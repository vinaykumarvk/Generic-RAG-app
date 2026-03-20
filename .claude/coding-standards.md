# Coding Standards — Full Reference

These standards are extracted from the project's review skills and must be followed
when writing any code in this repository. CLAUDE.md contains the most critical subset;
this file is the complete reference.

---

## Security

### Injection Prevention
- All SQL queries must use parameterized queries (`$1`, `$2`) — never string concatenation or template literals with user input.
- Dynamic table/column names must be validated against allowlists, never user-supplied.
- No `exec()`, `spawn()`, `system()`, or `eval()` with user-supplied input.
- No `dangerouslySetInnerHTML` without DOMPurify sanitization.
- File paths from user input must be validated and sandboxed — no `../` traversal.
- Upload destinations must use generated filenames, not user-supplied ones.
- URLs from user input must be validated against allowlists; block internal/private IP ranges (SSRF).

### Authentication
- Auth tokens in httpOnly + secure + sameSite cookies — never localStorage.
- Password hashing: bcrypt/scrypt/argon2 only (not MD5/SHA).
- No plaintext passwords in logs, error messages, or API responses.
- Rate limiting on login endpoints; brute-force protection.
- Every protected route must pass through auth middleware at the router level.
- Failed auth returns consistent error format with no user-existence leakage.
- Access tokens: short-lived (15-60 min); refresh tokens: rotation required.
- Logout must invalidate server-side state.

### Authorization
- Roles/permissions are server-defined — never trust client-supplied roles.
- Every mutation endpoint has authorization checks.
- Read endpoints filter data by user scope (tenant, workspace, ownership).
- Object-level access checks required (no IDOR).
- Bulk operations enforce per-item authorization.
- Users cannot modify their own role/permissions.
- File/attachment access respects parent resource auth rules.

### Secrets
- No hardcoded API keys, tokens, passwords, or connection strings in source code.
- No secrets in Dockerfiles, CI configs, or infra-as-code.
- `.env` in `.gitignore`; `.env.example` has placeholders only.
- Secrets must be rotatable without code deployment.

### Data Protection
- API responses return only necessary fields — no over-fetching sensitive data.
- PII masked/redacted in logs, error messages, and non-privileged responses.
- Sensitive fields never in GET query parameters.
- Audit logs are append-only.
- Required headers: `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options`, `Cache-Control: no-store` for sensitive responses.
- CORS: specific origins only (not `*` in production).
- Request size limits configured.

### Logging Safety
- No sensitive data in logs (passwords, tokens, PII).
- No `console.log`/`console.debug` in production code — use structured logger (pino).
- Security events logged at WARN/ERROR level.

---

## Code Quality

### Type Safety
- No `any` type annotations in new code; use `unknown` where types are unclear.
- No `as any` casts.
- No `// @ts-ignore` or `// eslint-disable` without explanatory comment.
- TypeScript strict mode enabled.
- All API inputs validated against Zod schemas server-side before processing.
- Reject unexpected fields (strict schemas).

### Error Handling
- All async operations have error handling (try/catch, `.catch()`, error middleware).
- Never swallow errors silently — log at minimum.
- Global error handler catches unhandled exceptions.
- Error messages are user-safe: no stack traces, internal paths, or SQL in responses.
- Correct HTTP status codes (not 200 for errors, not 500 for client errors).
- Use project error helpers (`send400()`, `send404()`, etc.) not raw `reply.send` for errors.

### Database
- No N+1 queries — use JOINs or `WHERE id = ANY($1)`.
- Transactions for multi-step mutations.
- All list endpoints have LIMIT/pagination (no unbounded queries).
- Connection pooling configured.
- Foreign keys with referential integrity.
- Indexes on frequently queried columns, FKs, and search fields.
- Migrations: idempotent (`IF NOT EXISTS`), backward-compatible.
- Audit fields (`created_at`, `updated_at`, `created_by`) consistently present.
- Timestamps in UTC.
- State machine transitions enforce guards.
- Check-and-act operations atomic (DB transactions for TOCTOU).

### API Contracts
- Consistent response envelope across all endpoints.
- Uniform pagination, filtering, sorting patterns.
- Structured validation error messages.
- All path/query parameters validated and typed.

### Code Maintainability
- Functions <= ~50 lines; files <= ~500 lines.
- No deeply nested conditionals (>3 levels) — use early returns.
- No commented-out code blocks.
- Remove dead/unused imports and exports.
- No duplicated utilities/types — use shared packages.
- Import via workspace aliases (`@puda/shared`, `@puda/api-core`), not relative paths into `packages/`.

### Testing
- Unit tests for core business logic.
- Tests assert behavior, not implementation details.
- Deterministic tests — no time/order dependence.
- Negative cases tested (invalid input, unauthorized, missing data).

