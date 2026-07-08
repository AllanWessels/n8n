# =============================================================================
# artifact_registry.tf — Docker repo for custom n8n / Ollama images
# =============================================================================

resource "google_artifact_registry_repository" "images" {
  project       = var.project_id
  location      = var.region
  repository_id = "f1-decision-platform"
  description   = "Custom n8n and Ollama images for the f1-decision-platform demo."
  format        = "DOCKER"

  depends_on = [google_project_service.required]
}
