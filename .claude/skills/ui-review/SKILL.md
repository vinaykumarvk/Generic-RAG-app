---
name: ui-review
description: End-to-end UI/UX quality review covering accessibility, responsive design, i18n, interaction states, design system integrity, and frontend performance. Produces a prioritized improvement plan with a release-readiness verdict.
argument-hint: "[target] [phase]"
---

# UI/UX Review Playbook

Perform an end-to-end UI/UX quality review and produce a prioritized, actionable improvement plan with a release-readiness verdict.

## Scoping

If the user specifies a target (example: `/ui-review apps/citizen`), review only that app. Otherwise review all UI apps.

If the user specifies a phase (example: `/ui-review accessibility only`), run only that section.
Valid phase keywords: `preflight`, `scan`, `design-system`, `responsive`, `accessibility`, `interaction`, `states`, `i18n`, `performance`, `gates`, `compliance`, `backlog`, `quickwins`.

If target includes `/`, generate a safe output slug:

- Replace `/` with `-`
- Remove spaces
- Example: `apps/dopams-ui` -> `apps-dopams-ui`

## Project Context

This monorepo has five UI apps and one shared UI package:

```text
apps/
  citizen/          - React (Vite) citizen-facing app (EN/HI/PA, mobile-first)
  officer/          - React (Vite) officer portal
  dopams-ui/        - React (Vite) DOPAMS intelligence dashboard (EN/HI/TE)
  forensic-ui/      - React (Vite) forensic platform UI (EN/HI/TE)
  social-media-ui/  - React (Vite) social media monitoring UI (EN/HI/TE)
packages/
  shared/           - Shared UI primitives and utilities
```

Primary requirements source: `docs/policing_apps_brd/`.

### Locale Matrix

| App | Primary | Secondary | Tertiary |
|-----|---------|-----------|----------|
| citizen | EN | HI (Hindi) | PA (Punjabi) |
| officer | EN | HI (Hindi) | PA (Punjabi) |
| dopams-ui | EN | HI (Hindi) | TE (Telugu) |
| forensic-ui | EN | HI (Hindi) | TE (Telugu) |
| social-media-ui | EN | HI (Hindi) | TE (Telugu) |

## Established UI Patterns

The following patterns have been implemented across the three policing UIs (dopams-ui, forensic-ui, social-media-ui). Reviews MUST validate that each pattern is correctly and consistently applied.

### 1. Faceted Filter Counts on List Views

All entity list views fetch a dedicated `/api/v1/<entity>/facets` endpoint on mount to populate filter dropdowns with live record counts (e.g., `OPEN (5)`). The pattern:

- **API**: `GET /api/v1/<entity>/facets` returns `{ facets: { field: [{ value, label?, count }] } }`, sorted by count DESC, scoped by `unit_id` where applicable.
- **UI**: `FacetEntry` type + `facetOptions()` helper renders `<option>` elements with counts. Graceful fallback to original hardcoded values if the facet API fails.
- **Scope**: 9 list views across 3 apps.

| App | View | Facet Endpoint | Fields |
|-----|------|---------------|--------|
| social-media-ui | AlertList | `/api/v1/alerts/facets` | state_id, priority, alert_type |
| social-media-ui | CaseList | `/api/v1/cases/facets` | state_id, priority |
| social-media-ui | ContentList | `/api/v1/content/facets` | platform, category_id (with label from taxonomy JOIN) |
| dopams-ui | AlertList | `/api/v1/alerts/facets` | state_id, severity, alert_type |
| dopams-ui | CaseList | `/api/v1/cases/facets` | state_id, priority |
| dopams-ui | LeadList | `/api/v1/leads/facets` | state_id, priority, source_type |
| dopams-ui | SubjectList | `/api/v1/subjects/facets` | state_id, gender |
| forensic-ui | CaseList | `/api/v1/cases/facets` | state_id, priority, case_type |
| forensic-ui | ImportList | `/api/v1/imports/facets` | state_id |

**Review checks:**
- Every list view with filter dropdowns must use faceted counts (no plain hardcoded options without counts).
- Facet fetch must be a separate `useEffect` from the data fetch (different cache profile).
- Fallback to hardcoded values must work when the API is unreachable.
- Facet queries must respect `unit_id` scoping where the entity table has it.
- Previously empty dropdowns (DOPAMS alert_type, lead source_type, forensic case_type) must now be dynamically populated.

### 2. Enhanced Login Screen

