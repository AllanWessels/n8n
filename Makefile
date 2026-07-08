# =============================================================================
# f1-decision-platform — lifecycle Makefile
#
# `make help` (or just `make`) lists all targets. Most targets are thin
# wrappers around npm scripts / docker compose / gcloud / terraform so the
# whole platform lifecycle is discoverable from one place.
# =============================================================================

.PHONY: help install test test-cov lint typecheck \
        up down logs ps warm import-workflows seed e2e graph pdf \
        bootstrap-gcp deploy gpu-up gpu-down destroy clean

.DEFAULT_GOAL := help

# --- container / project names (must match docker-compose.yml) -------------
POSTGRES_CONTAINER := f1-postgres
N8N_CONTAINER       := f1-n8n
OLLAMA_CONTAINER    := f1-ollama

# --- GCP deploy vars (override via env, see scripts/bootstrap-gcp.sh) -------
PROJECT_ID ?= f1-decision-platform
REGION     ?= us-central1

# --- load .env (gitignored) if present, so DB_POSTGRESDB_* etc. are
# available to both Make and the shell recipes below (e.g. `make seed`) ----
ifneq (,$(wildcard .env))
include .env
export
endif

# --- host-side Ollama URL --------------------------------------------------
# Host processes (e.g. `make e2e`) reach Ollama over its PUBLISHED port on
# localhost. This is deliberately NOT the container-internal OLLAMA_BASE_URL
# (http://ollama:11434 from .env), which only resolves inside the compose
# network — using it from the host fails DNS with "fetch failed". Defaults to
# the compose publish port; override OLLAMA_PORT if you remapped it, or set
# OLLAMA_HOST_URL directly to point at any reachable Ollama.
OLLAMA_PORT     ?= 11434
OLLAMA_HOST_URL ?= http://localhost:$(OLLAMA_PORT)

help: ## Show this help
	@echo "f1-decision-platform — available targets:"
	@echo
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z0-9_-]+:.*##/ { printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

# --- npm / build lifecycle ---------------------------------------------------

install: ## Install npm dependencies (workspace root + packages)
	@echo "==> Installing dependencies..."
	npm install

test: ## Run the test suite (vitest)
	@echo "==> Running tests..."
	npm run test

test-cov: ## Run the test suite with coverage
	@echo "==> Running tests with coverage..."
	npm run test:cov

lint: ## Run eslint
	@echo "==> Linting..."
	npm run lint

typecheck: ## Type-check / build TypeScript project references
	@echo "==> Type-checking (tsc --build)..."
	npm run build

# --- docker compose lifecycle ------------------------------------------------

up: ## Start the local stack (postgres, n8n, ollama) in the background
	@echo "==> Starting local stack..."
	docker compose up -d
	@echo
	@echo "n8n:     http://localhost:5678"
	@echo "ollama:  http://localhost:11434"
	@echo "postgres: localhost:5432"
	@echo
	@echo "Tip: 'make warm' to pull local models, 'make seed' to (re)apply the schema."

down: ## Stop the local stack
	@echo "==> Stopping local stack..."
	docker compose down

logs: ## Tail logs from all services
	docker compose logs -f

ps: ## Show status of stack containers
	docker compose ps

warm: ## Pull the local Ollama models used by the pipeline
	@echo "==> Pulling Ollama models into $(OLLAMA_CONTAINER) (this may take a while)..."
	docker exec $(OLLAMA_CONTAINER) ollama pull qwen2.5:7b-instruct
	docker exec $(OLLAMA_CONTAINER) ollama pull qwen2.5:14b-instruct
	@echo "==> Models ready."
	docker exec $(OLLAMA_CONTAINER) ollama list

import-workflows: ## Import workflows/*.json into n8n via its CLI
	@echo "==> Importing workflows from ./workflows into $(N8N_CONTAINER)..."
	docker exec $(N8N_CONTAINER) n8n import:workflow --separate --input=/workflows
	@echo
	@echo "NOTE: importing does not activate workflows. Activation (for webhook"
	@echo "      triggers etc.) currently requires the n8n REST API or the UI —"
	@echo "      log in at http://localhost:5678 and toggle 'Active', or call"
	@echo "      POST /rest/workflows/:id/activate with a valid session/API key."

import-workflows-remote: ## Import workflows/*.json into a REMOTE n8n over its API (idempotent). Needs N8N_BASE + (N8N_API_KEY | N8N_EMAIL+N8N_PASSWORD)
	@echo "==> Importing ./workflows into $(N8N_BASE) via API..."
	node scripts/import-workflows-remote.mjs

