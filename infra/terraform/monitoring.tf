# =============================================================================
# monitoring.tf — dashboard + alert policy
# =============================================================================

resource "google_monitoring_dashboard" "n8n_overview" {
  project        = var.project_id
  dashboard_json = file("${path.module}/dashboards/n8n-overview.json")

  depends_on = [google_project_service.required]
}

# Log-based metric counting successful decision-pipeline runs, parsed from
# n8n's structured logs (workflow logs a JSON line containing
# `"event":"decision_logged"` when a decision is persisted to the ledger).
resource "google_logging_metric" "decisions_logged" {
  project = var.project_id
  name    = "f1-decisions-logged"
  filter  = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"f1-n8n\" AND jsonPayload.event=\"decision_logged\""

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
}

# Alert when the n8n Cloud Run service starts returning a meaningful rate of
# 5xx server errors — the primary signal something in the pipeline broke.
resource "google_monitoring_alert_policy" "n8n_error_rate" {
  project      = var.project_id
  display_name = "f1-n8n: elevated 5xx error rate"
  combiner     = "OR"

  conditions {
    display_name = "Cloud Run 5xx responses > 5 in 5m"

    condition_threshold {
      filter          = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"f1-n8n\" AND metric.type=\"run.googleapis.com/request_count\" AND metric.labels.response_code_class=\"5xx\""
      comparison      = "COMPARISON_GT"
      threshold_value = 5
      duration        = "300s"

      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }

  notification_channels = []

  alert_strategy {
    auto_close = "1800s"
  }
}