All three policing UIs use a redesigned login screen with these features:

- **Centered card layout**: Full-viewport centered grid using `100dvh`, surface card with `border-radius: var(--radius-xl)` and `box-shadow: var(--shadow-md)`.
- **App-specific SVG logo**: Unique inline SVG icon per app (shield for DOPAMS, magnifying glass for Forensic, chat bubble for Social Media) rendered in a branded circle.
- **Remember Me**: Checkbox backed by `localStorage` (`dopams_remember` / `forensic_remember` / `sm_remember`). Username is persisted/restored across sessions.
- **Forgot Password flow**: In-page panel swap (not a separate route) with back-to-login button, email/username input, and success alert. Currently client-side only.
- **Expanded theme selector**: Shows all custom themes via `<optgroup>` with human-readable labels from `THEME_LABELS` map. Pill-shaped select (`border-radius: 999px`).
- **Branded footer**: App-specific footer text below the form.
- **Dedicated CSS**: Login styles in `login.css` (imported by `Login.tsx`), not in `app.css`.

**Review checks:**
- Login CSS must use design tokens (no hardcoded colors, spacing, or breakpoints).
- All interactive elements must have `:hover`, `:active`, and `:focus-visible` states.
- Mobile breakpoint at `max-width: 30rem` must adapt layout (column on small phones).
- All user-visible text must use `t()` i18n keys (including error messages, footer, forgot-password instructions).
- Login i18n keys must exist in all 3 locale files (en, hi, te).
- Remember Me must not store passwords — only the username.
- Theme selector must show all themes defined in the theme system.

### 3. Dashboard Drill-Down (Clickable Stat Cards)

Dashboard stat cards are interactive buttons that navigate to the corresponding entity list view.

- **Semantic HTML**: Each stat card is a `<button type="button">` (not a clickable `<div>`).
- **`onNavigate` prop**: Dashboard accepts `onNavigate: (view: string) => void`. App.tsx passes its `navigate` function.
- **CSS class**: `.stat-card--clickable` with `cursor: pointer`, `:hover` (brand border + shadow), `:active` (scale 0.98), `:focus-visible` (3px outline with offset).

| App | Card 1 → | Card 2 → | Card 3 → | Card 4 → |
|-----|----------|----------|----------|----------|
| dopams-ui | alerts | leads | cases | subjects |
| forensic-ui | cases | cases | cases | cases |
| social-media-ui | alerts | cases | content | watchlists |

**Review checks:**
- All stat cards must be `<button>` elements (not `<div>` or `<a>`).
- Must have `:hover`, `:active`, and `:focus-visible` CSS states.
- Navigation target must map to a valid view in the App shell.
- Touch target must meet 44px minimum.
- Transitions must use design tokens (`transition: box-shadow 0.15s ease`).

### 4. Content List Category Display (Social Media)

ContentList in social-media-ui has been enhanced:

- Content queries JOIN `taxonomy_category` to return `category_name` alongside `category_id`.
- A new "Category" column displays `category_name` in a default badge.
- Category filter uses faceted counts with labels from the taxonomy JOIN.
- The separate `/api/v1/config/taxonomy` fetch has been replaced by the facets endpoint.
- Threat score thresholds corrected to 0-100 scale (`>= 70` critical, `>= 40` warning).

### 5. API Hardening (Supporting UI)

These API changes support the UI improvements and should be validated during review:

- **UUID type casting**: All `unit_id` filter parameters use `$N::uuid` (not `$N::text`). Prevents PostgreSQL type mismatch errors.
- **Token in auth response body**: Login endpoints return `{ user, token }` enabling Bearer-token auth alongside cookies.
- **Audit logger null safety**: `entityType || "unknown"` and `entityId || "N/A"` fallbacks prevent NOT NULL constraint violations.
- **Dashboard queries respect unit_id**: All dashboard aggregate queries scope by the authenticated user's unit.

## Operating Rules

- Use evidence-first review: cite exact files, components, CSS selectors, and line numbers.
- Separate `confirmed` evidence from `inferred` conclusions.
- Never state a check passed unless you ran it.
- If something cannot be verified (tool/env limitation), mark it explicitly.
- Every recommendation must include `what`, `where`, `how`, and `verify`.
- Prefer small, reversible fixes; propose phased migration for larger redesigns.
- Recommend one default path when options exist.
- Prioritize: Accessibility -> Mobile reliability -> Sensitive action safety -> Consistency -> Performance.
- Save final report to `docs/reviews/ui-review-{targetSlug}-{YYYY-MM-DD}.md`.

