#!/bin/bash
set -euo pipefail

API_PORT="${API_PORT:-3001}"
TARGET_URL="${DAST_LOCAL_TARGET_URL:-http://127.0.0.1:${API_PORT}/docs}"
DOCKER_TARGET_URL="${DAST_LOCAL_DOCKER_TARGET_URL:-http://host.docker.internal:${API_PORT}/docs}"
REPORT_DIR="${DAST_LOCAL_REPORT_DIR:-outputs/dast-local}"
API_LOG_PATH="${DAST_LOCAL_API_LOG:-/tmp/puda-api-dast.log}"
MAX_HIGH="${ZAP_MAX_HIGH:-0}"
MAX_MEDIUM="${ZAP_MAX_MEDIUM:-10}"

mkdir -p "${REPORT_DIR}"

API_PID=""
cleanup() {
  if [[ -n "${API_PID}" ]]; then
    kill "${API_PID}" >/dev/null 2>&1 || true
    wait "${API_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

if ! command -v docker >/dev/null 2>&1; then
  echo "[LOCAL_DAST_FAILED] docker is required for OWASP ZAP baseline scan."
  exit 1
fi

echo "[LOCAL_DAST] Starting API for scan target ${TARGET_URL}"
NODE_ENV=test \
VITEST=true \
JWT_SECRET=dast-local-secret \
ALLOWED_ORIGINS=http://localhost:5173 \
API_PORT="${API_PORT}" \
npm --workspace apps/api exec tsx src/index.ts >"${API_LOG_PATH}" 2>&1 &
API_PID=$!

echo "[LOCAL_DAST] Waiting for API health..."
for attempt in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:${API_PORT}/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
  if [[ "${attempt}" -eq 40 ]]; then
    echo "[LOCAL_DAST_FAILED] API did not become healthy in time. Recent log tail:"
    tail -n 80 "${API_LOG_PATH}" || true
    exit 1
  fi
done

echo "[LOCAL_DAST] Running OWASP ZAP baseline scan (docker target ${DOCKER_TARGET_URL})"
docker run --rm -t \
  --add-host host.docker.internal:host-gateway \
  -v "$PWD/${REPORT_DIR}:/zap/wrk:rw" \
  ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py \
  -t "${DOCKER_TARGET_URL}" \
  -m 3 \
  -J zap-local-report.json \
  -w zap-local-report.md \
  -r zap-local-report.html \
  -I

echo "[LOCAL_DAST] Enforcing thresholds high=${MAX_HIGH} medium=${MAX_MEDIUM}"
ZAP_MAX_HIGH="${MAX_HIGH}" \
ZAP_MAX_MEDIUM="${MAX_MEDIUM}" \
node scripts/check-zap-report.mjs "${REPORT_DIR}/zap-local-report.json"

echo "[LOCAL_DAST_OK] Local DAST smoke completed successfully."
