#!/bin/bash
# =============================================================================
# Policing Apps (non-PUDA) — Full GCP Cloud Run Deployment
# Deploys 6 services (3 APIs + 3 UIs): social-media, dopams, forensic
# to the policing-apps GCP project with Cloud SQL, secrets, and
# optional GitHub Actions CI/CD via Workload Identity Federation.
#
# NOTE: PUDA services (puda-api, puda-citizen, puda-officer) are deployed
# separately to the puda-489215 project via scripts/setup-puda-cloudrun.sh.
#
# Prerequisites:
#   - gcloud CLI authenticated with project-owner or equivalent permissions
#   - Docker installed (for Cloud Build)
#
# Required env vars:
#   DB_PASS         — Database password (URL-encoded if it contains special chars)
#
# Optional env vars:
#   GCP_PROJECT     — GCP project ID (default: policing-apps)
#   GCP_REGION      — Cloud Run region (default: asia-southeast1)
#   CLOUDSQL_REGION — Cloud SQL region (default: asia-southeast1)
#   CLOUDSQL_INSTANCE — Cloud SQL instance name (default: policing-db-v2)
#   DB_USER         — Database user (default: puda)
#   CLOUDSQL_TIER   — Cloud SQL machine type (default: db-f1-micro)
#   GITHUB_REPO     — GitHub repo (org/name) for WIF setup; skip WIF if unset
#
# Usage:
#   DB_PASS='StrongPass123!' ./scripts/setup-all-cloudrun.sh
#   GCP_PROJECT=policing-apps DB_PASS='StrongPass123!' ./scripts/setup-all-cloudrun.sh
#
# Dry run (prints commands without executing):
#   DB_PASS=test ./scripts/setup-all-cloudrun.sh --dry-run
# =============================================================================
set -euo pipefail

# ---- Parse flags ----
DRY_RUN=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    *) echo "Unknown flag: $arg"; exit 1 ;;
  esac
done

# ---- Required env vars ----
DB_PASS="${DB_PASS:?DB_PASS must be set}"

# ---- Defaults ----
PROJECT="${GCP_PROJECT:-policing-apps}"
REGION="${GCP_REGION:-asia-southeast1}"
DB_USER="${DB_USER:-puda}"
CLOUDSQL_TIER="${CLOUDSQL_TIER:-db-f1-micro}"
GITHUB_REPO="${GITHUB_REPO:-}"
# Cloud SQL instance region — same as Cloud Run region after migration to policing-db-v2
CLOUDSQL_REGION="${CLOUDSQL_REGION:-asia-southeast1}"

INSTANCE_NAME="${CLOUDSQL_INSTANCE:-policing-db-v2}"

# ---- cd to repo root ----
cd "$(dirname "$0")/.."

# ---- Helpers ----
STEP_NUM=0
step() { STEP_NUM=$((STEP_NUM + 1)); echo -e "\n\033[1;34m=== STEP ${STEP_NUM}: $1 ===\033[0m"; }
ok()   { echo -e "\033[1;32m✅ $1\033[0m"; }
warn() { echo -e "\033[1;33m⚠️  $1\033[0m"; }
fail() { echo -e "\033[1;31m❌ $1\033[0m"; exit 1; }

run() {
  if [ "$DRY_RUN" = true ]; then
    echo "[DRY RUN] $*" >&2
  else
    "$@"
  fi
}

# Create or update a Secret Manager secret
create_secret() {
  local name="$1"
  local value="$2"
  if [ "$DRY_RUN" = true ]; then
    echo "[DRY RUN] create/update secret '$name'"
    return
  fi
  if gcloud secrets describe "$name" --project="$PROJECT" &>/dev/null; then
    warn "Secret '$name' already exists — adding new version"
    echo -n "$value" | gcloud secrets versions add "$name" --data-file=- --project="$PROJECT"
  else
    echo -n "$value" | gcloud secrets create "$name" --data-file=- --project="$PROJECT" \
      --replication-policy=automatic
  fi
  ok "Secret '$name' ready"
}

