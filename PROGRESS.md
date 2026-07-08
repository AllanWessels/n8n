# Build Progress

| Component                  | Status  | Notes |
|-----------------------------|---------|-------|
| Root scaffold                | done    | Root tsconfig(s), eslint, prettier, vitest config, `.nvmrc`, `.env.example`. |
| `@f1/contracts`               | done    | Shared types, Zod ingestion schemas, judge rubric, policy loader + tests. 100% runtime coverage. |
| `@f1/kalshi`                  | done    | Kalshi client (fixture + live modes), RSA-PSS signer, market snapshot fetcher. 100% stmt coverage, incl. signature round-trip test. |
| `@f1/f1model`                 | done    | Softmax win-probability model, betting-edge calc, half-Kelly sizing. 100% coverage. |
| `@f1/core`                    | done    | Reusable decision framework: agent -> judge -> guardrail -> decision record, `StubLLM` + `OllamaClient`. 99.6% coverage. |
| `@f1/app`                     | done    | End-to-end F1 pipeline + `f1-decision` CLI, in-memory + Postgres persistence. |
| Fixtures                     | done    | Real captured snapshots (Jolpica, OpenF1, Open-Meteo, Autosport, Kalshi) — clone-to-run with zero credentials. `fixtures/validate.mjs`. |
| n8n workflows                | done    | `00-decision-framework.json` (reusable), `10-f1-edge-flagship.json` (22-node flagship), `90-warmup-ping.json`. Validated to import into a real n8n container. |
| docker-compose               | done    | n8n + Postgres + Ollama local stack (`docker-compose.yml`). |
| Terraform                    | done    | Cloud Run (scale-to-zero), Cloud SQL, spot L4 Ollama MIG (toggleable), Pub/Sub, Secret Manager, WIF, monitoring dashboard, queue-mode toggle (`infra/terraform/`). |
| CI/CD                        | done    | `.github/workflows/ci.yml` (build/lint/test+coverage gate/artifact validation/gitleaks/terraform validate/Ollama-Qwen adversarial reviewer), `cd.yml` (WIF-authenticated, `ENABLE_CD`-gated deploy). |
| Local test/quality harness   | done    | 141 tests / 17 files, ~93.6% aggregate statement coverage (100% on `@f1/contracts`/`@f1/f1model`/`@f1/kalshi` runtime code, 99.6% on `@f1/core`). Enforced 80/80/75/80 coverage gate in CI. |
| README + graphs               | done    | Flagship + reusable-framework Mermaid graphs regenerated via `scripts/export-graph.mjs` (fixed to skip sticky notes and render `<br/>` line breaks). |
| GCP deploy                   | partial | n8n live on Cloud Run in project `f1-decision-platform`. Ollama GPU MIG written and `terraform apply`-ready but **not yet provisioned** — pending an L4 GPU quota grant (see `BLOCKERS.md`). |
| Grafana / observability      | partial | Cloud Monitoring dashboard JSON deployed (`infra/terraform/dashboards/n8n-overview.json`) + log-based metric + 5xx alert policy. No rendered dashboard screenshot captured yet. |
| Live n8n canvas screenshot   | pending | Workflows validated to import cleanly; a screenshot of the live n8n editor canvas has not yet been captured — see `make import-workflows` / `workflows/README.md`. |

Last updated: 2026-07-07
