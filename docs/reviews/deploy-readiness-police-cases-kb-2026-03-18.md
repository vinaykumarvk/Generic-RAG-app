# Deployment Report: police-cases-kb

**Date:** 2026-03-18
**Commit:** 24c5388 (main)
**Deployer:** Claude Code

## Preflight Summary

| Field | Value |
|-------|-------|
| Target | apps/api + apps/web |
| App Type | Full-Stack (Fastify API + React SPA) |
| Tech Stack | Node 20 / TypeScript / Vite / Tailwind |
| Cloud Project | policing-apps |
| Cloud Region | asia-southeast1 |
| Services | police-cases-kb-api, police-cases-kb |
| Database | Reusing police_kb (shared with police-kb) |
| Build Order | shared → workflow-engine → api-core → api-integrations → api / web |
| Docker | Cloud-only (local Docker daemon unavailable) |

## Services Deployed

| Service | Type | URL | Image | Memory |
|---------|------|-----|-------|--------|
| police-cases-kb-api | Fastify API | https://police-cases-kb-api-809677427844.asia-southeast1.run.app | asia-southeast1-docker.pkg.dev/policing-apps/policing-apps/police-cases-kb-api:latest | 512Mi |
| police-cases-kb | Nginx + SPA | https://police-cases-kb-809677427844.asia-southeast1.run.app | asia-southeast1-docker.pkg.dev/policing-apps/policing-apps/police-cases-kb:latest | 256Mi |

## Files Created

| File | Purpose |
|------|---------|
| `Dockerfile.api` | Multi-stage API build (deps → build → production with dumb-init) |
| `Dockerfile.web` | Multi-stage web build (deps → vite build → nginx:1.27-alpine) |
| `nginx.web.conf` | Nginx config with API proxy, SPA fallback, gzip, asset caching |
| `.dockerignore` | Already existed, verified adequate |

## Fixes Applied

| # | Severity | File | Fix |
|---|----------|------|-----|
| 1 | P0 | apps/api/src/index.ts:175 | Added `PORT` env var support (Cloud Run injects `PORT`, app used `API_PORT` only) |

## Environment Variables

### API (police-cases-kb-api)

| Variable | Source | Value |
|----------|--------|-------|
| NODE_ENV | env var | production |
| DATABASE_SSL | env var | false |
| ALLOWED_ORIGINS | env var | https://police-cases-kb-809677427844.asia-southeast1.run.app |
| DATABASE_URL | Secret Manager | police-cases-kb-database-url:latest |
| JWT_SECRET | Secret Manager | police-cases-kb-jwt-secret:latest |
| Cloud SQL | annotation | policing-apps:asia-southeast1:policing-db,policing-apps:asia-southeast1:policing-db-v2 |

### Web (police-cases-kb)

| Variable | Source | Value |
|----------|--------|-------|
| API_UPSTREAM | env var | https://police-cases-kb-api-809677427844.asia-southeast1.run.app |
| VITE_API_BASE_URL | build arg | "" (empty — uses relative paths via nginx proxy) |

## Cloud Sanity Results

| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| API health | 200 | 200 | PASS |
| Web root loads | 200 + HTML | 200, 492B | PASS |
| JS bundle served | 200 | 200, 276KB | PASS |
| CSS bundle served | 200 | 200, 48KB | PASS |
| SPA /login route | 200 | 200 | PASS |
| SPA /dashboard route | 200 | 200 | PASS |
| SPA /admin route | 200 | 200 | PASS |
| Health via proxy | 200 | 200 | PASS |
| Auth via proxy | Token returned | Token returned | PASS |
| Cloud logs (API) | No errors | No errors | PASS |
| Cloud logs (Web) | No errors | No errors | PASS |

## Credentials

- **Admin:** username=`admin`, password=`Admin123!`
- Bootstrap admin auto-created on first startup

## Rollback

First deploy — no previous revision. To rollback:
```bash
gcloud run services delete police-cases-kb-api --platform managed --region asia-southeast1 --project policing-apps
gcloud run services delete police-cases-kb --platform managed --region asia-southeast1 --project policing-apps
```

## Final Verdict

```
Preflight:           COMPLETE
Env Var Audit:       ALL ACCOUNTED
Readiness Checks:    1 P0 FIXED
Local Docker Build:  SKIPPED (daemon unavailable)
Local Build:         PASS (npm run build:all)
Cloud Build API:     SUCCESS (1m44s)
Cloud Build Web:     SUCCESS (1m46s)
Cloud Deploy:        SUCCESS
Cloud Sanity:        11/11 PASS
Cloud Logs:          CLEAN
Deployment Status:   DEPLOYED
```

| Service | URL |
|---------|-----|
| **Web (SPA)** | https://police-cases-kb-809677427844.asia-southeast1.run.app |
| **API** | https://police-cases-kb-api-809677427844.asia-southeast1.run.app |