---

## UI/UX & Accessibility (WCAG 2.1 AA)

### Responsive Design
- Use `100dvh` not `100vh` for full-height layouts.
- Media query breakpoints in `rem` units: `22.5rem`, `48rem`, `80rem`.
- No fixed pixel widths >= 100px — use `min()`, `max-width`, or percentage/rem.
- `vw` units inside `clamp()` only.
- Mobile-first CSS: base = mobile, `min-width` queries for desktop.
- `<meta name="viewport" content="width=device-width, initial-scale=1">` present.
- No horizontal overflow at 320px viewport.

### Accessibility
- Interactive elements: min 44px (2.75rem) touch target.
- Icon-only buttons have `aria-label`.
- No `<div onClick>` or `<span onClick>` — use `<button>` or `<a>`.
- Toggle components have `aria-expanded` on trigger.
- All `<img>` have `alt` attribute.
- Raw `<button>` elements specify `type="button"` or `type="submit"` explicitly.
- Every `:hover` has a corresponding `:active` for touch parity.
- Color contrast: 4.5:1 normal text, 3:1 large text.
- Visible `:focus-visible` styles on all interactive elements.
- `prefers-reduced-motion` respected.
- Clickable `<tr>`: `tabIndex={0}`, `role="link"`, `onKeyDown` for Enter/Space.
- Decorative SVGs: `aria-hidden="true"`.
- Modals: `<dialog>` or `role="dialog"` + `aria-modal="true"`, focus trapped, Escape to close.
- `<nav>` landmark with `aria-label` for sidebar.
- Toast/notifications: `role="status"` or `aria-live="polite"`.
- Error messages: `role="alert"` or `aria-live="assertive"`.
- `aria-invalid` on fields with validation errors.
- `aria-describedby` linking error messages to inputs.
- Single `<h1>` per page; valid heading hierarchy.

### Design System
- No hardcoded hex/rgb — use CSS custom properties (`var(--color-*)`).
- No hardcoded spacing/radius/shadow — use design tokens.
- No inline styles with hardcoded pixel spacing.

### Design Token Rules (IntelliRAG-specific)
- **Theming uses `[data-theme]` attribute on `<html>`** — NOT Tailwind `dark:` prefix. Never use `dark:` classes; they are non-functional in this project.
- **Allowed Tailwind color prefixes**: `primary-*`, `surface`, `surface-alt`, `text-skin-base`, `text-skin-muted`, `border-skin`, `bg-skin-base`, `sidebar-*`. These reference CSS custom properties and adapt per theme.
- **Forbidden Tailwind color prefixes**: `red-*`, `amber-*`, `green-*`, `blue-*`, `gray-*`, `slate-*`, `white`, `black`, and all other standard Tailwind colors. These are hardcoded and break on dark/custom themes.
- **Semantic accents** (error red, success green, warning amber): use a token-based background (`bg-surface-alt`, `bg-surface`) with a colored border accent (`border-red-500`, `border-green-500`) and token-based text (`text-skin-base`). This keeps the semantic color visible while the background adapts to the theme.
- **Verify utility classes exist**: class names like `text-text-secondary`, `bg-surface-secondary`, `border-border-primary` do NOT exist in `tailwind.config.js` and render as no-ops. Always cross-check against the config.
- **Lint check**: Run `npm run lint:theme` to catch all violations mechanically (see `scripts/lint-theme-tokens.sh`).

### Dark Mode
- All text colors use design tokens (`var(--color-text-*)`) — no hardcoded `#333`, `black`, `gray-900`.
- All background colors use design tokens — no hardcoded `white`, `#fff`, `gray-50`.
- All border colors use tokens — no hardcoded `gray-200`, `#e5e7eb`.
- Form inputs readable in dark mode (proper background + text contrast).
- Status badges (success/error/warning) visible and readable in both modes.
- No flash of wrong theme on page load (theme applied before first paint via `<script>` or `data-theme`).
- Shadows adapt for dark mode (lighter shadows or glow instead of drop shadow).
- Modal/overlay backdrops render correctly in dark mode.

### Navigation
- Sidebar collapses on mobile with hamburger toggle.
- Hamburger: dynamic `aria-label`, `aria-expanded`.
- Mobile sidebar: overlay with backdrop, close on click/Escape.
- Sidebar closes on route navigation (mobile).
- Sidebar slides with `transform` + `transition` (not `display` toggle).
- Body scroll locked when overlay open.
- Focus trapped in overlay sidebar; focus returns to hamburger on close.
- Menu items use `<a>` or `<NavLink>`, not `<div onClick>`.
- Menu icons: consistent size across all items, `aria-hidden="true"` on icons.
- Menu sections grouped with headings or visual separators.

