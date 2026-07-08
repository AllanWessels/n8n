# =============================================================================
# pubsub.tf — decision event topic + dead-letter topic/subscription
# =============================================================================

resource "google_pubsub_topic" "decisions" {
  project = var.project_id
  name    = "decisions"

  depends_on = [google_project_service.required]
}

resource "google_pubsub_topic" "decisions_deadletter" {
  project = var.project_id
  name    = "decisions-deadletter"

  depends_on = [google_project_service.required]
}

resource "google_pubsub_subscription" "decisions" {
  project = var.project_id
  name    = "decisions-sub"
  topic   = google_pubsub_topic.decisions.id

  ack_deadline_seconds = 30

  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.decisions_deadletter.id
    max_delivery_attempts = 5
  }

  expiration_policy {
    ttl = "" # never expires
  }
}

# Allow Pub/Sub's own service agent to publish to the dead-letter topic and
# ack messages on the source subscription, as required for dead-lettering.
resource "google_pubsub_topic_iam_member" "deadletter_publisher" {
  project = var.project_id
  topic   = google_pubsub_topic.decisions_deadletter.name
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:service-${data.google_project.current.number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}

resource "google_pubsub_subscription_iam_member" "deadletter_subscriber" {
  project      = var.project_id
  subscription = google_pubsub_subscription.decisions.name
  role         = "roles/pubsub.subscriber"
  member       = "serviceAccount:service-${data.google_project.current.number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}
