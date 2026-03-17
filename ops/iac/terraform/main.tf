locals {
  required_services = toset([
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "artifactregistry.googleapis.com",
    "cloudtrace.googleapis.com",
    "monitoring.googleapis.com",
    "logging.googleapis.com",
    "sqladmin.googleapis.com",
  ])

  runtime_roles = toset([
    "roles/secretmanager.secretAccessor",
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
    "roles/cloudtrace.agent",
    "roles/cloudsql.client",
  ])

  # Unix-socket DATABASE_URL for Cloud Run → Cloud SQL
  # Format: postgresql://USER:PASS@/DBNAME?host=/cloudsql/CONNECTION_NAME
  cloudsql_user    = var.cloudsql_db_name # user name matches db name
  database_url     = "postgresql://${local.cloudsql_user}:${var.cloudsql_db_password}@/${var.cloudsql_db_name}?host=/cloudsql/${var.cloudsql_instance_connection_name}"
}

resource "google_project_service" "required" {
  for_each           = local.required_services
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_service_account" "runtime" {
  account_id   = "${var.name_prefix}-runtime"
  display_name = "PUDA runtime service account"
  project      = var.project_id
}

resource "google_project_iam_member" "runtime_roles" {
  for_each = local.runtime_roles
  project  = var.project_id
  role     = each.value
  member   = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_secret_manager_secret" "jwt_secret" {
  project   = var.project_id
  secret_id = "${var.name_prefix}-jwt-secret"

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "jwt_secret" {
  secret      = google_secret_manager_secret.jwt_secret.id
  secret_data = var.jwt_secret
}

resource "google_secret_manager_secret" "payment_webhook_secret" {
  project   = var.project_id
  secret_id = "${var.name_prefix}-payment-webhook-secret"

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "payment_webhook_secret" {
  secret      = google_secret_manager_secret.payment_webhook_secret.id
  secret_data = var.payment_gateway_webhook_secret
}

# --- Cloud SQL: database + user on existing instance ---

resource "google_sql_database" "puda" {
  project  = var.project_id
  instance = var.cloudsql_instance_name
  name     = var.cloudsql_db_name
}

resource "google_sql_user" "puda" {
  project  = var.project_id
  instance = var.cloudsql_instance_name
  name     = var.cloudsql_db_name
  password = var.cloudsql_db_password
}

resource "google_secret_manager_secret" "database_url" {
  project   = var.project_id
  secret_id = "${var.name_prefix}-database-url"

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "database_url" {
  secret      = google_secret_manager_secret.database_url.id
  secret_data = local.database_url
}

resource "google_cloud_run_v2_service" "api" {
  name     = var.api_service_name
  location = var.region
  project  = var.project_id
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.runtime.email
    timeout         = "60s"

    scaling {
      min_instance_count = var.api_min_instances
      max_instance_count = var.api_max_instances
    }

    # Cloud SQL Unix socket connector
    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [var.cloudsql_instance_connection_name]
      }
    }

    containers {
      image = var.api_image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }

      # Mount the Cloud SQL socket
      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }

      env {
        name  = "ALLOWED_ORIGINS"
        value = var.allowed_origins
      }

      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.database_url.secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "JWT_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.jwt_secret.secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "PAYMENT_GATEWAY_WEBHOOK_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.payment_webhook_secret.secret_id
            version = "latest"
          }
        }
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  depends_on = [
    google_project_service.required,
    google_project_iam_member.runtime_roles,
    google_secret_manager_secret_version.jwt_secret,
    google_secret_manager_secret_version.payment_webhook_secret,
    google_secret_manager_secret_version.database_url,
    google_sql_database.puda,
    google_sql_user.puda,
  ]
}
