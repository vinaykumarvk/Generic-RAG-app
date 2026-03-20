#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────
# _lib.sh — Shared helpers for lint check scripts
#
# Provides:
#   filter_files()   — resolve file list (staged or full scan)
#   run_check()      — execute a grep-based check and record results
#   emit_result()    — output check result in text or JSON
#   finish_checks()  — print summary, write temp results
#
# Env vars consumed:
#   LINT_FILES       — newline-separated file list (set by lint-all.sh)
#   LINT_OUTPUT_MODE — "text" (default) or "json"
#   LINT_RESULTS_DIR — temp dir for per-script result files
# ──────────────────────────────────────────────────────────────────
set -euo pipefail

# Target directories for full scans
SCAN_DIRS_TS=("apps/api/src" "apps/web/src" "packages/shared/src" "packages/api-core/src" "packages/api-integrations/src" "packages/workflow-engine/src" "packages/nl-assistant/src")
SCAN_DIRS_PY=("apps/worker/src")
SCAN_DIRS_DOCKER=(".")
SCAN_DIRS_WEB=("apps/web/src")

LINT_OUTPUT_MODE="${LINT_OUTPUT_MODE:-text}"
LINT_RESULTS_DIR="${LINT_RESULTS_DIR:-/tmp/lint-results}"

# Accumulators for this script
declare -a _CHECK_IDS=()
declare -a _CHECK_COUNTS=()
declare -a _CHECK_DESCS=()

# ── filter_files: return files matching glob from LINT_FILES or scan dirs ──
# Usage: filter_files "*.ts" "*.tsx" -- dir1 dir2
# If LINT_FILES is set, filters that list by extensions.
# Otherwise does a find across the given dirs.
filter_files() {
  local -a patterns=()
  local -a dirs=()
  local in_dirs=false

  for arg in "$@"; do
    if [[ "$arg" == "--" ]]; then
      in_dirs=true
      continue
    fi
    if $in_dirs; then
      dirs+=("$arg")
    else
      patterns+=("$arg")
    fi
  done

  if [[ -n "${LINT_FILES:-}" ]]; then
    # Filter staged files by pattern
    local pat_regex=""
    for p in "${patterns[@]}"; do
      # Convert glob to regex: *.ts → \.ts$, *.tsx → \.tsx$
      local ext="${p#\*}"
      ext="${ext//./\\.}"
      if [[ -n "$pat_regex" ]]; then
        pat_regex="${pat_regex}|${ext}\$"
      else
        pat_regex="${ext}\$"
      fi
    done
    echo "$LINT_FILES" | grep -E "($pat_regex)" || true
  else
    # Full scan: find in dirs
    local -a find_args=()
    for d in "${dirs[@]}"; do
      [[ -d "$d" ]] && find_args+=("$d")
    done
    [[ ${#find_args[@]} -eq 0 ]] && return 0

    local -a name_args=()
    local first=true
    for p in "${patterns[@]}"; do
      if $first; then
        name_args+=("-name" "$p")
        first=false
      else
        name_args+=("-o" "-name" "$p")
      fi
    done

    find "${find_args[@]}" -type f \( "${name_args[@]}" \) ! -path '*/node_modules/*' ! -path '*/.venv/*' ! -path '*/__pycache__/*' ! -path '*/dist/*' ! -path '*/.git/*' 2>/dev/null || true
  fi
}

# ── run_check: grep for a pattern, count matches ──
# Usage: run_check "CHECK-ID" "description" "grep_pattern" file_list
# file_list is newline-separated paths
run_check() {
  local check_id="$1"
  local description="$2"
  local pattern="$3"
  local files="$4"
  local grep_opts="${5:--E}"
  local exclude_pattern="${6:-}"

  [[ -z "$files" ]] && { _record_result "$check_id" 0 "$description"; return 0; }

  local count=0
  local matches=""

  # Use xargs to handle large file lists efficiently
  if [[ -n "$exclude_pattern" ]]; then
    matches=$(echo "$files" | xargs grep -n $grep_opts "$pattern" 2>/dev/null | grep -v -E "$exclude_pattern" || true)
  else
    matches=$(echo "$files" | xargs grep -n $grep_opts "$pattern" 2>/dev/null || true)
  fi

  if [[ -n "$matches" ]]; then
    count=$(echo "$matches" | wc -l | tr -d ' ')
  fi

  _record_result "$check_id" "$count" "$description" "$matches"
  return 0
}

# ── run_check_custom: for checks that need custom counting logic ──
# Usage: run_check_custom "CHECK-ID" "description" count "match_output"
run_check_custom() {
  local check_id="$1"
  local description="$2"
  local count="$3"
  local matches="${4:-}"

  _record_result "$check_id" "$count" "$description" "$matches"
}

# ── Internal: record a check result ──
_record_result() {
  local check_id="$1"
  local count="$2"
  local description="$3"
  local matches="${4:-}"

  _CHECK_IDS+=("$check_id")
  _CHECK_COUNTS+=("$count")
  _CHECK_DESCS+=("$description")

  if [[ "$LINT_OUTPUT_MODE" == "text" && "$count" -gt 0 ]]; then
    echo "  $check_id: $count violation(s) — $description"
    if [[ -n "$matches" ]]; then
      echo "$matches" | head -20 | sed 's/^/    /'
      local total
      total=$(echo "$matches" | wc -l | tr -d ' ')
      if [[ "$total" -gt 20 ]]; then
        echo "    ... and $((total - 20)) more"
      fi
    fi
  fi
}

# ── finish_checks: write results to temp dir, print summary ──
finish_checks() {
  local script_name="$1"

  # Write JSON results for orchestrator
  if [[ -d "$LINT_RESULTS_DIR" ]]; then
    local result_file="$LINT_RESULTS_DIR/${script_name}.json"
    echo "{" > "$result_file"
    local first=true
    for i in "${!_CHECK_IDS[@]}"; do
      if $first; then first=false; else echo "," >> "$result_file"; fi
      printf '  "%s": %s' "${_CHECK_IDS[$i]}" "${_CHECK_COUNTS[$i]}" >> "$result_file"
    done
    echo "" >> "$result_file"
    echo "}" >> "$result_file"
  fi
}
