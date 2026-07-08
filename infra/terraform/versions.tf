# =============================================================================
# versions.tf — Terraform + provider version constraints, remote state backend
# =============================================================================
#
# The GCS backend block is intentionally left empty. Backend configuration
# (bucket, prefix, credentials) is supplied at `terraform init` time via
# `-backend-config=` flags or a `backend.hcl` file that is NOT committed to
# version control (it will typically differ per environment / operator).
#
# For local validation without any backend or credentials, run:
#   terraform init -backend=false
#
# For real usage against the GCS bucket created by the bootstrap script:
#   terraform init \
#     -backend-config="bucket=<state-bucket-name>" \
#     -backend-config="prefix=f1-decision-platform/terraform/state"

terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  backend "gcs" {
    # Intentionally empty — configured at `terraform init` time.
  }
}
