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
   Remaining (couldn't be done from the assistant's sandbox — it blocks writes to the live instance): **import the
   3 workflows** and set node credentials. Fastest path: log in → **Workflows → Import from File** → pick each of
   `workflows/*.json`. Then set the credentials the nodes reference — Postgres (Cloud SQL), Ollama (the GPU ILB IP,
   step 2), and the JWT webhook secret (already in Secret Manager as `f1-n8n-jwt-secret`).
2. **GPU (L4) quota — GRANTED** (`NVIDIA_L4_GPUS: limit=1`, spot too, `us-central1`). `enable_gpu=true` is now set in
   `infra/terraform/terraform.tfvars` and Terraform is initialized with a clean plan (**10 to add, 0 to destroy**).
   Apply it to create the MIG (it starts at **min=0 → $0 idle**):
   ```bash
   terraform -chdir=infra/terraform apply   # review the plan, then approve
   ```
   Then `make gpu-up PROJECT_ID=f1-decision-platform REGION=us-central1` scales it to 1 for a demo, and the Ollama
   credential URL in n8n is `http://<f1-ollama-ilb-ip>:11434` (`terraform output`). The **local** stack runs the full
   AI pipeline with no GPU cost in the meantime.
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
