# =============================================================================
# outputs.tf
# =============================================================================

output "n8n_url" {
  description = "Public HTTPS URL of the n8n Cloud Run service."
  value       = google_cloud_run_v2_service.n8n.uri
}

output "cloudsql_private_ip" {
  description = "Private IP address of the Cloud SQL for PostgreSQL instance."
  value       = google_sql_database_instance.main.private_ip_address
}

output "ollama_mig_name" {
  description = "Name of the regional managed instance group backing the Ollama GPU host (null if enable_gpu = false)."
  value       = var.enable_gpu ? google_compute_region_instance_group_manager.ollama[0].name : null
}

output "wif_provider" {
  description = "Full resource name of the Workload Identity Federation provider, for use in GitHub Actions' google-github-actions/auth `workload_identity_provider` input."
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "deployer_sa_email" {
  description = "Email of the deployer service account GitHub Actions impersonates via WIF."
  value       = google_service_account.deployer.email
}

output "artifact_registry_repo" {
  description = "Full Artifact Registry repository path for pushing custom n8n / Ollama images."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
}