### Data Tables
- Semantic `<table>`, `<thead>`, `<tbody>`, `<th>`, `<td>` elements.
- Column headers have `scope="col"` for screen readers.
- Sortable columns have `aria-sort` attribute and visual indicator (arrow icon).
- Tables responsive on mobile: data-dense operational tables must switch to stacked card/list presentation below the mobile breakpoint. Horizontal scroll is only acceptable for genuinely matrix-like/tabular content that cannot be meaningfully reflowed.
- Table rows min 44px height for touch targets.
- Table empty state when no rows match (not just empty `<tbody>`).
- Pagination controls for large datasets (not rendering 500+ rows).

### Search & Filter
- Search input debounced (300-500ms) to avoid excessive API calls.
- Search input has clear button when non-empty.
- "No results" state when search/filter returns empty — distinct from data-empty state.
- Active filter count or badges showing applied filters.
- "Clear all filters" action available when filters are applied.
- Search input has `type="search"` and `role="searchbox"`.

### Toast & Notifications
- Success/error feedback for mutations (create, update, delete) via toast or inline message.
- Toasts positioned consistently (top-right or bottom-right).
- Toasts auto-dismiss after 3-5 seconds with manual dismiss option.
- Toasts use semantic colors (green=success, red=error, yellow=warning, blue=info).
- Toast container has `role="status"` or `aria-live="polite"`.
- No more than 3 toasts visible simultaneously (queue excess).

### Modals & Dialogs
- Modals use `<dialog>` element or have `role="dialog"` + `aria-modal="true"`.
- Focus trapped inside open modal (Tab cycles within modal).
- Focus returns to trigger element when modal closes.
- Escape key closes modal.
- Click outside modal (on backdrop) closes it.
- Modal has `aria-labelledby` pointing to heading.
- Confirmation dialogs for destructive actions use explicit action labels (e.g., "Delete workspace") — not generic "OK"/"Cancel".
- Body scroll locked when modal is open.

### Forms
- All form inputs have visible labels (not just placeholder text).
- Required fields indicated with asterisk or "(required)" text.
- Inline validation errors next to field (not just at top of form).
- Validation timing: on blur for first visit, on change after first error.
- Submit buttons disabled with loading state during submission (double-submit prevention).
- Correct HTML input types for mobile keyboards (`email`, `url`, `tel`, `number`).
- `autocomplete` attributes on form inputs.
- Multi-step forms show progress indicator.

### Cards & Containers
- Cards use consistent border-radius and shadow from design tokens.
- Interactive cards have `cursor: pointer` and `:focus-visible` ring.
- Card grids responsive: `grid-cols-1 md:grid-cols-2 lg:grid-cols-3` or `auto-fit`.

### State Management
- Every data component has loading, empty, and error states.
- Empty states: icon + heading + description + CTA.
- Search/filter empty state ("No results match your criteria") distinct from data-empty state.
- React Error Boundary wraps main content.
- Error boundary shows: error icon + message + "Try Again"/"Go Home" buttons.
- 404 catch-all route exists.
- Skeleton/shimmer loading preferred over spinners; skeleton shape matches content layout (prevents CLS).
- Long operations (>3s) show progress bar or step indicator.
- No indefinite spinners — all loading states have timeout with error fallback.
- Confirmation for destructive actions.
- Session expired → redirect to login with message.

### Scroll & Content Behavior
- Long lists virtualized or paginated (not rendering 1000+ DOM nodes).
- Scroll position restored on back navigation.
- Sticky headers/toolbars don't overlap scrollable content.
- No competing nested scroll containers.

### Image & Media
- Images use `loading="lazy"` for below-fold content.
- All `<img>` have `alt` attribute (empty `alt=""` for decorative).
- Image containers have fixed aspect-ratio to prevent layout shift (CLS).
- Broken image fallback (placeholder or error state).
- SVG icons have `aria-hidden="true"` when decorative.

### Animation & Motion
- `prefers-reduced-motion` respected (disable animations for accessibility).
- Consistent duration: 150-300ms for micro-interactions, 300-500ms for page transitions.
- Easing: ease-out for enter, ease-in for exit.
- Animations use `transform`/`opacity` only (no layout-triggering `width`/`height`).

### Login Screen
- Full-viewport centered layout (`100dvh`).
- Input font-size >= 16px to prevent iOS Safari auto-zoom.
- Password visibility toggle (eye icon with `aria-label`).
- Auto-focus first empty field on mount.
- Enter key submits form (native `<form>` with `onSubmit`).
- Error dismissed on new input (clear error when user types).
- Redirect to intended page after login (not always dashboard).
- "Remember me" persists username only — never passwords.
- Error display uses `role="alert"` or `aria-live="assertive"`.
- `<main>` landmark wrapping login content.
- `autocomplete="username"` and `autocomplete="current-password"` on inputs.
- All login text uses i18n keys.

