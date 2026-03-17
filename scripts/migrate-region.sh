#!/bin/bash
# =============================================================================
# Migrate Cloud Run services from asia-south1 → asia-southeast1
# For the policing-apps GCP project ONLY (social-media, dopams, forensic).
#
# NOTE: This was a one-time migration utility. PUDA services now deploy to
# a separate GCP project (puda-489215) via scripts/setup-puda-cloudrun.sh.
#
# Reuses existing Cloud SQL (asia-south1), secrets, and container images for APIs.
# Rebuilds UIs since VITE_API_BASE_URL is baked in at build time.
#
# Usage:
#   ./scripts/migrate-region.sh
#   ./scripts/migrate-region.sh --dry-run
# =============================================================================
set -euo pipefail

DRY_RUN=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    *) echo "Unknown flag: $arg"; exit 1 ;;
  esac
done

PROJECT="policing-apps"
OLD_REGION="asia-south1"
NEW_REGION="asia-southeast1"
CLOUDSQL_CONNECTION="${PROJECT}:${OLD_REGION}:policing-db"

cd "$(dirname "$0")/.."

# ---- Helpers ----
STEP_NUM=0
step() { STEP_NUM=$((STEP_NUM + 1)); echo -e "\n\033[1;34m=== STEP ${STEP_NUM}: $1 ===\033[0m"; }
ok()   { echo -e "\033[1;32m✅ $1\033[0m"; }
warn() { echo -e "\033[1;33m⚠️  $1\033[0m"; }

run() {
  if [ "$DRY_RUN" = true ]; then
    echo "[DRY RUN] $*" >&2
  else
    "$@"
  fi
}

get_service_url() {
  local service="$1"
  local region="${2:-$NEW_REGION}"
  if [ "$DRY_RUN" = true ]; then
    echo "https://${service}-EXAMPLE.${region}.run.app"
  else
    gcloud run services describe "$service" \
      --project "$PROJECT" --region "$region" \
      --format='value(status.url)'
  fi
}

# =========================================================================
# STEP 1: Deploy APIs to new region (reuse existing images from GCR)
# =========================================================================
step "Deploying API services to ${NEW_REGION} (reusing existing images)"

