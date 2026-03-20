#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────
# lint-theme-tokens.sh — Catch CSS-class violations that break theming
#
# Checks TSX/TS files for:
#   1. Hardcoded Tailwind colors that bypass the design-token system
#   2. Tailwind `dark:` prefixes (project uses data-theme, not dark mode)
#   3. Known non-existent utility classes
#
# Usage:
#   ./scripts/lint-theme-tokens.sh [target_dir]  # default: apps/web/src
#
# Exit codes:  0 = clean, 1 = violations found
# ──────────────────────────────────────────────────────────────────
TARGET="${1:-apps/web/src}"
TMPDIR_LINT=$(mktemp -d)
trap 'rm -rf "$TMPDIR_LINT"' EXIT

ERRORS=0

# Hardcoded Tailwind color names (NOT in the design-token system)
COLOR_NAMES="red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone"

# ── 1. Hardcoded Tailwind color classes in TSX ──
grep -rn --include='*.tsx' --include='*.ts' --exclude='*.test.*' \
  -E "(bg|text|border|ring|outline|divide)-($COLOR_NAMES)-[0-9]" \
  "$TARGET" \
  > "$TMPDIR_LINT/hardcoded.txt" 2>/dev/null || true

HC_COUNT=$(wc -l < "$TMPDIR_LINT/hardcoded.txt" | tr -d ' ')
if [ "$HC_COUNT" -gt 0 ]; then
  echo "❌ HARDCODED TAILWIND COLORS — $HC_COUNT violation(s)"
  echo "   These bypass the design-token system and break on dark/custom themes."
  echo "   Replace with: bg-surface, bg-surface-alt, text-skin-base, text-skin-muted,"
  echo "   border-skin, bg-primary-*, text-primary-*, etc."
  echo "   For semantic accents (error/success), use border-<color> on a token bg."
  echo ""
  cat "$TMPDIR_LINT/hardcoded.txt"
  echo ""
  ERRORS=$((ERRORS + HC_COUNT))
fi

# ── 2. Tailwind dark: prefix (does NOT work with data-theme system) ──
grep -rn --include='*.tsx' --include='*.ts' --exclude='*.test.*' \
  -E 'dark:' \
  "$TARGET" \
  > "$TMPDIR_LINT/dark.txt" 2>/dev/null || true

DK_COUNT=$(wc -l < "$TMPDIR_LINT/dark.txt" | tr -d ' ')
if [ "$DK_COUNT" -gt 0 ]; then
  echo "❌ TAILWIND dark: PREFIX — $DK_COUNT violation(s)"
  echo "   Non-functional: project uses [data-theme] selectors, not Tailwind dark mode."
  echo "   Remove dark: classes. CSS custom properties adapt automatically per theme."
  echo ""
  cat "$TMPDIR_LINT/dark.txt"
  echo ""
  ERRORS=$((ERRORS + DK_COUNT))
fi

# ── 3. Known non-existent utility classes ──
grep -rn --include='*.tsx' --include='*.ts' --exclude='*.test.*' \
  -E 'text-text-|bg-surface-secondary|border-border-|bg-bg-|text-color-' \
  "$TARGET" \
  > "$TMPDIR_LINT/phantom.txt" 2>/dev/null || true

PH_COUNT=$(wc -l < "$TMPDIR_LINT/phantom.txt" | tr -d ' ')
if [ "$PH_COUNT" -gt 0 ]; then
  echo "❌ NON-EXISTENT UTILITY CLASSES — $PH_COUNT violation(s)"
  echo "   These render as no-ops, producing invisible/missing styling."
  echo "   Check tailwind.config.js for valid token names."
  echo ""
  cat "$TMPDIR_LINT/phantom.txt"
  echo ""
  ERRORS=$((ERRORS + PH_COUNT))
fi

# ── Summary ──
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ "$ERRORS" -gt 0 ]; then
  echo "Found $ERRORS theme-token violation(s) in $TARGET"
  exit 1
else
  echo "✅ No theme-token violations found in $TARGET"
  exit 0
fi
