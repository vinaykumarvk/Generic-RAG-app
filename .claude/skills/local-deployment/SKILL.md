---
name: local-deployment
description: Post-feature local deployment verification — builds packages, starts dev servers, validates auth/DB/routes/feature, and confirms the app is ready for manual testing with port and credentials.
argument-hint: "<app-dir> [feature-description]"
user_invocable: true
---

# Local Deployment Verification Playbook

End-to-end local dev environment validation: rebuild dependencies, start servers, verify auth + DB + routing + feature, report readiness with port and credentials.

## Purpose

Run this skill after developing a feature to verify it works end-to-end in the local dev environment before declaring it ready for manual testing. This catches the integration issues that compile-time checks miss.

## Scoping

The user MUST specify a target app directory (example: `/local-deployment apps/officer`).

Optionally, the user can describe the feature being tested (example: `/local-deployment apps/officer NL Assistant module`). If provided, Phase 7 will specifically validate that feature.

If no target is specified, ask the user which app to deploy locally.

Options the user may append:
- `no-fix` — report findings only, do not fix issues
- `api-only` — only start and test the API, skip the frontend
- `ui-only` — only start and test the frontend (assumes API is already running)
- `skip-rebuild` — skip package rebuild phase (use when you know packages are up to date)

## Operating Rules

- Evidence-first: cite exact files, line numbers, and command output for every finding.
- Fix issues in-place as you find them — do not defer fixes unless they depend on an earlier fix.
- After every fix, verify the fix works before moving on.
- **Max 3 fix-rebuild cycles** per phase. If still failing after 3 attempts, report the blocker and stop.
- Kill any stale processes on required ports before starting servers.
- Always verify end-to-end, not just compilation — a feature that compiles but returns 401/403/500 is NOT working.

## Severity

- `P0` — App won't start or crashes immediately (BLOCKER — stop and fix before proceeding)
- `P1` — Feature broken at runtime (auth fails, DB errors, route 404/401/403/500)
- `P2` — Degraded behavior (missing data, UI glitch, slow response)
- `P3` — Cosmetic or hardening issue

If a P0/P1 issue cannot be fixed in 3 cycles, escalate as BLOCKER in the readiness report and stop.

## Troubleshooting Quick Reference

**API won't start — check in this order:**
1. DATABASE_URL pointing to Cloud SQL (port 15435)? → Check `.env`, must NOT be localhost:5432
2. cloud-sql-proxy running? → `pgrep -f cloud-sql-proxy && lsof -ti:15435`
3. Port in use? → `lsof -ti:$API_PORT | xargs kill -9`
4. Stale package dist? → Rebuild: `npm run build:shared && npm run build:api-core`
5. Missing env var? → Check `.env` for `DATABASE_URL`, `JWT_SECRET`, `PORT`
6. DB not running? → `psql "$DATABASE_URL" -c "SELECT 1"`
7. Migrations not run? → Check for `relation "X" does not exist` in error output

**Frontend loads but features don't work:**
1. API not running? → `curl -sf http://localhost:$API_PORT/health`
2. Wrong API URL? → Check `VITE_API_BASE_URL` in `.env` and `apiBaseUrl` in source
3. Missing `credentials: "include"`? → Check fetch calls for cookie-based auth
4. CORS blocking? → Check API CORS origin list includes frontend port
5. Build-time flag missing? → Check `VITE_ENABLE_*` in `.env`

**Enable verbose logging for debugging:**
```bash
# Start API with debug logging
DEBUG=* npm run dev --workspace=<api-dir> 2>&1 | tee /tmp/api-debug.log &
# Then search logs: grep -i "error\|warn\|fail" /tmp/api-debug.log
```

---

## Phase 0: Preflight — Understand the Environment

### 0.1: Current State

```bash
git status --short
git log --oneline -3
```

Record branch, uncommitted changes, and recent commits for context.

### 0.2: Target App Analysis

