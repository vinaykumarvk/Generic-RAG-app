#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────
# security.sh — Security lint checks (SEC-03 to SEC-19)
# ──────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_lib.sh"

[[ "$LINT_OUTPUT_MODE" == "text" ]] && echo "── Security ──"

# Collect file lists
ts_files=$(filter_files "*.ts" "*.tsx" -- "${SCAN_DIRS_TS[@]}")
py_files=$(filter_files "*.py" -- "${SCAN_DIRS_PY[@]}")
docker_files=$(filter_files "Dockerfile" "Dockerfile.*" "*.dockerfile" -- "${SCAN_DIRS_DOCKER[@]}")

all_code="$ts_files"
[[ -n "$py_files" ]] && all_code="${all_code}${all_code:+$'\n'}${py_files}"

# SEC-03: eval()/exec()/spawn()/system() with potential user input
run_check "SEC-03" "eval()/exec()/spawn()/system() call" \
  '\beval\s*\(|\bexec\s*\(|\bspawn\s*\(|\bsystem\s*\(' \
  "$all_code" \
  "-E" \
  '\.test\.|\.spec\.|__tests__|node_modules|\.venv|execSync.*build|exec\(\s*pool|execSync\(\s*('\''|")npm|execSync\(\s*('\''|")npx|Regex\.exec\b|regex\.exec\b|\.exec\(result|\.exec\(text|\.exec\(str|\.exec\(input|\.exec\(content'

# SEC-04: dangerouslySetInnerHTML
run_check "SEC-04" "dangerouslySetInnerHTML usage" \
  'dangerouslySetInnerHTML' \
  "$ts_files" \
  "-F"

# SEC-07: Auth tokens in localStorage/sessionStorage
run_check "SEC-07" "Token in localStorage/sessionStorage" \
  'localStorage\.(set|get)Item.*token|sessionStorage\.(set|get)Item.*token|localStorage\.token|sessionStorage\.token' \
  "$ts_files" \
  "-Ei" \
  '\.test\.|\.spec\.|__tests__'

# SEC-15: Hardcoded secrets in source
run_check "SEC-15" "Hardcoded secret/key/password in source" \
  '(api_key|apikey|secret_key|password|token)\s*[:=]\s*["\x27][A-Za-z0-9+/=_-]{16,}' \
  "$all_code" \
  "-Ei" \
  '\.test\.|\.spec\.|__tests__|\.example|placeholder|CHANGE_ME|your_|example_|\.env\.'

# SEC-17: Secrets in Dockerfile ENV
run_check "SEC-17" "Secret exposed in Dockerfile ENV" \
  'ENV\s+(.*_KEY|.*_SECRET|.*_PASSWORD|.*_TOKEN)\s*=' \
  "$docker_files" \
  "-Ei"

# SEC-18: console.log/debug/info in production code
run_check "SEC-18" "console.log/debug/info in production code" \
  'console\.(log|debug|info)\s*\(' \
  "$ts_files" \
  "-E" \
  '\.test\.|\.spec\.|__tests__|// eslint-|// TODO|dev-only'

# SEC-19: CORS origin wildcard
run_check "SEC-19" "CORS wildcard origin" \
  "origin:\s*['\"]\\*['\"]|origin:\s*true|Access-Control-Allow-Origin.*\\*" \
  "$all_code" \
  "-E" \
  '\.test\.|\.spec\.|__tests__'

finish_checks "security"
