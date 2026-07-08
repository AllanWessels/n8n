#!/usr/bin/env bash
# =============================================================================
# bootstrap-gcp.sh — one-time GCP project setup for f1-decision-platform.
#
# Creates (or reuses) a GCP project, links billing, enables the core APIs
# Terraform will need, and creates a GCS bucket for Terraform remote state.
# Nothing here provisions compute/GPU resources — that's Terraform's job
# (see `make deploy` / `scripts/deploy.sh`).
#
# Idempotent: every step checks for existing state before creating.
#
# Usage:
#   PROJECT_ID=my-project BILLING_ACCOUNT=XXXXXX-XXXXXX-XXXXXX \
#     scripts/bootstrap-gcp.sh
#
#   scripts/bootstrap-gcp.sh my-project us-central1
#
# Env vars (all optional, sensible defaults below):
#   PROJECT_ID        GCP project id to create/use.      default: f1-decision-platform
#   BILLING_ACCOUNT    Billing account id to link.         default: 01FA1A-4B91D5-956F9E
#   ORG_ID              GCP organization id (optional).     default: (unset — personal project)
#   REGION             Default region for resources.       default: us-central1
# =============================================================================

set -euo pipefail

# --- inputs ------------------------------------------------------------

PROJECT_ID="${1:-${PROJECT_ID:-f1-decision-platform}}"
REGION="${2:-${REGION:-us-central1}}"
BILLING_ACCOUNT="${BILLING_ACCOUNT:-01FA1A-4B91D5-956F9E}"
ORG_ID="${ORG_ID:-}"

TFSTATE_BUCKET="${PROJECT_ID}-tfstate"

echo "=== f1-decision-platform: GCP bootstrap ==="
echo "PROJECT_ID:      ${PROJECT_ID}"
echo "REGION:           ${REGION}"
echo "BILLING_ACCOUNT:   ${BILLING_ACCOUNT}"
echo "ORG_ID:            ${ORG_ID:-<none>}"
echo "TFSTATE_BUCKET:    ${TFSTATE_BUCKET}"
echo

if ! command -v gcloud >/dev/null 2>&1; then
  echo "ERROR: gcloud CLI not found on PATH. Install the Google Cloud SDK first:" >&2
  echo "  https://cloud.google.com/sdk/docs/install" >&2
  exit 1
fi

# --- 1. create project (skip if it already exists) ---------------------

if gcloud projects describe "${PROJECT_ID}" >/dev/null 2>&1; then
  echo "[1/5] Project ${PROJECT_ID} already exists — skipping creation."
else
  echo "[1/5] Creating project ${PROJECT_ID}..."
  if [[ -n "${ORG_ID}" ]]; then
    gcloud projects create "${PROJECT_ID}" --organization="${ORG_ID}"
  else
    gcloud projects create "${PROJECT_ID}"
  fi
fi

# --- 2. link billing -----------------------------------------------------

echo "[2/5] Linking billing account ${BILLING_ACCOUNT}..."
CURRENT_BILLING="$(gcloud billing projects describe "${PROJECT_ID}" \
  --format='value(billingAccountName)' 2>/dev/null || true)"
if [[ "${CURRENT_BILLING}" == *"${BILLING_ACCOUNT}"* ]]; then
  echo "      Billing already linked — skipping."
else
  gcloud billing projects link "${PROJECT_ID}" \
    --billing-account="${BILLING_ACCOUNT}"
fi

# --- 3. enable core APIs ---------------------------------------------------

echo "[3/5] Enabling core APIs (this can take a minute)..."
gcloud services enable \
  compute.googleapis.com \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudresourcemanager.googleapis.com \
  iam.googleapis.com \
  storage.googleapis.com \
  secretmanager.googleapis.com \
  --project="${PROJECT_ID}"

# --- 4. create Terraform state bucket -------------------------------------

echo "[4/5] Creating Terraform state bucket gs://${TFSTATE_BUCKET}..."
if gcloud storage buckets describe "gs://${TFSTATE_BUCKET}" >/dev/null 2>&1; then
  echo "      Bucket already exists — skipping."
else
  gcloud storage buckets create "gs://${TFSTATE_BUCKET}" \
    --project="${PROJECT_ID}" \
    --location="${REGION}" \
    --uniform-bucket-level-access
  gcloud storage buckets update "gs://${TFSTATE_BUCKET}" --versioning
fi

# --- 5. summary ------------------------------------------------------------

echo "[5/5] Done."
echo
echo "=== Summary ==="
echo "Project:            ${PROJECT_ID}"
echo "Region:              ${REGION}"
echo "Terraform state:      gs://${TFSTATE_BUCKET}"
echo
echo "Next steps:"
echo "  1. Set PROJECT_ID and REGION in your environment (or .env):"
echo "       export PROJECT_ID=${PROJECT_ID}"
echo "       export REGION=${REGION}"
echo "  2. Initialize Terraform with the remote state backend:"
echo "       terraform -chdir=infra/terraform init -backend-config=\"bucket=${TFSTATE_BUCKET}\""
echo "  3. Deploy: make deploy   (wraps scripts/deploy.sh)"
echo
echo "Note: no compute/GPU resources have been created yet — only the"
echo "project, billing link, enabled APIs, and Terraform state bucket."