```bash
# Identify app type
cat <app-dir>/package.json | head -30

# Frontend or API?
ls <app-dir>/src/index.html <app-dir>/public/ 2>/dev/null   # frontend indicators
ls <app-dir>/src/server.* <app-dir>/src/app.* 2>/dev/null   # backend indicators
ls <app-dir>/vite.config.* 2>/dev/null                      # Vite frontend

# Identify the API app this frontend talks to
rg "apiBaseUrl|API_URL|VITE_API" <app-dir>/src/ --glob '*.{ts,tsx}' | head -5
```

### Frontend-to-API Mapping

Use this table to determine which API app backs each frontend:

| Frontend App | API App | API Port Default |
|---|---|---|
| apps/citizen | apps/api | 3001 |
| apps/officer | apps/api | 3001 |
| apps/dopams-ui | apps/dopams-api | 3002 |
| apps/forensic-ui | apps/forensic-api | 3003 |
| apps/social-media-ui | apps/social-media-api | 3004 |

Set `<api-dir>` to the API app directory from this table. All subsequent phases use `<api-dir>` to reference the correct API.

### 0.3: Identify the API App

For frontend apps, identify which API app serves the backend (confirm against the mapping table above):

```bash
# Check vite proxy config or env vars
rg "proxy|target.*http" <app-dir>/vite.config.* 2>/dev/null
cat <app-dir>/.env* 2>/dev/null | grep -i "api\|port\|url"
cat .env 2>/dev/null | grep -i "api\|port\|url\|database"
```

Determine:
- **Frontend port**: from vite.config or package.json dev script
- **API port**: from .env or app.ts listen call
- **Database URL**: from .env

### 0.4: Monorepo Dependency Graph

```bash
# Workspace packages this app depends on
rg '"@puda/' <app-dir>/package.json

# Build order for this monorepo
# shared → workflow-engine → api-core → api-integrations → <target-app>
```

Record the build chain. All upstream packages must be rebuilt if their source changed.

---

## Phase 1: Package Rebuild — Stale dist/ is the #1 Silent Killer

**WHY**: `tsx --watch` auto-reloads the API on source changes to `<api-dir>/src/`, but does NOT detect changes to compiled `dist/` of workspace packages. If you modified `packages/api-core/src/` but didn't rebuild, the API imports stale code and you get runtime errors like `createXxx is not a function`.

### 1.1: Detect Stale Packages

For each workspace package the app depends on, check if source is newer than dist:

```bash
# Check if any package source is newer than its dist
for pkg in shared workflow-engine api-core api-integrations; do
  PKG_DIR="packages/$pkg"
  if [ -d "$PKG_DIR/src" ]; then
    SRC_TIME=$(find "$PKG_DIR/src" -name '*.ts' -newer "$PKG_DIR/dist/index.js" 2>/dev/null | head -1)
    if [ -n "$SRC_TIME" ]; then
      echo "STALE: $pkg — source newer than dist"
    else
      echo "OK: $pkg"
    fi
  fi
done
```

### 1.2: Rebuild Stale Packages (in order)

```bash
# Rebuild in dependency order
npm run build:shared 2>&1 | tail -3
npm run build:workflow-engine 2>&1 | tail -3
npm run build:api-core 2>&1 | tail -3
npm run build:api-integrations 2>&1 | tail -3
# Add any app-specific packages (e.g., nl-assistant for officer/citizen)
```

**Gate: All package builds must succeed. If a build fails, diagnose and fix before continuing.**

### 1.3: Lockfile Consistency

If any new packages were added to workspaces:

```bash
# Check if package-lock.json includes all workspaces
npm ls --depth=0 2>&1 | grep -i "ERR\|missing\|invalid" | head -10
```

If missing workspace errors appear:

```bash
npm install --package-lock-only
```

**Known issue**: Adding a new workspace package (e.g., `packages/nl-assistant`) requires updating `package-lock.json` before `npm ci` will work. This also affects Docker builds.

---

## Phase 2: Database Connectivity — Cloud SQL Required

**WHY**: The most common local deployment failure is the API starting but every query returning ECONNREFUSED because the database isn't running or the connection string is wrong. IntelliRAG **must** connect to Cloud SQL via `cloud-sql-proxy` — never a local PostgreSQL instance.

### 2.0: Enforce Cloud SQL Connection (P0 Gate)

