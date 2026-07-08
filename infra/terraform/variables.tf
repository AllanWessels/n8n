# =============================================================================
# variables.tf — input variables for the f1-decision-platform GCP deployment
# =============================================================================

variable "project_id" {
  description = "GCP project ID that Terraform manages resources in. The project itself is created out-of-band by a bootstrap script — Terraform never creates or destroys the project."
  type        = string
}

variable "region" {
  description = "Default GCP region for regional resources (Cloud Run, Cloud SQL, VPC connector, MIG, etc.)."
  type        = string
  default     = "us-central1"
}

variable "zone" {
  description = "Default GCP zone (used for zonal resources / instance template defaults)."
  type        = string
  default     = "us-central1-a"
}

variable "n8n_image" {
  description = "Fully-qualified container image reference for the n8n Cloud Run service (e.g. us-central1-docker.pkg.dev/<project>/<repo>/n8n:latest). Defaults to the public n8n image so the plan is valid before a custom image has been pushed."
  type        = string
  default     = "docker.n8n.io/n8nio/n8n:latest"
}

variable "ollama_gpu_type" {
  description = "GPU accelerator type attached to the Ollama inference instance template."
  type        = string
  default     = "nvidia-l4"
}

variable "enable_gpu" {
  description = "Whether to provision the spot/preemptible GPU-backed Ollama MIG. Disable for a CPU-only or fully scaled-down demo to avoid GPU quota requirements."
  type        = bool
  default     = true
}

variable "enable_queue_mode" {
  description = "Whether to provision n8n queue-mode resources (Memorystore Redis + a dedicated `n8n worker` Cloud Run service) for horizontal scaling. Disabled by default for the cost-minimal single-service demo topology."
  type        = bool
  default     = false
}

variable "github_repo" {
  description = "GitHub repository in 'owner/name' form allowed to impersonate the Workload Identity Federation deployer service account (e.g. \"allan-org/f1-decision-platform\")."
  type        = string
}

variable "db_tier" {
  description = "Cloud SQL machine tier. db-f1-micro is the smallest shared-core tier, suitable for a low-traffic portfolio demo."
  type        = string
  default     = "db-f1-micro"
}

variable "min_instances" {
  description = "Minimum Cloud Run instance count for the n8n service. 0 enables scale-to-zero for cost minimization."
  type        = number
  default     = 0
}

variable "max_instances" {
  description = "Maximum Cloud Run instance count for the n8n service."
  type        = number
  default     = 4
}

variable "n8n_public" {
  description = "Whether the n8n Cloud Run service is invocable by allUsers (public demo access) rather than requiring IAM-authenticated invocation."
  type        = bool
  default     = true
}