## Quality Bar (Definition of Done)

A UI review is complete only when all are present:

- Inventory of routes/views and shared-component usage.
- Findings for all requested categories.
- QA gate scorecard with `PASS` / `PARTIAL` / `FAIL`.
- Release verdict (`GO` or `NO-GO`) with blocking failures listed.
- BRD traceability matrix for UI obligations.
- Prioritized backlog and quick-win plan.

## Severity, Confidence, and Risk

Use these fields for each finding:

- `Severity`: `P0` (urgent), `P1` (this sprint), `P2` (next sprint), `P3` (hardening)
- `Confidence`: `High`, `Medium`, `Low`
- `Status`: `Confirmed`, `Partially Confirmed`, `Unverified`

Preferred scoring:

`Risk Score = Impact (1-5) x Frequency (1-5)`

Risk Score to severity mapping: `16-25 = P0`, `9-15 = P1`, `4-8 = P2`, `1-3 = P3`.

### Violation-to-Severity Quick Reference

| Violation | Severity | Rationale |
|-----------|----------|-----------|
| Missing `aria-label` on icon-only button | P1 | Screen reader users cannot identify the control |
| `:hover` without `:active` | P2 | Touch users see no feedback on tap |
| Hardcoded `px` breakpoint | P2 | Fragmented responsive behavior |
| `100vh` instead of `dvh` | P1 | Content hidden behind mobile browser chrome |
| Interactive element < 44px | P1 | WCAG 2.5.5 failure, mis-taps on mobile |
| Missing safe-area inset on sticky element | P1 | Content obscured on notched devices |
| Hardcoded color bypassing token | P2 | Theme/dark-mode breakage |
| `label={t(...)}` in citizen app | P1 | Bilingual compliance violation |
| Missing i18n key in locale file | P1 | Untranslated text shown to users |
| Form input font-size < 1rem on mobile | P2 | Triggers iOS Safari auto-zoom |
| Horizontal overflow at 320px | P1 | Content unreachable on small phones |

## Mandatory Evidence Artifacts

Collect these artifacts unless blocked:

- Screenshot matrix for key screens at:
  - `360x800` (small phone)
  - `768x1024` (tablet)
  - `1280x800` (desktop)
- Light and dark theme snapshots for at least one critical flow.
- Keyboard-only traversal notes for at least one critical flow.
- Accessibility scan output summary (manual and/or automated).
- Command execution log (`Executed`, `Not Executed`, reason).

If screenshots/scans are not possible in the environment, mark as `Not Executed` and provide precise manual verification steps.

## Phase 0: Preflight

Capture before analysis:

- Scope and assumptions.
- Branch and commit hash.
- Available scripts and checks from `package.json`.
- Environment constraints (missing backend, auth data, browser runtime).

## Phase 1: UI Inventory Scan

Produce:

- Route/page inventory by app.
- Component ownership map (local vs `@puda/shared`).
- CSS map: core stylesheets and approximate size/hotspot files.
- i18n footprint and hardcoded string candidates.
- Theme coverage map and likely dark-mode gaps.
- Faceted filter coverage: which list views have facet endpoints wired up vs still using plain hardcoded options.
- Login screen feature completeness: logo, remember-me, forgot-password, theme picker, footer, dedicated CSS.
- Dashboard drill-down coverage: which stat cards navigate and their targets.

Minimum table:

| App | Route | Screen Component | CSS Source | Shared Components | i18n Status | Theme Status |
|-----|-------|------------------|------------|-------------------|-------------|--------------|

Additional inventory table for faceted filters:

| App | List View | Facet Endpoint | Facet Fields | Fallback Values | Status |
|-----|-----------|---------------|-------------|-----------------|--------|

## Phase 2: Design System Integrity

### A) Token Compliance

- Hardcoded colors bypassing `var(--color-*)`.
- Hardcoded spacing/radius/shadow bypassing token vars.
- Breakpoints declared ad-hoc instead of tokenized values.

For each violation capture: file, line, current value, recommended token.

### B) Component Contract and State Completeness

Review shared components and high-use local components for:

- State coverage (`default`, `hover`, `active`, `focus-visible`, `disabled`, `loading`).
- Hover/active parity for touch users.
- Disabled semantics and visual distinction.
- Loading-state double-submit prevention.

