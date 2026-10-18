locals {
  required_apis = [
    "artifactregistry.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "compute.googleapis.com",
    "dns.googleapis.com",
    "iam.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "sqladmin.googleapis.com",
    "storage.googleapis.com",
  ]
}

# 1. Enable required Google Cloud APIs
resource "google_project_service" "apis" {
  for_each           = toset(local.required_apis)
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

# 2. Artifact Registry (asia-northeast1)
resource "google_artifact_registry_repository" "repo" {
  location      = var.region
  repository_id = "houjin-bangou-mcp"
  description   = "Container repository for Japan Corporate Number & Invoice Check MCP"
  format        = "DOCKER"

  depends_on = [google_project_service.apis]
}

# 3. Service Accounts (3 dedicated roles: service, ingest job, migrate job)
resource "google_service_account" "service" {
  account_id   = var.service_account_service_id
  display_name = "MCP HTTP Service Runtime SA"

  depends_on = [google_project_service.apis]
}

resource "google_service_account" "ingest" {
  account_id   = var.service_account_ingest_id
  display_name = "MCP Dataset Ingestion Job SA"

  depends_on = [google_project_service.apis]
}

resource "google_service_account" "migrate" {
  account_id   = var.service_account_migrate_id
  display_name = "MCP Database Migration Job SA"

  depends_on = [google_project_service.apis]
}

# Cloud SQL Client permissions for all 3 service accounts
resource "google_project_iam_member" "service_cloudsql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.service.email}"

  depends_on = [google_project_service.apis]
}

resource "google_project_iam_member" "ingest_cloudsql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.ingest.email}"

  depends_on = [google_project_service.apis]
}

resource "google_project_iam_member" "migrate_cloudsql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.migrate.email}"

  depends_on = [google_project_service.apis]
}

# 4. Secret Manager secrets (3 containers for DATABASE_URL; secret versions are populated manually)
resource "google_secret_manager_secret" "db_url_reader" {
  secret_id = "houjin-db-url-reader"
  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret" "db_url_ingest" {
  secret_id = "houjin-db-url-ingest"
  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret" "db_url_admin" {
  secret_id = "houjin-db-url-admin"
  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

# Least-privilege Secret Accessor bindings per SA
resource "google_secret_manager_secret_iam_member" "reader_secret_access" {
  secret_id = google_secret_manager_secret.db_url_reader.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.service.email}"
}

resource "google_secret_manager_secret_iam_member" "ingest_secret_access" {
  secret_id = google_secret_manager_secret.db_url_ingest.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.ingest.email}"
}

resource "google_secret_manager_secret_iam_member" "admin_secret_access" {
  secret_id = google_secret_manager_secret.db_url_admin.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.migrate.email}"
}

# 5. Cloud SQL for PostgreSQL 16 (deletion protection, daily automated backups, no PITR, no authorized networks)
resource "google_sql_database_instance" "postgres" {
  name                = "houjin-bangou-pg16"
  region              = var.region
  database_version    = "POSTGRES_16"
  deletion_protection = true

  settings {
    tier                        = var.sql_tier
    edition                     = "ENTERPRISE"
    disk_size                   = var.sql_disk_size_gb
    disk_type                   = "PD_SSD"
    disk_autoresize             = true
    availability_type           = "ZONAL"
    deletion_protection_enabled = true

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = false
      backup_retention_settings {
        retained_backups = 7
        retention_unit   = "COUNT"
      }
    }

    ip_configuration {
      ipv4_enabled = true
      # No authorized_networks: connections are established via Cloud SQL Auth Proxy / Unix socket
    }
  }

  depends_on = [google_project_service.apis]
}

resource "google_sql_database" "database" {
  name     = "corp_check"
  instance = google_sql_database_instance.postgres.name
}

