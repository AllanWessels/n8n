# =============================================================================
# cloudsql.tf — Cloud SQL for PostgreSQL (n8n storage + decision ledger)
# =============================================================================
# Private IP only (no public IP), fronted by the VPC access connector so
# Cloud Run can reach it. deletion_protection is disabled for the demo so
# `terraform destroy` can tear the whole stack down cleanly.

resource "google_sql_database_instance" "main" {
  project             = var.project_id
  name                = "f1-decision-pg"
  region              = var.region
  database_version    = "POSTGRES_16"
  deletion_protection = false

  depends_on = [
    google_project_service.required,
    google_service_networking_connection.private_vpc_connection,
  ]

  settings {
    tier              = var.db_tier
    availability_type = "ZONAL"
    disk_autoresize   = true
    disk_size         = 10
    disk_type         = "PD_SSD"

    ip_configuration {
      ipv4_enabled    = false
      private_network = google_compute_network.main.id
    }

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = false
      start_time                     = "07:00"
    }

    insights_config {
      query_insights_enabled = true
    }
  }
}

resource "google_sql_database" "n8n" {
  project  = var.project_id
  name     = "n8n"
  instance = google_sql_database_instance.main.name
}

resource "google_sql_user" "n8n" {
  project  = var.project_id
  name     = "n8n"
  instance = google_sql_database_instance.main.name
  password = random_password.db_password.result
}
