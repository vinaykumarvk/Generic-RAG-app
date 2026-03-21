#!/bin/bash
set -euo pipefail

PROJECT="${GCP_PROJECT:-policing-apps}"
PROJECT_NUMBER="${GCP_PROJECT_NUMBER:-809677427844}"
REGION="${GCP_REGION:-asia-southeast1}"
REPO="${ARTIFACT_REPO:-policing-apps}"
API_SERVICE="${API_SERVICE:-police-cases-kb-api}"
WEB_SERVICE="${WEB_SERVICE:-police-cases-kb}"
WORKER_SERVICE="${WORKER_SERVICE:-police-cases-kb-worker}"
SERVICE_ACCOUNT="${SERVICE_ACCOUNT:-809677427844-compute@developer.gserviceaccount.com}"
API_CLOUDSQL_INSTANCES="${API_CLOUDSQL_INSTANCES:-policing-apps:asia-southeast1:policing-db,policing-apps:asia-southeast1:policing-db-v2}"
WORKER_CLOUDSQL_INSTANCES="${WORKER_CLOUDSQL_INSTANCES:-$API_CLOUDSQL_INSTANCES}"
API_ALLOWED_ORIGINS="${API_ALLOWED_ORIGINS:-https://police-cases-kb-809677427844.asia-southeast1.run.app}"
API_DATABASE_SECRET="${API_DATABASE_SECRET:-police-cases-kb-database-url:latest}"
API_JWT_SECRET="${API_JWT_SECRET:-police-cases-kb-jwt-secret:latest}"
API_OPENROUTER_KEY_SECRET="${API_OPENROUTER_KEY_SECRET:-openrouter-api-key:latest}"
WEB_API_UPSTREAM="${WEB_API_UPSTREAM:-https://police-cases-kb-api-809677427844.asia-southeast1.run.app}"
WORKER_DATABASE_SECRET="${WORKER_DATABASE_SECRET:-$API_DATABASE_SECRET}"
WORKER_OPENAI_API_KEY_SECRET="${WORKER_OPENAI_API_KEY_SECRET:-openai-api-key:latest}"
WORKER_GEMINI_API_KEY_SECRET="${WORKER_GEMINI_API_KEY_SECRET:-gemini-api-key:latest}"
WORKER_DOCUMENT_AI_SECRET="${WORKER_DOCUMENT_AI_SECRET:-police-cases-kb-document-ai-credentials:latest}"
WORKER_DOCUMENT_AI_PROJECT_ID="${WORKER_DOCUMENT_AI_PROJECT_ID:-wealth-report}"
WORKER_DOCUMENT_AI_LOCATION="${WORKER_DOCUMENT_AI_LOCATION:-eu}"
WORKER_DOCUMENT_AI_PROCESSOR_ID="${WORKER_DOCUMENT_AI_PROCESSOR_ID:-70b690b94894b43}"
WORKER_DOCUMENT_AI_CREDENTIALS_PATH="${WORKER_DOCUMENT_AI_CREDENTIALS_PATH:-/var/secrets/document-ai/wealth-report-sa.json}"
WORKER_GEMINI_MODEL="${WORKER_GEMINI_MODEL:-gemini-2.5-flash}"
WORKER_KG_LLM_PROVIDER="${WORKER_KG_LLM_PROVIDER:-}"
WORKER_KG_MODEL_ID="${WORKER_KG_MODEL_ID:-}"
WORKER_POLLER_THREADS="${WORKER_POLLER_THREADS:-3}"
UPLOADS_BUCKET="${UPLOADS_BUCKET:-police-cases-kb-uploads-${PROJECT_NUMBER}}"

API_IMAGE="asia-southeast1-docker.pkg.dev/${PROJECT}/${REPO}/${API_SERVICE}:latest"
WEB_IMAGE="asia-southeast1-docker.pkg.dev/${PROJECT}/${REPO}/${WEB_SERVICE}:latest"
WORKER_IMAGE="asia-southeast1-docker.pkg.dev/${PROJECT}/${REPO}/${WORKER_SERVICE}:latest"

cd "$(dirname "$0")/.."