# 6. GCS Bucket for monthly CSV staging (uniform bucket-level access, public access prevented)
resource "google_storage_bucket" "ingest" {
  name                        = var.ingest_bucket_name
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  depends_on = [google_project_service.apis]
}

resource "google_storage_bucket_iam_member" "ingest_bucket_viewer" {
  bucket = google_storage_bucket.ingest.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.ingest.email}"
}

# 7. Cloud Run Service (ingress restricted to internal and Cloud Load Balancing)
resource "google_cloud_run_v2_service" "mcp" {
  name     = "houjin-bangou-mcp"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"

  template {
    service_account = google_service_account.service.email

    scaling {
      max_instance_count = var.max_instances
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.postgres.connection_name]
      }
    }

    containers {
      image = var.image

      ports {
        container_port = 8080
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }

      env {
        name  = "DATA_SOURCE"
        value = "db"
      }

      env {
        name  = "TRUST_PROXY"
        value = tostring(var.trust_proxy)
      }

      env {
        name  = "ALLOWED_ORIGINS"
        value = var.allowed_origins
      }

      env {
        name  = "OPENAI_APPS_CHALLENGE_TOKEN"
        value = var.openai_apps_challenge_token
      }

      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.db_url_reader.secret_id
            version = "latest"
          }
        }
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }
    }
  }

  depends_on = [
    google_project_service.apis,
    google_secret_manager_secret_iam_member.reader_secret_access,
    google_project_iam_member.service_cloudsql_client,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "public_invoker" {
  project  = var.project_id
  location = google_cloud_run_v2_service.mcp.location
  name     = google_cloud_run_v2_service.mcp.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# 8. Cloud Run Jobs (migrate and ingest)
resource "google_cloud_run_v2_job" "migrate" {
  name     = "houjin-bangou-migrate"
  location = var.region

  template {
    template {
      service_account = google_service_account.migrate.email
      max_retries     = 0
      timeout         = "1800s"

      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [google_sql_database_instance.postgres.connection_name]
        }
      }

      containers {
        image   = var.image
        command = ["node"]
        args    = ["dist/db/migrate.js"]

        env {
          name  = "NODE_ENV"
          value = "production"
        }

        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.db_url_admin.secret_id
              version = "latest"
            }
          }
        }

        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }
      }
    }
  }

  depends_on = [
    google_project_service.apis,
    google_secret_manager_secret_iam_member.admin_secret_access,
    google_project_iam_member.migrate_cloudsql_client,
  ]
}

resource "google_cloud_run_v2_job" "ingest_corporate" {
  name     = "houjin-bangou-ingest-corporate"
  location = var.region

  template {
    template {
      service_account       = google_service_account.ingest.email
      execution_environment = "EXECUTION_ENVIRONMENT_GEN2"
      max_retries           = 0
      timeout               = "${var.ingest_timeout_sec}s"

      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [google_sql_database_instance.postgres.connection_name]
        }
      }

      volumes {
        name = "ingest-gcs"
        gcs {
          bucket    = google_storage_bucket.ingest.name
          read_only = true
        }
      }

      containers {
        image   = var.image
        command = ["node", "dist/ingest/cli.js", "--type", "corporate"]

        env {
          name  = "NODE_ENV"
          value = "production"
        }

        env {
          name  = "INGEST_MIN_RECORD_COUNT"
          value = tostring(var.ingest_min_record_count_corporate)
        }

        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.db_url_ingest.secret_id
              version = "latest"
            }
          }
        }

        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }

        volume_mounts {
          name       = "ingest-gcs"
          mount_path = "/mnt/ingest"
        }
      }
    }
  }

  depends_on = [
    google_project_service.apis,
    google_secret_manager_secret_iam_member.ingest_secret_access,
    google_project_iam_member.ingest_cloudsql_client,
    google_storage_bucket_iam_member.ingest_bucket_viewer,
  ]
}

