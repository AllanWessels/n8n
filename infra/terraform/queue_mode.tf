# =============================================================================
# queue_mode.tf — toggleable n8n queue-mode topology (horizontal scaling)
# =============================================================================
# Everything in this file is guarded by `count = var.enable_queue_mode ? 1 : 0`.
# By default the platform runs n8n as a single "regular mode" Cloud Run
# service (see cloudrun_n8n.tf), which is the cheapest, simplest topology
# for a portfolio demo. Flipping `enable_queue_mode = true` adds:
#   - a Memorystore (Redis) instance for the Bull queue n8n uses in queue
#     mode, and
#   - a second Cloud Run service running `n8n worker`, which pulls jobs off
#     that queue.
# The main `f1-n8n` service would additionally need `EXECUTIONS_MODE=queue`
# set (left as a follow-up wiring step / variable for whoever flips this on,
# since it changes the primary service's env in a way that only makes sense
# once this file's resources exist) — this module focuses on standing up the
# queue-mode infrastructure itself.

resource "google_redis_instance" "queue" {
  count = var.enable_queue_mode ? 1 : 0

  project        = var.project_id
  name           = "f1-n8n-queue"
  region         = var.region
  tier           = "BASIC"
  memory_size_gb = 1

  authorized_network = google_compute_network.main.id
  connect_mode       = "PRIVATE_SERVICE_ACCESS"
  redis_version      = "REDIS_7_0"

  depends_on = [
    google_project_service.required,
    google_service_networking_connection.private_vpc_connection,
  ]
}

resource "google_cloud_run_v2_service" "n8n_worker" {
  count = var.enable_queue_mode ? 1 : 0

  project  = var.project_id
  name     = "f1-n8n-worker"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_INTERNAL_ONLY" # worker is not invoked externally over HTTP.

  deletion_protection = false

  template {
    service_account = google_service_account.n8n_runtime.email

    scaling {
      min_instance_count = 0
      max_instance_count = var.max_instances
    }

    vpc_access {
      connector = google_vpc_access_connector.main.id
      egress    = "PRIVATE_RANGES_ONLY"
    }

    containers {
      image   = var.n8n_image
      command = ["n8n"]
      args    = ["worker"]

      resources {
        limits = {
          cpu    = "1"
          memory = "1Gi"
        }
      }

      env {
        name  = "EXECUTIONS_MODE"
        value = "queue"
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
        name  = "QUEUE_BULL_REDIS_HOST"
        value = google_redis_instance.queue[0].host
      }
      env {
        name  = "QUEUE_BULL_REDIS_PORT"
        value = tostring(google_redis_instance.queue[0].port)
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
