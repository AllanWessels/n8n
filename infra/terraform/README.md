# infra/terraform — f1-decision-platform GCP infrastructure

Terraform that provisions everything the f1-decision-platform demo needs
**inside** a GCP project. The project itself is created out-of-band by a
bootstrap script (billing account, project ID, initial IAM) — this
configuration takes `project_id` as an input variable and never creates or
destroys the project.

## What this provisions

- **Networking**: a VPC + subnet, a Serverless VPC Access connector (Cloud
  Run → Cloud SQL / Ollama), Private Services Access for Cloud SQL, and
  firewall rules scoped to internal traffic + Google health checks.
- **Cloud SQL for PostgreSQL 16** (private IP only, backups on,
  `db-f1-micro` by default) — n8n's database and the decision ledger.
- **Secret Manager**: generated (`random_password`) values for the DB
  password, n8n encryption key, and n8n JWT secret, plus empty placeholder
  secrets for Kalshi live-trading credentials that an operator populates
  out-of-band. No secret values are ever stored in this repo.
- **Artifact Registry**: a Docker repo for custom n8n / Ollama images.
- **Cloud Run (`f1-n8n`)**: the main n8n service, `min_instances = 0` by
  default (scale-to-zero), reading DB creds and encryption keys from Secret
  Manager, on the VPC connector so it can reach Cloud SQL and Ollama.
- **Ollama GPU host** (`enable_gpu = true` by default): a spot/preemptible
  `g2-standard-4` + NVIDIA L4 instance template behind a regional Managed
  Instance Group (0-2 replicas) and an internal passthrough load balancer,
  so `f1-n8n` always has a stable internal address for it. Guarded entirely
  by `var.enable_gpu` so it can be skipped if L4 quota isn't available yet.
- **Pub/Sub**: `decisions` topic + dead-letter topic/subscription for
  decision-pipeline events.
- **Workload Identity Federation**: a pool + GitHub OIDC provider + a
  `f1-gha-deployer` service account, scoped to a single `owner/repo`, so
  GitHub Actions can deploy without a long-lived JSON key.
- **Monitoring**: a dashboard (Cloud Run request count/latency/instances +
  decisions-logged) and an alert policy on elevated Cloud Run 5xx rate.
- **Queue mode** (`enable_queue_mode = false` by default): a toggleable
  Memorystore Redis instance + a second `n8n worker` Cloud Run service, for
  horizontal scaling beyond the single-service demo topology.

## Scale-to-zero + GPU quota notes

- The n8n Cloud Run service and (with `enable_queue_mode = true`) the worker
  service both default to `min_instances = 0`: no traffic, no cost.
- The Ollama MIG's regional autoscaler has `min_replicas = 0`, but standard
  CPU-utilization autoscaling **cannot itself scale from zero** (there's no
  running instance to sample). In this architecture, scale-from-zero is
  driven externally — an n8n "warm-up" workflow step calls the Compute API
  to set the instance group's `target_size` to 1 before a run that needs the
  local model; the autoscaler (and its cooldown) then manages scale-down.
- **New GCP projects typically start with 0 GPU quota** in most regions. If
  `terraform apply` fails provisioning the Ollama instance template/MIG with
  a quota error, either request an L4 quota increase for the target region,
  or set `enable_gpu = false` to stand up everything else without the GPU
  host.

## Usage

```bash
# Validate without any backend or credentials configured:
terraform init -backend=false
terraform validate
terraform fmt -check -recursive

# Real usage, once the bootstrap script has created the project + a GCS
# state bucket:
terraform init \
  -backend-config="bucket=<state-bucket-name>" \
  -backend-config="prefix=f1-decision-platform/terraform/state"

cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars with the real project_id / github_repo / etc.

terraform plan
terraform apply
```

## Files

| File | Purpose |
|---|---|
| `versions.tf` | Terraform + provider version constraints, GCS backend stub |
| `providers.tf` | `google` / `google-beta` provider config |
| `variables.tf` | All input variables |
| `apis.tf` | Enables required GCP APIs |
| `network.tf` | VPC, subnet, VPC connector, private services access, firewalls |
| `cloudsql.tf` | Cloud SQL for PostgreSQL (private IP) |
| `secrets.tf` | Generated + placeholder secrets in Secret Manager |
| `artifact_registry.tf` | Docker repo for images |
| `cloudrun_n8n.tf` | Main n8n Cloud Run service |
| `ollama_gpu.tf` | Spot L4 GPU MIG + internal LB for Ollama |
| `pubsub.tf` | Decision event topic + dead-letter topic/subscription |
| `wif.tf` | Workload Identity Federation for GitHub Actions |
| `monitoring.tf` | Dashboard + alert policy |
| `iam.tf` | Runtime service account + least-privilege roles |
| `queue_mode.tf` | Toggleable Redis + `n8n worker` service |
| `outputs.tf` | Deployment-relevant outputs |
| `data.tf` | Shared data sources |
| `terraform.tfvars.example` | Placeholder variable values |
| `scripts/ollama-startup.sh` | GCE startup script: installs Ollama, pulls models |
| `dashboards/n8n-overview.json` | Monitoring dashboard JSON |
