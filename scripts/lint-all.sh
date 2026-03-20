#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────
# lint-all.sh — Orchestrator for all lint check scripts
#
# Usage:
#   ./scripts/lint-all.sh                  # full scan, compare against baseline
#   ./scripts/lint-all.sh --staged         # scan only staged files
#   ./scripts/lint-all.sh --fix-baseline   # update baseline to current counts
#   ./scripts/lint-all.sh --json           # output results as JSON
#
# Exit codes:
#   0 — no regressions (all checks at or below baseline)
#   1 — regressions found (at least one check above baseline)
# ──────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECKS_DIR="$REPO_ROOT/scripts/checks"
BASELINE_FILE="$REPO_ROOT/scripts/.lint-baseline.json"

# Parse flags
STAGED=false
FIX_BASELINE=false
JSON_OUTPUT=false

for arg in "$@"; do
  case "$arg" in
    --staged)       STAGED=true ;;
    --fix-baseline) FIX_BASELINE=true ;;
    --json)         JSON_OUTPUT=true ;;
    *)              echo "Unknown flag: $arg"; exit 1 ;;
  esac
done

# Set up env for check scripts
export LINT_RESULTS_DIR
LINT_RESULTS_DIR=$(mktemp -d)
trap 'rm -rf "$LINT_RESULTS_DIR"' EXIT

if $JSON_OUTPUT; then
  export LINT_OUTPUT_MODE="json"
else
  export LINT_OUTPUT_MODE="text"
fi

# If --staged, collect staged files
if $STAGED; then
  STAGED_FILES=$(cd "$REPO_ROOT" && git diff --cached --name-only --diff-filter=ACMR 2>/dev/null || true)
  if [[ -z "$STAGED_FILES" ]]; then
    [[ "$LINT_OUTPUT_MODE" == "text" ]] && echo "No staged files — skipping lint."
    exit 0
  fi
  export LINT_FILES="$STAGED_FILES"
fi

# ── Run check scripts in parallel ──
[[ "$LINT_OUTPUT_MODE" == "text" ]] && echo "Running lint checks..."
[[ "$LINT_OUTPUT_MODE" == "text" ]] && echo ""

cd "$REPO_ROOT"

pids=()
bash "$CHECKS_DIR/security.sh" &
pids+=($!)
bash "$CHECKS_DIR/quality.sh" &
pids+=($!)
bash "$CHECKS_DIR/ui-a11y.sh" &
pids+=($!)
bash "$CHECKS_DIR/infra.sh" &
pids+=($!)

# Wait for all — collect exit codes
all_ok=true
for pid in "${pids[@]}"; do
  wait "$pid" || all_ok=false
done

[[ "$LINT_OUTPUT_MODE" == "text" ]] && echo ""

# ── Merge results from all check scripts into a flat file ──
# Format: KEY=VALUE, one per line, sorted
MERGED="$LINT_RESULTS_DIR/_merged.txt"
: > "$MERGED"

for result_file in "$LINT_RESULTS_DIR"/*.json; do
  [[ -f "$result_file" ]] || continue
  # Extract "KEY": VALUE → KEY=VALUE
  while IFS= read -r line; do
    key=$(echo "$line" | sed -n 's/.*"\([A-Z][A-Z]*-[0-9][0-9]*\)".*/\1/p')
    val=$(echo "$line" | sed -n 's/.*"[A-Z][A-Z]*-[0-9][0-9]*":[[:space:]]*\([0-9][0-9]*\).*/\1/p')
    if [[ -n "$key" && -n "$val" ]]; then
      echo "${key}=${val}" >> "$MERGED"
    fi
  done < "$result_file"
done
sort -o "$MERGED" "$MERGED"

# Helper: look up value from flat file
_lookup() {
  local file="$1" key="$2" default="${3:-0}"
  local val
  val=$(grep "^${key}=" "$file" 2>/dev/null | head -1 | cut -d= -f2)
  echo "${val:-$default}"
}

