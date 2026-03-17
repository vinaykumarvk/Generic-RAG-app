---
name: deploy-app
description: Full deployment pipeline — deployment readiness check, code cleanup, local Docker build & sanity test, GCloud deploy, and cloud sanity verification. Fixes all issues found at each stage before proceeding.
argument-hint: "<app-dir> [phase] [options]"
user_invocable: true
---

# Deploy App Playbook

End-to-end deployment pipeline: readiness audit, code cleanup, Docker build, local sanity testing, GCloud deploy, and cloud verification.

## Scoping

The user MUST specify a target app directory (example: `/deploy-app apps/citizen`).

If the user specifies a phase (example: `/deploy-app apps/citizen docker-test only`), run only that phase.
Valid phase keywords: `preflight`, `readiness`, `cleanup`, `build-verify`, `commit`, `docker-build`, `docker-test`, `cloud-deploy`, `cloud-test`.

If target includes `/`, generate a safe output slug: replace `/` with `-`, remove spaces.

Options the user may append:
- `docker-only` — stop after local Docker sanity check (skip GCloud deploy)
- `cloud-only` — skip local Docker, deploy straight to GCloud (assumes prior local verification)
- `no-commit` — fix issues but do not commit
- `no-cleanup` — skip code cleanup phase (Phase 2.8)
- `dry-run` — run readiness check only, report findings, do not fix or deploy
- `force` — skip user confirmation prompts for non-destructive fixes

If no target is specified, ask the user which app to deploy.

When the user specifies just an app name (e.g., `dopams`, `forensic`, `social-media`), expand it to both `-api` and `-ui` services. For example, `dopams` means deploy both `apps/dopams-api` and `apps/dopams-ui`.

## Operating Rules

- Evidence-first: cite exact files, line numbers, and command output for every finding.
- Separate `confirmed` evidence from `inferred` conclusions.
- Never claim a check passed unless you executed it.
- Fix issues in-place as you find them — do not defer fixes to a later phase unless they depend on an earlier fix.
- After every fix, verify the fix works before moving on.
- If a fix requires a judgment call (multiple valid approaches), ask the user.
- **Max 3 fix-rebuild cycles** per phase to prevent infinite loops. If still failing after 3 attempts, report the blocker and stop.
- Prefer small, reversible fixes; propose phased migration for larger changes.
- Save the deployment readiness report to `docs/reviews/deploy-readiness-{targetSlug}-{YYYY-MM-DD}.md`.
- Log all deployment commands and their outputs in the report.

## Project-Specific Infrastructure

### Service Registry

| Service | Dockerfile | Cloud Run Name | GCloud Project | Region | Custom Domain |
|---------|-----------|----------------|---------------|--------|---------------|
| apps/api | Dockerfile.api | puda-api | puda-489215 | asia-southeast1 | — |
| apps/citizen | Dockerfile.citizen | puda-citizen | puda-489215 | asia-southeast1 | puda.adssoftek.com |
| apps/officer | Dockerfile.officer | puda-officer | puda-489215 | asia-southeast1 | puda-officer.adssoftek.com |
| apps/dopams-api | Dockerfile.dopams-api | dopams-api | policing-apps | asia-southeast1 | — |
| apps/dopams-ui | Dockerfile.dopams-ui | dopams-ui | policing-apps | asia-southeast1 | — |
| apps/forensic-api | Dockerfile.forensic-api | forensic-api | policing-apps | asia-southeast1 | — |
| apps/forensic-ui | Dockerfile.forensic-ui | forensic-ui | policing-apps | asia-southeast1 | — |
| apps/social-media-api | Dockerfile.social-media-api | social-media-api | policing-apps | asia-southeast1 | — |
| apps/social-media-ui | Dockerfile.social-media-ui | social-media-ui | policing-apps | asia-southeast1 | — |

### Custom Domain Proxy Architecture (PUDA)

PUDA citizen and officer apps have custom domains mapped via Cloud Run domain mappings. To avoid third-party cookie issues (see T7), these apps use an **nginx reverse proxy** pattern:

```
Browser → puda.adssoftek.com/api/v1/... → nginx proxy → puda-api-xxx.run.app/api/v1/...
Browser → puda.adssoftek.com/           → nginx serves SPA static files
```

**Key implications for deployment**:
1. `VITE_API_BASE_URL` must be `""` (empty string) — SPA calls `/api/` relative to same origin
2. `apiBaseUrl` in source must use `??` (not `||`) to preserve empty string — see T8
3. `nginx.citizen.conf` and `nginx.officer.conf` must have `/api/` proxy blocks
4. API cookie `SameSite=Strict` is correct (same-origin via proxy)
5. API `ALLOWED_ORIGINS` should still include the custom domains for direct API access

### Cloud SQL

- Instance: `policing-apps:asia-southeast1:policing-db-v2` (PostgreSQL 15, db-f1-micro)
- All API services connect via Cloud SQL socket (not public IP)
- Database URLs stored in Secret Manager (e.g., `dopams-database-url`, `puda-database-url`)
- JWT secrets stored in Secret Manager (e.g., `dopams-jwt-secret`, `puda-jwt-secret`)
- **CRITICAL: `DATABASE_SSL=false` is REQUIRED** for all API services on Cloud Run. Cloud SQL Unix sockets do not support SSL, but `@puda/api-core` defaults to `ssl: { rejectUnauthorized: true }` when `DATABASE_SSL` is unset. Without this, the app crashes with "The server does not support SSL connections".
- **Cloud SQL instances annotation is REQUIRED**: Always include `--add-cloudsql-instances "policing-apps:asia-southeast1:policing-db,policing-apps:asia-southeast1:policing-db-v2"` when deploying API services. Without it, the Unix socket path (`/cloudsql/...`) doesn't exist in the container.

### Cloud Build with Custom Dockerfiles

**CRITICAL**: `gcloud builds submit --tag` does NOT support `--dockerfile`. For Dockerfiles not named `Dockerfile`, use a `--config` cloudbuild YAML:

```bash
# Create a temporary cloudbuild config
cat > /tmp/cloudbuild-<app>.yaml << 'EOF'
steps:
  - name: 'gcr.io/cloud-builders/docker'
    args: ['build', '-f', 'Dockerfile.<app>', '-t', '$_IMAGE', '.']
images: ['$_IMAGE']
EOF

# Submit with substitution for the image tag
gcloud builds submit \
  --config /tmp/cloudbuild-<app>.yaml \
  --substitutions="_IMAGE=asia-southeast1-docker.pkg.dev/policing-apps/policing-apps/<app>:latest" \
  --project policing-apps \
  --region asia-southeast1 \
  --gcs-source-staging-dir="gs://policing-apps_cloudbuild/source" \
  .
```

For UI apps with build args (e.g., `VITE_API_BASE_URL`), add the `--build-arg` to the docker build step:

```yaml
steps:
  - name: 'gcr.io/cloud-builders/docker'
    args: ['build', '-f', 'Dockerfile.<app-ui>', '--build-arg', 'VITE_API_BASE_URL=$_API_URL', '-t', '$_IMAGE', '.']
images: ['$_IMAGE']
```

### Deploy Order for Multi-Service Apps

When deploying an app with both API and UI (e.g., `dopams`):
1. **Build API image first** → deploy API to Cloud Run
2. **Get the API service URL** from the deployment output
3. **Build UI image** with appropriate `VITE_API_BASE_URL` build arg → deploy UI
4. **Verify CORS**: API's `ALLOWED_ORIGINS` must include the UI service URL

**IMPORTANT — Custom domain apps (PUDA citizen/officer)**:
- These apps use nginx reverse proxy (see T7) — `VITE_API_BASE_URL` must be `""` (empty)
- The proxy is configured in `nginx.citizen.conf` / `nginx.officer.conf`
- API URL is hardcoded in the nginx proxy block, NOT baked into the JS bundle
- Deploy order: API first (get URL), update nginx proxy target if URL changed, then build+deploy UI

**Standard apps (DOPAMS, Forensic, Social Media)**:
- These apps use direct API calls — `VITE_API_BASE_URL=<api-cloud-run-url>`
- No nginx proxy needed (no custom domains, no third-party cookie issue)

### Docker Desktop May Not Be Available

If `docker ps` fails with "Cannot connect to Docker daemon":
1. `docker info` may show the client version but the daemon can be down
2. **Do NOT block on local Docker** — skip to `cloud-only` mode
3. Verify the local build passes with `npm run build:<app>` (TypeScript + Vite) instead
4. Use Cloud Build for the Docker build step

### cloud-sql-proxy Authentication

```bash
# Use --gcloud-auth flag (not Application Default Credentials)
cloud-sql-proxy "policing-apps:asia-southeast1:policing-db-v2" --port 15435 --gcloud-auth &

# Then connect
psql "postgresql://puda:Welcome%4001@127.0.0.1:15435/<dbname>"
```

The `GOOGLE_APPLICATION_CREDENTIALS` env var may point to a stale or wrong service account file. Always use `--gcloud-auth` which inherits from `gcloud auth login`.

### Auth Testing

Login endpoints use `username` field (not `login`):
```bash
curl -s $SERVICE_URL/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"password"}'
```

API endpoints require both `Authorization: Bearer $TOKEN` header AND `Cookie: token=$TOKEN`.

### Seed Data Sync

After deploying, if the cloud database has stale/incomplete seed data:
1. Connect via cloud-sql-proxy (see above)
2. Run seed SQL files: `psql -f apps/<app>/scripts/seed-*.sql`
3. Seed files use `ON CONFLICT DO NOTHING` — safe to re-run
4. Some seed files resolve subjects by name (`ILIKE '%name%'`); if names don't match exactly, some inserts will be silently skipped with NOTICE logs

## Quality Bar (Definition of Done)

The deployment is complete only when ALL of these are present:

- Preflight context block with commit hash, tech stack, and constraints.
- Readiness scorecard with evidence for every check.
- Every finding has severity, confidence, and verification result.
- Local Docker build succeeds and container starts.
- Local sanity tests pass (health, auth, core features).
- Cloud deployment succeeds (if not `docker-only`).
- Cloud sanity tests pass (if not `docker-only`).
- Final verdict with service URL.
- Report saved to `docs/reviews/`.

## Severity and Confidence

Use these fields for every finding:

- `Severity`: `P0` (deploy-blocker — app won't start or will crash), `P1` (high — runtime failure under normal use), `P2` (medium — degraded behavior), `P3` (low — cleanup/hardening)
- `Confidence`: `High` (direct evidence), `Medium` (strong inference), `Low` (hypothesis)
- `Status`: `Confirmed`, `Fixed`, `Deferred`, `Not Applicable`

---

## Phase 0: Preflight

Before any checks, establish context:

### 0.1: Environment Discovery

```bash
# Current state
git log --oneline -5
git status --short
git rev-parse HEAD

# Tech stack detection
ls package.json pyproject.toml requirements.txt Cargo.toml go.mod 2>/dev/null

# Docker infrastructure
ls Dockerfile* docker-compose*.yml .dockerignore 2>/dev/null

# Cloud infrastructure
ls deploy*.sh Makefile cloudbuild.yaml app.yaml 2>/dev/null
gcloud config get-value project 2>/dev/null
gcloud config get-value run/region 2>/dev/null
```

### 0.2: Target App Analysis

```bash
# Identify the target app's tech stack
cat <app-dir>/package.json 2>/dev/null | head -30
cat <app-dir>/requirements.txt 2>/dev/null
cat <app-dir>/pyproject.toml 2>/dev/null

# Identify app type: API, frontend, full-stack
ls <app-dir>/src/index.html <app-dir>/index.html <app-dir>/public/ 2>/dev/null  # frontend indicators
ls <app-dir>/src/server.* <app-dir>/src/app.* <app-dir>/src/main.* 2>/dev/null  # backend indicators

# Identify the Dockerfile for this app
ls Dockerfile.<app-slug> Dockerfile 2>/dev/null
```

### 0.3: Monorepo Dependency Graph (if applicable)

For monorepo projects, identify build order:

```bash
# Find workspace dependencies
cat package.json | python3 -c "
import json, sys
pkg = json.load(sys.stdin)
ws = pkg.get('workspaces', [])
print('Workspaces:', ws)
"

# Check if target app depends on local packages
rg '"@puda/|"@[^/]+/' <app-dir>/package.json 2>/dev/null
```

Determine the correct build order. For this monorepo:
`shared → workflow-engine → api-core → api-integrations → <target-app>`

Verify all upstream packages build before the target app.

### 0.4: Existing Deployment State

```bash
# Check if service already exists in Cloud Run
gcloud run services list --platform managed 2>/dev/null | grep <app-slug>

# Get current revision (for rollback reference)
gcloud run services describe <service-name> \
  --platform managed --region <region> \
  --format 'value(status.latestReadyRevisionName)' 2>/dev/null
```

Record the current revision name for rollback purposes.

### Preflight Summary

Output a preflight block:

```text
Target:              <app-dir>
App Type:            [Frontend | API | Full-Stack]
Tech Stack:          [Node/TS | Python | etc.]
Build Tool:          [Vite | tsc | esbuild | webpack | etc.]
Dockerfile:          <path>
Docker Compose:      [Yes (<path>) | No]
Cloud Project:       <project-id>
Cloud Region:        <region>
Current Revision:    <revision-name or "NEW">
Commit:              <hash>
Branch:              <branch>
Build Order:         <dependency chain>
Constraints:         <any env limitations>
```

---

## Phase 1: Environment Variable Audit

**Run this BEFORE other readiness checks — missing env vars cause most deployment failures.**

### 1.1: Discover Required Environment Variables

```bash
# All env var reads in the app
rg -n "process\.env\.\w+|os\.environ\[|os\.getenv\(|import\.meta\.env\.\w+" \
  --glob '*.{ts,tsx,js,jsx,py}' <app-dir>/src | sort -u

# Extract just the variable names
rg -oN "process\.env\.(\w+)" --glob '*.{ts,tsx,js,jsx}' <app-dir>/src | sort -u
rg -oN "os\.environ\[.(\w+).\]|os\.getenv\(.(\w+).\)" --glob '*.py' <app-dir>/ | sort -u
```

### 1.2: Cross-Reference Against Config Sources

Check each discovered env var against:

```bash
# .env files (development)
cat <app-dir>/.env 2>/dev/null
cat <app-dir>/.env.example 2>/dev/null
cat .env 2>/dev/null

# Dockerfile (build-time ARG and runtime ENV)
rg -n "^ARG |^ENV " Dockerfile* 2>/dev/null

# Docker Compose
rg -n "environment:|env_file:" docker-compose*.yml 2>/dev/null

# Cloud Run service config
gcloud run services describe <service-name> \
  --platform managed --region <region> \
  --format 'yaml(spec.template.spec.containers[0].env)' 2>/dev/null
```

### 1.3: Classification

Produce an env var inventory:

| Variable | Required | Default | Dev (.env) | Docker | Cloud Run | Status |
|----------|----------|---------|------------|--------|-----------|--------|
| PORT | Yes | 8080 | | | Auto | |
| DATABASE_URL | Yes | None | | | | |
| ... | | | | | | |

Flag:
- **MISSING**: Required in code but not in deployment config.
- **ORPHAN**: In config but never read by code.
- **HARDCODED**: Value hardcoded instead of using env var.
- **INSECURE**: Secret value committed in `.env` that's tracked by git.

### 1.4: Startup Validation

```bash
# Does the app fail-fast on missing required env vars?
rg -n "throw.*env|exit.*env|required.*env|assert.*env|must.*set" \
  --glob '*.{ts,js,py}' <app-dir>/src -i
```

If no startup validation exists, flag as P1 — the app should crash immediately with a clear error message when required env vars are missing, not fail silently later.

**Gate: All required env vars must be accounted for in the deployment target.**

---

## Phase 2: Deployment Readiness Check

Perform a thorough pre-deployment audit. For each check, record: `PASS`, `FAIL` (with severity and details), or `NOT_APPLICABLE`.

### 2.1: Dependency Completeness

Verify all runtime dependencies are declared:

```bash
# For Node.js apps — find all imports and check against package.json
rg -n "from ['\"]" --glob '*.{ts,tsx,js,jsx}' <app-dir>/src | \
  grep -oP "from ['\"]([^./][^'\"]*)" | sort -u

# For Python apps — check requirements.txt / pyproject.toml
rg -n "^import |^from " --glob '*.py' <app-dir>/ | \
  grep -oP "^(import|from) (\w+)" | sort -u

# Cross-reference: extract package.json dependencies
cat <app-dir>/package.json | python3 -c "
import json, sys
pkg = json.load(sys.stdin)
deps = set(pkg.get('dependencies', {}).keys())
dev = set(pkg.get('devDependencies', {}).keys())
print('Runtime deps:', sorted(deps))
print('Dev-only deps:', sorted(dev - deps))
"
```

Flag:
- **Missing runtime deps** — imported but not in dependencies (only devDependencies, or not listed at all).
- **Phantom deps** — used via transitive dependency but not explicitly declared.
- **Dev deps used at runtime** — e.g., `vite` imported in production code.

For monorepos, also verify workspace package dependencies are declared:
```bash
# Check workspace packages are in dependencies
rg '"@puda/' <app-dir>/package.json
```

### 2.2: Dockerfile Audit

For each Dockerfile associated with the target app:

**Structure and sequencing:**
- Base image pinned to specific version (not `latest`).
- Multi-stage build used (build stage vs production stage).
- COPY order: dependency manifests (package.json, lockfile) BEFORE source code (for layer caching).
- Non-root USER directive present with numeric UID.
- HEALTHCHECK instruction present (or Cloud Run probe configured).

**Dependency installation — CRITICAL:**
- Verify dependency install command does NOT use `--no-deps` flag.
  ```bash
  # BAD: This skips installing dependencies like uvicorn!
  # RUN pip install --no-deps /wheels/*.whl || pip install .
  # The --no-deps flag prevents pip from installing ANY dependencies.
  # If the wheel doesn't exist, the fallback `pip install .` runs,
  # but the || means a partially successful --no-deps install
  # will skip the fallback entirely.

  # GOOD:
  # RUN pip install /wheels/*.whl
  # OR:
  # RUN pip install -r requirements.txt
  ```
- For Node.js: `npm ci --omit=dev` or `npm ci` (NOT `npm install` without lockfile).
- For Python: `pip install -r requirements.txt` (with ALL deps listed, including transitive).
- **CRITICAL**: Ensure the install step does NOT have a fallback that silently skips failures:
  - `|| true` — hides install errors
  - `|| pip install .` — may install from source without the same deps
  - `2>/dev/null` — hides error output
  - `; exit 0` — masks non-zero exit codes

**Port configuration — CRITICAL:**
- `EXPOSE` should match the expected runtime port (usually 8080 for Cloud Run).
- No hardcoded port values in the app code that override `PORT` env var.
  ```bash
  # Check for hardcoded ports
  rg -n "listen\(.*[0-9]{4}" --glob '*.{ts,js,py}' <app-dir>/src
  rg -n "port.*=.*[0-9]{4}" --glob '*.{ts,js,py}' <app-dir>/src

  # Verify PORT env var is used
  rg -n "process\.env\.PORT|os\.environ.*PORT|PORT" --glob '*.{ts,js,py}' <app-dir>/src
  ```

**Entrypoint and paths:**
- CMD/ENTRYPOINT path matches the actual build output location.
- Build output directory in build stage matches COPY source in production stage.
- Working directory (WORKDIR) is consistent between stages.

**Layer caching efficiency:**
- `.dockerignore` excludes: `node_modules`, `dist`, `.git`, `.env*`, `*.md`, test files, docs.
- No unnecessary `RUN` layers that could be combined.
- Package manager cache cleaned after install.

### 2.3: Asset Availability

Verify all referenced static assets exist and are included in the Docker image:

```bash
# Find asset references in code
rg -n "\.(png|jpg|jpeg|svg|gif|ico|woff|woff2|ttf|eot|pdf|mp3|mp4|webp|avif)" \
  --glob '*.{ts,tsx,js,jsx,css,html}' <app-dir>/src

# Check that referenced files exist on disk
# For each referenced asset path, verify the file is present

# Check .dockerignore doesn't exclude needed assets
cat .dockerignore 2>/dev/null
cat <app-dir>/.dockerignore 2>/dev/null

# Verify public/ or assets/ directories exist and have content
ls -la <app-dir>/public/ <app-dir>/src/assets/ 2>/dev/null
```

Flag any asset referenced in code but:
- Missing from the filesystem.
- Excluded by `.dockerignore`.
- Located outside the Docker build context.

### 2.4: Dependency Version Compatibility

Check for version conflicts, outdated packages, and known-bad combinations:

```bash
# Node.js: Check for peer dependency conflicts and missing deps
npm ls --depth=0 2>&1 | grep -i 'ERR\|WARN\|peer\|invalid\|missing'

# Python: Check version compatibility
pip check 2>&1 || true
```

**Known problematic combinations to check:**

| Package A | Package B | Bad Combo | Fix |
|-----------|-----------|-----------|-----|
| `openai<1.66.0` | any | Missing Responses API | Upgrade to `>=1.66.0` |
| `openai==1.12.0` | `httpx>=0.28` | Incompatible httpx | Upgrade openai to latest |
| `vite<5` | `node>=22` | Build failures | Upgrade vite or pin node |
| `react` | `react-dom` | Different versions | Must match exactly |
| `typescript<5` | `@types/node>=20` | Type errors | Upgrade TypeScript |

```bash
# Check OpenAI SDK version if used
rg "openai" <app-dir>/package.json <app-dir>/requirements.txt <app-dir>/pyproject.toml 2>/dev/null

# Check Node version in Dockerfile vs package.json engines
rg "^FROM node:" Dockerfile* 2>/dev/null
rg '"engines"' <app-dir>/package.json 2>/dev/null

# React/ReactDOM version parity
cat <app-dir>/package.json | python3 -c "
import json, sys
pkg = json.load(sys.stdin)
deps = {**pkg.get('dependencies',{}), **pkg.get('devDependencies',{})}
react = deps.get('react', 'N/A')
react_dom = deps.get('react-dom', 'N/A')
if react != react_dom and react != 'N/A':
    print(f'MISMATCH: react={react} react-dom={react_dom}')
else:
    print(f'OK: react={react} react-dom={react_dom}')
" 2>/dev/null
```

### 2.5: Path Mapping Verification

Verify build output → Dockerfile COPY → runtime paths are aligned:

```bash
# Step 1: What does the build tool produce?
# Vite
rg -n "outDir|build\.outDir" --glob 'vite.config.*' <app-dir>/
# TypeScript
rg -n '"outDir"' --glob 'tsconfig*.json' <app-dir>/

# Step 2: What does Dockerfile COPY from the build stage?
rg -n "COPY --from=build|COPY.*dist|COPY.*build" Dockerfile* 2>/dev/null

# Step 3: What does the runtime expect?
rg -n "express\.static|serve-static|sirv|staticFiles|root:" --glob '*.{ts,js}' <app-dir>/src

# Step 4: What does the CMD/ENTRYPOINT reference?
rg -n "^CMD|^ENTRYPOINT" Dockerfile* 2>/dev/null
```

Common mismatches to catch:
- Vite `build.outDir: 'dist'` but Dockerfile copies from `dist/client/`.
- Vite SSR builds to `dist/server/` but CMD references `dist/index.js`.
- TypeScript `outDir: './dist'` but entrypoint is `build/index.js`.
- Static files served from `dist/public/` but copied to `/app/dist/client/`.
- Frontend SPA needs fallback routing but nginx/express not configured for it.

### 2.6: Relative Path Handling

Verify paths work in production (Docker) context, not just dev:

```bash
# Find all file reads with relative paths
rg -n "readFileSync|readFile|createReadStream|readdir" --glob '*.{ts,js}' <app-dir>/src

# Find __dirname / import.meta usage
rg -n "__dirname|__filename|import\.meta\.(url|dirname|env)" --glob '*.{ts,js}' <app-dir>/src

# Find path.join/resolve with relative segments
rg -n "path\.(join|resolve)\(.*'\.\." --glob '*.{ts,js}' <app-dir>/src

# Find CWD-dependent paths
rg -n "process\.cwd\(\)|\./" --glob '*.{ts,js}' <app-dir>/src | grep -v "node_modules\|import "
```

Verify:
- `__dirname` resolves correctly after TypeScript compilation (may change with ESM).
- `import.meta.url` is used instead of `__dirname` for ESM modules.
- No `process.cwd()` assumptions (Docker WORKDIR may differ from dev CWD).
- Relative paths like `./data/config.json` resolve to the correct location inside the container.
- `path.join(__dirname, '../../some-package/')` doesn't work when flattened in Docker.

### 2.7: Duplicate and Conflicting Configuration

```bash
# Check for duplicate keys in JSON configs using a proper detector
python3 -c "
import json, sys, os

class DuplicateKeyDetector(json.JSONDecoder):
    def __init__(self, *args, **kwargs):
        super().__init__(object_pairs_hook=self.check_duplicates, *args, **kwargs)
    def check_duplicates(self, pairs):
        keys = [k for k, v in pairs]
        dupes = [k for k in keys if keys.count(k) > 1]
        if dupes:
            print(f'  DUPLICATE KEYS: {set(dupes)}')
        return dict(pairs)

for f in ['package.json', 'tsconfig.json']:
    fp = os.path.join('$APP_DIR', f)
    if os.path.exists(fp):
        print(f'{f}:')
        try:
            with open(fp) as fh:
                DuplicateKeyDetector().decode(fh.read())
            print('  OK')
        except json.JSONDecodeError as e:
            print(f'  PARSE ERROR: {e}')
" 2>/dev/null

# Check for duplicate env var definitions
rg -n "^[A-Z_]+=" <app-dir>/.env* 2>/dev/null | \
  awk -F'[=:]' '{print $2}' | sort | uniq -c | sort -rn | head -10

# Check for conflicting tsconfig settings
rg -n '"module"|"target"|"moduleResolution"' <app-dir>/tsconfig*.json 2>/dev/null
```

Also check for:
- Conflicting `module` / `target` between `tsconfig.json` and `tsconfig.build.json`.
- Vite config overriding TypeScript config in incompatible ways.
- Duplicate route definitions (same HTTP method + path).
- Conflicting CORS origins across config files.

### 2.8: Code Cleanup (skip if `no-cleanup`)

Focused cleanup of deployment-breaking issues. **Do NOT remove TODO/FIXME comments — those are documentation, not bugs.**

```bash
# Unused variables and imports (TypeScript strict check)
npx tsc --noEmit --noUnusedLocals --noUnusedParameters \
  --project <app-dir>/tsconfig.json 2>&1 | head -80

# Console.log in production code (API/server code — remove or replace with logger)
# Keep console.error/warn — those are intentional
rg -n "console\.log\(" --glob '*.{ts,js}' <app-dir>/src | grep -v test | grep -v __test

# Dead imports (imported but never used)
# Use TypeScript compiler output from above

# References to deleted/renamed files
rg -n "from ['\"]\./" --glob '*.{ts,tsx}' <app-dir>/src | while read line; do
  file=$(echo "$line" | grep -oP "from ['\"](\./[^'\"]+)" | sed "s/from ['\"]//")
  # Check if referenced file exists
done

# Unreachable code after return/throw
rg -n "return.*\n\s+[a-zA-Z]" --multiline --glob '*.{ts,js}' <app-dir>/src | head -20
```

For each confirmed finding:
1. Remove unused variables and imports.
2. Remove or replace `console.log` with structured logger in server code. Leave `console.log` in frontend code if it's in error handlers.
3. Remove dead code blocks (code after unconditional return/throw).
4. Remove broken imports that reference non-existent files.
5. **Verify each removal doesn't break the build** before proceeding to next.

### 2.9: Vite / Build Tool Production Issues

Check for build-tool-specific production problems:

```bash
# Is vite imported in production code? (it should only be a devDependency)
rg -n "from ['\"]vite['\"]|require\(['\"]vite['\"]" --glob '*.{ts,js}' <app-dir>/src
rg -n "import.*from.*vite" --glob '*.{ts,js}' <app-dir>/dist 2>/dev/null

# Check if vite is in dependencies vs devDependencies
cat <app-dir>/package.json | python3 -c "
import json, sys
pkg = json.load(sys.stdin)
deps = pkg.get('dependencies', {})
dev = pkg.get('devDependencies', {})
for tool in ['vite', 'vitest', 'eslint', 'prettier', '@vitejs/plugin-react']:
    if tool in deps:
        print(f'P0: {tool} is in dependencies — must be devDependencies only')
    elif tool in dev:
        print(f'OK: {tool} is in devDependencies')
"

# Check for SSR/server entry that imports vite at runtime
rg -n "createServer|createViteServer|loadSsrModule" --glob '*.{ts,js}' <app-dir>/src

# Check that build output is self-contained (no dynamic imports of source files)
ls <app-dir>/dist/ 2>/dev/null | head -20
```

Ensure:
- Build tools (`vite`, `vitest`, `eslint`, `prettier`) are devDependencies only.
- Production build output doesn't `import` or `require` vite.
- SSR entry point uses the built bundle, not vite's dev server.
- `import.meta.env` variables are statically replaced at build time (not runtime).

### 2.10: Cloud Run PORT Compliance

```bash
# The app MUST use PORT env var (Cloud Run injects it, defaults to 8080)
rg -n "process\.env\.PORT|os\.environ.*PORT|os\.getenv.*PORT" \
  --glob '*.{ts,js,py}' <app-dir>/src

# Check for hardcoded port that IGNORES the env var
rg -n "\.listen\(" --glob '*.{ts,js,py}' <app-dir>/src -A 2
rg -n "port\s*[:=]\s*[0-9]{4}" --glob '*.{ts,js,py}' <app-dir>/src
```

The app MUST:
- Read `PORT` from environment variable: `const port = process.env.PORT || 8080`
- Default to `8080` (Cloud Run default) if `PORT` is not set.
- NOT hardcode a port that ignores the `PORT` env var.
- Bind to `0.0.0.0` (not `127.0.0.1` or `localhost`) — Cloud Run requires this.

```bash
# Check bind address
rg -n "listen\(.*localhost|listen\(.*127\.0\.0\.1|host.*localhost|host.*127" \
  --glob '*.{ts,js,py}' <app-dir>/src
```

### 2.11: Docker Include/Exclude Audit

```bash
# Read .dockerignore
echo "=== Root .dockerignore ==="
cat .dockerignore 2>/dev/null || echo "MISSING — create one!"

echo "=== App .dockerignore ==="
cat <app-dir>/.dockerignore 2>/dev/null || echo "None (using root)"

# Find runtime data files (JSON, YAML, SQL, etc.)
rg -n "readFileSync.*\.(json|yaml|yml|sql|csv)|require\(.*\.json|import.*\.json" \
  --glob '*.{ts,js}' <app-dir>/src

# Find locale/i18n files used at runtime
rg -n "locales|i18n|translations" --glob '*.{ts,tsx,js}' <app-dir>/src | head -10
ls <app-dir>/src/locales/ 2>/dev/null

# Check if service-packs or config directories are needed at runtime
rg -n "service-packs|workflow\.json|config/" --glob '*.{ts,js}' <app-dir>/src | head -10
```

Verify:
- Runtime JSON/YAML/config files are NOT excluded by `.dockerignore`.
- Locale files are included (for i18n apps).
- `service-packs/` directory is included if referenced at runtime.
- These ARE excluded: `node_modules/`, `.git/`, `.env*`, `*.md`, `docs/`, `test/`, `__tests__/`, `.claude/`.
- **Missing `.dockerignore`** is a P1 finding — the entire repo becomes build context, slowing builds dramatically.

### 2.12: CORS and Cross-Origin Configuration

If deploying a frontend app that calls an API, or an API that serves a frontend:

```bash
# Find CORS configuration
rg -n "cors|Access-Control|allowedOrigins|origin:" --glob '*.{ts,js,py,yaml,yml}' <app-dir>/src

# Check for hardcoded localhost in CORS
rg -n "localhost|127\.0\.0\.1" --glob '*.{ts,js}' <app-dir>/src | grep -i "cors\|origin\|allow"

# Check frontend API base URL configuration
rg -n "API_URL|API_BASE|VITE_API|BACKEND_URL|BASE_URL" --glob '*.{ts,tsx,js}' <app-dir>/src
```

Verify:
- CORS origins include the production frontend URL (not just localhost).
- Frontend API base URL uses an env var (not hardcoded localhost).
- For Cloud Run: the API allows the frontend's `*.run.app` domain.
- Credentials mode and allowed headers are appropriate.

### 2.13: Container Health Check

```bash
# Does Dockerfile have a HEALTHCHECK?
rg -n "HEALTHCHECK" Dockerfile* 2>/dev/null

# Does the app have a health endpoint?
rg -n "/health|/healthz|/readyz|/livez" --glob '*.{ts,js,py}' <app-dir>/src

# For Cloud Run: startup probe configured?
rg -n "startupProbe|livenessProbe" cloudbuild.yaml app.yaml 2>/dev/null
```

If no health endpoint exists, flag as P1 and create one. A minimal health endpoint should:
- Return 200 with `{"status":"ok"}`.
- Optionally check database connectivity.
- Be lightweight (no expensive queries).
- Be unauthenticated (load balancer needs to reach it).

### 2.14: Local Build Verification

After making all fixes from 2.1–2.13, verify the build:

```bash
# Step 1: Build upstream dependencies first (monorepo)
npm run build:shared 2>&1 | tail -5
npm run build:workflow-engine 2>&1 | tail -5
# ... other upstream packages as needed

# Step 2: Build the target app
npm run build:<app-name> 2>&1

# Step 3: TypeScript type check (if applicable)
npx tsc --noEmit --project <app-dir>/tsconfig.json 2>&1

# Step 4: Run tests (if available)
npm run test:<app-name> 2>&1 | tail -30
```

**Gate: Build must succeed. If it fails, diagnose and fix, then re-run. Max 3 attempts — if still failing, stop and report the blocker.**

### Readiness Scorecard

| # | Check | Severity | Status | Evidence |
|---|-------|----------|--------|----------|
| 1.1-1.4 | Environment variables | | | |
| 2.1 | Dependency completeness | | | |
| 2.2 | Dockerfile audit | | | |
| 2.3 | Asset availability | | | |
| 2.4 | Version compatibility | | | |
| 2.5 | Path mapping | | | |
| 2.6 | Relative paths | | | |
| 2.7 | Duplicate config | | | |
| 2.8 | Code cleanup | | | |
| 2.9 | Build tool production | | | |
| 2.10 | Cloud Run PORT | | | |
| 2.11 | Docker include/exclude | | | |
| 2.12 | CORS configuration | | | |
| 2.13 | Health check | | | |
| 2.14 | Local build | | | |

**Gate: All P0 and P1 findings must be fixed. P2/P3 findings may be deferred with user approval.**

---

## Phase 3: Commit Changes (skip if `no-commit`)

After all readiness fixes pass verification:

1. Run `git status` and `git diff --stat` to review all changes.
2. Stage only the files modified for deployment fixes.
3. Create a commit using HEREDOC format:

```bash
git commit -m "$(cat <<'EOF'
Deployment readiness fixes for <app-name>

- <summary of key fixes, one bullet per category>
- Fixes: <count> P0, <count> P1, <count> P2 findings

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

4. Run `git status` to verify commit succeeded.

---

## Phase 4: Local Docker Build and Run

### 4.1: Pre-Build Cleanup

```bash
# Remove any stale containers from previous runs
docker stop <app-name>-test 2>/dev/null
docker rm <app-name>-test 2>/dev/null

# Check Docker daemon is ACTUALLY running (not just the client)
# IMPORTANT: `docker info` shows client info even when daemon is down.
# Use `docker ps` to verify the daemon is reachable.
docker ps 2>&1 | head -3
if [ $? -ne 0 ]; then
  echo "Docker daemon not running — switching to cloud-only mode"
  echo "Will use Cloud Build for Docker image creation"
fi

# Check disk space (Docker builds can be large)
docker system df 2>/dev/null
```

**If Docker daemon is not running**: Skip Phase 4 and Phase 5 entirely. Ensure the local build passed in Phase 2.14 (TypeScript + Vite), then proceed directly to Phase 6 (Cloud Build + Deploy). This is the `cloud-only` path.

### 4.2: Docker Build

```bash
# Build the Docker image with build progress output
docker build \
  -f <Dockerfile> \
  -t <app-name>:local-test \
  --progress=plain \
  . 2>&1
```

If the build fails:
1. Capture the full error output.
2. Diagnose: is it a dependency issue (Phase 2.1/2.4), path issue (Phase 2.5), or Dockerfile issue (Phase 2.2)?
3. Fix the root cause, re-commit if needed, and rebuild.
4. **Max 3 rebuild attempts.**

### 4.3: Docker Run

Determine the required environment variables from Phase 1 and start the container:

```bash
# Build the env var flags from Phase 1 inventory
docker run -d \
  --name <app-name>-test \
  -p <host-port>:8080 \
  -e PORT=8080 \
  -e NODE_ENV=production \
  <additional -e flags for each required env var> \
  <app-name>:local-test

# Wait for startup (check logs for ready signal)
for i in 1 2 3 4 5; do
  sleep 2
  if docker logs <app-name>-test 2>&1 | grep -qi "listening\|ready\|started"; then
    echo "Container ready"
    break
  fi
done

# Verify container is running (not crashed)
docker ps | grep <app-name>-test
if [ $? -ne 0 ]; then
  echo "Container crashed — checking logs:"
  docker logs <app-name>-test 2>&1 | tail -50
fi
```

**For apps that need a database:**

Check if docker-compose exists with a database service:
```bash
# If docker-compose includes DB
docker compose -f docker-compose.yml up -d db 2>/dev/null
# Wait for DB to be ready, then start the app container with network access

# Or if the app can connect to an existing local DB
# Pass DATABASE_URL pointing to host.docker.internal
docker run -d \
  --name <app-name>-test \
  --add-host=host.docker.internal:host-gateway \
  -p <host-port>:8080 \
  -e DATABASE_URL=postgresql://user:pass@host.docker.internal:5432/dbname \
  <app-name>:local-test
```

If no database is available locally, note which sanity tests will be limited and proceed with what's testable.

If the container crashes or fails to start:
1. Check logs: `docker logs <app-name>-test 2>&1`
2. Common crash causes:
   - Missing env var → add to `docker run` command
   - Port already in use → change host port
   - Missing runtime dependency → go back to Phase 2.1
   - File not found → go back to Phase 2.5/2.6
3. Fix, rebuild if needed, and rerun.
4. **Max 3 attempts.**

---

## Phase 5: Local Docker Sanity Testing

Test key features inside the Docker container. Adapt tests to the app type (API, frontend, full-stack).

### 5.1: Health and Connectivity

```bash
# Health endpoint
curl -sf http://localhost:<port>/health && echo " OK" || echo " FAIL"
curl -sf http://localhost:<port>/api/health && echo " OK" || echo " FAIL"

# Root page loads
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:<port>/)
echo "Root: HTTP $HTTP_CODE"
# Expect 200 for frontend, 200 or 404 for API-only

