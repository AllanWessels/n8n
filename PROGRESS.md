# Build Progress

Positioning: this repo is the **Decision Orchestration Platform** — a source-agnostic,
n8n-orchestrated decision-automation platform. The F1 / prediction-market pipeline below is
the reference implementation proving the framework generalizes; it is not the point of the
project. See `README.md` for the full pitch, the attribute → implementation matrix, and
example domains the same core could serve (credit/risk, claims triage, supplier selection,
content moderation, ops routing).

| Component                  | Status  | Notes |
|-----------------------------|---------|-------|
| Root scaffold                | done    | Root tsconfig(s), eslint, prettier, vitest config, `.nvmrc`, `.env.example`. |
| `@dop/contracts`              | done    | Shared types, Zod ingestion schemas, judge rubric, policy loader + tests. 100% runtime coverage. |
| `@dop/kalshi`                 | done    | Read-only external market-signal client (fixture + live modes), RSA-PSS signer, market snapshot fetcher. 100% stmt coverage, incl. signature round-trip test. |
| `@dop/f1model`                | done    | Softmax probability model, model-vs-market signal calc, half-Kelly sizing. 100% coverage. |
| `@dop/core`                   | done    | Reusable, domain-agnostic decision framework: agent -> judge -> guardrail -> decision record, `StubLLM` + `OllamaClient`. 99.6% coverage. |
| `@dop/app`                    | done    | End-to-end reference pipeline + `f1-decision` CLI, in-memory + Postgres persistence. |
| Fixtures                     | done    | Real captured snapshots (Jolpica, OpenF1, Open-Meteo, Autosport, Kalshi) — clone-to-run with zero credentials. `fixtures/validate.mjs`. |
| n8n workflows                | done    | `00-decision-framework.json` (reusable, domain-agnostic core), `10-f1-edge-flagship.json` (flagship reference pipeline), `90-warmup-ping.json`. Validated to import into a real n8n container. |
| docker-compose               | done    | n8n + Postgres + Ollama local stack (`docker-compose.yml`). |
| Terraform                    | done    | Cloud Run (scale-to-zero), Cloud SQL, spot L4 Ollama MIG (toggleable), Pub/Sub, Secret Manager, WIF, monitoring dashboard, queue-mode toggle (`infra/terraform/`). |
| CI/CD                        | done    | `.github/workflows/ci.yml` (build/lint/test+coverage gate/artifact validation/gitleaks/terraform validate/Ollama-Qwen adversarial reviewer), `cd.yml` (WIF-authenticated, `ENABLE_CD`-gated deploy). |
| Local test/quality harness   | done    | 141 tests / 17 files, ~93.6% aggregate statement coverage (100% on `@dop/contracts`/`@dop/f1model`/`@dop/kalshi` runtime code, 99.6% on `@dop/core`). Enforced 80/80/75/80 coverage gate in CI. |
| README repositioning          | done    | README rewritten around the Decision Orchestration Platform positioning: business-language attribute matrix, source-agnostic framing, humans-own-the-logic emphasis, colorized architecture diagram, all betting/gambling terminology removed. |
| n8n canvas screenshots        | pending | `docs/img/n8n-flagship.png` and `docs/img/n8n-framework.png` are referenced from README as the workflow-graph visuals; the PNGs themselves have not been captured yet (Mermaid `.mmd` exports in `docs/img/` exist today via `make graph`). |
| GCP deploy                   | partial | n8n live on Cloud Run. Ollama GPU MIG written and `terraform apply`-ready but **not yet provisioned** — pending an L4 GPU quota grant (see `BLOCKERS.md`). |
| Grafana / observability      | partial | Cloud Monitoring dashboard JSON deployed (`infra/terraform/dashboards/n8n-overview.json`) + log-based metric + 5xx alert policy. No rendered dashboard screenshot captured yet. |

Last updated: 2026-07-08
