output "load_balancer_ip" {
  description = "Global static IPv4 address of the External Application Load Balancer (register this in DNS A record)"
  value       = google_compute_global_address.lb_ip.address
}

output "ssl_certificate_name" {
  description = "Managed SSL certificate resource name"
  value       = google_compute_managed_ssl_certificate.cert.name
}

output "cloud_run_service_name" {
  description = "Cloud Run service name"
  value       = google_cloud_run_v2_service.mcp.name
}

output "cloud_run_service_uri" {
  description = "Direct run.app URI (should return 403/404 due to internal-and-cloud-load-balancing ingress)"
  value       = google_cloud_run_v2_service.mcp.uri
}

output "cloud_sql_connection_name" {
  description = "Cloud SQL instance connection name for Unix socket mounts"
  value       = google_sql_database_instance.postgres.connection_name
}

output "artifact_registry_repository" {
  description = "Artifact Registry repository ID"
  value       = google_artifact_registry_repository.repo.id
}

output "ingest_bucket_name" {
  description = "GCS bucket name for staging monthly NTA CSV files"
  value       = google_storage_bucket.ingest.name
}

output "migrate_job_name" {
  description = "Cloud Run Job name for database migrations"
  value       = google_cloud_run_v2_job.migrate.name
}

output "ingest_job_name" {
  description = "Cloud Run Job name for dataset ingestion"
  value       = google_cloud_run_v2_job.ingest.name
}

output "ingest_min_record_count_invoice" {
  description = "Configured minimum record count for invoice ingestion (pass as --update-env-vars INGEST_MIN_RECORD_COUNT=<value> when running invoice job)"
  value       = var.ingest_min_record_count_invoice
}
