variable "project_id" {
  type        = string
  description = "GCP project ID."
}

variable "region" {
  type        = string
  description = "GCP region for Cloud Run."
  default     = "asia-south1"
}

variable "name_prefix" {
  type        = string
  description = "Prefix for IAM and secret resource names."
  default     = "puda"
}

variable "api_service_name" {
  type        = string
  description = "Cloud Run service name for API."
  default     = "puda-api"
}

variable "api_image" {
  type        = string
  description = "Container image for API service (e.g. gcr.io/project/puda-api:tag)."
}

variable "api_min_instances" {
  type        = number
  description = "Minimum Cloud Run instances for API."
  default     = 1
}

variable "api_max_instances" {
  type        = number
  description = "Maximum Cloud Run instances for API."
  default     = 20
}

variable "allowed_origins" {
  type        = string
  description = "Comma-separated CORS origins exposed to API runtime."
}

variable "jwt_secret" {
  type        = string
  description = "JWT signing secret stored in Secret Manager."
  sensitive   = true
}

variable "payment_gateway_webhook_secret" {
  type        = string
  description = "Payment callback verification secret stored in Secret Manager."
  sensitive   = true
}

# --- Cloud SQL ---

variable "cloudsql_instance_name" {
  type        = string
  description = "Existing Cloud SQL instance name (not the full connection name)."
  default     = "free-trial-first-project"
}

variable "cloudsql_instance_connection_name" {
  type        = string
  description = "Full Cloud SQL instance connection name (PROJECT:REGION:INSTANCE)."
  default     = "wealth-report:europe-west1:free-trial-first-project"
}

variable "cloudsql_db_name" {
  type        = string
  description = "PostgreSQL database name to create on the Cloud SQL instance."
  default     = "puda"
}

variable "cloudsql_db_password" {
  type        = string
  description = "Password for the dedicated 'puda' database user."
  sensitive   = true
}