The active `DATABASE_URL` in `.env` **must** point to Cloud SQL through the cloud-sql-proxy (port `15435`). A local PostgreSQL connection (port `5432`) is NOT acceptable for local deployment.

```bash
# Read the active (uncommented) DATABASE_URL
ACTIVE_DB_URL=$(grep '^DATABASE_URL=' .env | head -1 | cut -d= -f2-)
echo "Active DATABASE_URL: $ACTIVE_DB_URL"

# Check if it points to Cloud SQL proxy (port 15435)
if echo "$ACTIVE_DB_URL" | grep -qE ':15435/'; then
  echo "OK: DATABASE_URL points to Cloud SQL (port 15435)"
else
  echo "FAIL: DATABASE_URL does NOT point to Cloud SQL."
  echo "Expected port 15435 (cloud-sql-proxy), got: $ACTIVE_DB_URL"
  echo "Switching to Cloud SQL connection..."
fi
```

**If DATABASE_URL is not pointing to Cloud SQL**, fix it:

1. Comment out the local DATABASE_URL line
2. Uncomment or set the Cloud SQL DATABASE_URL (port 15435 via cloud-sql-proxy)
3. The Cloud SQL connection string format: `postgresql://<user>:<pass>@127.0.0.1:15435/<dbname>`
4. Refer to the commented-out Cloud SQL lines in `.env` for the correct connection string

```bash
# Example fix — swap active DATABASE_URL to Cloud SQL:
# Comment out local line, uncomment Cloud SQL line in .env
# sed -i '' 's|^DATABASE_URL=postgres://intellirag.*localhost:5432|# LOCAL: &|' .env
# sed -i '' 's|^# Cloud SQL.*DATABASE_URL=|DATABASE_URL=|' .env
```

**Gate: Do NOT proceed past Phase 2 if DATABASE_URL does not point to port 15435.**

### 2.1: Verify cloud-sql-proxy is Running

The Cloud SQL proxy must be running for the API to reach the database.

```bash
# Check if cloud-sql-proxy is running
if pgrep -f "cloud-sql-proxy\|cloud_sql_proxy" >/dev/null 2>&1; then
  echo "OK: cloud-sql-proxy is running"
  ps aux | grep -E "cloud.sql.proxy" | grep -v grep
else
  echo "FAIL: cloud-sql-proxy is NOT running"
  echo ""
  echo "Start it with:"
  echo '  cloud-sql-proxy "policing-apps:asia-southeast1:policing-db-v2" --port 15435 --gcloud-auth &'
  echo ""
  echo "Prerequisites:"
  echo "  - gcloud auth login"
  echo "  - gcloud auth application-default login"
  echo "  - cloud-sql-proxy binary installed (brew install cloud-sql-proxy)"
fi

# Verify something is listening on port 15435
lsof -ti:15435 2>/dev/null && echo "Port 15435: LISTENING" || echo "Port 15435: NOTHING LISTENING — start cloud-sql-proxy first"
```

**If cloud-sql-proxy is not running, report it as a P0 BLOCKER.** Provide the start command and stop — the user must start the proxy manually (it requires gcloud authentication).

### 2.2: Test Cloud SQL Connection

```bash
# Try a connection test through cloud-sql-proxy
ACTIVE_DB_URL=$(grep '^DATABASE_URL=' .env | head -1 | cut -d= -f2-)
psql "$ACTIVE_DB_URL" -c "SELECT 1" 2>&1
```

If the connection fails, check in order:
1. **cloud-sql-proxy not running** → start it (see 2.1)
2. **Wrong credentials** → check the user/password in DATABASE_URL against Cloud SQL config
3. **Wrong database name** → verify the database exists: `psql "$ACTIVE_DB_URL" -l`
4. **gcloud auth expired** → `gcloud auth application-default login`

### 2.3: Fix Database Issues

Common fixes (apply as needed):

**cloud-sql-proxy not running**:
```bash
# Start the proxy (requires gcloud auth)
cloud-sql-proxy "policing-apps:asia-southeast1:policing-db-v2" --port 15435 --gcloud-auth &
sleep 3
lsof -ti:15435 && echo "Proxy started" || echo "Proxy failed to start"
```