resource "google_cloud_run_v2_job" "ingest_invoice" {
  name     = "houjin-bangou-ingest-invoice"
  location = var.region

  template {
    template {
      service_account       = google_service_account.ingest.email
      execution_environment = "EXECUTION_ENVIRONMENT_GEN2"
      max_retries           = 0
      timeout               = "${var.ingest_timeout_sec}s"

      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [google_sql_database_instance.postgres.connection_name]
        }
      }

      volumes {
        name = "ingest-gcs"
        gcs {
          bucket    = google_storage_bucket.ingest.name
          read_only = true
        }
      }

      containers {
        image   = var.image
        command = ["node", "dist/ingest/cli.js", "--type", "invoice"]

        env {
          name  = "NODE_ENV"
          value = "production"
        }

        env {
          name  = "INGEST_MIN_RECORD_COUNT"
          value = tostring(var.ingest_min_record_count_invoice)
        }

        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.db_url_ingest.secret_id
              version = "latest"
            }
          }
        }

        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }

        volume_mounts {
          name       = "ingest-gcs"
          mount_path = "/mnt/ingest"
        }
      }
    }
  }

  depends_on = [
    google_project_service.apis,
    google_secret_manager_secret_iam_member.ingest_secret_access,
    google_project_iam_member.ingest_cloudsql_client,
    google_storage_bucket_iam_member.ingest_bucket_viewer,
  ]
}

# 9. Cloud Armor Security Policy (D3: primary per-IP rate limiting)
resource "google_compute_security_policy" "armor" {
  name        = "houjin-bangou-armor-policy"
  description = "Per-IP rate limiting policy for Japan Corporate Number & Invoice Check MCP"

  rule {
    action   = "throttle"
    priority = 1000
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"
      rate_limit_threshold {
        count        = var.armor_rate_limit_count
        interval_sec = var.armor_rate_limit_interval_sec
      }
    }
    description = "Throttle per client IP"
  }

  rule {
    action   = "allow"
    priority = 2147483647
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
    description = "Default allow rule"
  }

  depends_on = [google_project_service.apis]
}

# 10. Global External Application Load Balancer (D1, D2, D10)
resource "google_compute_global_address" "lb_ip" {
  name       = "houjin-bangou-lb-ip"
  ip_version = "IPV4"

  depends_on = [google_project_service.apis]
}

resource "google_compute_managed_ssl_certificate" "cert" {
  name = "houjin-bangou-ssl-cert"

  managed {
    domains = [var.domain]
  }

  depends_on = [google_project_service.apis]
}

resource "google_compute_region_network_endpoint_group" "serverless_neg" {
  name                  = "houjin-bangou-serverless-neg"
  network_endpoint_type = "SERVERLESS"
  region                = var.region

  cloud_run {
    service = google_cloud_run_v2_service.mcp.name
  }
}

resource "google_compute_backend_service" "mcp_backend" {
  name                  = "houjin-bangou-backend"
  protocol              = "HTTPS"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  security_policy       = google_compute_security_policy.armor.id

  # D2: Overwrite X-Forwarded-For with verified client IP and LB IP to prevent header spoofing
  custom_request_headers = [
    "x-forwarded-for:{client_ip_address},{server_ip_address}",
  ]

  backend {
    group = google_compute_region_network_endpoint_group.serverless_neg.id
  }

  log_config {
    enable      = var.lb_log_enabled
    sample_rate = var.lb_log_enabled ? var.lb_log_sample_rate : null
  }
}

resource "google_compute_url_map" "https" {
  name            = "houjin-bangou-https-url-map"
  default_service = google_compute_backend_service.mcp_backend.id
}

resource "google_compute_target_https_proxy" "https" {
  name             = "houjin-bangou-https-proxy"
  url_map          = google_compute_url_map.https.id
  ssl_certificates = [google_compute_managed_ssl_certificate.cert.id]
}

