#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────
# infra.sh — Infrastructure lint checks (INF-04, INF-10)
# ──────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_lib.sh"

[[ "$LINT_OUTPUT_MODE" == "text" ]] && echo "── Infrastructure ──"

# Collect file lists
docker_files=$(filter_files "Dockerfile" "Dockerfile.*" "*.dockerfile" -- "${SCAN_DIRS_DOCKER[@]}")
ts_files=$(filter_files "*.ts" "*.tsx" -- "${SCAN_DIRS_TS[@]}")
py_files=$(filter_files "*.py" -- "${SCAN_DIRS_PY[@]}")

all_code="$ts_files"
[[ -n "$py_files" ]] && all_code="${all_code}${all_code:+$'\n'}${py_files}"

# INF-04: npm install in Dockerfiles (should be npm ci)
run_check "INF-04" "'npm install' in Dockerfile (use 'npm ci')" \
  'RUN.*npm install\b' \
  "$docker_files" \
  "-E" \
  'npm ci'

# INF-10: Hardcoded localhost/127.0.0.1 in source
run_check "INF-10" "Hardcoded localhost/127.0.0.1" \
  'localhost:[0-9]|127\.0\.0\.1' \
  "$all_code" \
  "-E" \
  '\.test\.|\.spec\.|__tests__|\.example|\.env\.|process\.env|config\.\w+\s*\|\||fallback|default.*localhost|// dev|// local'

finish_checks "infra"