**gcloud auth expired**:
```bash
gcloud auth application-default login
```

**Database doesn't exist on Cloud SQL**:
```bash
# List available databases
psql "$ACTIVE_DB_URL" -l 2>/dev/null
```

### 2.4: Verify Migrations are Applied

```bash
# Check if key tables exist
psql "$(cat .env | grep '^DATABASE_URL=' | cut -d= -f2-)" -c "\dt" 2>&1 | head -30

# If tables are missing, run migrations
# Check for migration runner in package.json
cat <api-dir>/package.json | python3 -c "
import json,sys
pkg = json.load(sys.stdin)
scripts = pkg.get('scripts', {})
for k,v in scripts.items():
    if 'migrat' in k.lower():
        print(f'  {k}: {v}')
"
```

If migrations haven't been run:
```bash
npm run migrate --workspace=<api-dir> 2>&1
# Or the specific migration command for this project
```

**Gate: Database must be connectable and have required tables before starting the API.**

---

## Phase 3: Port Conflicts — Kill Stale Processes

**WHY**: Previous dev server sessions often leave zombie processes on the required ports. The API silently fails with EADDRINUSE, or Vite auto-increments to a different port, breaking the frontend→API proxy.

### 3.1: Identify Required Ports

```bash
# API port (from .env or app source)
API_PORT=$(rg "PORT.*=.*[0-9]{4}" .env 2>/dev/null | head -1 | grep -oE '[0-9]{4}')
echo "API port: ${API_PORT:-3001}"

# Frontend port (from vite.config)
rg "port:" <app-dir>/vite.config.* 2>/dev/null
```

### 3.2: Kill Stale Processes

```bash
# Kill anything on the API port
API_PORT=${API_PORT:-3001}
PIDS=$(lsof -ti:$API_PORT 2>/dev/null)
if [ -n "$PIDS" ]; then
  echo "Killing stale processes on port $API_PORT: $PIDS"
  echo "$PIDS" | xargs kill -9
fi

# Kill anything on the frontend port
FE_PORT=<detected-frontend-port>
PIDS=$(lsof -ti:$FE_PORT 2>/dev/null)
if [ -n "$PIDS" ]; then
  echo "Killing stale processes on port $FE_PORT: $PIDS"
  echo "$PIDS" | xargs kill -9
fi
```

Wait 2 seconds, then verify ports are free:

```bash
lsof -ti:$API_PORT 2>/dev/null && echo "STILL IN USE" || echo "FREE"
lsof -ti:$FE_PORT 2>/dev/null && echo "STILL IN USE" || echo "FREE"
```

---

## Phase 4: Start Dev Servers

### 4.1: Start API Server

```bash
# Start API in background (uses the dev script defined in <api-dir>/package.json)
cd <project-root>
npm run dev --workspace=<api-dir> &

# Wait for startup (up to 15 seconds)
for i in $(seq 1 15); do
  sleep 1
  if curl -sf http://localhost:$API_PORT/health >/dev/null 2>&1; then
    echo "API ready on port $API_PORT"
    break
  fi
  if [ $i -eq 15 ]; then
    echo "API FAILED TO START — check logs above"
  fi
done
```

**Common API startup failures:**

| Error | Root Cause | Fix |
|-------|-----------|-----|
| `createXxx is not a function` | Stale package dist/ | Rebuild packages (Phase 1) |
| `EADDRINUSE` | Port in use | Kill stale process (Phase 3) |
| `ECONNREFUSED` on DB | Database not running | Start PostgreSQL (Phase 2) |
| `FATAL: JWT_SECRET must be set` | Missing .env var | Add to .env |
| `relation "xxx" does not exist` | Migrations not run | Run migrations (Phase 2.4) |
| `column "xxx" does not exist` | Migration schema mismatch | Check migration SQL vs actual schema |

### 4.1.1: Verify API is Running (if `ui-only`)

When `ui-only` is passed, the API is NOT started by this skill. Verify it is already running before proceeding:

```bash
if ! curl -sf http://localhost:$API_PORT/health >/dev/null 2>&1; then
  echo "BLOCKER: API is not running on port $API_PORT."
  echo "Start the API first, or re-run without ui-only."
  echo "Expected: curl http://localhost:$API_PORT/health returns 200"
  # STOP — do not proceed to frontend startup
fi
echo "API confirmed running on port $API_PORT"
```

**Gate: If the API health check fails, stop and report the blocker. The frontend will not function without a running API.**

### 4.2: Start Frontend Dev Server (if not `api-only`)

```bash
npm run dev --workspace=<app-dir> &

# Wait for Vite to report the URL
sleep 5
# Vite prints: Local: http://localhost:XXXX/
```

**NOTE**: If the configured port is in use, Vite auto-increments (5174 → 5175 → 5176...). Record the ACTUAL port from Vite's output — this is what you'll report to the user.

---

## Phase 5: Authentication Verification

**WHY**: Auth is the most common point of failure. Cookie-based auth, token-based auth, header-based auth — each has different requirements. A misconfigured auth flow makes every subsequent test return 401.

### 5.1: Find Working Credentials

```bash
# Check seed/migration files for test users
rg -n "INSERT INTO.*user" <api-dir>/src/ --glob '*.{ts,sql}' -i | head -10
rg -n "password.*:" <api-dir>/src/ --glob '*.{ts,sql}' -i | grep -v node_modules | head -10

# Check for dev/test credentials in .env or config
rg "TEST_USER|DEFAULT_PASSWORD|ADMIN_USER" .env <api-dir>/src/ 2>/dev/null | head -5

# Check seed scripts
rg -rn "login.*officer|password.*123|test.*user" <api-dir>/src/ --glob '*.{ts,sql}' -i | head -10
```

### 5.2: Test Login via API

```bash
# Try login with discovered credentials
LOGIN_RESPONSE=$(curl -s -c /tmp/cookies.txt http://localhost:$API_PORT/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"login":"<discovered-user>","password":"<discovered-password>"}')
echo "Login response: $(echo $LOGIN_RESPONSE | head -c 500)"
```

Check the response for:
- **Token in body**: `{"token": "eyJ..."}` → header-based auth
- **Set-Cookie header**: `puda_auth=eyJ...` → cookie-based auth
- **Error**: `{"error": "INVALID_CREDENTIALS"}` → wrong credentials, try others

### 5.3: Verify Auth Propagation

```bash
# Test an authenticated endpoint using the auth method discovered above

# If cookie-based:
curl -s -b /tmp/cookies.txt http://localhost:$API_PORT/api/v1/<any-protected-endpoint> | head -c 500

# If token-based:
curl -s http://localhost:$API_PORT/api/v1/<any-protected-endpoint> \
  -H "Authorization: Bearer $TOKEN" | head -c 500
```

Expected: 200 with data. If 401, check:
- Cookie path and domain
- Token expiration
- Middleware order (auth middleware registered before routes?)

### 5.4: Frontend Auth Check

If testing a frontend app, verify the UI can authenticate:

```bash
# Check that the frontend's API base URL points to the running API
rg "apiBaseUrl|API_URL|VITE_API" <app-dir>/src/ --glob '*.{ts,tsx}' | head -5

# Verify the frontend sends credentials with fetch calls
rg 'credentials.*include|withCredentials' <app-dir>/src/ --glob '*.{ts,tsx}' | head -10
```

**Known issue**: If the app uses cookie-based auth (HttpOnly cookies), ALL fetch calls must include `credentials: "include"`. Missing this causes silent 401 failures — the request succeeds from curl (with `-b cookies.txt`) but fails from the browser.

---

## Phase 6: Route and Integration Verification

**WHY**: Routes can return 404 (wrong path), 401 (auth middleware conflict), 403 (role check mismatch), or 500 (runtime error) even when the code compiles fine.

### 6.1: Public vs Protected Route Conflicts

```bash
# Find public route definitions
rg "PUBLIC_ROUTES|public.*route|skip.*auth" <api-dir>/src/ --glob '*.{ts,js}' | head -20

# Find route prefix patterns that skip auth
rg "PUBLIC_ROUTE_PREFIXES|public.*prefix" <api-dir>/src/ --glob '*.{ts,js}' | head -10
```

