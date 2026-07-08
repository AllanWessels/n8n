#!/usr/bin/env bash
# =============================================================================
# deploy.sh — apply the Terraform configuration in infra/terraform to the
# GCP project created by scripts/bootstrap-gcp.sh.
#
# Usage:
#   PROJECT_ID=my-project REGION=us-central1 scripts/deploy.sh
#
# Requires:
#   - `terraform` on PATH
#   - `gcloud` authenticated (gcloud auth application-default login)
#   - infra/terraform/ containing the Terraform configuration (provisioned
#     by a separate task in this repo)
#
# Note: the Ollama inference host is planned to run on an L4 GPU instance.
# New GCP projects typically start with 0 GPU quota in most regions — if
# `terraform apply` fails with a quota error, request a quota increase at:
#   https://console.cloud.google.com/iam-admin/quotas
# before re-running this script (Terraform apply is safe to re-run).
# =============================================================================

set -euo pipefail

PROJECT_ID="${PROJECT_ID:?ERROR: set PROJECT_ID (e.g. export PROJECT_ID=f1-decision-platform)}"
REGION="${REGION:-us-central1}"
TFSTATE_BUCKET="${TFSTATE_BUCKET:-${PROJECT_ID}-tfstate}"
TF_DIR="infra/terraform"

if ! command -v terraform >/dev/null 2>&1; then
  echo "ERROR: terraform CLI not found on PATH. Install it first:" >&2
  echo "  https://developer.hashicorp.com/terraform/install" >&2
  exit 1
fi

if [[ ! -d "${TF_DIR}" ]]; then
  echo "ERROR: ${TF_DIR} not found. Terraform configuration has not been added to this repo yet." >&2
  exit 1
fi

echo "=== f1-decision-platform: Terraform deploy ==="
echo "PROJECT_ID:     ${PROJECT_ID}"
echo "REGION:          ${REGION}"
echo "TFSTATE_BUCKET:   ${TFSTATE_BUCKET}"
echo

echo "[1/2] terraform init..."
terraform -chdir="${TF_DIR}" init \
  -backend-config="bucket=${TFSTATE_BUCKET}"

echo "[2/2] terraform apply..."
terraform -chdir="${TF_DIR}" apply \
  -var "project_id=${PROJECT_ID}" \
  -var "region=${REGION}"

echo
echo "Deploy complete. If this failed on GPU quota, request an increase and re-run:"
echo "  https://console.cloud.google.com/iam-admin/quotas?project=${PROJECT_ID}"