### Frontend API Calls
- `fetch()` to own API: `credentials: "include"`.
- Mutations check `isOffline` and disable submit when offline.
- `useCallback` for functions in `useEffect` dependencies.
- Catch blocks have corresponding error state UI.

### Frontend Performance
- Route-level code splitting with `React.lazy` + `Suspense`.
- Suspense fallback for React.lazy routes (page-level loader).
- Bundle budget: flag > 250KB gzipped.
- No barrel re-exports (`export * from`) defeating tree-shaking.
- No expensive computations in render path.
- Web Vitals targets: LCP < 2.5s, FID < 100ms, CLS < 0.1.

### Internationalization
- All user-visible text uses i18n functions — no hardcoded strings.
- Every i18n key exists in all locale files.
- Date/number/currency formatting: locale-aware utilities.

---

## Infrastructure

### Docker
- Non-root user (`USER` directive with numeric UID).
- Base images pinned to specific versions (not `latest`).
- Minimal base images (alpine or distroless).
- Multi-stage builds: build tools not in production image.
- COPY order: dependency manifests before source code.
- `npm ci` (not `npm install`) in Docker builds.
- `.dockerignore` excludes `node_modules`, `dist`, `.git`, `.env`, tests, docs.
- No secrets in image layers.
- Debug mode disabled in production.

### Build & CI/CD
- Build order respects dependency graph.
- No phantom or circular dependencies.
- Shared packages export only needed items.
- Lockfile committed; `npm ci` in CI.
- Tests run on every PR; failures block merge.

### Reliability
- SIGTERM/SIGINT handlers drain in-flight requests.
- DB connections closed cleanly on shutdown.
- Health check endpoints verify actual dependencies.
- Readiness check distinguishes startup from degraded.
- Request timeouts at all layers.
- External failures don't cascade (timeouts, circuit breakers).
- Queue failures: dead-letter queues, retry with backoff.
- Idempotency for retried operations.

### Configuration
- No hardcoded `localhost` in production code paths.
- All required env vars documented in `.env.example`.
- Env var validation at startup (throw on missing required).
- Services use port from env var, not hardcoded.

### Observability
- Structured JSON logs.
- Consistent log fields (timestamp, level, service, message).
- Request/correlation IDs propagated across services.
- All auth events logged.
- All data mutations logged (who, what, when).

### Scalability
- Stateless services (no in-memory session state).
- Object storage for files in production (not local filesystem).
- Background jobs use proper queue, not in-process timers.
- SPA fallback to `index.html` for client-side routes.

---

## Automated Checks

The following rules are enforced mechanically by `scripts/lint-all.sh` with a baseline ratchet. Run `npm run lint` to check, `npm run lint:baseline` to ratchet down after cleanup.

| ID | Rule | Script | Priority |
|----|------|--------|----------|
| SEC-03 | No `eval()`/`exec()`/`spawn()`/`system()` | security.sh | P0 |
| SEC-04 | No `dangerouslySetInnerHTML` | security.sh | P0 |
| SEC-07 | No auth tokens in localStorage/sessionStorage | security.sh | P0 |
| SEC-15 | No hardcoded secrets in source | security.sh | P0 |
| SEC-17 | No secrets in Dockerfile ENV | security.sh | P0 |
| SEC-18 | No `console.log/debug/info` in production code | security.sh | P1 |
| SEC-19 | No CORS wildcard `*` origin | security.sh | P2 |
| QUA-01 | No `: any` type annotations | quality.sh | P1 |
| QUA-02 | No `as any` casts | quality.sh | P1 |
| QUA-03 | No `@ts-ignore`/`@ts-expect-error` | quality.sh | P2 |
| QUA-14 | Files must not exceed 500 lines | quality.sh | P2 |
| QUA-18 | No relative imports into `packages/` | quality.sh | P2 |
| UID-05 | No hardcoded Tailwind colors (use tokens) | ui-a11y.sh | P1 |
| UID-06 | No dead `dark:` prefix | ui-a11y.sh | P1 |
| UID-07 | No non-existent utility classes | ui-a11y.sh | P1 |
| UIA-01 | No `<div onClick>`/`<span onClick>` | ui-a11y.sh | P2 |
| UIA-03 | `<button>` must have `type=` attribute | ui-a11y.sh | P1 |
| UIA-05 | `<img>` must have `alt=` attribute | ui-a11y.sh | P1 |
| UIT-02 | `<th>` must have `scope=` attribute | ui-a11y.sh | P2 |
| INF-04 | Use `npm ci` not `npm install` in Dockerfiles | infra.sh | P2 |
| INF-10 | No hardcoded `localhost`/`127.0.0.1` | infra.sh | P2 |