**Known issue**: If auth middleware skips all routes under a prefix (e.g., `/api/v1/config/*`), then routes registered under that prefix NEVER get `request.authUser` populated. Any route that needs auth must NOT be under a public prefix.

Verify: no protected route is accidentally under a public prefix.

### 6.2: User Object Shape Mismatch

```bash
# How does auth middleware set the user?
rg "request\.(authUser|user|auth)\s*=" <api-dir>/src/ --glob '*.{ts,js}' | head -5

# How do route handlers read the user?
rg "request\.(authUser|user|auth)" packages/ --glob '*.{ts,js}' | head -20
```

**Known issue**: Generic packages (api-core) may reference `request.user`, but app-specific middleware sets `request.authUser`. Route factories must accept a `getUser` parameter to bridge this gap.

### 6.3: Role/Permission Check Mismatch

```bash
# What roles does the app use?
rg "system_role_ids|role_key|userType|roles" <api-dir>/src/ --glob '*.{ts,js}' | head -20

# What roles do route guards check for?
rg "isAdmin|adminRoles|ADMIN|SUPER_ADMIN" packages/ --glob '*.{ts,js}' | head -20
```

**Known issue**: Generic `isAdmin()` checks for `["ADMIN", "SUPER_ADMIN"]` but PUDA officers have role IDs like `["CLERK", "SDO", "SENIOR_ASSISTANT"]`. The admin role list must match the app's actual role structure:
- Flat `roles[]` array
- Nested `postings[].system_role_ids[]` (array of arrays)
- `userType` field

### 6.4: Test Key API Endpoints

```bash
# Health
curl -sf http://localhost:$API_PORT/health && echo " Health: OK"

# Dashboard/main data endpoint (authenticated)
curl -s -b /tmp/cookies.txt http://localhost:$API_PORT/api/v1/dashboard | head -c 300

# Feature-specific endpoints (from the feature being tested)
# Test 2-3 endpoints specific to the developed feature
```

For each endpoint, verify:
- HTTP status is 200 (not 401, 403, 404, 500)
- Response contains actual data (not empty `{}` or `[]`)
- No SQL errors in API logs (check for "column X does not exist", "relation does not exist", "invalid input syntax")

### 6.5: Database Schema Accuracy

```bash
# Check API logs for SQL errors
# If the feature uses LLM-generated SQL or dynamic queries, verify column names match actual schema

# List actual table columns for key tables
psql "$DATABASE_URL" -c "\d <table_name>" 2>/dev/null | head -20
```

**Known issue**: Schema descriptions passed to LLMs for SQL generation must exactly match actual column names. Wrong column names cause `column "X" does not exist` errors at runtime.

### 6.6: Data Type Mismatches

```bash
# Check for UUID vs TEXT user ID mismatches
rg "UUID|uuid" packages/api-core/src/migrations/ --glob '*.sql' | grep user_id
```

**Known issue**: If migrations define `user_id UUID` but the app uses text-based IDs (e.g., `"test-officer-1"`), inserts fail with `invalid input syntax for type uuid`. Use TEXT for user_id columns when the app doesn't guarantee UUID format.

---

## Phase 7: Feature-Specific Verification

If the user specified a feature to test, validate it end-to-end.

### 7.1: Identify Feature Endpoints and UI Components

Based on the feature description, identify:
- New API routes added
- New UI components/pages added
- New database tables/columns
- New configuration or feature flags

### 7.2: Test Feature API Endpoints

For each new endpoint:
```bash
curl -s -b /tmp/cookies.txt http://localhost:$API_PORT/<endpoint> | head -c 500
```

Verify: 200 response with correct data shape.

### 7.3: Test Feature Flags (if applicable)

```bash
# Check if feature flags are enabled
curl -s http://localhost:$API_PORT/api/v1/assistant/features/status 2>/dev/null | head -c 200

# If flags exist but are disabled, enable them
psql "$DATABASE_URL" -c "UPDATE feature_flag SET enabled = TRUE WHERE flag_key IN ('feature_key_1', 'feature_key_2')" 2>/dev/null
```

