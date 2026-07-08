# Hand-off — what's live and what needs Allan (morning)

## ✅ Done autonomously overnight (2026-07-07)
- **Live GCP deploy**: n8n is running on Cloud Run + Cloud SQL Postgres in the new project
  **`f1-decision-platform`** (created under your org, billing `01FA1A-4B91D5-956F9E`).
  - n8n URL: **https://f1-n8n-4nbtikalia-uc.a.run.app** (scale-to-zero; first hit cold-starts ~1-2s)
  - 64 Terraform resources applied (VPC, Cloud SQL, Secret Manager, Pub/Sub, Artifact Registry, WIF, monitoring).
- **Repo**: pushed to https://github.com/AllanWessels/n8n — clone→run, README (+PDF), 141 tests, CI/CD.

## Action items for you
1. **n8n owner account — DONE.** The owner login on https://f1-n8n-4nbtikalia-uc.a.run.app is created
   (owner `j.allan.wessels@gmail.com`; password shared privately — change it in Settings → change password).
   Remaining: **import the 3 workflows** and set node credentials. Import is now programmatic (version-controlled,
   no UI paste): `N8N_BASE=https://f1-n8n-4nbtikalia-uc.a.run.app N8N_EMAIL=... N8N_PASSWORD=... make import-workflows-remote`
   (CD does this automatically once an `f1-n8n-api-key` secret exists). Then set the credentials the nodes reference —
   Postgres (host `10.199.0.3`, db/user `n8n`, pw in Secret Manager `f1-db-password`), Ollama (`http://10.10.0.2:11434`),
   and the JWT webhook secret (Secret Manager `f1-n8n-jwt-secret`).
2. **GPU tier — APPLIED; one quota still pending.** `enable_gpu=true` and the whole Ollama GPU topology is now
   **provisioned** (instance template, MIG `f1-ollama-mig` at size 0, autoscaler, internal LB `10.10.0.2`), and n8n's
   `OLLAMA_BASE_URL` is auto-wired to `http://10.10.0.2:11434`. Fixing the apply surfaced four real IaC bugs (dead boot
   image, regional-MIG update-policy rule, L4 zone availability, internal-LB balancing mode) — all committed.
   - **Blocker:** GCP enforces *two* GPU quotas. The regional `NVIDIA_L4_GPUS` is granted (=1), but the global
     **`GPUS_ALL_REGIONS` is still 0**, so every instance creation fails with `Quota 'GPUS_ALL_REGIONS' exceeded`.
   - An increase request for `GPUS-ALL-REGIONS-per-project` → **4** has been **submitted** (Cloud Quotas, status
     `reconciling`). Track it: Console → IAM & Admin → Quotas → filter "GPUs (all regions)". Same async grant as the
     L4 one (minutes–a day).
   - **Once granted:** `make gpu-up PROJECT_ID=f1-decision-platform REGION=us-central1` boots a spot L4 (verified the
     instance *does* create once quota clears), pulls the Qwen models (~3-4 min), and the pipeline runs against the
     cloud GPU. `make gpu-down` returns it to zero. The **local** stack runs the full AI pipeline in the meantime.
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
