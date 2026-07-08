# =============================================================================
# network.tf — VPC, subnet, serverless VPC access, private services access
# =============================================================================

resource "google_compute_network" "main" {
  project                 = var.project_id
  name                    = "f1-decision-vpc"
  auto_create_subnetworks = false
  depends_on              = [google_project_service.required]
}

resource "google_compute_subnetwork" "main" {
  project                  = var.project_id
  name                     = "f1-decision-subnet"
  region                   = var.region
  network                  = google_compute_network.main.id
  ip_cidr_range            = "10.10.0.0/20"
  private_ip_google_access = true
}

# --- Serverless VPC Access connector -----------------------------------
# Lets Cloud Run (n8n) reach Cloud SQL private IP and the Ollama MIG's
# internal IPs without traversing the public internet.
resource "google_vpc_access_connector" "main" {
  project       = var.project_id
  name          = "f1-decision-vpcacc"
  region        = var.region
  network       = google_compute_network.main.name
  ip_cidr_range = "10.10.16.0/28"
  min_instances = 2
  max_instances = 3
  machine_type  = "e2-micro"
  depends_on    = [google_project_service.required]
}

# --- Private Services Access (for Cloud SQL private IP) ----------------
resource "google_compute_global_address" "private_service_range" {
  project       = var.project_id
  name          = "f1-decision-psa-range"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.main.id
}

resource "google_service_networking_connection" "private_vpc_connection" {
  network                 = google_compute_network.main.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_service_range.name]
  depends_on              = [google_project_service.required]
}

# --- Firewall rules ------------------------------------------------------

# Allow all internal traffic within the VPC to reach Ollama's API port.
resource "google_compute_firewall" "allow_internal_ollama" {
  project = var.project_id
  name    = "f1-decision-allow-internal-ollama"
  network = google_compute_network.main.name

  direction = "INGRESS"
  priority  = 1000

  allow {
    protocol = "tcp"
    ports    = ["11434"]
  }

  # Internal VPC ranges: the subnet itself and the serverless VPC access
  # connector's range, so Cloud Run (via the connector) can reach Ollama.
  source_ranges = [
    google_compute_subnetwork.main.ip_cidr_range,
    "10.10.16.0/28",
  ]

  target_tags = ["ollama"]
}

# Allow Google Cloud health checks to reach the Ollama MIG instances.
resource "google_compute_firewall" "allow_health_checks" {
  project = var.project_id
  name    = "f1-decision-allow-health-checks"
  network = google_compute_network.main.name

  direction = "INGRESS"
  priority  = 1000

  allow {
    protocol = "tcp"
    ports    = ["11434", "80"]
  }

  # Google Cloud health check source ranges.
  source_ranges = [
    "35.191.0.0/16",
    "130.211.0.0/22",
  ]

  target_tags = ["ollama"]
}

# Allow internal SSH for operator debugging of the GPU instances.
resource "google_compute_firewall" "allow_internal_ssh" {
  project = var.project_id
  name    = "f1-decision-allow-internal-ssh"
  network = google_compute_network.main.name

  direction = "INGRESS"
  priority  = 1000

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }

  source_ranges = [google_compute_subnetwork.main.ip_cidr_range]
  target_tags   = ["ollama"]
}