### 7.4: Verify Frontend Renders Feature

If the feature has UI components:
```bash
# Check that the feature component is imported and rendered
rg "import.*<FeatureComponent>" <app-dir>/src/ --glob '*.{tsx,ts}' | head -5

# Check for conditional rendering (build flags, feature flags)
rg "VITE_ENABLE|featureFlag|flags\." <app-dir>/src/ --glob '*.{tsx,ts}' | head -10
```

### 7.5: Verify External Service Configuration (if applicable)

If the feature depends on external services (LLM providers, payment gateways, etc.):
```bash
# Check if the service is configured
# For LLM: check for provider config in DB
psql "$DATABASE_URL" -c "SELECT provider, display_name, model_id, is_active FROM llm_provider_config" 2>/dev/null

# For API keys: check .env
rg "API_KEY|SECRET" .env 2>/dev/null | sed 's/=.*/=***/'  # mask values
```

If a required external service isn't configured, seed it:
```bash
# Example: seed an LLM provider
psql "$DATABASE_URL" -c "INSERT INTO llm_provider_config (...) VALUES (...) ON CONFLICT DO NOTHING"
```

---

## Phase 8: Frontend-to-API Integration Check

**WHY**: The frontend and API may each work individually but fail together due to CORS, cookie policy, wrong API URL, or missing `credentials: "include"`.

### 8.1: CORS Configuration

```bash
# Check API CORS settings
rg "cors|Access-Control|origin" <api-dir>/src/ --glob '*.{ts,js}' | head -10

# Verify the frontend origin is allowed
# Frontend runs on http://localhost:XXXX — is that in the CORS allow list?
```

### 8.2: Cookie/Credential Propagation

```bash
# Verify all frontend fetch calls include credentials
rg "fetch\(" <app-dir>/src/ --glob '*.{ts,tsx}' -A 3 | grep -B 1 "credentials" | head -20

# Find fetch calls MISSING credentials
rg "fetch\(" <app-dir>/src/ --glob '*.{ts,tsx}' -l > /tmp/fetch-files.txt
while read f; do
  MISSING=$(python3 -c "
import re
with open('$f') as fh:
    content = fh.read()
fetches = re.findall(r'fetch\([^)]+\)', content, re.DOTALL)
for f in fetches:
    if 'credentials' not in f and 'include' not in f:
        print(f[:100])
" 2>/dev/null)
  if [ -n "$MISSING" ]; then
    echo "MISSING credentials in $f:"
    echo "$MISSING"
  fi
done < /tmp/fetch-files.txt
```

**Known issue**: Cookie-based auth requires `credentials: "include"` on EVERY fetch call. Even one missing fetch causes that specific feature to silently fail with 401.

### 8.3: API Base URL Consistency

```bash
# What URL does the frontend use for API calls?
rg "apiBaseUrl|API_BASE|VITE_API" <app-dir>/src/ --glob '*.{ts,tsx}' | head -5

# Is it pointing to the correct port?
# Must match the actual API port from Phase 4
```

---

## Phase 9: Readiness Report

### 9.1: Summary

Produce the final readiness status:

```text
LOCAL DEPLOYMENT VERIFICATION REPORT
=====================================

App:               <app-dir>
Feature:           <feature-description or "General">
Branch:            <git branch>
Commit:            <git commit hash>

CHECKS:
  Package builds:     [PASS | FAIL]
  Cloud SQL:          [PASS | FAIL — details]
  Database:           [PASS | FAIL — details]
  API startup:        [PASS | FAIL — details]
  Frontend startup:   [PASS | FAIL — details]
  Authentication:     [PASS | FAIL — details]
  Route validation:   [PASS | FAIL — details]
  Feature endpoints:  [PASS | FAIL — details]
  Frontend↔API:       [PASS | FAIL — details]

ISSUES FOUND & FIXED:  <count>
ISSUES REMAINING:      <count>

READY FOR TESTING:     [YES | NO — blockers listed]

ACCESS:
  Frontend URL:   http://localhost:<actual-port>/
  API URL:        http://localhost:<api-port>/
  Login:          <userid> / <password>
  User Type:      <CITIZEN | OFFICER | ADMIN>

FEATURE LOCATION:
  <Where the feature can be found in the UI — menu item, page, button, etc.>

NOTES:
  <Any caveats, limitations, or things to watch for during manual testing>
```

