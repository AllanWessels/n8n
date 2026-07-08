# =============================================================================
# iam.tf — runtime service account for the n8n Cloud Run service(s)
# =============================================================================
# Least-privilege roles: Cloud SQL client (to reach Cloud SQL via the
# Cloud SQL Auth Proxy / private IP), Secret Manager accessor (to read
# runtime secrets), Pub/Sub publisher (to emit decision events), and the
# standard logging/monitoring writer roles.

resource "google_service_account" "n8n_runtime" {
  project      = var.project_id
  account_id   = "f1-n8n-runtime"
  display_name = "f1-decision-platform n8n runtime"
  description  = "Runtime identity for the n8n Cloud Run service(s); least-privilege access to Cloud SQL, Secret Manager, and Pub/Sub."
}

locals {
  n8n_runtime_roles = [
    "roles/cloudsql.client",
    "roles/secretmanager.secretAccessor",
    "roles/pubsub.publisher",
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
  ]
}

resource "google_project_iam_member" "n8n_runtime" {
  for_each = toset(local.n8n_runtime_roles)

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.n8n_runtime.email}"
}