# Health-check a deployed Cloud Run URL
health_check() {
  local url="$1"
  local name="$2"
  if [ "$DRY_RUN" = true ]; then
    echo "[DRY RUN] health check ${name}: ${url}/health"
    return
  fi
  echo "Checking ${name} health..."
  sleep 5
  local status
  status=$(curl -s -o /dev/null -w '%{http_code}' "${url}/health" || echo "000")
  if [ "$status" = "200" ]; then
    ok "${name} health check passed"
  else
    warn "${name} health returned ${status} (may need a few seconds to start)"
  fi
}

# Get a Cloud Run service URL
get_service_url() {
  local service="$1"
  if [ "$DRY_RUN" = true ]; then
    echo "https://${service}-EXAMPLE.${REGION}.run.app"
  else
    gcloud run services describe "$service" \
      --project "$PROJECT" --region "$REGION" \
      --format='value(status.url)'
  fi
}

# =========================================================================
# PHASE 1: Enable GCP APIs
# =========================================================================
step "Enabling required GCP APIs"

APIS=(
  run.googleapis.com
  cloudbuild.googleapis.com
  sqladmin.googleapis.com
  secretmanager.googleapis.com
  iam.googleapis.com
  iamcredentials.googleapis.com
  artifactregistry.googleapis.com
)

for api in "${APIS[@]}"; do
  run gcloud services enable "$api" --project="$PROJECT" --quiet
done
ok "All required APIs enabled"

# =========================================================================
# PHASE 2: Cloud SQL Setup
# =========================================================================
step "Creating Cloud SQL Postgres instance"

if [ "$DRY_RUN" = true ]; then
  echo "[DRY RUN] Would create Cloud SQL instance '${INSTANCE_NAME}'"
  CLOUDSQL_CONNECTION="${PROJECT}:${CLOUDSQL_REGION}:${INSTANCE_NAME}"
else
  if gcloud sql instances describe "$INSTANCE_NAME" --project="$PROJECT" &>/dev/null; then
    warn "Cloud SQL instance '${INSTANCE_NAME}' already exists — skipping creation"
  else
    gcloud sql instances create "$INSTANCE_NAME" \
      --project="$PROJECT" \
      --region="$CLOUDSQL_REGION" \
      --database-version=POSTGRES_15 \
      --tier="$CLOUDSQL_TIER" \
      --storage-type=SSD \
      --storage-size=10GB \
      --storage-auto-increase \
      --availability-type=zonal \
      --quiet
    ok "Cloud SQL instance created"
  fi
  CLOUDSQL_CONNECTION="${PROJECT}:${CLOUDSQL_REGION}:${INSTANCE_NAME}"
fi

# Create databases (no PUDA — it has its own Cloud SQL in puda-489215)
DATABASES=(social_media dopams forensic)
for db in "${DATABASES[@]}"; do
  if [ "$DRY_RUN" = true ]; then
    echo "[DRY RUN] Would create database '${db}'"
  else
    if gcloud sql databases describe "$db" --instance="$INSTANCE_NAME" --project="$PROJECT" &>/dev/null; then
      warn "Database '${db}' already exists"
    else
      gcloud sql databases create "$db" --instance="$INSTANCE_NAME" --project="$PROJECT" --quiet
      ok "Database '${db}' created"
    fi
  fi
done

# Create user
if [ "$DRY_RUN" = true ]; then
  echo "[DRY RUN] Would create database user '${DB_USER}'"
else
  if gcloud sql users list --instance="$INSTANCE_NAME" --project="$PROJECT" --format='value(name)' | grep -qx "$DB_USER"; then
    warn "Database user '${DB_USER}' already exists — updating password"
    gcloud sql users set-password "$DB_USER" --instance="$INSTANCE_NAME" --project="$PROJECT" --password="$DB_PASS" --quiet
  else
    gcloud sql users create "$DB_USER" --instance="$INSTANCE_NAME" --project="$PROJECT" --password="$DB_PASS" --quiet
    ok "Database user '${DB_USER}' created"
  fi
fi

ok "Cloud SQL setup complete: ${CLOUDSQL_CONNECTION}"

# =========================================================================
# PHASE 3: Secret Manager
# =========================================================================
step "Creating secrets in Secret Manager"

# Generate JWT secrets (one per API)
SM_JWT=$(openssl rand -base64 32)
DOPAMS_JWT=$(openssl rand -base64 32)
FORENSIC_JWT=$(openssl rand -base64 32)

