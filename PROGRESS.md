# Build Progress

| Component                  | Status  | Notes |
|-----------------------------|---------|-------|
| Root scaffold                | done    | Root tsconfig(s), eslint, prettier, vitest config, `.nvmrc`, `.env.example`. |
| `@f1/contracts`               | done    | Shared types, Zod ingestion schemas, judge rubric, policy loader + tests. |
| `@f1/kalshi`                  | pending | Kalshi client (fixture + live modes), market snapshot fetcher. |
| `@f1/f1model`                 | pending | F1 domain evidence gathering (Jolpica, OpenF1, Open-Meteo, RSS). |
| `@f1/core`                    | pending | Decision pipeline: assess -> edge -> judge -> policy -> persist. |
| Fixtures                     | pending | Recorded sample payloads for offline/deterministic tests. |
| n8n workflows                | pending | Workflow JSON exports wiring the pipeline together. |
| docker-compose               | pending | n8n + Postgres + Ollama local stack. |
| Terraform                    | pending | GCP deployment infra-as-code. |
| CI/CD                        | pending | GitHub Actions: lint, typecheck, test, build. |
| Grafana / observability      | pending | Dashboards + metrics for decision pipeline runs. |
| README + PDF                 | pending | Top-level README and exported PDF doc. |
| GCP deploy                   | pending | Actual deployment to Allan's GCP project. |

Last updated: 2026-07-07
