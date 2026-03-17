#!/bin/bash
# =============================================================================
# PUDA — GCP Cloud Run Deployment (puda-489215)
# Deploys 3 services (puda-api, puda-citizen, puda-officer) with a dedicated
# Cloud SQL instance, secrets, and optional GitHub Actions CI/CD via WIF.
#
# Prerequisites:
#   - gcloud CLI authenticated with project-owner or equivalent permissions
#   - Docker installed (for Cloud Build)
#
# Required env vars:
#   DB_PASS         — Database password (URL-encoded if it contains special chars)
#
# Optional env vars:
#   GCP_PROJECT     — GCP project ID (default: puda-489215)
#   GCP_REGION      — GCP region (default: asia-southeast1)
#   DB_USER         — Database user (default: puda)
#   CLOUDSQL_TIER   — Cloud SQL machine type (default: db-f1-micro)
#   GITHUB_REPO     — GitHub repo (org/name) for WIF setup; skip WIF if unset
#
# Usage:
#   DB_PASS='StrongPass123!' ./scripts/setup-puda-cloudrun.sh
#   GCP_PROJECT=puda-489215 DB_PASS='StrongPass123!' ./scripts/setup-puda-cloudrun.sh
#
# Dry run (prints commands without executing):
#   DB_PASS=test ./scripts/setup-puda-cloudrun.sh --dry-run
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
PROJECT="${GCP_PROJECT:-puda-489215}"
REGION="${GCP_REGION:-asia-southeast1}"
DB_USER="${DB_USER:-puda}"
CLOUDSQL_TIER="${CLOUDSQL_TIER:-db-f1-micro}"
GITHUB_REPO="${GITHUB_REPO:-}"

INSTANCE_NAME="puda-db"

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
step "Enabling required GCP APIs in ${PROJECT}"

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
# PHASE 2: Cloud SQL Setup (dedicated instance in puda-489215)
# =========================================================================
step "Creating Cloud SQL Postgres instance '${INSTANCE_NAME}'"

if [ "$DRY_RUN" = true ]; then
  echo "[DRY RUN] Would create Cloud SQL instance '${INSTANCE_NAME}'"
  CLOUDSQL_CONNECTION="${PROJECT}:${REGION}:${INSTANCE_NAME}"
else
  if gcloud sql instances describe "$INSTANCE_NAME" --project="$PROJECT" &>/dev/null; then
    warn "Cloud SQL instance '${INSTANCE_NAME}' already exists — skipping creation"
  else
    gcloud sql instances create "$INSTANCE_NAME" \
      --project="$PROJECT" \
      --region="$REGION" \
      --database-version=POSTGRES_15 \
      --tier="$CLOUDSQL_TIER" \
      --storage-type=SSD \
      --storage-size=10GB \
      --storage-auto-increase \
      --availability-type=zonal \
      --quiet
    ok "Cloud SQL instance created"
  fi
  CLOUDSQL_CONNECTION="${PROJECT}:${REGION}:${INSTANCE_NAME}"
fi

# Create database
if [ "$DRY_RUN" = true ]; then
  echo "[DRY RUN] Would create database 'puda'"
else
  if gcloud sql databases describe "puda" --instance="$INSTANCE_NAME" --project="$PROJECT" &>/dev/null; then
    warn "Database 'puda' already exists"
  else
    gcloud sql databases create "puda" --instance="$INSTANCE_NAME" --project="$PROJECT" --quiet
    ok "Database 'puda' created"
  fi
fi

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

PUDA_JWT=$(openssl rand -base64 32)

# Database URL (Cloud SQL socket path)
PUDA_DB_URL="postgresql://${DB_USER}:${DB_PASS}@/puda?host=/cloudsql/${CLOUDSQL_CONNECTION}"

create_secret "puda-database-url"             "$PUDA_DB_URL"
create_secret "puda-jwt-secret"               "$PUDA_JWT"
create_secret "puda-payment-webhook-secret"   "placeholder-change-when-gateway-ready"

