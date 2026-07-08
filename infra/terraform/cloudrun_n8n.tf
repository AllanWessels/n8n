# =============================================================================
# cloudrun_n8n.tf — n8n main service on Cloud Run (scale-to-zero capable)
# =============================================================================

locals {
  # Stable internal address for the Ollama GPU host when enabled; when GPU
  # inference is disabled this is left unset (empty string) — workflows that
  # need a local model will fail gracefully / fall back until GPU is enabled.
  ollama_base_url = var.enable_gpu ? "http://${google_compute_address.ollama_ilb[0].address}:11434" : ""

  n8n_container_port = 5678
}

resource "google_cloud_run_v2_service" "n8n" {
  project  = var.project_id
  name     = "f1-n8n"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  deletion_protection = false

  template {
    service_account = google_service_account.n8n_runtime.email

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    vpc_access {
      connector = google_vpc_access_connector.main.id
      egress    = "PRIVATE_RANGES_ONLY"
    }

    containers {
      image = var.n8n_image

      ports {
        container_port = local.n8n_container_port
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "1Gi"
        }
        # Cloud Run CPU-throttling is fine for a scale-to-zero demo; startup
        # CPU boost helps n8n's cold-start.
        startup_cpu_boost = true
      }

      env {
        name  = "DB_TYPE"
        value = "postgresdb"
      }
      env {
        name  = "DB_POSTGRESDB_HOST"
        value = google_sql_database_instance.main.private_ip_address
      }
      env {
        name  = "DB_POSTGRESDB_PORT"
        value = "5432"
      }
      env {
        name  = "DB_POSTGRESDB_DATABASE"
        value = google_sql_database.n8n.name
      }
      env {
        name  = "DB_POSTGRESDB_USER"
        value = google_sql_user.n8n.name
      }
      env {
        name = "DB_POSTGRESDB_PASSWORD"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.this["db_password"].secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "N8N_ENCRYPTION_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.this["n8n_encryption_key"].secret_id
            version = "latest"
          }
        }
      }
      env {
        name  = "N8N_JWT_AUTH_ACTIVE"
        value = "false"
      }
      env {
        name = "N8N_JWT_AUTH_HEADER_VALUE_PREFIX"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.this["n8n_jwt_secret"].secret_id
            version = "latest"
          }
        }
      }
      env {
        name  = "N8N_PORT"
        value = tostring(local.n8n_container_port)
      }
      env {
        name  = "N8N_PROTOCOL"
        value = "https"
      }
      env {
        name  = "OLLAMA_BASE_URL"
        value = local.ollama_base_url
      }
      env {
        name  = "GCP_PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "PUBSUB_TOPIC_DECISIONS"
        value = google_pubsub_topic.decisions.name
      }
      env {
        name = "KALSHI_API_KEY_ID"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.this["kalshi_api_key_id"].secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "KALSHI_PRIVATE_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.this["kalshi_private_key"].secret_id
            version = "latest"
          }
        }
      }

      # n8n's own health path is "/healthz", but Cloud Run's request-routing
      # layer treats a bare "/healthz" specially in some configurations, so
      # probes target n8n's dedicated readiness sub-path instead.
      startup_probe {
        initial_delay_seconds = 5
        timeout_seconds       = 3
        period_seconds        = 5
        failure_threshold     = 20
        tcp_socket {
          port = local.n8n_container_port
        }
      }

      liveness_probe {
        initial_delay_seconds = 10
        timeout_seconds       = 3
        period_seconds        = 15
        failure_threshold     = 3
        http_get {
          path = "/healthz/readiness"
          port = local.n8n_container_port
        }
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  depends_on = [
    google_project_service.required,
    google_vpc_access_connector.main,
    google_sql_database_instance.main,
  ]
}

# --- Public invoker (demo default) or IAM-authenticated only ---------------

resource "google_cloud_run_v2_service_iam_member" "public_invoker" {
  count = var.n8n_public ? 1 : 0

  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.n8n.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