# Database URLs (Cloud SQL socket path)
mk_db_url() {
  local db_name="$1"
  echo "postgresql://${DB_USER}:${DB_PASS}@/${db_name}?host=/cloudsql/${CLOUDSQL_CONNECTION}"
}

SM_DB_URL=$(mk_db_url "social_media")
DOPAMS_DB_URL=$(mk_db_url "dopams")
FORENSIC_DB_URL=$(mk_db_url "forensic")

# Social Media
create_secret "sm-database-url"               "$SM_DB_URL"
create_secret "sm-jwt-secret"                 "$SM_JWT"

# DOPAMS
create_secret "dopams-database-url"           "$DOPAMS_DB_URL"
create_secret "dopams-jwt-secret"             "$DOPAMS_JWT"

# Forensic
create_secret "forensic-database-url"         "$FORENSIC_DB_URL"
create_secret "forensic-jwt-secret"           "$FORENSIC_JWT"

ALL_SECRETS=(
  sm-database-url sm-jwt-secret
  dopams-database-url dopams-jwt-secret
  forensic-database-url forensic-jwt-secret
)

# Grant secret accessor to compute service account
if [ "$DRY_RUN" = true ]; then
  echo "[DRY RUN] Would grant secretAccessor + cloudsql.client to compute SA"
else
  PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
  COMPUTE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
  echo "Compute service account: $COMPUTE_SA"

  for secret in "${ALL_SECRETS[@]}"; do
    gcloud secrets add-iam-policy-binding "$secret" \
      --member="serviceAccount:$COMPUTE_SA" \
      --role=roles/secretmanager.secretAccessor \
      --project="$PROJECT" --quiet 2>/dev/null
  done
  ok "Secret accessor granted for all secrets"

  # Grant project-level roles needed for Cloud Build + Cloud Run
  for role in roles/cloudsql.client roles/storage.admin roles/artifactregistry.writer roles/artifactregistry.createOnPushWriter roles/logging.logWriter; do
    gcloud projects add-iam-policy-binding "$PROJECT" \
      --member="serviceAccount:$COMPUTE_SA" \
      --role="$role" \
      --quiet 2>/dev/null
  done
  ok "Project IAM roles granted (cloudsql.client, storage.admin, artifactregistry.writer, logging.logWriter)"
fi

echo ""
echo "Generated JWT secrets (save these):"
echo "  SM:       $SM_JWT"
echo "  DOPAMS:   $DOPAMS_JWT"
echo "  Forensic: $FORENSIC_JWT"

# =========================================================================
# PHASE 4: Build & Deploy APIs (3 services)
# =========================================================================
step "Building and deploying API services"

# Ensure staging bucket exists
run gcloud storage buckets describe "gs://${PROJECT}_cloudbuild" --project="$PROJECT" &>/dev/null \
  || run gcloud storage buckets create "gs://${PROJECT}_cloudbuild" --project="$PROJECT" --location="$REGION" --quiet 2>/dev/null \
  || true

