#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────
# ui-a11y.sh — UI design tokens + accessibility checks (UID/UIA/UIT)
# ──────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_lib.sh"

[[ "$LINT_OUTPUT_MODE" == "text" ]] && echo "── UI & Accessibility ──"

# Collect web source files (TSX/TS, excluding tests)
web_files=$(filter_files "*.tsx" "*.ts" -- "${SCAN_DIRS_WEB[@]}")

# UID-05: Hardcoded Tailwind colors bypassing design tokens
COLOR_NAMES="red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone"
run_check "UID-05" "Hardcoded Tailwind color bypassing tokens" \
  "(bg|text|border|ring|outline|divide)-($COLOR_NAMES)-[0-9]" \
  "$web_files" \
  "-E" \
  '\.test\.|\.spec\.|__tests__|tailwind\.config'

# UID-06: Dead dark: prefix (project uses data-theme, not Tailwind dark mode)
run_check "UID-06" "Dead 'dark:' prefix (non-functional)" \
  '\bdark:' \
  "$web_files" \
  "-E" \
  '\.test\.|\.spec\.|__tests__|tailwind\.config|// dark:|/\* dark:'

# UID-07: Non-existent utility classes (phantom classes)
run_check "UID-07" "Non-existent utility class" \
  'bg-bg-|text-color-|border-color-' \
  "$web_files" \
  "-E" \
  '\.test\.|\.spec\.|__tests__|tailwind\.config'

# UIA-01: <div onClick> or <span onClick>
run_check "UIA-01" "<div onClick> or <span onClick> (use <button>)" \
  '<(div|span)\s[^>]*onClick' \
  "$web_files" \
  "-E" \
  '\.test\.|\.spec\.|__tests__'

# UIA-03: <button> without type=
if [[ -n "$web_files" ]]; then
  missing_type=""
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    file_missing=$(LC_ALL=C perl -0ne '
      while (/<button\b(?:(?!>)[\s\S])*?>/g) {
        my $button = $&;
        next if $button =~ /\btype\s*=/;
        my $start = $-[0];
        my $prefix = substr($_, 0, $start);
        my $line = ($prefix =~ tr/\n//) + 1;
        (my $snippet = $button) =~ s/\s+/ /g;
        print "$ARGV:$line:$snippet\n";
      }
    ' "$f")
    if [[ -n "$file_missing" ]]; then
      missing_type="${missing_type}${missing_type:+$'\n'}${file_missing}"
    fi
  done <<< "$web_files"

  if [[ -n "$missing_type" ]]; then
    btn_count=$(echo "$missing_type" | wc -l | tr -d ' ')
  else
    btn_count=0
  fi
  run_check_custom "UIA-03" "<button> without type= attribute" "$btn_count" "$missing_type"
else
  run_check_custom "UIA-03" "<button> without type= attribute" 0
fi

# UIA-05: <img> without alt=
if [[ -n "$web_files" ]]; then
  img_lines=$(echo "$web_files" | xargs grep -n '<img\b' 2>/dev/null | grep -v '\.test\.\|\.spec\.\|__tests__' || true)
  if [[ -n "$img_lines" ]]; then
    missing_alt=$(echo "$img_lines" | grep -v 'alt=' || true)
    if [[ -n "$missing_alt" ]]; then
      alt_count=$(echo "$missing_alt" | wc -l | tr -d ' ')
    else
      alt_count=0
    fi
  else
    alt_count=0
    missing_alt=""
  fi
  run_check_custom "UIA-05" "<img> without alt= attribute" "$alt_count" "$missing_alt"
else
  run_check_custom "UIA-05" "<img> without alt= attribute" 0
fi

# UIT-02: <th> without scope=
if [[ -n "$web_files" ]]; then
  th_lines=$(echo "$web_files" | xargs grep -n '<th\b' 2>/dev/null | grep -v '\.test\.\|\.spec\.\|__tests__' || true)
  if [[ -n "$th_lines" ]]; then
    missing_scope=$(echo "$th_lines" | grep -v 'scope=' || true)
    if [[ -n "$missing_scope" ]]; then
      scope_count=$(echo "$missing_scope" | wc -l | tr -d ' ')
    else
      scope_count=0
    fi
  else
    scope_count=0
    missing_scope=""
  fi
  run_check_custom "UIT-02" "<th> without scope= attribute" "$scope_count" "$missing_scope"
else
  run_check_custom "UIT-02" "<th> without scope= attribute" 0
fi

finish_checks "ui-a11y"
