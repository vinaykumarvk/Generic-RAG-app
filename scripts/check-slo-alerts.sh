#!/bin/bash
set -euo pipefail

RULES_FILE="ops/observability/prometheus-alerts.yml"
TEST_FILE="ops/observability/prometheus-alerts.test.yml"

run_with_promtool() {
  promtool check rules "${RULES_FILE}"
  promtool test rules "${TEST_FILE}"
}

run_with_docker() {
  local image="${PROMTOOL_DOCKER_IMAGE:-prom/prometheus:v2.54.1}"
  docker run --rm --entrypoint /bin/promtool -v "$PWD:/work" -w /work "${image}" check rules "${RULES_FILE}"
  docker run --rm --entrypoint /bin/promtool -v "$PWD:/work" -w /work "${image}" test rules "${TEST_FILE}"
}

if command -v promtool >/dev/null 2>&1; then
  run_with_promtool
elif command -v docker >/dev/null 2>&1; then
  run_with_docker
else
  echo "[SLO_ALERT_TEST_FAILED] Neither promtool nor docker is available."
  exit 1
fi

echo "[SLO_ALERT_TEST_OK] Prometheus alert rules and synthetic replay tests passed."
