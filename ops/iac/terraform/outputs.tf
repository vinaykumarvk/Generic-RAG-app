output "api_service_name" {
  description = "Cloud Run API service name."
  value       = google_cloud_run_v2_service.api.name
}

output "api_service_uri" {
  description = "Cloud Run API service URI."
  value       = google_cloud_run_v2_service.api.uri
}

output "runtime_service_account_email" {
  description = "Runtime service account email."
  value       = google_service_account.runtime.email
}

output "jwt_secret_name" {
  description = "Secret Manager secret ID for JWT secret."
  value       = google_secret_manager_secret.jwt_secret.secret_id
}

output "payment_webhook_secret_name" {
  description = "Secret Manager secret ID for payment webhook secret."
  value       = google_secret_manager_secret.payment_webhook_secret.secret_id
}

output "database_url_secret_name" {
  description = "Secret Manager secret ID for DATABASE_URL."
  value       = google_secret_manager_secret.database_url.secret_id
}

output "cloudsql_database_name" {
  description = "Cloud SQL database name."
  value       = google_sql_database.puda.name
}

output "cloudsql_user_name" {
  description = "Cloud SQL database user."
  value       = google_sql_user.puda.name
}