### 9.2: Cleanup Reminder

Remind the user:
- Dev servers are running in the background
- How to stop them: `lsof -ti:<port> | xargs kill`
- If they modify package source, they need to rebuild: `npm run build:<package>`

---

## Appendix: Common Integration Issues Checklist

These are the most frequent issues discovered during local deployment. The phases above cover them, but this serves as a quick reference.

| # | Issue | Root Cause | Fix |
|---|-------|-----------|-----|
| 1 | `createXxx is not a function` | Stale workspace package dist/ | Rebuild: `npm run build:<package>` |
| 2 | `EADDRINUSE` | Previous dev server still running | Kill: `lsof -ti:<port> \| xargs kill -9` |
| 3 | `ECONNREFUSED` on DB queries | cloud-sql-proxy not running or wrong port | Start cloud-sql-proxy on port 15435, verify DATABASE_URL |
| 3a | DATABASE_URL points to local DB | .env has localhost:5432 instead of Cloud SQL :15435 | Switch DATABASE_URL to Cloud SQL connection string |
| 3b | cloud-sql-proxy not running | Proxy process not started or crashed | `cloud-sql-proxy "policing-apps:asia-southeast1:policing-db-v2" --port 15435 --gcloud-auth &` |
| 3c | gcloud auth expired | Application default credentials expired | `gcloud auth application-default login` |
| 4 | 401 on all requests | Cookie auth without `credentials: "include"` | Add to all fetch calls |
| 5 | 401 on public endpoints | Route under public prefix → auth middleware skipped → no user object | Move route out of public prefix, or remove auth check |
| 6 | 403 FORBIDDEN on admin routes | Role names don't match (generic vs app-specific) | Pass app-specific `adminRoles` |
| 7 | `request.user` is undefined | Package reads `request.user`, app sets `request.authUser` | Add `getUser` parameter to route factories |
| 8 | `column "X" does not exist` | Migration schema doesn't match code expectations | Fix migration SQL or code references |
| 9 | `invalid input syntax for type uuid` | Column is UUID but app uses text IDs | Change column type to TEXT |
| 10 | Feature flag not working | Flags disabled in DB or endpoint returns 401 | Enable flags, fix endpoint auth |
| 11 | Vite on wrong port | Configured port in use, Vite auto-incremented | Kill stale process or use actual port |
| 12 | Lockfile out of sync | New workspace not in package-lock.json | `npm install --package-lock-only` |
| 13 | LLM SQL errors | Schema context has wrong column names | Verify schema context against actual DB |
| 14 | Frontend shows but features missing | Build-time flag not set | Set `VITE_ENABLE_XXX=true` in .env |
| 15 | API starts, queries fail silently | DB tables missing — migrations not run | Run migrations |

### Appendix Severity Reference

| Severity | Issues |
|----------|--------|
| P0 | #2 (EADDRINUSE), #3 (ECONNREFUSED), #3a (wrong DB target), #3b (proxy not running), #15 (tables missing) |
| P1 | #1 (stale dist), #4 (401 all requests), #5 (401 public), #6 (403), #7 (user undefined), #8 (column missing), #9 (UUID mismatch) |
| P2 | #10 (feature flag), #11 (wrong port), #13 (LLM SQL), #14 (features missing) |
| P3 | #12 (lockfile sync) |

### Migration Verification

After starting the API, verify all migrations have been applied:

```bash
# Check if key tables exist (substitute actual table names for the target app)
psql "$DATABASE_URL" -c "\dt" 2>/dev/null | head -30

# If using a migration tracking table, check latest migration
psql "$DATABASE_URL" -c "SELECT * FROM migrations ORDER BY id DESC LIMIT 5" 2>/dev/null
# Or check the app-specific migration table name
rg "migrations|migrate" <api-dir>/package.json
```