ALL_SECRETS=(
  puda-database-url puda-jwt-secret puda-payment-webhook-secret
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
echo "Generated JWT secret (save this):"
echo "  PUDA: $PUDA_JWT"

# =========================================================================
# PHASE 4: Build & Deploy PUDA API
# =========================================================================
step "Building and deploying puda-api"

# Ensure staging bucket exists
run gcloud storage buckets describe "gs://${PROJECT}_cloudbuild" --project="$PROJECT" &>/dev/null \
  || run gcloud storage buckets create "gs://${PROJECT}_cloudbuild" --project="$PROJECT" --location="$REGION" --quiet 2>/dev/null \
  || true

deploy_api() {
  local service_name="$1"
  local dockerfile="$2"
  local db_url_secret="$3"
  local jwt_secret="$4"
  local db_env_var="$5"
  shift 5
  local extra_secrets=("$@")

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

PUDA_API_URL=$(deploy_api "puda-api" "Dockerfile.api" \
  "puda-database-url" "puda-jwt-secret" "DATABASE_URL" \
  "PAYMENT_GATEWAY_WEBHOOK_SECRET=puda-payment-webhook-secret:latest")

# =========================================================================
# PHASE 5: Build & Deploy PUDA UIs
# =========================================================================
step "Building and deploying PUDA UI services"

deploy_ui() {
  local service_name="$1"
  local app_name="$2"
  local api_url="$3"

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

CITIZEN_URL=$(deploy_ui "puda-citizen" "citizen" "$PUDA_API_URL")
OFFICER_URL=$(deploy_ui "puda-officer" "officer" "$PUDA_API_URL")

# =========================================================================
# PHASE 6: Update CORS on puda-api with UI URLs
# =========================================================================
step "Updating puda-api CORS origins with frontend URLs"

CITIZEN_DOMAIN="puda.adssoftek.com"
OFFICER_DOMAIN="puda-officer.adssoftek.com"

run gcloud run services update puda-api \
  --project "$PROJECT" --region "$REGION" \
  --update-env-vars "^::^ALLOWED_ORIGINS=${CITIZEN_URL},${OFFICER_URL},https://${CITIZEN_DOMAIN},https://${OFFICER_DOMAIN}" \
  --quiet
ok "puda-api CORS → citizen + officer (Cloud Run + custom domains)"

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

map_domain "puda-citizen" "$CITIZEN_DOMAIN"
map_domain "puda-officer" "$OFFICER_DOMAIN"

echo ""
echo "┌──────────────────────────────────────────────────────────────┐"
echo "│ DNS Records Required (CNAME → ghs.googlehosted.com)        │"
echo "├──────────────────────────────────────────────────────────────┤"
echo "│  ${CITIZEN_DOMAIN}  CNAME  ghs.googlehosted.com             │"
echo "│  ${OFFICER_DOMAIN}  CNAME  ghs.googlehosted.com             │"
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
echo "║         PUDA — Deployment Complete (${PROJECT})"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║                                                            ║"
printf "║  API:      %-48s ║\n" "$PUDA_API_URL"
printf "║  Citizen:  %-48s ║\n" "$CITIZEN_URL"
printf "║             https://%-38s ║\n" "$CITIZEN_DOMAIN"
printf "║  Officer:  %-48s ║\n" "$OFFICER_URL"
printf "║             https://%-38s ║\n" "$OFFICER_DOMAIN"
echo "║                                                            ║"
echo "║  Cloud SQL: ${CLOUDSQL_CONNECTION}"
echo "║  Database:  puda                                           ║"
echo "║                                                            ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  Next steps:                                               ║"
echo "║    1. Save the JWT secret above securely                   ║"
echo "║    2. Add DNS CNAME records (see above)                    ║"
echo "║    3. Test API: curl <API_URL>/health                      ║"
echo "║    4. Open citizen + officer UI URLs in browser            ║"
if [ -n "$GITHUB_REPO" ]; then
echo "║    4. Set the 2 GitHub secrets shown above                 ║"
echo "║    5. Push to main to trigger CI/CD                        ║"
fi
echo "╚══════════════════════════════════════════════════════════════╝"