resource "google_compute_global_forwarding_rule" "https" {
  name                  = "houjin-bangou-https-forwarding-rule"
  ip_protocol           = "TCP"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  port_range            = "443"
  target                = google_compute_target_https_proxy.https.id
  ip_address            = google_compute_global_address.lb_ip.id
}

resource "google_compute_url_map" "http_redirect" {
  name = "houjin-bangou-http-redirect"

  default_url_redirect {
    https_redirect         = true
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
    strip_query            = false
  }
}

resource "google_compute_target_http_proxy" "http_redirect" {
  name    = "houjin-bangou-http-proxy"
  url_map = google_compute_url_map.http_redirect.id
}

resource "google_compute_global_forwarding_rule" "http_redirect" {
  name                  = "houjin-bangou-http-forwarding-rule"
  ip_protocol           = "TCP"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  port_range            = "80"
  target                = google_compute_target_http_proxy.http_redirect.id
  ip_address            = google_compute_global_address.lb_ip.id
}

# 11. Log-based Metric, Notification Channel, and Alert Policies (D9)
resource "google_monitoring_notification_channel" "email" {
  display_name = "MCP Operations Email Alert Channel"
  type         = "email"
  labels = {
    email_address = var.alert_email
  }

  depends_on = [google_project_service.apis]
}

resource "google_logging_metric" "ingest_failed" {
  name        = "houjin_ingest_failed_count"
  description = "Count of failed dataset ingestion runs (logger=dataset_ingest, status=failed)"
  filter      = "resource.type=\"cloud_run_job\" AND jsonPayload.logger=\"dataset_ingest\" AND jsonPayload.status=\"failed\""

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }

  depends_on = [google_project_service.apis]
}

# Alert 1: Dataset ingestion log failure
resource "google_monitoring_alert_policy" "ingest_failed_alert" {
  display_name = "MCP Dataset Ingestion Failed (Log Metric)"
  combiner     = "OR"

  conditions {
    display_name = "jsonPayload.logger=dataset_ingest AND status=failed"
    condition_threshold {
      filter          = "resource.type = \"cloud_run_job\" AND metric.type = \"logging.googleapis.com/user/${google_logging_metric.ingest_failed.name}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.id]
}

# Alert 2: Cloud Run Job execution failure
resource "google_monitoring_alert_policy" "job_execution_failed_alert" {
  display_name = "MCP Cloud Run Job Execution Failed"
  combiner     = "OR"

  conditions {
    display_name = "Cloud Run Job failed execution count > 0"
    condition_threshold {
      filter          = "resource.type = \"cloud_run_job\" AND metric.type = \"run.googleapis.com/job/completed_execution_count\" AND metric.labels.result = \"failed\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.id]
}

# 15. Regional Cloud Logging Bucket (asia-northeast1, 30 days retention)
resource "google_logging_project_bucket_config" "regional_logging_bucket" {
  project        = var.project_id
  location       = "asia-northeast1"
  retention_days = 30
  bucket_id      = var.logging_bucket_id
  description    = "Regional log bucket in asia-northeast1 with 30-day retention"

  depends_on = [google_project_service.apis]
}

# 16. Cloud DNS Managed Zone and Record Set (SLA2-327)
resource "google_dns_managed_zone" "mcp_zone" {
  name        = var.dns_zone_name
  dns_name    = endswith(var.dns_zone_dns_name, ".") ? var.dns_zone_dns_name : "${var.dns_zone_dns_name}."
  description = "Managed DNS public zone for MCP subdomains delegated from sugu-kuru.co.jp"
  visibility  = "public"

  depends_on = [google_project_service.apis]
}

resource "google_dns_record_set" "domain_a" {
  name         = endswith(var.domain, ".") ? var.domain : "${var.domain}."
  managed_zone = google_dns_managed_zone.mcp_zone.name
  type         = "A"
  ttl          = 300
  rrdatas      = [google_compute_global_address.lb_ip.address]

  depends_on = [google_project_service.apis]
}

