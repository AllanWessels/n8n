# =============================================================================
# providers.tf — provider configuration
# =============================================================================
# The GCP project itself is created out-of-band by a bootstrap script; this
# configuration only manages resources INSIDE that pre-existing project.

provider "google" {
  project = var.project_id
  region  = var.region
  zone    = var.zone
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
  zone    = var.zone
}