step() { printf '\n=== %s ===\n' "$1"; }
ok() { printf 'OK: %s\n' "$1"; }
warn() { printf 'WARN: %s\n' "$1"; }

join_by_comma() {
  local IFS=,
  echo "$*"
}

if [ -z "$WORKER_KG_LLM_PROVIDER" ]; then
  if [ -n "$WORKER_GEMINI_API_KEY_SECRET" ]; then
    WORKER_KG_LLM_PROVIDER="gemini"
  else
    WORKER_KG_LLM_PROVIDER="openai"
  fi
fi

if [ -z "$WORKER_KG_MODEL_ID" ] && [ "$WORKER_KG_LLM_PROVIDER" = "gemini" ]; then
  WORKER_KG_MODEL_ID="$WORKER_GEMINI_MODEL"
fi

service_exists() {
  local service="$1"
  gcloud run services describe "$service" \
    --project "$PROJECT" \
    --region "$REGION" \
    --platform managed >/dev/null 2>&1
}

get_service_url() {
  local service="$1"
  gcloud run services describe "$service" \
    --project "$PROJECT" \
    --region "$REGION" \
    --platform managed \
    --format='value(status.url)'
}

get_ready_revision() {
  local service="$1"
  if ! service_exists "$service"; then
    return 0
  fi
  gcloud run services describe "$service" \
    --project "$PROJECT" \
    --region "$REGION" \
    --platform managed \
    --format='value(status.latestReadyRevisionName)'
}

service_has_upload_volume() {
  local service="$1"
  if ! service_exists "$service"; then
    return 1
  fi

  gcloud run services describe "$service" \
    --project "$PROJECT" \
    --region "$REGION" \
    --platform managed \
    --format=json | grep -q '"name": "shared-uploads"'
}

require_secret() {
  local secret_name="$1"
  gcloud secrets describe "$secret_name" --project "$PROJECT" >/dev/null
}

ensure_secret_accessor() {
  local secret_name="$1"
  gcloud secrets add-iam-policy-binding "$secret_name" \
    --project "$PROJECT" \
    --member "serviceAccount:${SERVICE_ACCOUNT}" \
    --role "roles/secretmanager.secretAccessor" \
    --quiet >/dev/null
}

ensure_uploads_bucket() {
  if gcloud storage buckets describe "gs://${UPLOADS_BUCKET}" --project "$PROJECT" >/dev/null 2>&1; then
    ok "Uploads bucket exists: gs://${UPLOADS_BUCKET}"
    return
  fi

  gcloud storage buckets create "gs://${UPLOADS_BUCKET}" \
    --project "$PROJECT" \
    --location "$REGION" \
    --uniform-bucket-level-access \
    --quiet
  ok "Created uploads bucket: gs://${UPLOADS_BUCKET}"
}

health_check() {
  local name="$1"
  local url="$2"
  local status
  status="$(curl -s -o /dev/null -w '%{http_code}' "${url}")"
  if [ "$status" = "200" ]; then
    ok "${name} check passed (${url})"
  else
    warn "${name} check returned ${status} (${url})"
  fi
}

step "Capturing rollback revisions"
API_PREV_REVISION="$(get_ready_revision "$API_SERVICE")"
WEB_PREV_REVISION="$(get_ready_revision "$WEB_SERVICE")"
WORKER_PREV_REVISION="$(get_ready_revision "$WORKER_SERVICE")"
ok "API previous revision: ${API_PREV_REVISION}"
ok "Web previous revision: ${WEB_PREV_REVISION}"
ok "Worker previous revision: ${WORKER_PREV_REVISION:-<none>}"

step "Validating shared runtime dependencies"
ensure_uploads_bucket
require_secret "${WORKER_DATABASE_SECRET%%:*}"
require_secret "${WORKER_OPENAI_API_KEY_SECRET%%:*}"
require_secret "${WORKER_DOCUMENT_AI_SECRET%%:*}"
if [ -n "$WORKER_GEMINI_API_KEY_SECRET" ]; then
  require_secret "${WORKER_GEMINI_API_KEY_SECRET%%:*}"
