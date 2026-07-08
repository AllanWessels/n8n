# =============================================================================
# ollama_gpu.tf — spot/preemptible L4 GPU Ollama inference host (0-2 replicas)
# =============================================================================
# All resources here are guarded by `count = var.enable_gpu ? 1 : 0` so the
# entire GPU topology can be skipped (e.g. no GPU quota yet, or a CPU-only
# demo) without touching any other module.
#
# Cost/scale notes:
#   - SPOT provisioning + preemptible scheduling minimizes cost but means the
#     instance can be reclaimed at any time; automatic_restart is disabled
#     because SPOT VMs are not eligible for automatic restart anyway.
#   - The region autoscaler's `min_replicas = 0` allows the managed instance
#     group to sit fully scaled down (zero cost) between demo sessions.
#     NOTE: standard CPU-utilization-based autoscaling cannot itself trigger
#     scale-FROM-zero (there is no running instance to sample utilization
#     from). In this architecture, scale-from-zero is driven externally by
#     an n8n "warm-up" workflow step that calls the Compute API to set the
#     instance group's target_size to 1 before a decision run that needs the
#     local model, and lets the autoscaler (and its cooldown) manage scale
#     down again afterwards.

resource "google_service_account" "ollama_host" {
  count = var.enable_gpu ? 1 : 0

  project      = var.project_id
  account_id   = "f1-ollama-host"
  display_name = "f1-decision-platform Ollama GPU host"
}

resource "google_project_iam_member" "ollama_host_logging" {
  count = var.enable_gpu ? 1 : 0

  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.ollama_host[0].email}"
}

resource "google_project_iam_member" "ollama_host_monitoring" {
  count = var.enable_gpu ? 1 : 0

  project = var.project_id
  role    = "roles/monitoring.metricWriter"
  member  = "serviceAccount:${google_service_account.ollama_host[0].email}"
}

resource "google_compute_instance_template" "ollama" {
  count = var.enable_gpu ? 1 : 0

  project      = var.project_id
  name_prefix  = "f1-ollama-"
  machine_type = "g2-standard-4"
  region       = var.region

  tags = ["ollama"]

  disk {
    source_image = "projects/ml-images/global/images/family/common-cu121-debian-11"
    auto_delete  = true
    boot         = true
    disk_size_gb = 100
    disk_type    = "pd-ssd"
  }

  guest_accelerator {
    type  = var.ollama_gpu_type
    count = 1
  }

  # Required when attaching a guest accelerator.
  scheduling {
    provisioning_model          = "SPOT"
    preemptible                 = true
    on_host_maintenance         = "TERMINATE"
    automatic_restart           = false
    instance_termination_action = "STOP"
  }

  network_interface {
    network    = google_compute_network.main.id
    subnetwork = google_compute_subnetwork.main.id
    # No access_config block -> no public IP; reached only via the internal
    # load balancer / VPC access connector.
  }

  service_account {
    email  = google_service_account.ollama_host[0].email
    scopes = ["cloud-platform"]
  }

  metadata = {
    startup-script = file("${path.module}/scripts/ollama-startup.sh")
  }

  lifecycle {
    create_before_destroy = true
  }

  depends_on = [google_project_service.required]
}

resource "google_compute_region_instance_group_manager" "ollama" {
  count = var.enable_gpu ? 1 : 0

  project = var.project_id
  name    = "f1-ollama-mig"
  region  = var.region

  base_instance_name = "f1-ollama"
  target_size        = 0 # starts scaled to zero; see warm-up workflow note above.

  version {
    instance_template = google_compute_instance_template.ollama[0].id
  }

  named_port {
    name = "ollama"
    port = 11434
  }

  update_policy {
    type                  = "PROACTIVE"
    minimal_action        = "REPLACE"
    max_surge_fixed       = 1
    max_unavailable_fixed = 1
  }
}

resource "google_compute_region_autoscaler" "ollama" {
  count = var.enable_gpu ? 1 : 0

  project = var.project_id
  name    = "f1-ollama-autoscaler"
  region  = var.region
  target  = google_compute_region_instance_group_manager.ollama[0].id

  autoscaling_policy {
    min_replicas    = 0
    max_replicas    = 2
    cooldown_period = 180

    cpu_utilization {
      target = 0.6
    }
  }
}

# --- Internal load balancer so Cloud Run has a stable address for Ollama ---

resource "google_compute_health_check" "ollama" {
  count = var.enable_gpu ? 1 : 0

  project             = var.project_id
  name                = "f1-ollama-health"
  timeout_sec         = 5
  check_interval_sec  = 10
  healthy_threshold   = 2
  unhealthy_threshold = 3

  tcp_health_check {
    port = 11434
  }
}

resource "google_compute_region_backend_service" "ollama" {
  count = var.enable_gpu ? 1 : 0

  project               = var.project_id
  name                  = "f1-ollama-backend"
  region                = var.region
  protocol              = "TCP"
  load_balancing_scheme = "INTERNAL"
  health_checks         = [google_compute_health_check.ollama[0].id]

  backend {
    group = google_compute_region_instance_group_manager.ollama[0].instance_group
  }
}

resource "google_compute_address" "ollama_ilb" {
  count = var.enable_gpu ? 1 : 0

  project      = var.project_id
  name         = "f1-ollama-ilb-ip"
  region       = var.region
  subnetwork   = google_compute_subnetwork.main.id
  address_type = "INTERNAL"
}

resource "google_compute_forwarding_rule" "ollama" {
  count = var.enable_gpu ? 1 : 0

  project               = var.project_id
  name                  = "f1-ollama-ilb"
  region                = var.region
  ip_address            = google_compute_address.ollama_ilb[0].id
  load_balancing_scheme = "INTERNAL"
  backend_service       = google_compute_region_backend_service.ollama[0].id
  network               = google_compute_network.main.id
  subnetwork            = google_compute_subnetwork.main.id
  ports                 = ["11434"]
}
