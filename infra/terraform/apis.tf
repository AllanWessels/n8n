# =============================================================================
# apis.tf — enable required GCP APIs on the target project
# =============================================================================
# disable_on_destroy = false so that `terraform destroy` (e.g. tearing down
# the demo) never disables APIs project-wide; the bootstrap script owns the
# lifecycle of the project itself.

locals {
  required_apis = [
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "compute.googleapis.com",
    "servicenetworking.googleapis.com",
    "pubsub.googleapis.com",
    "secretmanager.googleapis.com",
    "artifactregistry.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "monitoring.googleapis.com",
    "logging.googleapis.com",
    "vpcaccess.googleapis.com",
    "cloudresourcemanager.googleapis.com",
  ]
}

resource "google_project_service" "required" {
  for_each = toset(local.required_apis)

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}
