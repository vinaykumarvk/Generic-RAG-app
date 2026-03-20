#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────
# quality.sh — Code quality lint checks (QUA-01 to QUA-18)
# ──────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_lib.sh"

[[ "$LINT_OUTPUT_MODE" == "text" ]] && echo "── Quality ──"

# Collect file lists
ts_files=$(filter_files "*.ts" "*.tsx" -- "${SCAN_DIRS_TS[@]}")

# QUA-01: `: any` type annotation
run_check "QUA-01" "': any' type annotation" \
  ':\s*any\b' \
  "$ts_files" \
  "-E" \
  '\.test\.|\.spec\.|__tests__|\.d\.ts'

# QUA-02: `as any` cast
run_check "QUA-02" "'as any' cast" \
  '\bas\s+any\b' \
  "$ts_files" \
  "-E" \
  '\.test\.|\.spec\.|__tests__|\.d\.ts'

# QUA-03: @ts-ignore / @ts-expect-error
run_check "QUA-03" "@ts-ignore or @ts-expect-error" \
  '@ts-ignore|@ts-expect-error' \
  "$ts_files" \
  "-E" \
  '\.test\.|\.spec\.|__tests__'

# QUA-14: Files exceeding 500 lines
if [[ -n "$ts_files" ]]; then
  long_files=""
  long_count=0
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    # Skip test files
    [[ "$f" == *".test."* || "$f" == *".spec."* || "$f" == *"__tests__"* ]] && continue
    lines=$(wc -l < "$f" 2>/dev/null | tr -d ' ')
    if [[ "$lines" -gt 500 ]]; then
      long_files="${long_files}${f}: ${lines} lines"$'\n'
      long_count=$((long_count + 1))
    fi
  done <<< "$ts_files"
  run_check_custom "QUA-14" "File exceeds 500 lines" "$long_count" "$long_files"
else
  run_check_custom "QUA-14" "File exceeds 500 lines" 0
fi

# QUA-18: Relative import into packages/
# Catches imports like '../../../packages/' or '../../packages/'
run_check "QUA-18" "Relative import into packages/" \
  "from\s+['\"]\.+/.*packages/" \
  "$ts_files" \
  "-E" \
  '\.test\.|\.spec\.|__tests__'

finish_checks "quality"