# ── --fix-baseline: write current counts and exit ──
if $FIX_BASELINE; then
  echo "{" > "$BASELINE_FILE"
  first=true
  while IFS='=' read -r key val; do
    [[ -z "$key" ]] && continue
    if $first; then first=false; else echo "," >> "$BASELINE_FILE"; fi
    printf '  "%s": %s' "$key" "$val" >> "$BASELINE_FILE"
  done < "$MERGED"
  echo "" >> "$BASELINE_FILE"
  echo "}" >> "$BASELINE_FILE"
  echo "Baseline written to $BASELINE_FILE"
  echo "Counts:"
  cat "$BASELINE_FILE"
  exit 0
fi

# ── Compare against baseline ──
has_regression=false
has_improvement=false

if [[ -f "$BASELINE_FILE" ]]; then
  # Parse baseline into flat file
  BASELINE_FLAT="$LINT_RESULTS_DIR/_baseline.txt"
  : > "$BASELINE_FLAT"
  while IFS= read -r line; do
    key=$(echo "$line" | sed -n 's/.*"\([A-Z][A-Z]*-[0-9][0-9]*\)".*/\1/p')
    val=$(echo "$line" | sed -n 's/.*"[A-Z][A-Z]*-[0-9][0-9]*":[[:space:]]*\([0-9][0-9]*\).*/\1/p')
    if [[ -n "$key" && -n "$val" ]]; then
      echo "${key}=${val}" >> "$BASELINE_FLAT"
    fi
  done < "$BASELINE_FILE"
  sort -o "$BASELINE_FLAT" "$BASELINE_FLAT"

  if [[ "$LINT_OUTPUT_MODE" == "text" ]]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Baseline comparison:"
    echo ""
  fi

  regressions=""
  improvements=""

  while IFS='=' read -r key current; do
    [[ -z "$key" ]] && continue
    base=$(_lookup "$BASELINE_FLAT" "$key" 0)

    if [[ "$current" -gt "$base" ]]; then
      has_regression=true
      delta=$((current - base))
      regressions="${regressions}  FAIL  $key: $current (was $base, +$delta)"$'\n'
    elif [[ "$current" -lt "$base" ]]; then
      has_improvement=true
      delta=$((base - current))
      improvements="${improvements}  DOWN  $key: $current (was $base, -$delta)"$'\n'
    fi
  done < "$MERGED"

  if [[ "$LINT_OUTPUT_MODE" == "text" ]]; then
    if [[ -n "$regressions" ]]; then
      echo "REGRESSIONS (new violations):"
      echo "$regressions"
    fi
    if [[ -n "$improvements" ]]; then
      echo "IMPROVEMENTS (run --fix-baseline to ratchet down):"
      echo "$improvements"
    fi
    if ! $has_regression && ! $has_improvement; then
      echo "  No changes from baseline."
    fi
    echo ""
  fi
else
  if [[ "$LINT_OUTPUT_MODE" == "text" ]]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "No baseline found. Run with --fix-baseline to create one."
    echo ""
    # Show raw counts
    total=0
    while IFS='=' read -r key val; do
      [[ -z "$key" ]] && continue
      echo "  $key: $val"
      total=$((total + val))
    done < "$MERGED"
    echo ""
    echo "Total violations: $total"
    echo ""
  fi
fi

# ── JSON output ──
if $JSON_OUTPUT; then
  echo "{"
  echo '  "results": {'
  first=true
  while IFS='=' read -r key val; do
    [[ -z "$key" ]] && continue
    if $first; then first=false; else echo ","; fi
    printf '    "%s": %s' "$key" "$val"
  done < "$MERGED"
  echo ""
  echo "  },"
  echo "  \"has_regression\": $has_regression"
  echo "}"
fi

# ── Exit code ──
if $has_regression; then
  [[ "$LINT_OUTPUT_MODE" == "text" ]] && echo "FAILED: Regressions detected. Fix violations or update baseline with --fix-baseline."
  exit 1
else
  if [[ "$LINT_OUTPUT_MODE" == "text" ]]; then
    if [[ -f "$BASELINE_FILE" ]]; then
      echo "PASSED: No regressions from baseline."
    fi
  fi
  exit 0
fi