fi
ensure_secret_accessor "${WORKER_DATABASE_SECRET%%:*}"
ensure_secret_accessor "${WORKER_OPENAI_API_KEY_SECRET%%:*}"
ensure_secret_accessor "${WORKER_DOCUMENT_AI_SECRET%%:*}"
if [ -n "$WORKER_GEMINI_API_KEY_SECRET" ]; then
  ensure_secret_accessor "${WORKER_GEMINI_API_KEY_SECRET%%:*}"
fi
require_secret "${API_OPENROUTER_KEY_SECRET%%:*}"
ensure_secret_accessor "${API_OPENROUTER_KEY_SECRET%%:*}"
ok "Required worker secrets are present"

step "Building API image"
gcloud builds submit . \
  --project "$PROJECT" \
  --config cloudbuild-api-generic.yaml \
  --substitutions "_DOCKERFILE=Dockerfile.api,_IMAGE=${API_IMAGE}" \
  --quiet
ok "Built ${API_IMAGE}"

step "Deploying API"
api_volume_args=()
if ! service_has_upload_volume "$API_SERVICE"; then
  api_volume_args+=(
    --add-volume "name=shared-uploads,type=cloud-storage,bucket=${UPLOADS_BUCKET}"
    --add-volume-mount "volume=shared-uploads,mount-path=/app/uploads"
  )
fi

gcloud run deploy "$API_SERVICE" \
  --project "$PROJECT" \
  --region "$REGION" \
  --platform managed \
  --image "$API_IMAGE" \
  --service-account "$SERVICE_ACCOUNT" \
  --allow-unauthenticated \
  --port 8080 \
  --cpu 1 \
  --memory 512Mi \
  --concurrency 80 \
  --timeout 300 \
  --min-instances 0 \
  --max-instances 10 \
  --add-cloudsql-instances "$API_CLOUDSQL_INSTANCES" \
  --set-env-vars "NODE_ENV=production,DATABASE_SSL=false,ALLOWED_ORIGINS=${API_ALLOWED_ORIGINS},STORAGE_BASE_DIR=./uploads,ALLOW_LOCAL_STORAGE_SHARED_MOUNT=true" \
  --set-secrets "DATABASE_URL=${API_DATABASE_SECRET},JWT_SECRET=${API_JWT_SECRET},OPENROUTER_API_KEY=${API_OPENROUTER_KEY_SECRET}" \
  "${api_volume_args[@]+"${api_volume_args[@]}"}" \
  --quiet
API_URL="$(get_service_url "$API_SERVICE")"
ok "API deployed: ${API_URL}"

step "Building worker image"
gcloud builds submit . \
  --project "$PROJECT" \
  --config cloudbuild-api-generic.yaml \
  --substitutions "_DOCKERFILE=apps/worker/Dockerfile,_IMAGE=${WORKER_IMAGE}" \
  --quiet
ok "Built ${WORKER_IMAGE}"

step "Deploying worker"
worker_volume_args=()
if ! service_has_upload_volume "$WORKER_SERVICE"; then
  worker_volume_args+=(
    --add-volume "name=shared-uploads,type=cloud-storage,bucket=${UPLOADS_BUCKET}"
    --add-volume-mount "volume=shared-uploads,mount-path=/app/uploads"
  )
fi

worker_env_vars=(
  "STORAGE_BASE_DIR=./uploads"
  "WORKER_POLLER_THREADS=${WORKER_POLLER_THREADS}"
  "DOCUMENT_AI_PROJECT_ID=${WORKER_DOCUMENT_AI_PROJECT_ID}"
  "DOCUMENT_AI_LOCATION=${WORKER_DOCUMENT_AI_LOCATION}"
  "DOCUMENT_AI_PROCESSOR_ID=${WORKER_DOCUMENT_AI_PROCESSOR_ID}"
  "DOCUMENT_AI_CREDENTIALS_PATH=${WORKER_DOCUMENT_AI_CREDENTIALS_PATH}"
  "KG_LLM_PROVIDER=${WORKER_KG_LLM_PROVIDER}"
)
if [ "$WORKER_KG_LLM_PROVIDER" = "gemini" ]; then
  worker_env_vars+=(
    "GEMINI_MODEL=${WORKER_GEMINI_MODEL}"
    "KG_MODEL_ID=${WORKER_KG_MODEL_ID}"
  )
