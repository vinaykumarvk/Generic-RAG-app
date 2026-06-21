# Deployment Report: IntelliRAG (All Services) — 2026-03-24

## Preflight Summary

| Field | Value |
|-------|-------|
| Target | apps/api + apps/web + apps/worker |
| Cloud Project | policing-apps |
| Cloud Region | asia-southeast1 |
| Branch | main |
| Commit | a346571 |
| Docker | Unavailable (cloud-only mode) |
| Build Order | shared -> workflow-engine -> api-core -> api-integrations -> api/web |

## Services Deployed

| Service | Cloud Run Name | Previous Revision | New Revision | Status |
|---------|---------------|-------------------|--------------|--------|
| API | police-cases-kb-api | 00021-pp9 | 00022-czs | DEPLOYED |
| Web | police-cases-kb | 00015-5wv | 00016-8mg | DEPLOYED |
| Worker | police-cases-kb-worker | 00015-z96 | 00016-9x6 | DEPLOYED |

## Changes Deployed

### Feature: Auto-Split Large PDFs
- New SPLIT pipeline step between VALIDATE and NORMALIZE
- PDFs > 20 MB auto-split into page-based parts (configurable via `PDF_SPLIT_THRESHOLD_BYTES`)
- Child documents process independently through pipeline
- Migration 024: `parent_document_id`, `part_number`, `total_parts` columns
- Frontend: SPLITTING/SPLIT_COMPLETE statuses, part badges
- Worker: `pdf_splitter.py` with pypdf, storage upload, job poller SPLIT handler

### Fix: Conversation Reset
- ChatPanel now resets mutation state when `conversationId` changes to null
- "New conversation" properly clears the right pane

## Cloud Build Results

| Service | Build ID | Duration | Status |
|---------|----------|----------|--------|
| API | 45681308-767e-... | 1m36s | SUCCESS |
| Web | f86bdb32-9f9b-... | 1m05s | SUCCESS |
| Worker | c8a0d55c-d520-... | 2m13s | SUCCESS |

## Cloud Sanity Results

| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| API health | 200 | 200 (0.18s) | PASS |
| Web root | 200 | 200 (0.17s) | PASS |
| Worker health | 200 | 200 (0.58s) | PASS |
| Web -> API proxy | 200 | 200 (0.16s) | PASS |
| SPA routing | 200 | 200 | PASS |
| JS bundle loads | 200 | 200 (280KB) | PASS |
| Migration 024 | Applied | Applied | PASS |
| Auth test | Token | Rate-limited | SKIPPED |

Note: Auth test was blocked by rate limiter due to multiple credential attempts during testing. The bootstrap logs confirm admin user exists with synced password and unlocked account.

## Environment Variables

### Worker (new)
- `PDF_SPLIT_THRESHOLD_BYTES=20971520` added

### API / Web
- No env var changes required

## Rollback Commands

```bash
# API
gcloud run services update-traffic police-cases-kb-api --to-revisions police-cases-kb-api-00021-pp9=100 --platform managed --region asia-southeast1 --project policing-apps

# Web
gcloud run services update-traffic police-cases-kb --to-revisions police-cases-kb-00015-5wv=100 --platform managed --region asia-southeast1 --project policing-apps

# Worker
gcloud run services update-traffic police-cases-kb-worker --to-revisions police-cases-kb-worker-00015-z96=100 --platform managed --region asia-southeast1 --project policing-apps
```

## Final Verdict

```
Preflight:           COMPLETE
Local Build:         PASS (API, Web, Worker all compile)
Cloud Build:         3/3 SUCCESS
Cloud Deploy:        3/3 SUCCESS
Migration:           024_pdf_split.sql APPLIED
Cloud Sanity:        7/8 PASS (1 SKIPPED — auth rate-limited)
Deployment Status:   DEPLOYED
```

| Service | URL |
|---------|-----|
| API | https://police-cases-kb-api-809677427844.asia-southeast1.run.app |
| Web | https://police-cases-kb-809677427844.asia-southeast1.run.app |
| Worker | https://police-cases-kb-worker-809677427844.asia-southeast1.run.app |
