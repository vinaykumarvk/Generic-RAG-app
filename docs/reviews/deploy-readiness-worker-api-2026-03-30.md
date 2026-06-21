# Deployment Report: police-cases-kb (API + Worker)

**Date:** 2026-03-30
**Branch:** main
**Commit:** cbbe589 (perf: accelerate document ingestion pipeline)

## Preflight Summary

| Field | Value |
|-------|-------|
| Target | apps/api + apps/worker |
| Project | policing-apps |
| Region | asia-southeast1 |
| Deploy Script | scripts/deploy-police-cases-kb-cloudrun.sh |
| Previous API Rev | police-cases-kb-api-00022-czs |
| Previous Worker Rev | police-cases-kb-worker-00016-9x6 |

## Changes Deployed

### Pipeline Performance Optimizations (apps/worker/)

1. **Concurrent KG extraction** — ThreadPoolExecutor with 8 workers (configurable via `KG_CONCURRENCY`)
2. **Batch chunk INSERTs** — `execute_values` replaces N+1 INSERT loop in chunker
3. **Batch embedding UPDATEs** — `execute_values` replaces N+1 UPDATE loop in embedder
4. **Batch KG node UPSERTs** — single `execute_values` with `fetch=True` for RETURNING
5. **Batch KG edge storage** — pre-fetch node_ids + batch UPSERT (3N queries → 2)
6. **Batch provenance INSERTs** — single `execute_values` call
7. **Trigram-accelerated consolidation** — O(n²) → ~O(n) for large graphs
8. **Default poller threads** — 1 → 4 (Cloud Run override: 3)
9. **Batch node description embedding UPDATEs**

## Deployment Results

| Service | Image Build | Deploy | New Revision | Status |
|---------|-------------|--------|-------------|--------|
| police-cases-kb-api | SUCCESS (2m18s) | SUCCESS | police-cases-kb-api-00023-v4h | Serving 100% |
| police-cases-kb-worker | SUCCESS (2m35s) | SUCCESS | police-cases-kb-worker-00017-jcs | Serving 100% |
| police-cases-kb (web) | SUCCESS (1m52s) | SUCCESS | police-cases-kb-00018-hll | Serving 100% |

## Cloud Sanity Results

| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| API health | 200 | 200 | PASS |
| Web root | 200 | 200 | PASS |
| Web /login | 200 | 200 | PASS |
| Login (admin) | User returned | User returned | PASS |
| Workspaces list | Non-empty | 1 workspace | PASS |
| Documents list | Non-empty | 20 documents | PASS |
| Worker startup | Running | Application startup complete | PASS |
| Worker logs | No errors | Clean (no errors) | PASS |

## Rollback Commands

```bash
gcloud run services update-traffic police-cases-kb-api --project policing-apps --region asia-southeast1 --to-revisions police-cases-kb-api-00022-czs=100
gcloud run services update-traffic police-cases-kb-worker --project policing-apps --region asia-southeast1 --to-revisions police-cases-kb-worker-00016-9x6=100
gcloud run services update-traffic police-cases-kb --project policing-apps --region asia-southeast1 --to-revisions police-cases-kb-00017-pzz=100
```

## Live URLs

- **API:** https://police-cases-kb-api-809677427844.asia-southeast1.run.app
- **Web:** https://police-cases-kb-809677427844.asia-southeast1.run.app
- **Worker:** https://police-cases-kb-worker-809677427844.asia-southeast1.run.app

## Final Verdict

```
Preflight:           COMPLETE
Build Verification:  ALL 3 BUILDS PASS
Cloud Deploy:        SUCCESS (all 3 services)
Cloud Sanity:        8/8 PASS
Cloud Logs:          CLEAN
Deployment Status:   DEPLOYED
```
