# =============================================================================
# wif.tf — Workload Identity Federation for GitHub Actions (keyless deploys)
# =============================================================================
# Lets GitHub Actions workflows in `var.github_repo` impersonate a dedicated
# deployer service account without any long-lived JSON key ever leaving
# GCP. The attribute condition restricts the trust relationship to only the
# named repository.

resource "google_iam_workload_identity_pool" "github" {
  project                   = var.project_id
  workload_identity_pool_id = "f1-github-pool"
  display_name              = "f1-decision-platform GitHub pool"
  description               = "Workload Identity Pool for GitHub Actions OIDC deploys."

  depends_on = [google_project_service.required]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-oidc"
  display_name                       = "GitHub OIDC"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }

  # Only allow tokens minted for the configured repository.
  attribute_condition = "assertion.repository == \"${var.github_repo}\""

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account" "deployer" {
  project      = var.project_id
  account_id   = "f1-gha-deployer"
  display_name = "f1-decision-platform GitHub Actions deployer"
  description  = "Impersonated by GitHub Actions via Workload Identity Federation to deploy Cloud Run revisions and push images."
}

# Allow the GitHub repository (via the WIF pool/provider) to impersonate the
# deployer service account.
resource "google_service_account_iam_member" "wif_impersonation" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repo}"
}

# Least-privilege deploy roles: push images, deploy Cloud Run revisions, and
# act as the runtime service account when deploying.
locals {
  deployer_roles = [
    "roles/run.developer",
    "roles/artifactregistry.writer",
    "roles/iam.serviceAccountUser",
  ]
}

resource "google_project_iam_member" "deployer" {
  for_each = toset(local.deployer_roles)

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.deployer.email}"
}
