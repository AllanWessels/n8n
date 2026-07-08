# =============================================================================
# secrets.tf — generated + placeholder secrets, stored in Secret Manager
# =============================================================================
# No secret VALUES live in this repo. `random_password` generates strong
# values for the resources Terraform itself owns (DB password, n8n
# encryption key, n8n JWT secret) at apply time; Kalshi credentials are
# created as empty placeholder secret versions that an operator populates
# out-of-band (e.g. `gcloud secrets versions add`) once live trading is
# enabled.

resource "random_password" "db_password" {
  length  = 32
  special = false # Cloud SQL password chars are restricted; keep it simple/safe.
}

resource "random_password" "n8n_encryption_key" {
  length  = 32
  special = false
}

resource "random_password" "n8n_jwt_secret" {
  length  = 48
  special = false
}

locals {
  # Terraform-managed secret values (rotated via `terraform apply` if the
  # underlying random_password resources are ever re-generated).
  managed_secrets = {
    db_password        = random_password.db_password.result
    n8n_encryption_key = random_password.n8n_encryption_key.result
    n8n_jwt_secret     = random_password.n8n_jwt_secret.result
  }

  # Placeholders only — Terraform creates the secret + an empty version so
  # the resource (and IAM binding) exists, but the real value is populated
  # out-of-band (e.g. `gcloud secrets versions add`) before enabling
  # KALSHI_MODE=live. Terraform never overwrites a manually-added version.
  placeholder_secrets = {
    kalshi_api_key_id  = ""
    kalshi_private_key = ""
  }

  all_secrets = merge(local.managed_secrets, local.placeholder_secrets)
}

resource "google_secret_manager_secret" "this" {
  for_each = local.all_secrets

  project   = var.project_id
  secret_id = "f1-${replace(each.key, "_", "-")}"

  replication {
    auto {}
  }

  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret_version" "managed" {
  for_each = local.managed_secrets

  secret      = google_secret_manager_secret.this[each.key].id
  secret_data = each.value
}

resource "google_secret_manager_secret_version" "placeholder" {
  for_each = local.placeholder_secrets

  secret      = google_secret_manager_secret.this[each.key].id
  secret_data = each.value

  # Placeholder value only; avoid re-creating the version out from under an
  # operator who has since populated it manually out-of-band.
  lifecycle {
    ignore_changes = [secret_data]
  }
}

resource "google_secret_manager_secret_iam_member" "n8n_runtime_access" {
  for_each = local.all_secrets

  project   = var.project_id
  secret_id = google_secret_manager_secret.this[each.key].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.n8n_runtime.email}"
}