fi

worker_secret_vars=(
  "DATABASE_URL=${WORKER_DATABASE_SECRET}"
  "OPEN_AI_API_KEY=${WORKER_OPENAI_API_KEY_SECRET}"
  "${WORKER_DOCUMENT_AI_CREDENTIALS_PATH}=${WORKER_DOCUMENT_AI_SECRET}"
)
if [ -n "$WORKER_GEMINI_API_KEY_SECRET" ]; then
  worker_secret_vars+=("GEMINI_API_KEY=${WORKER_GEMINI_API_KEY_SECRET}")
fi

gcloud run deploy "$WORKER_SERVICE" \
  --project "$PROJECT" \
  --region "$REGION" \
  --platform managed \
  --image "$WORKER_IMAGE" \
  --service-account "$SERVICE_ACCOUNT" \
  --no-allow-unauthenticated \
  --port 8080 \
  --cpu 1 \
  --memory 1Gi \
  --concurrency 1 \
  --timeout 300 \
  --min-instances 1 \
  --max-instances 1 \
  --no-cpu-throttling \
  --add-cloudsql-instances "$WORKER_CLOUDSQL_INSTANCES" \
  --set-env-vars "$(join_by_comma "${worker_env_vars[@]}")" \
  --set-secrets "$(join_by_comma "${worker_secret_vars[@]}")" \
  "${worker_volume_args[@]+"${worker_volume_args[@]}"}" \
  --quiet
WORKER_URL="$(get_service_url "$WORKER_SERVICE")"
ok "Worker deployed: ${WORKER_URL}"

step "Building web image"
gcloud builds submit . \
  --project "$PROJECT" \
  --config cloudbuild-frontend.yaml \
  --substitutions "_IMAGE=${WEB_IMAGE},_VITE_API_BASE_URL=" \
  --quiet
ok "Built ${WEB_IMAGE}"

step "Deploying web"
gcloud run deploy "$WEB_SERVICE" \
  --project "$PROJECT" \
  --region "$REGION" \
  --platform managed \
  --image "$WEB_IMAGE" \
  --service-account "$SERVICE_ACCOUNT" \
  --allow-unauthenticated \
  --port 8080 \
  --cpu 1 \
  --memory 256Mi \
  --concurrency 80 \
  --timeout 300 \
  --min-instances 0 \
  --max-instances 5 \
  --set-env-vars "API_UPSTREAM=${WEB_API_UPSTREAM}" \
  --quiet
WEB_URL="$(get_service_url "$WEB_SERVICE")"
ok "Web deployed: ${WEB_URL}"

step "Verifying live endpoints"
health_check "API health" "${API_URL}/health"
health_check "Web root" "${WEB_URL}/"
health_check "Web login" "${WEB_URL}/login"

step "Capturing worker revision"
WORKER_READY_REVISION="$(get_ready_revision "$WORKER_SERVICE")"
ok "Worker ready revision: ${WORKER_READY_REVISION}"

printf '\nRollback commands:\n'
printf 'gcloud run services update-traffic %s --project %s --region %s --to-revisions %s=100\n' \
  "$API_SERVICE" "$PROJECT" "$REGION" "$API_PREV_REVISION"
printf 'gcloud run services update-traffic %s --project %s --region %s --to-revisions %s=100\n' \
  "$WEB_SERVICE" "$PROJECT" "$REGION" "$WEB_PREV_REVISION"
if [ -n "${WORKER_PREV_REVISION}" ]; then
  printf 'gcloud run services update-traffic %s --project %s --region %s --to-revisions %s=100\n' \
    "$WORKER_SERVICE" "$PROJECT" "$REGION" "$WORKER_PREV_REVISION"
fi

printf '\nLive URLs:\n'
printf 'API: %s\n' "$API_URL"
printf 'WEB: %s\n' "$WEB_URL"
printf 'WORKER: %s\n' "$WORKER_URL"
printf 'UPLOADS_BUCKET: gs://%s\n' "$UPLOADS_BUCKET"