# Response time check (should be < 2s for health)
curl -s -o /dev/null -w "Response time: %{time_total}s\n" http://localhost:<port>/health
```

### 5.2: Authentication

**IMPORTANT**: Check the "Auth Testing" section in Project-Specific Infrastructure for the correct login field name and credentials. The field varies by app (e.g., `"username"` for DOPAMS/Forensic/SocialMedia, `"login"` for PUDA).

```bash
# For API apps — test login endpoint
# Discover the correct login field name first:
rg -n "loginSchema\|LoginBody\|loginBody" <app-dir>/src/ --glob '*.ts' | head -5

LOGIN_RESPONSE=$(curl -s http://localhost:<port>/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"<login-field>":"<test-user>","password":"<test-password>"}')
echo "Login response: $(echo $LOGIN_RESPONSE | head -c 200)"

# Extract token for subsequent tests
TOKEN=$(echo $LOGIN_RESPONSE | python3 -c "import json,sys; print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
if [ -n "$TOKEN" ]; then
  echo "Auth: PASS (token obtained)"
else
  echo "Auth: FAIL (no token in response)"
fi

# For frontend apps — verify login page renders with correct content
curl -sf http://localhost:<port>/login | head -c 500
# Should contain HTML with login form elements, not a blank page or error
```

### 5.3: Core Feature Smoke Tests

Adapt to the specific app being deployed:

**For API apps:**
```bash
# Test 2-3 main endpoints with auth token
# List endpoint (with pagination)
curl -s http://localhost:<port>/api/v1/<resource>?page=1&limit=5 \
  -H "Authorization: Bearer $TOKEN" | python3 -c "
import json,sys
data = json.load(sys.stdin)
print(f'List endpoint: {len(data.get(\"data\",data.get(\"items\",[])))} items')
print(f'Response keys: {list(data.keys())}')
" 2>&1

# Detail endpoint
curl -s http://localhost:<port>/api/v1/<resource>/1 \
  -H "Authorization: Bearer $TOKEN" -o /dev/null -w "Detail: HTTP %{http_code}\n"

# Unauthorized access (should return 401)
curl -s -o /dev/null -w "Unauth: HTTP %{http_code}\n" http://localhost:<port>/api/v1/<resource>
```

**For frontend apps:**
```bash
# Main pages load (check for actual HTML content, not empty body)
for path in "/" "/dashboard" "/login"; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:<port>$path)
  SIZE=$(curl -s http://localhost:<port>$path | wc -c)
  echo "GET $path → HTTP $CODE, ${SIZE}B"
done

# SPA routing works (non-root paths should return index.html, not 404)
curl -s -o /dev/null -w "SPA route: HTTP %{http_code}\n" http://localhost:<port>/some/deep/route
```

### 5.4: Static Asset Serving

```bash
# For frontend apps — verify JS/CSS bundles are served
curl -sf http://localhost:<port>/ | grep -oP 'src="[^"]+\.js"|href="[^"]+\.css"' | head -5

# Try to fetch one of the discovered assets
ASSET=$(curl -sf http://localhost:<port>/ | grep -oP 'src="(/[^"]+\.js)"' | head -1 | tr -d '"' | sed 's/src=//')
if [ -n "$ASSET" ]; then
  CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:<port>$ASSET)
  echo "Asset $ASSET: HTTP $CODE"
else
  echo "No JS assets found in HTML — check build output"
fi

# Check for common asset issues
curl -sf http://localhost:<port>/favicon.ico -o /dev/null -w "Favicon: HTTP %{http_code}\n"
```

### 5.5: Error Handling

```bash
# 404 page (should return proper error, not crash)
curl -s -o /dev/null -w "404 test: HTTP %{http_code}\n" http://localhost:<port>/nonexistent-path-12345

# Check container hasn't crashed after tests
docker ps | grep <app-name>-test || echo "CONTAINER CRASHED during testing"
docker logs <app-name>-test 2>&1 | grep -i "error\|exception\|fatal\|panic" | tail -10
```

### 5.6: Results and Cleanup

Record all results:

| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| Health endpoint | 200 | | |
| Root page | 200 | | |
| Login | Token returned | | |
| List endpoint | 200 + data | | |
| Static assets | 200 | | |
| 404 handling | 404 (not crash) | | |
| Container stable | Running | | |

If any test fails:
1. Check container logs: `docker logs <app-name>-test 2>&1 | tail -50`
2. Diagnose and fix the root cause.
3. Rebuild and retest. **Max 3 cycles.**

```bash
# Cleanup
docker stop <app-name>-test 2>/dev/null
docker rm <app-name>-test 2>/dev/null
# Also stop any docker-compose services started for testing
docker compose down 2>/dev/null
```

**Gate: All sanity tests must pass before proceeding to cloud deployment.**

---

## Phase 6: GCloud Deployment (skip if `docker-only`)

### 6.1: Pre-Deploy Checks

```bash
# Verify gcloud is authenticated and has the right project
gcloud auth list 2>&1
gcloud config get-value project 2>&1
gcloud config get-value run/region 2>&1

# Record current revision for rollback
CURRENT_REV=$(gcloud run services describe <service-name> \
  --platform managed --region <region> \
  --format 'value(status.latestReadyRevisionName)' 2>/dev/null)
echo "Current revision (rollback target): $CURRENT_REV"

# Verify required APIs are enabled
gcloud services list --enabled 2>&1 | grep -E "run|cloudbuild|artifactregistry"
```

If gcloud is not authenticated or project is wrong, ask the user to fix before proceeding.

### 6.2: Deploy to Cloud Run

First, check for an existing deployment script/config:

```bash
# Check for existing deploy configuration
cat deploy.sh cloudbuild.yaml app.yaml Makefile 2>/dev/null | head -50
npm run 2>/dev/null | grep -i deploy
```

If a deployment script exists, use it. Otherwise, follow the two-step approach (build image, then deploy):

**Step 1: Build the image with Cloud Build.**

For this project, Dockerfiles are named `Dockerfile.<app>` (not just `Dockerfile`). Since `gcloud builds submit --tag` does NOT support `--dockerfile`, use a cloudbuild config:

```bash
# Create temp cloudbuild config
cat > /tmp/cloudbuild-<app>.yaml << 'EOF'
steps:
  - name: 'gcr.io/cloud-builders/docker'
    args: ['build', '-f', 'Dockerfile.<app>', '-t', '$_IMAGE', '.']
images: ['$_IMAGE']
EOF

# For UI apps, add --build-arg for VITE_API_BASE_URL:
# args: ['build', '-f', 'Dockerfile.<app-ui>', '--build-arg', 'VITE_API_BASE_URL=$_API_URL', '-t', '$_IMAGE', '.']

gcloud builds submit \
  --config /tmp/cloudbuild-<app>.yaml \
  --substitutions="_IMAGE=<registry>/<app>:latest" \
  --project <project> \
  --region <region> \
  --gcs-source-staging-dir="gs://<project>_cloudbuild/source" \
  .
```

**Step 2: Deploy the image to Cloud Run.**

```bash
gcloud run deploy <service-name> \
  --image "<registry>/<app>:latest" \
  --project <project> \
  --region <region> \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 10 \
  --set-env-vars "NODE_ENV=production,<OTHER_ENV_VARS>" \
  --set-secrets "<SECRET_NAME>=<secret-id>:latest" \
  --quiet \
  2>&1
```

**CRITICAL: Do NOT use `gcloud run deploy --source`** for this project. It only supports a file named `Dockerfile` (no custom names). Always use the two-step build+deploy approach.

**Important Cloud Run flags to verify:**
- `--port`: Must match the port the app listens on (8080 for all apps in this project).
- `--memory`: 512Mi for API apps, 256Mi for UI apps (nginx).
- `--allow-unauthenticated`: All apps in this project are public-facing.
- `--add-cloudsql-instances`: **REQUIRED for all API apps** — `"policing-apps:asia-southeast1:policing-db,policing-apps:asia-southeast1:policing-db-v2"`. Without this, the Cloud SQL Unix socket path doesn't exist and DB connections fail.
- `--cpu-boost`: Recommended for API apps to speed up cold starts (migration runner + app init).
- `--set-env-vars`: Must include at minimum: `NODE_ENV=production,DATABASE_SSL=false,ALLOWED_ORIGINS=<ui-url>`. The `DATABASE_SSL=false` is critical (see Cloud SQL section). The `ALLOWED_ORIGINS` is required — the app crashes on startup without it in production.
- `--set-secrets`: Database URLs, JWT secrets, and API keys from Secret Manager. Known secrets per app:
  - **dopams-api**: `DATABASE_URL=dopams-database-url:latest,JWT_SECRET=dopams-jwt-secret:latest,OPEN_AI_API_KEY=openai-api-key:latest,OPEN_AI_MODEL=dopams-openai-model:latest`
  - **puda-api**: `DATABASE_URL=puda-database-url:latest,JWT_SECRET=puda-jwt-secret:latest`
  - **social-media-api**: `DATABASE_URL=sm-database-url:latest,JWT_SECRET=sm-jwt-secret:latest,OPEN_AI_API_KEY=sm-openai-api-key:latest`
- **Secret Manager gotcha**: If a secret doesn't exist yet, `gcloud run deploy` fails with "Permission denied on secret". You must first `gcloud secrets create <name> --data-file=-` and then `gcloud secrets add-iam-policy-binding <name> --member="serviceAccount:809677427844-compute@developer.gserviceaccount.com" --role="roles/secretmanager.secretAccessor"`.
- For API apps: Verify `ALLOWED_ORIGINS` includes the UI service URL.
- **CORS with commas**: When `ALLOWED_ORIGINS` contains multiple URLs separated by commas, use gcloud's `^##^` delimiter escape: `--set-env-vars "^##^ALLOWED_ORIGINS=https://url1,https://url2"`. Otherwise gcloud interprets the comma as an env var separator.
- UI apps need NO env vars (all config is baked in at build time via `VITE_API_BASE_URL`).

### 6.3: Deployment Verification

```bash
# Get the service URL
SERVICE_URL=$(gcloud run services describe <service-name> \
  --platform managed --region <region> \
  --format 'value(status.url)' 2>&1)
echo "Deployed to: $SERVICE_URL"

# Check deployment status
gcloud run services describe <service-name> \
  --platform managed --region <region> \
  --format 'yaml(status.conditions)' 2>&1

# Check latest revision is serving traffic
gcloud run revisions list --service <service-name> \
  --platform managed --region <region> \
  --limit 3 2>&1
```

### 6.4: Rollback Plan

If deployment fails or cloud sanity tests fail:

```bash
# Rollback to previous revision
gcloud run services update-traffic <service-name> \
  --to-revisions $CURRENT_REV=100 \
  --platform managed --region <region> 2>&1
```

**First-time deployments** (no previous revision exists):

```bash
# Check if this is a first deploy (no existing revisions)
REVISION_COUNT=$(gcloud run revisions list --service <service-name> \
  --platform managed --region <region> --format='value(REVISION)' 2>/dev/null | wc -l)

if [ "$REVISION_COUNT" -le 1 ]; then
  echo "FIRST DEPLOY — no rollback target. Fix forward or delete the service:"
  echo "  gcloud run services delete <service-name> --platform managed --region <region>"
fi
```

For first deploys, there is no previous revision to roll back to. Options:
1. **Fix forward** — identify the issue, fix it, redeploy
2. **Delete the service** — `gcloud run services delete` and start fresh
3. **Set traffic to 0** — `gcloud run services update-traffic --to-revisions=LATEST=0` to prevent access while debugging

Record the rollback command (or first-deploy status) in the report for manual use if needed.

### 6.5: Database Migration Verification (for API apps)

After deploying an API app, verify that the cloud database schema matches what the new code expects:

```bash
# Connect via cloud-sql-proxy
cloud-sql-proxy "<project>:<region>:<instance>" --port 15435 --gcloud-auth &
sleep 3

DB_URL="postgresql://<user>:<pass>@127.0.0.1:15435/<dbname>"

# Check if migration files exist
ls apps/<app>/src/migrations/ apps/<app>/scripts/migrate* 2>/dev/null

# List tables in the database
psql "$DB_URL" -c "\dt" 2>/dev/null | head -30

# Check for missing tables/columns that the new code references
# Extract table names from SQL in the codebase
rg -oN 'FROM\s+"?(\w+)"?' --glob '*.ts' apps/<app>/src/ | sort -u
rg -oN 'INSERT INTO\s+"?(\w+)"?' --glob '*.ts' apps/<app>/src/ | sort -u

# Compare against actual tables
psql "$DB_URL" -c "SELECT tablename FROM pg_tables WHERE schemaname='public'" 2>/dev/null
```

**Common migration issues**:

| Issue | Detection | Fix |
|-------|-----------|-----|
| Missing table | `relation "xxx" does not exist` in API logs | Run migration SQL via cloud-sql-proxy |
| Missing column | `column "xxx" does not exist` in API logs | Add column via ALTER TABLE or run migration |
| Type mismatch | `invalid input syntax for type uuid` | Check column type matches app expectations (TEXT vs UUID) |
| Missing seed data | Queries return 0 rows | Run seed scripts: `psql -f apps/<app>/scripts/seed-*.sql` |

```bash
# Run pending migrations if needed
psql "$DB_URL" -f apps/<app>/src/migrations/<migration>.sql 2>&1

# Verify seed data exists
psql "$DB_URL" -c "SELECT COUNT(*) FROM \"user\"" 2>/dev/null

# Kill cloud-sql-proxy when done
kill %1 2>/dev/null
```

---

## Phase 7: Cloud Sanity Check (skip if `docker-only`)

### 7.1: Service Availability

```bash
# Cold start test (first request may be slow)
time curl -sf -o /dev/null -w "HTTP %{http_code} in %{time_total}s\n" $SERVICE_URL/

# Health endpoint
curl -sf $SERVICE_URL/health && echo " OK" || echo " FAIL"
curl -sf $SERVICE_URL/api/health && echo " OK" || echo " FAIL"

# Multiple requests to verify stability
for i in 1 2 3; do
  curl -sf -o /dev/null -w "Request $i: HTTP %{http_code} in %{time_total}s\n" $SERVICE_URL/
done
```

### 7.2: TLS and Headers

```bash
# TLS verification (Cloud Run provides this automatically)
curl -sI $SERVICE_URL/ | grep -iE "strict-transport|content-security|x-frame|x-content-type"

# Check CORS headers (important for frontend→API communication)
curl -sI -X OPTIONS $SERVICE_URL/api/v1/auth/login \
  -H "Origin: https://your-frontend-domain.run.app" \
  -H "Access-Control-Request-Method: POST" | grep -i "access-control"
```

### 7.3: Authentication on Cloud

**IMPORTANT**: Check the "Auth Testing" section in Project-Specific Infrastructure for the correct field name and credentials. Common mistakes: using `login` instead of `username`, using `admin123` instead of `password`.

```bash
# Test login — use credentials from seed.ts
# For this project: field is "username" (not "login"), password is "password" (not "admin123")
LOGIN_RESPONSE=$(curl -s $SERVICE_URL/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"password"}')
echo "Login: $(echo $LOGIN_RESPONSE | head -c 300)"

# Extract token
TOKEN=$(echo $LOGIN_RESPONSE | python3 -c "
import json,sys
try:
    data = json.load(sys.stdin)
    token = data.get('token','')
    if token:
        print(token)
        print('AUTH: PASS', file=sys.stderr)
    else:
        print('', end='')
        print(f'AUTH: FAIL - response: {json.dumps(data)[:200]}', file=sys.stderr)
except Exception as e:
    print('', end='')
    print(f'AUTH: FAIL - {e}', file=sys.stderr)
" 2>&1)
```

### 7.4: Dashboard and Data Verification

```bash
# For API apps — verify data endpoints return real data
if [ -n "$TOKEN" ]; then
  curl -s $SERVICE_URL/api/v1/dashboard \
    -H "Authorization: Bearer $TOKEN" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    if isinstance(data, dict):
        print(f'Dashboard keys: {list(data.keys())}')
        # Check for actual data vs empty response
        has_data = any(bool(v) for v in data.values() if isinstance(v, (list, dict, int, float)))
        print(f'Has meaningful data: {has_data}')
        if not has_data:
            print('WARNING: Dashboard returned but appears empty')
    elif isinstance(data, list):
        print(f'Dashboard: {len(data)} items')
    else:
        print(f'Unexpected type: {type(data).__name__}')
except json.JSONDecodeError:
    print('FAIL: Response is not valid JSON')
except Exception as e:
    print(f'FAIL: {e}')
" 2>&1
fi

# For frontend apps — verify pages load with content
for path in "/" "/login" "/dashboard"; do
  RESULT=$(curl -s -o /dev/null -w "%{http_code} %{size_download}B %{time_total}s" $SERVICE_URL$path)
  echo "GET $path → $RESULT"
done
```

### 7.5: Error Page Verification

```bash
# 404 should not crash the service
curl -s -o /dev/null -w "404 test: HTTP %{http_code}\n" $SERVICE_URL/nonexistent-12345

# API error format is correct
curl -s $SERVICE_URL/api/v1/nonexistent-12345 | python3 -c "
import json,sys
try:
    data = json.load(sys.stdin)
    print(f'Error format: {list(data.keys())}')
except: print('Non-JSON error response')
" 2>/dev/null
```

### 7.6: Cloud Logs Check

```bash
# Check for errors in Cloud Run logs
gcloud logging read "resource.type=cloud_run_revision AND \
  resource.labels.service_name=<service-name> AND \
  severity>=ERROR" \
  --limit 10 --format json 2>&1 | python3 -c "
import json,sys
try:
    logs = json.load(sys.stdin)
    if logs:
        print(f'Found {len(logs)} error(s) in cloud logs:')
        for log in logs[:5]:
            msg = log.get('textPayload', log.get('jsonPayload', {}).get('message', 'unknown'))
            print(f'  - {str(msg)[:200]}')
    else:
        print('No errors in cloud logs')
except: print('Could not parse cloud logs')
" 2>/dev/null
```

### Cloud Sanity Scorecard

| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| Service deployed | Running | | |
| Cold start | < 10s | | |
| Health endpoint | 200 | | |
| TLS active | Yes | | |
| CORS headers | Present | | |
| Login works | Token returned | | |
| Dashboard data | Non-empty | | |
| Static assets | 200 | | |
| 404 handling | Graceful | | |
| Cloud logs | No errors | | |

**If any cloud sanity check fails:**
1. Check Cloud Run logs: `gcloud logging read ... --limit 50`
2. Diagnose root cause.
3. Fix, re-commit, and redeploy. **Max 3 deploy cycles.**
4. If still failing after 3 attempts, execute rollback (Phase 6.4) and report the blocker.

---

## Output

### Final Deployment Report

Save to `docs/reviews/deploy-readiness-{targetSlug}-{YYYY-MM-DD}.md` with sections:

1. **Preflight Summary** — target, tech stack, commit, constraints, build order
2. **Environment Variable Inventory** — full table from Phase 1
3. **Readiness Audit Scorecard** — all checks with severity, status, and evidence
4. **Fixes Applied** — each fix with file:line, severity, and verification result
5. **Commits Created** — hashes and messages
6. **Local Docker Results** — build output, container logs, sanity test results
7. **Cloud Deployment** — service URL, revision, deployment output
8. **Cloud Sanity Results** — full scorecard from Phase 7
9. **Rollback Information** — previous revision name and rollback command
10. **Final Verdict**

### Final Verdict

```text
Preflight:           [COMPLETE | INCOMPLETE]
Env Var Audit:       [ALL ACCOUNTED | X MISSING]
Readiness Checks:    [X/15 PASS | Y FIXED | Z DEFERRED]
Code Fixes:          [X fixes across Y files]
Local Docker Build:  [PASS | FAIL]
Local Sanity:        [X/7 PASS | Y FAIL]
Cloud Deploy:        [SUCCESS | FAILED | SKIPPED]
Cloud Sanity:        [X/10 PASS | Y FAIL | SKIPPED]
Cloud Logs:          [CLEAN | X ERRORS]
Deployment Status:   [DEPLOYED | DOCKER-VERIFIED | BLOCKED]
Service URL:         <url or N/A>
Rollback Revision:   <revision-name or N/A>
```

Verdict definitions:
- **DEPLOYED**: All phases passed. App is live and verified on cloud. Service URL is active.
- **DOCKER-VERIFIED**: Local Docker tests passed but cloud deploy was skipped (`docker-only` option or cloud deploy failed with rollback).
- **BLOCKED**: One or more phases failed after max retries. Blocker details and recommended next steps listed.

---

## Appendix: Common Post-Deploy Troubleshooting

These are the most frequent issues encountered during and after deployment. The phases above should catch them, but this serves as a quick diagnostic reference when something goes wrong.

### T1: UI Cannot Reach API (Wrong Port / Wrong URL)

**Symptoms**: Frontend loads but shows network errors, CORS errors, or "Failed to fetch" in browser console. All API calls fail.

**Root Causes & Fixes**:

| Cause | How to Detect | Fix |
|-------|--------------|-----|
| `VITE_API_BASE_URL` baked wrong at build time | Inspect the built JS: `curl -s $UI_URL/assets/index-*.js \| grep -o 'https://[^"]*'` — does it point to the correct API URL? | Rebuild UI image with correct `--build-arg VITE_API_BASE_URL=<api-url>`. For PUDA apps with custom domains, use `""` (empty) with nginx proxy — see T7 |
| `VITE_API_BASE_URL` empty but `\|\|` fallback used | JS calls `http://localhost:3001` despite empty build arg | Change `\|\|` to `??` in apiBaseUrl definition — see T8 |
| API not deployed yet when UI was built | UI points to old/nonexistent API URL | Deploy API first, get URL, then build+deploy UI (see Deploy Order) |
| CORS: API doesn't allow UI origin | `curl -sI -X OPTIONS $API_URL/api/v1/auth/login -H "Origin: $UI_URL"` — no `Access-Control-Allow-Origin` | Add UI URL to API's `ALLOWED_ORIGINS` env var, redeploy API |
| Local dev: Vite proxy port mismatch | Frontend calls `/api/v1/...` but proxy target port doesn't match running API | Check `vite.config.ts` proxy target vs actual API port in `.env` |
| Local dev: API on wrong port | `.env` says PORT=3001 but API started on 3002 (EADDRINUSE auto-increment) | Kill stale process on 3001, restart API |

**Quick diagnostic**:
```bash
# Cloud: Check what API URL is baked into the UI
curl -s $UI_URL/ | grep -oP 'https://[^"]+\.run\.app' | sort -u

# Cloud: Verify API CORS allows UI
curl -sI -X OPTIONS "$API_URL/api/v1/auth/login" \
  -H "Origin: $UI_URL" -H "Access-Control-Request-Method: POST" | grep -i access-control

# Local: Check Vite proxy config
rg "proxy|target" <app-dir>/vite.config.* 2>/dev/null
```

### T2: Login Fails (Password / Field Name Mismatch)

**Symptoms**: Login form submits but returns "Invalid credentials", "Validation error", or a 400/401 response.

**Root Causes & Fixes**:

| Cause | How to Detect | Fix |
|-------|--------------|-----|
| Wrong field name (`login` vs `username`) | Login returns validation error: `"body must have required property 'username'"` | Check seed.ts or auth route schema for the correct field name |
| Wrong password | Login returns `{"error":"INVALID_CREDENTIALS"}` | Check `apps/<app>/scripts/seed.ts` for the actual seeded password — it's often `"password"`, not `"admin123"` or `"Password@123"` |
| Password hashed differently | Login returns invalid credentials even with correct plaintext | Check if seed uses bcrypt hash vs plaintext; if hash, the password is whatever was hashed |
| User doesn't exist in DB | Login returns not found or invalid credentials | Run seed script: `psql -f apps/<app>/scripts/seed.ts` or check `SELECT * FROM users LIMIT 5` |
| Auth middleware not registered | Login endpoint returns 404 | Check `app.ts` for auth route registration: `app.register(authRoutes)` |

**Quick diagnostic**:
```bash
# Find the correct field name and test credentials
rg -n "username\|login\|password" apps/<app>/scripts/seed.ts | head -20

# Find the auth schema to see required fields
rg -n "loginSchema\|LoginBody\|loginBody" apps/<app>/src/ --glob '*.ts' | head -10

# Test login with discovered credentials
# Use the correct login field — check Auth Testing section
curl -s $API_URL/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"<login-field>":"<test-user>","password":"<test-password>"}' | head -c 300
```

### T3: Empty Data After Login (Authenticated But No Data)

**Symptoms**: Login succeeds, dashboard/list pages load, but all data sections show "No results", empty tables, or zero counts.

**Decision Tree** — follow in order, stop at first match:

```text
1. Open browser DevTools → Network tab → reload dashboard
   ├─ API calls return 401? → Cookie/token not being sent → check T7 (cross-origin) or credentials: "include"
   ├─ API calls return 403? → User role lacks permission → check role assignment in seed data
   ├─ API calls return 200 with empty data? → Database not seeded or wrong filter → check seed data below
   ├─ API calls return 200 with data but UI empty? → JS error → check Console tab for render errors
   └─ No API calls at all? → API URL wrong → check T1 / T8
```

**Root Causes & Fixes**:

| Cause | How to Detect | Fix |
|-------|--------------|-----|
| Database not seeded | `SELECT COUNT(*) FROM <main_table>` returns 0 | Run seed scripts via cloud-sql-proxy |
| Auth token not sent with API calls | Browser DevTools → Network tab shows 401 on data endpoints | Ensure `credentials: "include"` on all fetch calls, or `Authorization: Bearer` header |
| Cookie not set after login | `document.cookie` is empty after login | Check `Set-Cookie` header has correct `SameSite`, `Secure`, `Domain` attributes |
| Third-party cookie blocked | Login works but data calls return 401; especially in Chrome Incognito | Use nginx reverse proxy so cookie is same-origin — see T7 |
| Role-based filtering returns nothing | Login works but user's role has no data assigned | Check seed data assigns records to the test user's district/unit/role |
| API returns data but UI doesn't render | `curl` with token returns data, but UI shows empty | Check browser console for JS errors; check if UI component expects different response shape |
| CORS blocks data requests (not login) | Login works (simple POST) but GET with custom headers fails | Verify CORS allows `Authorization` header: `Access-Control-Allow-Headers` |
| Database has data but wrong offender_status/status values | All records show "UNKNOWN" or default values | Re-run enrichment seed scripts (e.g., `seed-crime-history.sql`) |

**Quick diagnostic**:
```bash
# Verify data exists in DB (via cloud-sql-proxy)
psql "$DB_URL" -c "SELECT COUNT(*) FROM subject_profile" 2>/dev/null
psql "$DB_URL" -c "SELECT offender_status, COUNT(*) FROM subject_profile GROUP BY offender_status" 2>/dev/null

# Verify API returns data when authenticated
# Use the correct login field — check Auth Testing section
TOKEN=$(curl -s $API_URL/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"<login-field>":"<test-user>","password":"<test-password>"}' | python3 -c "import json,sys; print(json.load(sys.stdin).get('token',''))")

curl -s "$API_URL/api/v1/subjects?page=1&limit=5" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Cookie: token=$TOKEN" | python3 -c "
import json,sys
data = json.load(sys.stdin)
if isinstance(data, dict):
    items = data.get('data', data.get('items', []))
    print(f'Items: {len(items)}, Total: {data.get(\"total\", \"?\")}')
else:
    print(f'Response type: {type(data).__name__}, length: {len(data)}')
"

# If empty, check if seed data exists
psql "$DB_URL" -c "\dt" 2>/dev/null | head -20
```

### T4: Container Crashes on Startup — SSL / Cloud SQL Socket

**Symptoms**: Cloud Run revision fails with "The user-provided container failed to start and listen on the port". Logs show `"The server does not support SSL connections"` or `"FATAL: DATABASE_SSL=false is not allowed in production"`.

**Root Causes & Fixes**:

| Cause | How to Detect | Fix |
|-------|--------------|-----|
| `DATABASE_SSL` not set | Logs: `"The server does not support SSL connections"` — `@puda/api-core` defaults to `ssl: { rejectUnauthorized: true }` | Add `DATABASE_SSL=false` to `--set-env-vars` |
| `DATABASE_SSL=false` but env var prefix mismatch | Logs: `"FATAL: DATABASE_SSL=false is not allowed in production (except Cloud SQL Unix sockets)"` | The SSL safety check in `api-core/db.ts` looks for `${envPrefix}_DATABASE_URL` (e.g., `DOPAMS_DATABASE_URL`) to detect Unix sockets, but Cloud Run secret is mapped to `DATABASE_URL`. Fix: ensure `db.ts` also checks fallback `DATABASE_URL` |
| Cloud SQL instances annotation missing | Logs: `"connect ENOENT /cloudsql/policing-apps:asia-southeast1:policing-db-v2/.s.PGSQL.5432"` | Add `--add-cloudsql-instances "policing-apps:asia-southeast1:policing-db,policing-apps:asia-southeast1:policing-db-v2"` to deploy command |

**Quick diagnostic**:
```bash
# Check revision logs for SSL errors
gcloud logging read "resource.type=cloud_run_revision AND \
  resource.labels.service_name=<service> AND \
  resource.labels.revision_name=<revision>" \
  --limit 20 --format json --project policing-apps 2>&1 | \
  python3 -c "import json,sys; [print(l.get('textPayload','')[:200]) for l in sorted(json.load(sys.stdin), key=lambda x: x.get('timestamp',''))]"

# Verify current env vars on the service
gcloud run services describe <service> --platform managed --region asia-southeast1 \
  --format 'yaml(spec.template.spec.containers[0].env)' 2>&1
```

### T5: Container Crashes on Startup — Missing Secret Manager Secrets

**Symptoms**: Cloud Run deploy fails with `"Permission denied on secret: projects/.../secrets/<name>/versions/latest"`.

**Root Causes & Fixes**:

| Cause | How to Detect | Fix |
|-------|--------------|-----|
| Secret doesn't exist | Error says "Permission denied" but `gcloud secrets describe <name>` returns 404 | Create: `echo -n "value" \| gcloud secrets create <name> --data-file=- --project policing-apps` |
| Secret exists but no IAM binding | `gcloud secrets describe <name>` works but deploy still fails | Grant: `gcloud secrets add-iam-policy-binding <name> --member="serviceAccount:809677427844-compute@developer.gserviceaccount.com" --role="roles/secretmanager.secretAccessor" --project policing-apps` |

**Quick diagnostic**:
```bash
# List all secrets in the project
gcloud secrets list --project policing-apps 2>&1 | grep -i "<keyword>"

# Check if a specific secret exists
gcloud secrets describe <name> --project policing-apps 2>&1

# Check IAM bindings on a secret
gcloud secrets get-iam-policy <name> --project policing-apps 2>&1
```

**Known secrets per service** (create these before first deploy):

| Service | Secret Name | Content |
|---------|-------------|---------|
| dopams-api | `dopams-database-url` | `postgresql://puda:...@/dopams?host=/cloudsql/policing-apps:asia-southeast1:policing-db-v2` |
| dopams-api | `dopams-jwt-secret` | JWT signing secret |
| dopams-api | `openai-api-key` | OpenAI API key (`sk-proj-...`) |
| dopams-api | `dopams-openai-model` | Model name (e.g., `gpt-5.2`) |
| puda-api | `puda-database-url` | PostgreSQL connection string |
| puda-api | `puda-jwt-secret` | JWT signing secret |
| social-media-api | `sm-database-url` | PostgreSQL connection string |
| social-media-api | `sm-jwt-secret` | JWT signing secret |
| social-media-api | `sm-openai-api-key` | OpenAI API key |

### T6: Container Crashes on Startup — Missing ALLOWED_ORIGINS

**Symptoms**: Migrations pass, then app crashes with `"FATAL: ALLOWED_ORIGINS must be set in production"`. The app enforces this check in `buildApp()` before starting the HTTP server.

**Root Cause**: `ALLOWED_ORIGINS` env var is not set on Cloud Run. All API apps require this in production for CORS configuration.

**Fix**:
```bash
# Get the UI service URL
UI_URL=$(gcloud run services describe <app>-ui --platform managed --region asia-southeast1 \
  --format 'value(status.url)' --project policing-apps)

# Deploy with ALLOWED_ORIGINS
gcloud run deploy <app>-api ... --set-env-vars "...,ALLOWED_ORIGINS=$UI_URL"

# If updating an existing service with multiple origins (comma in value):
gcloud run services update <app>-api \
  --update-env-vars "^##^ALLOWED_ORIGINS=https://url1,https://url2" \
  --project policing-apps --region asia-southeast1 --quiet
```

**Important**: The `^##^` prefix tells gcloud to use `##` as the key-value separator instead of `,`, allowing commas inside values.

### Quick Reference: The Big Twelve Checklist

Before declaring a deployment complete, verify all twelve items:

```text
□ T1  — UI→API connectivity: Frontend JS contains correct API URL; CORS allows UI origin
□ T2  — Authentication works: Correct field name + password; token returned in response
□ T3  — Data is visible: At least one list endpoint returns >0 items; dashboard has non-zero counts
□ T4  — Cloud SQL SSL: DATABASE_SSL=false is set; Cloud SQL instances annotation is present
□ T5  — Secrets exist: All --set-secrets references exist in Secret Manager with IAM bindings
□ T6  — ALLOWED_ORIGINS set: API apps have ALLOWED_ORIGINS env var with UI service URL
□ T7  — Cross-origin cookies: SPA uses nginx API proxy (same-origin); no third-party cookie reliance
□ T8  — API URL fallback: ?? (not ||) for VITE_API_BASE_URL to preserve empty string
□ T9  — Dockerfile workspace sync: All @puda/* deps in package.json are in Dockerfile (all 3 stages)
□ T10 — Cloud Build COMMIT_SHA: Manual builds need --substitutions=COMMIT_SHA=<hash>
□ T11 — Cloud Build IAM: Service account may lack run.services.get; use gcloud run deploy directly
□ T12 — GCloud project context: Verify gcloud project matches target (puda-489215 vs policing-apps)
```

If any fails, use the corresponding T1–T12 diagnostic below.

---

### T7: Cross-Origin Cookie Blocking (Third-Party Cookie Problem)

**Symptoms**: Login succeeds (response body contains user data) but dashboard shows no data. All subsequent API calls return 401. Happens especially in Chrome Incognito or browsers with third-party cookie blocking enabled.

**Root Cause**: Frontend SPA is on domain A (`puda.adssoftek.com`) but API is on domain B (`puda-api-xxx.run.app`). The auth cookie is set for domain B. Browsers treat this as a third-party cookie and block it — especially Chrome Incognito which blocks ALL third-party cookies regardless of `SameSite` setting.

**Why `SameSite=None` is NOT sufficient**: Even with `SameSite=None; Secure`, Chrome Incognito and Safari block third-party cookies entirely. This is not a misconfiguration — it's browser privacy policy.

**The Correct Fix — Nginx Reverse Proxy**:

Add an `/api/` proxy block to the frontend's nginx config so all API calls go through the same origin:

```nginx
# In nginx.citizen.conf / nginx.officer.conf
location /api/ {
    proxy_pass https://puda-api-40220923312.asia-southeast1.run.app;
    proxy_set_header Host puda-api-40220923312.asia-southeast1.run.app;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_ssl_server_name on;
    proxy_cookie_path / /;
}
```

With this proxy:
- Browser calls `https://puda.adssoftek.com/api/v1/auth/login` (same origin)
- Nginx proxies to `https://puda-api-xxx.run.app/api/v1/auth/login`
- Cookie is set for `puda.adssoftek.com` (first-party) → always works
- `SameSite=Strict` is correct and secure
- No CORS issues (same origin)

**Build-time requirement**: Set `VITE_API_BASE_URL=""` (empty string) so the SPA calls `/api/v1/...` (relative) instead of an absolute API URL.

**Quick diagnostic**:
```bash
# Check if custom domain has nginx proxy configured
curl -s "https://<custom-domain>/api/v1/config/services" | head -c 100
# If 404 from nginx → proxy not configured
# If JSON response → proxy is working

# Check if cookie is first-party (same domain)
# Use the correct login field — check Auth Testing section and loginSchema in the app's source
curl -sv -c /tmp/test.txt "https://<custom-domain>/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"<login-field>":"<test-user>","password":"<test-password>"}' 2>&1 | grep "Set-Cookie"
# Cookie domain should match the custom domain, NOT the run.app domain
```

**Checklist for PUDA apps with custom domains**:
```text
□ nginx.citizen.conf has location /api/ proxy block
□ nginx.officer.conf has location /api/ proxy block
□ VITE_API_BASE_URL="" (empty) in cloudbuild substitutions
□ apiBaseUrl uses ?? operator (not ||) — see T8
□ API cookie SameSite=Strict (not None — same-origin doesn't need None)
□ API ALLOWED_ORIGINS includes both custom domain AND run.app URL
```

### T8: Empty String Fallback Bug (`||` vs `??` for VITE_API_BASE_URL)

**Symptoms**: SPA deployed with `VITE_API_BASE_URL=""` (for nginx proxy) but browser console shows requests to `http://localhost:3001`. Dashboard shows "Failed to fetch".

**Root Cause**: JavaScript's `||` operator treats empty string as falsy:
```typescript
// BUG: empty string "" is falsy, falls back to localhost
export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";

// FIX: nullish coalescing only falls back on null/undefined
export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";
```

**Files to check**:
```bash
# Find all API base URL definitions
rg "VITE_API_BASE_URL.*\|\|" apps/*/src/ --glob '*.{ts,tsx}'
# Any matches are BUGS — change || to ??
```

**Affected files in this project**:
- `apps/citizen/src/citizen-types.ts` — `apiBaseUrl` definition
- `apps/officer/src/types.ts` — `apiBaseUrl` definition

### T9: Dockerfile Missing Workspace Packages

**Symptoms**: Cloud Build image build fails with `npm ERR! missing: @puda/<package>@^0.1.0` or runtime error `Cannot find module '@puda/<package>'`.

**Root Cause**: A new workspace package was added to the app's `package.json` dependencies, but the Dockerfile was not updated to include it in all three stages (deps, build, production).

**Dockerfiles have THREE stages that ALL need updating**:

1. **Stage 1 (deps)**: `COPY packages/<pkg>/package.json` + add to `npm ci --workspace=` list
2. **Stage 2 (build)**: `COPY packages/<pkg>/tsconfig.json` + `COPY packages/<pkg>/src/` + add to build command
3. **Stage 3 (production)**: `COPY packages/<pkg>/package.json` + add to `npm ci --workspace=` list + `COPY --from=build packages/<pkg>/dist/`

**Quick diagnostic**:
```bash
# Compare app's package.json workspace deps vs Dockerfile COPY lines
APP_DEPS=$(rg '"@puda/' <app-dir>/package.json | grep -oP '@puda/[\w-]+')
echo "App deps: $APP_DEPS"

DOCKERFILE_PKGS=$(grep "COPY packages/" Dockerfile.<app> | grep -oP 'packages/[\w-]+' | sort -u)
echo "Dockerfile packages: $DOCKERFILE_PKGS"

# Any dep in APP_DEPS not in DOCKERFILE_PKGS is a bug
```

### T10: Cloud Build $COMMIT_SHA Empty in Manual Builds

**Symptoms**: `gcloud builds submit --config=cloudbuild-xxx.yaml` fails with `invalid image name "gcr.io/<project>/<app>:"` — note the trailing colon with no tag.

**Root Cause**: `$COMMIT_SHA` is a built-in substitution that Cloud Build auto-populates ONLY when triggered by a source repository trigger (GitHub, Cloud Source). For manual `gcloud builds submit`, it's empty.

**Fix**: Always pass `--substitutions=COMMIT_SHA=<tag>` when using `gcloud builds submit` manually:
```bash
COMMIT_SHA=$(git rev-parse --short HEAD)
gcloud builds submit --config=cloudbuild-<app>.yaml \
  --project=<project> \
  --substitutions=COMMIT_SHA=$COMMIT_SHA
```

### T11: Cloud Build Service Account Lacks Cloud Run Deploy Permission

**Symptoms**: Docker image builds and pushes successfully (Steps 0 and 1 pass), but Step 2 (deploy) fails with `PERMISSION_DENIED: Permission 'run.services.get' denied on resource ... authenticated as <number>-compute@developer.gserviceaccount.com`.

**Root Cause**: The default Compute Engine service account used by Cloud Build doesn't have the `Cloud Run Admin` role in the target project.

**Workaround** (fast): Skip the Cloud Build deploy step and deploy directly:
```bash
# Build image via Cloud Build (steps 0-1 succeed, step 2 fails — that's OK)
gcloud builds submit --config=cloudbuild-<app>.yaml \
  --project=<project> --substitutions=COMMIT_SHA=<tag> --async

# Poll build status until image push completes (steps 0-1)
BUILD_ID=$(gcloud builds list --project=<project> --limit=1 --format='value(ID)')
gcloud builds describe $BUILD_ID --project=<project> --format='value(status)'
# Wait until status is SUCCESS or FAILURE. Steps 0-1 (build+push) must pass.
# Even if step 2 (deploy) fails, the image is pushed and usable.

# Then deploy directly with your auth
gcloud run deploy <service-name> \
  --image=gcr.io/<project>/<app>:<tag> \
  --region=asia-southeast1 \
  --platform=managed \
  --allow-unauthenticated \
  --project=<project>
```

**Permanent fix**: Grant Cloud Run Admin to the build service account:
```bash
PROJECT_NUMBER=$(gcloud projects describe <project> --format='value(projectNumber)')
gcloud projects add-iam-policy-binding <project> \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/run.admin"
gcloud iam service-accounts add-iam-policy-binding \
  ${PROJECT_NUMBER}-compute@developer.gserviceaccount.com \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser" \
  --project=<project>
```

### T12: Wrong GCloud Project Context

**Symptoms**: `gcloud run services list` shows services from a different project, or deploy creates the service in the wrong project.

**Root Cause**: Multiple GCloud projects exist (`policing-apps` for DOPAMS/Forensic/SocialMedia, `puda-489215` for PUDA). The active project may not match the target.

**Project Registry**:

| App | GCloud Project | Project ID |
|-----|---------------|------------|
| PUDA (citizen, officer, api) | PUDA | `puda-489215` |
| DOPAMS (api, ui) | policing-apps | `policing-apps` |
| Forensic (api, ui) | policing-apps | `policing-apps` |
| Social Media (api, ui) | policing-apps | `policing-apps` |

**Always verify before deploying**:
```bash
gcloud config get-value project
# If wrong:
gcloud config set project <correct-project>
```

**Also check cloudbuild YAML files**: Region and API URLs in substitutions must match the actual project:
```bash
# Verify region matches actual services
grep "region" cloudbuild-<app>.yaml
gcloud run services list --project=<project> --format="table(SERVICE,REGION)"
```
