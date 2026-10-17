variable "project_id" {
  description = "GCP Project ID (no default value; must be provided explicitly)"
  type        = string
}

variable "region" {
  description = "GCP region for regional resources"
  type        = string
  default     = "asia-northeast1"
}

variable "domain" {
  description = "Public custom domain for the Global External Application Load Balancer (e.g. houjin.mcp.sugu-kuru.co.jp)"
  type        = string
}

variable "image" {
  description = "Container image URI in Artifact Registry used by Cloud Run service and jobs"
  type        = string
}

variable "alert_email" {
  description = "Notification email address for Cloud Monitoring alerts (no default value)"
  type        = string
}

variable "max_instances" {
  description = "Maximum number of Cloud Run service instances (no default value)"
  type        = number
}

variable "trust_proxy" {
  description = "Express trust proxy hop count for Cloud Run behind Global External ALB"
  type        = number
  default     = 2
}

variable "allowed_origins" {
  description = "Comma-separated list of allowed Origin header values for /mcp"
  type        = string
}

variable "armor_rate_limit_count" {
  description = "Cloud Armor rate limit threshold count per client IP"
  type        = number
  default     = 60
}

variable "armor_rate_limit_interval_sec" {
  description = "Cloud Armor rate limit interval in seconds"
  type        = number
  default     = 60
}

variable "ingest_min_record_count_corporate" {
  description = "Minimum required record count for corporate number dataset ingestion (no default value)"
  type        = number
}

variable "ingest_min_record_count_invoice" {
  description = "Minimum required record count for invoice issuer dataset ingestion (no default value)"
  type        = number
}

variable "staleness_days" {
  description = "Alert threshold in days when no successful dataset ingestion log has been observed"
  type        = number
  default     = 40
}

variable "lb_log_enabled" {
  description = "Whether to enable request logging on the Global External Application Load Balancer backend service"
  type        = bool
  default     = false
}

variable "lb_log_sample_rate" {
  description = "Log sampling rate (0.0 to 1.0) for the load balancer backend service when lb_log_enabled is true"
  type        = number
  default     = 1.0
}

variable "sql_tier" {
  description = "Cloud SQL machine tier (no default value; determined after full-scale capacity measurement)"
  type        = string
}

variable "sql_disk_size_gb" {
  description = "Cloud SQL disk size in GB (no default value; must accommodate at least 2x active dataset size during RENAME swap)"
  type        = number
}

variable "ingest_bucket_name" {
  description = "GCS bucket name for staging monthly NTA CSV files"
  type        = string
}

variable "service_account_service_id" {
  description = "Account ID (prefix) for the Cloud Run service account"
  type        = string
}

variable "service_account_ingest_id" {
  description = "Account ID (prefix) for the ingestion Cloud Run Job service account"
  type        = string
}

variable "service_account_migrate_id" {
  description = "Account ID (prefix) for the migration Cloud Run Job service account"
  type        = string
}
