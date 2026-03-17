#!/bin/bash
# Safe Cloud Run canary deploy with automatic health validation and rollback.
# Usage:
#   ./scripts/deploy-cloudrun-canary.sh <service> <image> <project> [region] [canary_percent]
#
# Example:
#   ./scripts/deploy-cloudrun-canary.sh puda-api gcr.io/my-project/puda-api:sha-123 my-project asia-south1 10

set -euo pipefail

SERVICE_NAME="${1:-}"
IMAGE_REF="${2:-}"
PROJECT_ID="${3:-}"
REGION="${4:-asia-south1}"
CANARY_PERCENT="${5:-10}"

if [[ -z "${SERVICE_NAME}" || -z "${IMAGE_REF}" || -z "${PROJECT_ID}" ]]; then
  echo "Usage: $0 <service> <image> <project> [region] [canary_percent]"
  exit 1
fi

if ! [[ "${CANARY_PERCENT}" =~ ^[0-9]+$ ]] || [[ "${CANARY_PERCENT}" -le 0 ]] || [[ "${CANARY_PERCENT}" -ge 100 ]]; then
  echo "Error: canary_percent must be an integer between 1 and 99"
  exit 1
fi

HEALTH_PATH="${HEALTH_PATH:-/health}"
HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-12}"
HEALTH_SLEEP_SECONDS="${HEALTH_SLEEP_SECONDS:-5}"
STABLE_PERCENT=$((100 - CANARY_PERCENT))

echo "Fetching current stable revision..."
PREVIOUS_REVISION="$(gcloud run services describe "${SERVICE_NAME}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --format='value(status.latestReadyRevisionName)')"

if [[ -z "${PREVIOUS_REVISION}" ]]; then
  echo "Error: unable to determine previous stable revision for ${SERVICE_NAME}"
  exit 1
fi

echo "Deploying new revision with no traffic..."
gcloud run deploy "${SERVICE_NAME}" \
  --image "${IMAGE_REF}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --platform managed \
  --no-traffic \
  --quiet

NEW_REVISION="$(gcloud run services describe "${SERVICE_NAME}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --format='value(status.latestReadyRevisionName)')"

if [[ -z "${NEW_REVISION}" || "${NEW_REVISION}" == "${PREVIOUS_REVISION}" ]]; then
  echo "Error: failed to detect a newly deployed revision"
  exit 1
fi

echo "Shifting traffic to canary: ${PREVIOUS_REVISION}=${STABLE_PERCENT}% ${NEW_REVISION}=${CANARY_PERCENT}%"
gcloud run services update-traffic "${SERVICE_NAME}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --to-revisions "${PREVIOUS_REVISION}=${STABLE_PERCENT},${NEW_REVISION}=${CANARY_PERCENT}" \
  --quiet

SERVICE_URL="$(gcloud run services describe "${SERVICE_NAME}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --format='value(status.url)')"

if [[ -z "${SERVICE_URL}" ]]; then
  echo "Error: failed to resolve service URL"
  exit 1
fi

echo "Running canary health probe: ${SERVICE_URL}${HEALTH_PATH}"
for ((attempt=1; attempt<=HEALTH_ATTEMPTS; attempt++)); do
  STATUS_CODE="$(curl -sS -o /dev/null -w '%{http_code}' "${SERVICE_URL}${HEALTH_PATH}" || true)"
  if [[ "${STATUS_CODE}" == "200" ]]; then
    echo "Canary probe passed on attempt ${attempt}."
    break
  fi

  if [[ "${attempt}" -eq "${HEALTH_ATTEMPTS}" ]]; then
    echo "Canary probe failed after ${HEALTH_ATTEMPTS} attempts (last status: ${STATUS_CODE}). Rolling back..."
    gcloud run services update-traffic "${SERVICE_NAME}" \
      --project "${PROJECT_ID}" \
      --region "${REGION}" \
      --to-revisions "${PREVIOUS_REVISION}=100" \
      --quiet
    exit 1
  fi

  sleep "${HEALTH_SLEEP_SECONDS}"
done

echo "Canary healthy. Promote when ready with:"
echo "  gcloud run services update-traffic ${SERVICE_NAME} --project ${PROJECT_ID} --region ${REGION} --to-revisions ${NEW_REVISION}=100"
echo "Fast rollback command:"
echo "  gcloud run services update-traffic ${SERVICE_NAME} --project ${PROJECT_ID} --region ${REGION} --to-revisions ${PREVIOUS_REVISION}=100"