deploy_api() {
  local service_name="$1"
  local db_url_secret="$2"
  local jwt_secret="$3"
  local db_env_var="$4"
  shift 4
  local extra_secrets=("$@")

  echo "" >&2
  echo "--- Deploying ${service_name} to ${NEW_REGION} ---" >&2

  local secrets_arg="${db_env_var}=${db_url_secret}:latest,JWT_SECRET=${jwt_secret}:latest"
  if [ ${#extra_secrets[@]} -gt 0 ]; then
    for extra in "${extra_secrets[@]}"; do
      secrets_arg="${secrets_arg},${extra}"
    done
  fi

  run gcloud run deploy "$service_name" \
    --image "gcr.io/${PROJECT}/${service_name}" \
    --project "$PROJECT" \
    --region "$NEW_REGION" \
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
  echo "$url"
}

PUDA_API_URL=$(deploy_api "puda-api" \
  "puda-database-url" "puda-jwt-secret" "DATABASE_URL" \
  "PAYMENT_GATEWAY_WEBHOOK_SECRET=puda-payment-webhook-secret:latest")

# puda-api needs additional env var for stub payment provider
run gcloud run services update puda-api \
  --project "$PROJECT" --region "$NEW_REGION" \
  --update-env-vars "ALLOW_STUB_PAYMENT_PROVIDER_IN_PRODUCTION=true" \
  --quiet

SM_API_URL=$(deploy_api "social-media-api" \
  "sm-database-url" "sm-jwt-secret" "SM_DATABASE_URL")

DOPAMS_API_URL=$(deploy_api "dopams-api" \
  "dopams-database-url" "dopams-jwt-secret" "DOPAMS_DATABASE_URL")

FORENSIC_API_URL=$(deploy_api "forensic-api" \
  "forensic-database-url" "forensic-jwt-secret" "FORENSIC_DATABASE_URL")

# =========================================================================
# STEP 2: Rebuild & Deploy UIs to new region (new API URLs baked in)
# =========================================================================
step "Rebuilding and deploying UI services to ${NEW_REGION}"

# Ensure staging bucket exists
run gcloud storage buckets describe "gs://${PROJECT}_cloudbuild" --project="$PROJECT" &>/dev/null \
  || run gcloud storage buckets create "gs://${PROJECT}_cloudbuild" --project="$PROJECT" --location="$NEW_REGION" --quiet 2>/dev/null \
  || true

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

  echo "--- Deploying ${service_name} to ${NEW_REGION} ---" >&2

  run gcloud run deploy "$service_name" \
    --image "gcr.io/${PROJECT}/${service_name}" \
    --project "$PROJECT" \
    --region "$NEW_REGION" \
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
  echo "$url"
}

CITIZEN_URL=$(deploy_ui "puda-citizen" "citizen" "$PUDA_API_URL")
OFFICER_URL=$(deploy_ui "puda-officer" "officer" "$PUDA_API_URL")
SM_UI_URL=$(deploy_ui "social-media-ui" "social-media-ui" "$SM_API_URL")
DOPAMS_UI_URL=$(deploy_ui "dopams-ui" "dopams-ui" "$DOPAMS_API_URL")
FORENSIC_UI_URL=$(deploy_ui "forensic-ui" "forensic-ui" "$FORENSIC_API_URL")

# =========================================================================
# STEP 3: Update CORS on each API with new UI URLs
# =========================================================================
step "Updating API CORS origins with new frontend URLs"

run gcloud run services update puda-api \
  --project "$PROJECT" --region "$NEW_REGION" \
  --update-env-vars "^::^ALLOWED_ORIGINS=${CITIZEN_URL},${OFFICER_URL}" \
  --quiet
ok "puda-api CORS → citizen + officer"

run gcloud run services update social-media-api \
  --project "$PROJECT" --region "$NEW_REGION" \
  --update-env-vars "ALLOWED_ORIGINS=${SM_UI_URL}" \
  --quiet
ok "social-media-api CORS → social-media-ui"

run gcloud run services update dopams-api \
  --project "$PROJECT" --region "$NEW_REGION" \
  --update-env-vars "ALLOWED_ORIGINS=${DOPAMS_UI_URL}" \
  --quiet
ok "dopams-api CORS → dopams-ui"

run gcloud run services update forensic-api \
  --project "$PROJECT" --region "$NEW_REGION" \
  --update-env-vars "ALLOWED_ORIGINS=${FORENSIC_UI_URL}" \
  --quiet
ok "forensic-api CORS → forensic-ui"

# =========================================================================
# STEP 4: Delete old services in asia-south1
# =========================================================================
step "Cleaning up old services in ${OLD_REGION}"

OLD_SERVICES=(
  puda-api social-media-api dopams-api forensic-api
  puda-citizen puda-officer social-media-ui dopams-ui forensic-ui
)

for svc in "${OLD_SERVICES[@]}"; do
  echo "Deleting ${svc} from ${OLD_REGION}..."
  run gcloud run services delete "$svc" \
    --project "$PROJECT" --region "$OLD_REGION" \
    --quiet 2>/dev/null || warn "Could not delete ${svc} from ${OLD_REGION}"
done
ok "Old services cleaned up"

# =========================================================================
# DONE — Summary
# =========================================================================
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║     Region Migration Complete: ${OLD_REGION} → ${NEW_REGION}      ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║                                                            ║"
echo "║  PUDA                                                      ║"
printf "║    API:      %-46s ║\n" "$PUDA_API_URL"
printf "║    Citizen:  %-46s ║\n" "$CITIZEN_URL"
printf "║    Officer:  %-46s ║\n" "$OFFICER_URL"
echo "║                                                            ║"
echo "║  Social Media Intelligence                                 ║"
printf "║    API:      %-46s ║\n" "$SM_API_URL"
printf "║    UI:       %-46s ║\n" "$SM_UI_URL"
echo "║                                                            ║"
echo "║  DOPAMS                                                    ║"
printf "║    API:      %-46s ║\n" "$DOPAMS_API_URL"
printf "║    UI:       %-46s ║\n" "$DOPAMS_UI_URL"
echo "║                                                            ║"
echo "║  Forensic Science Lab                                      ║"
printf "║    API:      %-46s ║\n" "$FORENSIC_API_URL"
printf "║    UI:       %-46s ║\n" "$FORENSIC_UI_URL"
echo "║                                                            ║"
echo "║  Cloud SQL: ${CLOUDSQL_CONNECTION} (unchanged)"
echo "║  Domain mapping: NOW AVAILABLE in ${NEW_REGION}            ║"
echo "║                                                            ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  Next steps:                                               ║"
echo "║    1. Test each service URL                                ║"
echo "║    2. Map custom domains:                                  ║"
echo "║       gcloud run domain-mappings create --service=<svc>    ║"
echo "║         --domain=<your-domain> --region=${NEW_REGION}      ║"
echo "╚══════════════════════════════════════════════════════════════╝"