seed: ## (Re)apply db/schema.sql to postgres — idempotent (CREATE TABLE IF NOT EXISTS)
	@echo "==> Applying db/schema.sql to $(POSTGRES_CONTAINER)..."
	docker exec -i $(POSTGRES_CONTAINER) psql -U $${DB_POSTGRESDB_USER:-n8n} -d $${DB_POSTGRESDB_DATABASE:-n8n} < db/schema.sql
	@echo "==> Schema applied."

e2e: ## Run the end-to-end decision-pipeline script against a host-reachable Ollama ($(OLLAMA_HOST_URL))
	@if [ -f scripts/run-decision.mjs ]; then \
		echo "==> Running scripts/run-decision.mjs (Ollama: $(OLLAMA_HOST_URL))..."; \
		node scripts/run-decision.mjs --ollama-url $(OLLAMA_HOST_URL); \
	else \
		echo "run-decision not yet wired (scripts/run-decision.mjs is missing) — skipping."; \
		exit 0; \
	fi

graph: ## Render authentic n8n canvases + the architecture figure to docs/img/*.png
	@echo "==> Rendering architecture figure..."
	node scripts/render-architecture.mjs
	@echo "==> Rendering n8n canvases from the live instance (run 'make up && make import-workflows' first)..."
	node scripts/configure-n8n-creds.mjs
	node scripts/render-n8n-live.mjs

pdf: ## Render README.md to docs/README.pdf (best-effort)
	@echo "==> Rendering docs/README.pdf from README.md..."
	@mkdir -p docs
	node scripts/render-pdf.mjs

# --- GCP / Terraform ----------------------------------------------------------

bootstrap-gcp: ## One-time GCP project/billing/API/tfstate-bucket setup
	@echo "==> Bootstrapping GCP project (PROJECT_ID=$(PROJECT_ID) REGION=$(REGION))..."
	PROJECT_ID=$(PROJECT_ID) REGION=$(REGION) bash scripts/bootstrap-gcp.sh

deploy: ## Apply Terraform to the GCP project (infra/terraform)
	@echo "==> Deploying via Terraform (PROJECT_ID=$(PROJECT_ID) REGION=$(REGION))..."
	PROJECT_ID=$(PROJECT_ID) REGION=$(REGION) bash scripts/deploy.sh

gpu-up: ## Warm the Ollama GPU MIG to 1 for a demo (requires PROJECT_ID, REGION)
	@echo "==> Warming Ollama GPU MIG (PROJECT_ID=$(PROJECT_ID) REGION=$(REGION))..."
	# An autoscaled regional MIG rejects manual resize, and CPU-autoscaling can't
	# scale up *from zero* with no running instance to read a metric from — so
	# warming is an explicit op: turn the autoscaler off, then resize to 1.
	gcloud compute instance-groups managed update-autoscaling f1-ollama-mig \
		--project=$(PROJECT_ID) --region=$(REGION) --mode=off
	gcloud compute instance-groups managed resize f1-ollama-mig \
		--project=$(PROJECT_ID) --region=$(REGION) --size=1
	@echo "==> Booting. First boot pulls the Qwen models (~3-4 min). Watch: make gpu-status"

gpu-down: ## Scale the Ollama GPU MIG down to zero (saves cost)
	@echo "==> Scaling Ollama GPU MIG to zero (PROJECT_ID=$(PROJECT_ID) REGION=$(REGION))..."
	gcloud compute instance-groups managed resize f1-ollama-mig \
		--project=$(PROJECT_ID) --region=$(REGION) --size=0

gpu-status: ## Show the Ollama GPU MIG instance state + health (requires PROJECT_ID, REGION)
	@gcloud compute instance-groups managed list-instances f1-ollama-mig \
		--project=$(PROJECT_ID) --region=$(REGION) \
		--format='table(instance.basename(),instanceStatus,currentAction)'

destroy: ## Destroy all Terraform-managed GCP resources
	@echo "==> Destroying Terraform-managed resources (PROJECT_ID=$(PROJECT_ID) REGION=$(REGION))..."
	terraform -chdir=infra/terraform destroy \
		-var project_id=$(PROJECT_ID) -var region=$(REGION)

# --- housekeeping -------------------------------------------------------------

clean: ## Remove build output and coverage artifacts
	@echo "==> Cleaning dist/coverage..."
	npm run clean