### C) Visual Consistency

- Typography hierarchy consistency.
- Primary-action style consistency.
- Space rhythm and panel density consistency.
- Semantic color usage correctness (success/warn/error).

### D) Established Component Patterns

Verify these components follow design system rules:

- **`.stat-card--clickable`**: Must have `cursor: pointer`, `:hover` (brand border + shadow), `:active` (scale transform), `:focus-visible` (3px outline with offset). Transitions must use design tokens. Must be consistent across all 3 policing app `app.css` files.
- **Login card (`.login-container`)**: Must use `var(--radius-xl)`, `var(--shadow-md)`, `100dvh` (not `100vh`), fluid heading via `clamp()`, `accent-color: var(--color-brand)` for checkbox. Mobile breakpoint at `max-width: 30rem`. Must be in dedicated `login.css` (not `app.css`).
- **Facet option rendering**: `facetOptions()` helper must produce `<option>` elements with `VALUE (count)` format. Must gracefully fall back to plain values when facets are empty.

### E) Underline Tabs Pattern

The shared `<Tabs>` component (`@puda/shared` `ui.tsx`) renders `ui-tabs__*` class names. Every app that uses `<Tabs>` MUST have underline tab styles defined in its `app.css`. The canonical pattern:

```css
.ui-tabs__list {
  display: flex;
  gap: var(--space-1);
  border-bottom: 1px solid var(--color-border);
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
.ui-tabs__list::-webkit-scrollbar { display: none; }

.ui-tabs__tab {
  position: relative;
  background: none;
  border: none;
  padding: var(--space-3) var(--space-4);
  font-family: inherit;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-text-muted);
  cursor: pointer;
  white-space: nowrap;
  min-height: 2.75rem;
  transition: color 0.15s;
}
.ui-tabs__tab::after {
  content: "";
  position: absolute;
  left: var(--space-2); right: var(--space-2);
  bottom: -1px;
  height: 2px;
  border-radius: 2px;
  background: transparent;
  transition: background 0.2s;
}
.ui-tabs__tab:hover { color: var(--color-text); }
.ui-tabs__tab:active { opacity: 0.8; }
.ui-tabs__tab--active { color: var(--color-brand); font-weight: 600; }
.ui-tabs__tab--active::after { background: var(--color-brand); }
.ui-tabs__tab:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: -2px;
  border-radius: var(--radius-sm);
}
.ui-tabs__panel { padding-top: var(--space-5); }
```

**Review checks:**
- Every app using `<Tabs>` must have `ui-tabs__*` styles. Check with: `rg 'ui-tabs' apps/*/src --glob '*.css'`.
- Tab bar must be horizontally scrollable on mobile (no overflow).
- Active tab: brand-color text + 2px brand-color underline.
- Inactive tab: muted text, no underline.
- All tabs meet 44px min-height touch target.
- Must have `:hover`, `:active`, and `:focus-visible` states.
- Panel has top padding to separate content from tab bar.

### F) Keyboard-Navigable Table Rows

Clickable table rows (that navigate on click) MUST be keyboard-accessible. The pattern:

```tsx
<tr
  tabIndex={0}
  role="link"
  onClick={() => navigate(view)}
  onKeyDown={(e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(view); }
  }}
>
```

**Review checks:**
- Every `<tr>` with an `onClick` handler must also have `tabIndex={0}`, `role="link"`, and `onKeyDown` for Enter/Space.
- Check with: `rg 'onClick.*navigate' apps/*/src/views --glob '*.tsx' -l` then verify each file has matching `onKeyDown`.
- Must NOT use `<tr role="button">` — use `role="link"` since the action is navigation.

### G) Mobile-Responsive Detail Grids

Detail views that display key-value grids (e.g., subject profile, alert details, lead details) must use auto-fit columns instead of fixed column counts:

```css
/* BAD: breaks on mobile */
grid-template-columns: 1fr 1fr;

/* GOOD: responsive reflow */
grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
```

**Review checks:**
- Search for `gridTemplateColumns.*1fr 1fr` in detail views — all should use `auto-fit`.
- Verify with: `rg 'gridTemplateColumns.*1fr 1fr' apps/*/src/views --glob '*.tsx'`.

### H) Boolean Badge i18n

Components that render boolean values as badges (e.g., "Yes"/"No") MUST use i18n keys, not hardcoded English strings:

```tsx
// BAD
{value ? "Yes" : "No"}

// GOOD
{value ? t("common.yes") : t("common.no")}
```

**Review checks:**
- Search for hardcoded `"Yes"` / `"No"` in views: `rg '"Yes"|"No"' apps/*/src/views --glob '*.tsx'`.
- Ensure `common.yes` and `common.no` keys exist in all locale files.

## Phase 3: Responsive and Device Behavior

### A) Mobile-first Structure

- Base layout for mobile, desktop enhancements via min-width queries.
- Avoid `100vh`; prefer `dvh`.
- Width handling with responsive functions (`min`, `max`, `clamp`) where appropriate.

### B) Breakpoint Discipline

- Ensure breakpoints align with design tokens.
- Flag ad-hoc breakpoints that fragment behavior.

CSS specificity diagnostic:

```bash
# Find ad-hoc breakpoints not using design tokens
rg -n '@media[^{]*[0-9]+px' --glob '*.css'

# Find !important overrides (potential specificity wars)
rg -n '!important' --glob '*.css' --glob '!design-system.css' | head -20

# Find inline styles that bypass the design system
rg -n 'style={{' --glob '*.tsx' | grep -v 'var(--' | head -20
```

### C) Layout Adaptation

- Grid collapse and content order on small screens.
- Table-to-card behavior for narrow widths.
- Modal-to-bottom-sheet adaptation for mobile.
- Sticky/footer action bars with safe-area handling.

### D) Overflow and Readability

- Horizontal scroll risks at narrow widths.
- Missing `min-width: 0` in flex layouts.
- Long-token handling for IDs/hashes/ARN-like values.

## Phase 4: Accessibility (WCAG 2.1 AA)

### A) Color and Contrast

- Text/background contrast: WCAG 2.1 AA requires 4.5:1 for normal text, 3:1 for large text (18px+ or 14px+ bold).
- Contrast in muted, placeholder, disabled, and badge states.
- Non-color fallback for status-only cues (icon, text label, or pattern in addition to color).

### B) Keyboard and Focus

- Logical tab order and no focus traps.
- Visible focus for all interactive elements.
- Escape behavior for modal/drawer/popover.

### C) Screen Reader Semantics

- Accessible names for controls.
- Label/input/error relationships.
- Landmark usage (`main`, `nav`, `header`, `footer`).
- Live-region behavior for async status and toast notifications.

### D) Semantic Markup

- Buttons and links use semantic elements.
- Heading hierarchy is valid.
- Table semantics complete where tabular data exists.

### E) Touch Target Standards

- Interactive targets meet 44px minimum.
- Adjacent controls have adequate spacing.

### F) Accessibility Verification Commands

Run these checks and record results:

```bash
# Missing aria-label on icon-only buttons
rg -n '<button[^>]*>' --glob '*.tsx' -A 1 | grep -v 'aria-label'

# Interactive elements missing accessible names
rg -n 'role="button"|role="link"' --glob '*.tsx' | grep -v 'aria-label\|aria-labelledby'

# Images missing alt text
rg -n '<img ' --glob '*.tsx' | grep -v 'alt='

# Contrast — extract color pairs for manual verification
rg -n 'color:.*var\(--color-' --glob '*.css' | head -30

# Focus visibility — ensure :focus-visible is defined for interactive elements
rg -n ':focus-visible' --glob '*.css' | wc -l
rg -n 'button\|\.btn\|a\[href\]' --glob '*.css' -l | head -10
```

## Phase 5: Interaction, States, and UX Safety

### A) System Status and Feedback

- Loading, empty, error, and offline states for every critical screen.
- Mutation feedback (success/failure) consistency.
- No indefinite loading without timeout/error fallback.

### B) Error Prevention and Recovery

- Inline validation and clear recovery paths.
- Unsaved-change protection for form-heavy screens.
- Invalid actions disabled or blocked with explicit reason.

### C) Sensitive Action Safeguards (Domain Critical)

- Confirmations for irreversible actions (delete/finalize/export/merge).
- Explicit, contextual confirmation labels.
- PII reveal controls require explicit action and permission checks.
- High-risk actions display clear audit implications in UI.

### D) Trust and Explainability Signals

- Data freshness indicators.
- Source/context labels for high-impact data.
- Explainability hooks for risk scores or automated decisions.

### E) Established Interaction Patterns

Validate these recently implemented flows:

