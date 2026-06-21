# Deployment Report: police-cases-kb (Web Only)

**Date:** 2026-03-30
**Target:** police-cases-kb web service
**Scope:** Single nginx config fix — `client_max_body_size 250M`

## Preflight

| Field | Value |
|-------|-------|
| Target | police-cases-kb (web frontend) |
| App Type | Frontend (SPA via nginx reverse proxy) |
| Dockerfile | Dockerfile.web (node:20-slim → nginx:1.27-alpine) |
| Cloud Build | cloudbuild-frontend.yaml |
| Cloud Project | policing-apps |
| Cloud Region | asia-southeast1 |
| Commit | 5ff7e11 |
| Branch | main |
| Previous Revision | police-cases-kb-00016-8mg |
| New Revision | police-cases-kb-00017-pzz |

## Root Cause

File uploads on police-case-history.adssoftek.com were failing for files > 1MB because `nginx.web.conf` did not set `client_max_body_size`. Nginx defaults to 1MB, causing `413 Request Entity Too Large` errors before requests reached the Fastify API (which allows 250MB).

## Fix Applied

**File:** `nginx.web.conf:5-6`
**Severity:** P0 (deploy-blocker for upload feature)
**Confidence:** High

Added `client_max_body_size 250M;` to the nginx server block to match Fastify's multipart limit.

## Readiness Scorecard

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 1.1-1.4 | Env vars | PASS | Only `API_UPSTREAM` needed |
| 2.2 | Dockerfile | PASS | Multi-stage, pinned versions, non-root |
| 2.10 | PORT | PASS | nginx listens on 8080 |
| 2.11 | .dockerignore | PASS | Comprehensive |
| 2.13 | Health check | PASS | /health proxied to API |
| 2.14 | Local build | PASS | Vite build 3.28s |

## Cloud Build

- Build ID: `d42d3dd1-18c2-4fa5-8f91-70b4e619cf06`
- Duration: 1m47s
- Image: `asia-southeast1-docker.pkg.dev/policing-apps/policing-apps/police-cases-kb:latest`

## Cloud Sanity

| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| Health | 200 | 200 (3.6s cold start) | PASS |
| Root page | 200 | 200 | PASS |
| Login page | 200 | 200 | PASS |
| SPA routing | 200 | 200 | PASS |
| 404 handling | 200 (SPA) | 200 | PASS |
| Auth proxy | JSON response | 401 (valid error) | PASS |
| **Upload proxy (2MB)** | **NOT 413** | **401 (auth error)** | **PASS** |

The critical upload proxy test confirms: a 2MB request returns 401 (auth required), not 413 (body too large). The fix is live.

## Rollback

```bash
gcloud run services update-traffic police-cases-kb \
  --project policing-apps \
  --region asia-southeast1 \
  --to-revisions police-cases-kb-00016-8mg=100
```

## Final Verdict

```
Preflight:           COMPLETE
Readiness Checks:    6/6 PASS
Code Fixes:          1 fix (P0) in 1 file
Local Docker Build:  SKIPPED (Docker Desktop unavailable)
Cloud Build:         SUCCESS (1m47s)
Cloud Deploy:        SUCCESS
Cloud Sanity:        7/7 PASS
Deployment Status:   DEPLOYED
Service URL:         https://police-cases-kb-809677427844.asia-southeast1.run.app
Rollback Revision:   police-cases-kb-00016-8mg
```