# ---- Helper: build + deploy an API ----
deploy_api() {
  local service_name="$1"   # Cloud Run service name
  local dockerfile="$2"     # e.g. Dockerfile.api
  local db_url_secret="$3"  # Secret Manager secret name for database URL
  local jwt_secret="$4"     # Secret Manager secret name for JWT
  local db_env_var="$5"     # Env var the API reads (e.g. SM_DATABASE_URL)
  shift 5
  local extra_secrets=("$@")  # Additional --set-secrets args

  echo "" >&2
  echo "--- Building ${service_name} ---" >&2

  run gcloud builds submit \
    --config=cloudbuild-api-generic.yaml \
    --project "$PROJECT" \
    --gcs-source-staging-dir="gs://${PROJECT}_cloudbuild/source" \
    --substitutions="_SERVICE_NAME=${service_name},_DOCKERFILE=${dockerfile}" \
    --quiet >&2

  ok "${service_name} image built" >&2

  echo "--- Deploying ${service_name} to Cloud Run ---" >&2

  local secrets_arg="${db_env_var}=${db_url_secret}:latest,JWT_SECRET=${jwt_secret}:latest"
  if [ ${#extra_secrets[@]} -gt 0 ]; then
    for extra in "${extra_secrets[@]}"; do
      secrets_arg="${secrets_arg},${extra}"
    done
  fi

  run gcloud run deploy "$service_name" \
    --image "gcr.io/${PROJECT}/${service_name}" \
    --project "$PROJECT" \
    --region "$REGION" \
    --platform managed \
    --allow-unauthenticated \
    --port 8080 \
    --memory 512Mi \
    --cpu 1 \
    --min-instances 0 \
    --max-instances 10 \
    --add-cloudsql-instances "$CLOUDSQL_CONNECTION" \
    --set-env-vars "NODE_ENV=production,ALLOWED_ORIGINS=https://placeholder.invalid,DATABASE_SSL=false" \
    --set-secrets "$secrets_arg" \
    --quiet >&2

  local url
  url=$(get_service_url "$service_name")
  ok "${service_name} deployed: ${url}" >&2
  health_check "$url" "$service_name" >&2
  echo "$url"  # only the URL goes to stdout (captured by caller)
}

# Deploy Social Media API
SM_API_URL=$(deploy_api "social-media-api" "Dockerfile.social-media-api" \
  "sm-database-url" "sm-jwt-secret" "SM_DATABASE_URL")

# Deploy DOPAMS API
DOPAMS_API_URL=$(deploy_api "dopams-api" "Dockerfile.dopams-api" \
  "dopams-database-url" "dopams-jwt-secret" "DOPAMS_DATABASE_URL")

# Deploy Forensic API
FORENSIC_API_URL=$(deploy_api "forensic-api" "Dockerfile.forensic-api" \
  "forensic-database-url" "forensic-jwt-secret" "FORENSIC_DATABASE_URL")

# =========================================================================
# PHASE 5: Build & Deploy UIs (3 services)
# =========================================================================
step "Building and deploying UI services"

deploy_ui() {
  local service_name="$1"   # Cloud Run service name
  local app_name="$2"       # Matches Dockerfile.<app_name>
  local api_url="$3"        # Deployed API URL for VITE_API_BASE_URL

  echo "" >&2
  echo "--- Building ${service_name} (API_URL=${api_url}) ---" >&2

  run gcloud builds submit \
    --config=cloudbuild-frontend.yaml \
    --project "$PROJECT" \
    --gcs-source-staging-dir="gs://${PROJECT}_cloudbuild/source" \
    --substitutions="_SERVICE_NAME=${service_name},_APP_NAME=${app_name},_VITE_API_BASE_URL=${api_url}" \
    --quiet >&2

  ok "${service_name} image built" >&2

  echo "--- Deploying ${service_name} to Cloud Run ---" >&2

  run gcloud run deploy "$service_name" \
    --image "gcr.io/${PROJECT}/${service_name}" \
    --project "$PROJECT" \
    --region "$REGION" \
    --platform managed \
    --allow-unauthenticated \
    --port 8080 \
    --memory 256Mi \
    --cpu 1 \
    --min-instances 0 \
    --max-instances 5 \
    --quiet >&2

  local url
  url=$(get_service_url "$service_name")
  ok "${service_name} deployed: ${url}" >&2
  echo "$url"  # only the URL goes to stdout
}

# Social Media UI
SM_UI_URL=$(deploy_ui "social-media-ui" "social-media-ui" "$SM_API_URL")

# DOPAMS UI
DOPAMS_UI_URL=$(deploy_ui "dopams-ui" "dopams-ui" "$DOPAMS_API_URL")

# Forensic UI
FORENSIC_UI_URL=$(deploy_ui "forensic-ui" "forensic-ui" "$FORENSIC_API_URL")

# =========================================================================
# PHASE 6: Update CORS on each API with its UI URLs
# =========================================================================
step "Updating API CORS origins with frontend URLs"

SM_DOMAIN="police-smmt.adssoftek.com"
DOPAMS_DOMAIN="police-dopams.adssoftek.com"
FORENSIC_DOMAIN="police-forensic.adssoftek.com"

run gcloud run services update social-media-api \
  --project "$PROJECT" --region "$REGION" \
  --update-env-vars "^::^ALLOWED_ORIGINS=${SM_UI_URL},https://${SM_DOMAIN}" \
  --quiet
ok "social-media-api CORS → social-media-ui + ${SM_DOMAIN}"

run gcloud run services update dopams-api \
  --project "$PROJECT" --region "$REGION" \
  --update-env-vars "^::^ALLOWED_ORIGINS=${DOPAMS_UI_URL},https://${DOPAMS_DOMAIN}" \
  --quiet
ok "dopams-api CORS → dopams-ui + ${DOPAMS_DOMAIN}"

run gcloud run services update forensic-api \
  --project "$PROJECT" --region "$REGION" \
  --update-env-vars "^::^ALLOWED_ORIGINS=${FORENSIC_UI_URL},https://${FORENSIC_DOMAIN}" \
  --quiet
ok "forensic-api CORS → forensic-ui + ${FORENSIC_DOMAIN}"

# =========================================================================
# PHASE 7: Custom Domain Mapping
# =========================================================================
step "Mapping custom domains"

map_domain() {
  local service="$1"
  local domain="$2"
  if [ "$DRY_RUN" = true ]; then
    echo "[DRY RUN] gcloud run domain-mappings create --service=${service} --domain=${domain}"
    return
  fi
  if gcloud beta run domain-mappings describe --domain="$domain" \
      --project="$PROJECT" --region="$REGION" &>/dev/null; then
    warn "Domain mapping '${domain}' already exists"
  else
    gcloud beta run domain-mappings create \
      --service="$service" \
      --domain="$domain" \
      --project="$PROJECT" \
      --region="$REGION" \
      --quiet
    ok "Mapped ${domain} → ${service}"
  fi
}

map_domain "social-media-ui" "$SM_DOMAIN"
map_domain "dopams-ui"       "$DOPAMS_DOMAIN"
map_domain "forensic-ui"     "$FORENSIC_DOMAIN"

echo ""
echo "┌──────────────────────────────────────────────────────────────┐"
echo "│ DNS Records Required (CNAME → ghs.googlehosted.com)        │"
echo "├──────────────────────────────────────────────────────────────┤"
echo "│  ${SM_DOMAIN}       CNAME  ghs.googlehosted.com             │"
echo "│  ${DOPAMS_DOMAIN}   CNAME  ghs.googlehosted.com             │"
echo "│  ${FORENSIC_DOMAIN} CNAME  ghs.googlehosted.com             │"
echo "└──────────────────────────────────────────────────────────────┘"

# =========================================================================
# PHASE 8: GitHub Actions CI/CD (Workload Identity Federation)
# =========================================================================
if [ -n "$GITHUB_REPO" ]; then
  step "Setting up GitHub Actions Workload Identity Federation"

  SA_NAME="github-deployer"
  SA_EMAIL="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
  POOL_NAME="github-pool"
  PROVIDER_NAME="github-provider"

  # Create service account
  if [ "$DRY_RUN" = true ]; then
    echo "[DRY RUN] Would create service account '${SA_NAME}'"
  else
    if gcloud iam service-accounts describe "$SA_EMAIL" --project="$PROJECT" &>/dev/null; then
      warn "Service account '${SA_NAME}' already exists"
    else
      gcloud iam service-accounts create "$SA_NAME" \
        --display-name="GitHub Actions deployer" \
        --project="$PROJECT" --quiet
      ok "Service account '${SA_NAME}' created"
    fi

    # Grant roles
    for role in roles/run.admin roles/cloudbuild.builds.editor roles/storage.admin roles/iam.serviceAccountUser; do
      gcloud projects add-iam-policy-binding "$PROJECT" \
        --member="serviceAccount:$SA_EMAIL" \
        --role="$role" \
        --quiet 2>/dev/null
    done
    ok "Roles granted to ${SA_NAME}"
  fi

  # Create Workload Identity Pool
  if [ "$DRY_RUN" = true ]; then
    echo "[DRY RUN] Would create WIF pool '${POOL_NAME}' + provider '${PROVIDER_NAME}'"
    WIF_PROVIDER="projects/${PROJECT}/locations/global/workloadIdentityPools/${POOL_NAME}/providers/${PROVIDER_NAME}"
  else
    if gcloud iam workload-identity-pools describe "$POOL_NAME" \
        --location=global --project="$PROJECT" &>/dev/null; then
      warn "Workload Identity Pool '${POOL_NAME}' already exists"
    else
      gcloud iam workload-identity-pools create "$POOL_NAME" \
        --location=global \
        --display-name="GitHub Actions" \
        --project="$PROJECT" --quiet
      ok "Workload Identity Pool created"
    fi

    # Create OIDC Provider
    if gcloud iam workload-identity-pools providers describe "$PROVIDER_NAME" \
        --workload-identity-pool="$POOL_NAME" --location=global \
        --project="$PROJECT" &>/dev/null; then
      warn "WIF provider '${PROVIDER_NAME}' already exists"
    else
      gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_NAME" \
        --workload-identity-pool="$POOL_NAME" \
        --location=global \
        --issuer-uri="https://token.actions.githubusercontent.com" \
        --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
        --attribute-condition="assertion.repository=='${GITHUB_REPO}'" \
        --project="$PROJECT" --quiet
      ok "OIDC provider created for ${GITHUB_REPO}"
    fi

    # Get the full provider resource name
    WIF_PROVIDER=$(gcloud iam workload-identity-pools providers describe "$PROVIDER_NAME" \
      --workload-identity-pool="$POOL_NAME" --location=global \
      --project="$PROJECT" --format='value(name)')

    # Bind the service account to the WIF pool
    gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
      --project="$PROJECT" \
      --role="roles/iam.workloadIdentityUser" \
      --member="principalSet://iam.googleapis.com/projects/$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')/locations/global/workloadIdentityPools/${POOL_NAME}/attribute.repository/${GITHUB_REPO}" \
      --quiet 2>/dev/null
    ok "Service account bound to WIF pool"
  fi

  echo ""
  echo "┌──────────────────────────────────────────────────┐"
  echo "│ GitHub Actions Secrets to Set                    │"
  echo "├──────────────────────────────────────────────────┤"
  echo "│ GCP_WORKLOAD_IDENTITY_PROVIDER:                  │"
  echo "│   ${WIF_PROVIDER}"
  echo "│                                                  │"
  echo "│ GCP_SERVICE_ACCOUNT:                             │"
  echo "│   ${SA_EMAIL}"
  echo "└──────────────────────────────────────────────────┘"
fi

# =========================================================================
# DONE — Summary
# =========================================================================
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║    Policing Apps (non-PUDA) — Deployment Complete          ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║                                                            ║"
echo "║  Social Media Intelligence                                 ║"
printf "║    API:      %-46s ║\n" "$SM_API_URL"
printf "║    UI:       %-46s ║\n" "$SM_UI_URL"
printf "║              https://%-37s ║\n" "$SM_DOMAIN"
echo "║                                                            ║"
echo "║  DOPAMS                                                    ║"
printf "║    API:      %-46s ║\n" "$DOPAMS_API_URL"
printf "║    UI:       %-46s ║\n" "$DOPAMS_UI_URL"
printf "║              https://%-37s ║\n" "$DOPAMS_DOMAIN"
echo "║                                                            ║"
echo "║  Forensic Science Lab                                      ║"
printf "║    API:      %-46s ║\n" "$FORENSIC_API_URL"
printf "║    UI:       %-46s ║\n" "$FORENSIC_UI_URL"
printf "║              https://%-37s ║\n" "$FORENSIC_DOMAIN"
echo "║                                                            ║"
echo "║  Cloud SQL: ${CLOUDSQL_CONNECTION}"
echo "║  Databases: social_media, dopams, forensic                 ║"
echo "║                                                            ║"
echo "║  NOTE: PUDA deploys separately → scripts/setup-puda-cloudrun.sh"
echo "║                                                            ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  Next steps:                                               ║"
echo "║    1. Save the JWT secrets above securely                  ║"
echo "║    2. Add DNS CNAME records (see above)                    ║"
echo "║    3. Test each API: curl <API_URL>/health                 ║"
echo "║    4. Open each UI URL in browser                          ║"
if [ -n "$GITHUB_REPO" ]; then
echo "║    4. Set the 2 GitHub secrets shown above                 ║"
echo "║    5. Push to main to trigger CI/CD                        ║"
fi
echo "╚══════════════════════════════════════════════════════════════╝"