- **Dashboard drill-down**: Clicking a stat card must navigate to the correct entity list. Verify all navigation targets are valid views in the App shell router.
- **Faceted filter fallback**: When `/facets` endpoint fails (network error, 500), filter dropdowns must show original hardcoded values (no empty or broken dropdowns). Test by checking the `catch(() => {})` pattern and that fallback arrays are provided.
- **Remember Me persistence**: On login page mount, saved username must be restored from `localStorage`. On submit with checkbox checked, username must be saved. On submit with checkbox unchecked, saved value must be cleared.
- **Forgot Password flow**: Panel must swap in-place (not navigate). Back button must return to login form. Email field must be required. Success message must show after "send". No actual API call is made yet (client-side only) — flag if this is still the case.
- **Theme selector completeness**: All themes from `CUSTOM_THEMES` must appear in the login theme dropdown. Verify count matches the theme definitions in `design-system.css`.

## Phase 6: Internationalization and Content Quality

### A) Citizen App Bilingual Compliance

- Use `<Bilingual tKey="..."/>` for bilingual labels/headings where required.
- Use `t("...")` for non-bilingual action text and messages.
- Ensure keys exist across `en.ts`, `hi.ts`, `pa.ts`.
- Flag hardcoded strings in JSX.

### B) Policing App Trilingual Compliance (dopams-ui, forensic-ui, social-media-ui)

- All user-visible text must use `t()` i18n keys.
- Ensure keys exist across all 4 locale files: `en.ts`, `hi.ts`, `te.ts`, `pa.ts`.
- Login screen keys: `login.remember_me`, `login.forgot_password`, `login.back_to_login`, `login.forgot_instructions`, `login.email_or_username`, `login.email_or_username_placeholder`, `login.send_reset_link`, `login.reset_link_sent`, `login.failed`, `login.footer_text`.
- Verify that Hindi locale files have actual Hindi translations (not English copies).
- Verify that Telugu locale files have actual Telugu translations.
- Verify that Punjabi locale files (`pa.ts`) have actual Punjabi translations.

### C) Layout Resilience for Longer Strings

- Hindi/Telugu/Punjabi expansion does not break layouts.
- Proper wrapping/truncation strategies in constrained UI.
- Login screen must accommodate longer translated text without overflow (especially footer and forgot-password instructions).

### D) Non-citizen App Content Hygiene

- Avoid accidental hardcoded copy where i18n is expected.
- Consistent error phrasing and tone across modules.

## Phase 7: Frontend Performance and Perceived Speed

### A) Build and Bundle

- Bundle sizes and growth hotspots (flag bundles > 250KB gzipped).
- Route-level splitting and lazy loading coverage.
- Tree-shaking risks from broad shared exports.

Performance verification:
```bash
# Build and check output sizes
npm run build --workspace=<app-dir> 2>&1 | tail -20
# Check for lazy loading / code splitting
rg -n "React\.lazy|import\(" <app-dir>/src --glob '*.tsx' | head -10
# Check for barrel re-exports defeating tree-shaking
rg -n "export \* from" <app-dir>/src --glob '*.ts' --glob '*.tsx'
```

### B) Render Efficiency

- Re-render hotspots in large lists/forms.
- Expensive computations in render path.
- Oversized files that indicate poor component boundaries.

### C) Perceived Performance

- Skeleton strategy quality on data-heavy screens: skeleton should match content height, use pulse animation, and disappear on data load.
- Layout stability and visible feedback responsiveness (target CLS < 0.1).
- Progress communication for long-running operations.
- Web Vitals targets: LCP < 2.5s, FID < 100ms, CLS < 0.1.

## Phase 8: QA Gates and Release Verdict

Assess each gate as `PASS`, `PARTIAL`, `FAIL`.

Blocking gates:

1. Accessibility (WCAG 2.1 AA)
2. Mobile responsiveness
3. Interaction predictability
4. Sensitive action safety
5. System status visibility
6. Error prevention
7. Progressive disclosure
8. State resilience
9. Graceful degradation/offline handling
10. UI determinism (same input always produces same visible output)
11. Behavioral trust (user can predict what an action will do before performing it)

Non-blocking gates:

1. Perceived performance
2. Temporal awareness
3. Input efficiency
4. UX observability

Release policy:

- Any blocking gate = `FAIL` => `NO-GO`.
- Blocking gates all `PASS` or `PARTIAL` with no `FAIL` => eligible `GO` with conditions.

Use verdict block:

