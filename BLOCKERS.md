# Hand-off — what's live and what needs Allan (morning)

## ✅ Done autonomously overnight (2026-07-07)
- **Live GCP deploy**: n8n is running on Cloud Run + Cloud SQL Postgres in the new project
  **`f1-decision-platform`** (created under your org, billing `01FA1A-4B91D5-956F9E`).
  - n8n URL: **https://f1-n8n-4nbtikalia-uc.a.run.app** (scale-to-zero; first hit cold-starts ~1-2s)
  - 64 Terraform resources applied (VPC, Cloud SQL, Secret Manager, Pub/Sub, Artifact Registry, WIF, monitoring).
- **Repo**: pushed to https://github.com/AllanWessels/n8n — clone→run, README (+PDF), 141 tests, CI/CD.

## Action items for you
1. **Complete the n8n owner account** (one-time): open https://f1-n8n-4nbtikalia-uc.a.run.app/setup and create the
   owner login. Then import the workflows: `make import-workflows` (or Import from the UI), and in n8n set the
   credentials referenced by the nodes — Postgres (Cloud SQL), Ollama (once GPU is up), and the JWT webhook secret
   (already in Secret Manager as `f1-n8n-jwt-secret`).
2. **GPU (L4) quota** — currently deferred (`enable_gpu=false`). New projects start at 0 L4 quota.
   - Request quota: Console → IAM & Admin → Quotas → filter "NVIDIA L4 GPUs" (region `us-central1`) → request ≥1.
   - Once granted: set `enable_gpu=true` in `infra/terraform/terraform.tfvars` and `make deploy` (or `make gpu-up`).
   - Until then the cloud n8n has no LLM endpoint; the **local** stack (RTX 5080 + Ollama) runs the full AI pipeline.
3. **(Optional) live Kalshi** — market DATA is keyless (live prices work with no key). A key is only needed to
   demonstrate the (paper-only) trade path. To enable: `gcloud secrets versions add f1-kalshi-api-key-id ...` and
   `f1-kalshi-private-key ...`, then set `KALSHI_MODE=live`. Defaults to fixtures otherwise.
4. **(Optional) CI/CD deploy** — `cd.yml` is WIF-ready but gated by repo var `ENABLE_CD=true`. To turn on keyless
   deploys from GitHub Actions, set repo secrets `GCP_WIF_PROVIDER`, `GCP_DEPLOY_SA`, `GCP_PROJECT_ID`,
   `GCP_TFSTATE_BUCKET` (values in `terraform output`) and var `ENABLE_CD=true`.

## Known limitations (documented honestly in README)
- Local **7B** Qwen produces weakly-grounded assessments that the adversarial judge correctly rejects; assessment
  quality scales with model size (14B/32B locally, or a hosted model via the same OpenAI-compatible interface).
- Live unquoted (`null`-price) Kalshi markets: `kalshiImpliedProb` returns `NaN`→HOLD in memory; a null-safe
  `EdgeResult` schema refactor is noted as a future cleanup (demo fixtures are all priced, so unaffected).

## Cost note
Idle cost is ~Cloud SQL `db-f1-micro` (~$8/mo) + minimal; Cloud Run and GPU are scale-to-zero ($0 idle).
To tear everything down: `make destroy` (or `terraform -chdir=infra/terraform destroy`).