```text
WCAG Status:        [PASS | PARTIAL | FAIL]
Mobile Readiness:   [PASS | FAIL]
Blocking Gates:     X/11 PASS, Y/11 PARTIAL, Z/11 FAIL
Non-Blocking Gates: X/4 PASS, Y/4 PARTIAL, Z/4 FAIL
Release Decision:   [GO | NO-GO]
```

## Phase 9: Bugs and Foot-Guns

### Common Fix Patterns

| Violation | Fix |
|-----------|-----|
| `label={t("key")}` | Replace with `label={<Bilingual tKey="key" />}` |
| `100vh` in CSS | Replace with `100dvh` |
| Hardcoded `#fff` color | Replace with `var(--color-surface)` or appropriate token |
| `@media (max-width: 768px)` | Replace with `@media (max-width: 48rem)` |
| `<div onClick={...}>` | Replace with `<button type="button" onClick={...}>` |
| Missing `aria-label` on icon button | Add `aria-label={t("common.action_name")}` |
| Interactive element < 44px | Add `min-height: 2.75rem` (or `3rem` on mobile for primary actions) |
| `:hover` without `:active` | Add matching `:active` state (e.g., `opacity: 0.8` or `transform: scale(0.98)`) |
| Hardcoded `"Yes"/"No"` | Replace with `t("common.yes")/t("common.no")` |

Minimum counts:

- Full-repo UI review: `10+` high-impact and `10+` medium-impact findings.
- Scoped UI review: `5+` high-impact and `5+` medium-impact findings.

Each finding must include:

- Severity, confidence, and status
- Exact file:line evidence
- UX/user-impact statement
- Specific fix
- Verification steps

## Phase 10: BRD UI Compliance Matrix

Create traceability matrix:

| BRD ID | UI Requirement | Evidence (File:Line or Artifact) | Status | Gap | Next Step |
|--------|----------------|-----------------------------------|--------|-----|-----------|

Focus on:

- Mobile-first obligations
- Language/bilingual obligations
- PII masking and reveal controls
- Evidence chain display and governance cues
- Timeout/session UX requirements
- SLA/progress visibility obligations

## Phase 11: Architect Backlog (UI/UX)

Backlog size:

- Full-repo: `25-50` items
- Scoped: `10-25` items

Use table:

| ID | Title | Priority | Risk Score | Effort | Area | Where | Why | Change | Verify | Dependencies |
|----|-------|----------|------------|--------|------|-------|-----|--------|--------|--------------|

Priority:

- `P0`: immediate
- `P1`: this sprint
- `P2`: next sprint
- `P3`: hardening

Effort:

- `S`: under 2 hours
- `M`: 2 hours to 2 days
- `L`: more than 2 days

## Phase 12: Quick Wins and Stabilization

- Quick wins (2 hours): `5-10` fixes.
- 2-day stabilization: `8-15` fixes with meaningful risk reduction.

Each task must include exact file targets and exact verification steps.

## Phase 13: Verification Commands

Prefer `rg` for audits.
Record each command as `Executed` or `Not Executed`.

```bash
# Anti-pattern checks
rg -n 'label=\{t\(' apps/citizen/src --glob '*.tsx'
rg -n '\b100vh\b' apps/*/src --glob '*.css'
rg -n '@media[^{]*[0-9]+px' apps/*/src --glob '*.css'
rg -n '#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(' apps/*/src --glob '*.css'
rg -n '\bpadding:\s*[0-9.]+(px|rem)|\bmargin:\s*[0-9.]+(px|rem)' apps/*/src --glob '*.css'

# Faceted filter pattern checks
# Verify all list views use facetOptions helper (no plain hardcoded <option> without counts)
rg -n 'facetOptions' apps/dopams-ui/src/views apps/forensic-ui/src/views apps/social-media-ui/src/views --glob '*.tsx'
# Verify facet fetch endpoints exist in all list views
rg -n '/facets' apps/dopams-ui/src/views apps/forensic-ui/src/views apps/social-media-ui/src/views --glob '*.tsx'
# Verify API facet routes are registered before /:id routes
rg -n 'facets' apps/dopams-api/src/routes apps/forensic-api/src/routes apps/social-media-api/src/routes --glob '*.ts'

# Login screen pattern checks
# Verify all 3 login screens have remember-me, forgot-password, theme picker, footer
rg -n 'rememberMe|remember_me' apps/dopams-ui/src/Login.tsx apps/forensic-ui/src/Login.tsx apps/social-media-ui/src/Login.tsx
rg -n 'forgotMode|forgot_password' apps/dopams-ui/src/Login.tsx apps/forensic-ui/src/Login.tsx apps/social-media-ui/src/Login.tsx
rg -n 'THEME_LABELS|CUSTOM_THEMES' apps/dopams-ui/src/Login.tsx apps/forensic-ui/src/Login.tsx apps/social-media-ui/src/Login.tsx
rg -n 'footer_text' apps/dopams-ui/src/Login.tsx apps/forensic-ui/src/Login.tsx apps/social-media-ui/src/Login.tsx
# Verify dedicated login.css exists and is imported
rg -n 'login\.css' apps/dopams-ui/src/Login.tsx apps/forensic-ui/src/Login.tsx apps/social-media-ui/src/Login.tsx

# Dashboard drill-down checks
# Verify stat cards use <button> not <div>
rg -n 'stat-card--clickable' apps/dopams-ui/src/views/Dashboard.tsx apps/forensic-ui/src/views/Dashboard.tsx apps/social-media-ui/src/views/Dashboard.tsx
rg -n 'onNavigate' apps/dopams-ui/src/views/Dashboard.tsx apps/forensic-ui/src/views/Dashboard.tsx apps/social-media-ui/src/views/Dashboard.tsx
# Verify clickable stat card CSS has hover + active + focus-visible
rg -n 'stat-card--clickable' apps/dopams-ui/src/app.css apps/forensic-ui/src/app.css apps/social-media-ui/src/app.css

# Underline tabs pattern checks
# Verify tab styles exist in every app that uses <Tabs>
rg -l 'Tabs' apps/dopams-ui/src/views apps/forensic-ui/src/views apps/social-media-ui/src/views --glob '*.tsx'
rg -n 'ui-tabs' apps/dopams-ui/src/app.css apps/forensic-ui/src/app.css apps/social-media-ui/src/app.css

# Keyboard-navigable table row checks
# Find clickable <tr> rows without keyboard handlers
rg -n 'onClick.*navigate' apps/*/src/views --glob '*.tsx' -l
rg -n 'onKeyDown' apps/*/src/views --glob '*.tsx' -l
# These two lists should match — any file in the first but not the second is a violation

# Mobile-responsive grid checks
# Find hardcoded 2-column grids in detail views
rg -n 'gridTemplateColumns.*1fr 1fr' apps/*/src/views --glob '*.tsx'
# All should use repeat(auto-fit, minmax(16rem, 1fr)) instead

# Boolean badge i18n checks
rg -n '"Yes"|"No"' apps/*/src/views --glob '*.tsx'

# i18n completeness checks
# Verify all 4 locale files exist per app
ls apps/dopams-ui/src/locales/{en,hi,te,pa}.ts
ls apps/forensic-ui/src/locales/{en,hi,te,pa}.ts
ls apps/social-media-ui/src/locales/{en,hi,te,pa}.ts
# Verify login keys exist in all locales
rg -n 'login\.remember_me|login\.forgot_password|login\.footer_text' apps/dopams-ui/src/locales apps/forensic-ui/src/locales apps/social-media-ui/src/locales --glob '*.ts'

# API hardening checks
# Verify unit_id uses ::uuid not ::text
rg -n 'unit_id = \$[0-9]+::text' apps/dopams-api/src apps/forensic-api/src apps/social-media-api/src --glob '*.ts'
# Verify auth returns token in body
rg -n 'token' apps/dopams-api/src/routes/auth.routes.ts apps/forensic-api/src/routes/auth.routes.ts apps/social-media-api/src/routes/auth.routes.ts

# Build checks for UI apps
npm run build:citizen
npm run build:officer
npm run build:dopams-ui
npm run build:forensic-ui
npm run build:social-media-ui

# Repo-level checks helpful for UI quality
npm run check:frontend-budgets
npm run test:e2e:a11y
npm run test:e2e:resilience

# Optional broader checks
npm run build:all
```

If a command fails, include failure summary and likely root cause.

## Output

Ensure the final review document contains these sections in order:

1. Scope and Preflight
2. UI Inventory
3. Category Findings
4. QA Gates and Verdict
5. Bugs and Foot-Guns
6. BRD UI Compliance Matrix
7. UI Architect Backlog
8. Quick Wins and Stabilization
9. Top 5 Priorities

If `docs/reviews/` does not exist, create it before writing the report.
