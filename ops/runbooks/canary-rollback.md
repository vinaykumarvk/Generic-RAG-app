# Cloud Run Canary / Rollback Runbook

## Scope
- Services: `puda-api`, `puda-citizen`, `puda-officer`
- Goal: deploy new revisions safely with partial traffic before full promotion.

## Prerequisites
- `gcloud` authenticated to target project.
- Build image already pushed to registry.
- Operator has `run.admin` and traffic update permissions.

## Canary Deploy
1. Deploy canary (default 10%):
   ```bash
   ./scripts/deploy-cloudrun-canary.sh puda-api gcr.io/<project>/puda-api:<tag> <project> asia-south1 10
   ```
2. Observe metrics/traces during canary window (10-30 minutes):
   - `puda_api_http_errors_total` (5xx ratio)
   - `puda_api_http_request_duration_seconds` (p95/p99)
   - `puda_api_db_pool_waiting_clients`
3. Check logs for elevated `level=error` with matching request IDs.

## Promote to 100%
```bash
gcloud run services update-traffic puda-api \
  --project <project> \
  --region asia-south1 \
  --to-revisions <new_revision>=100
```

## Fast Rollback
1. Identify previous revision:
   ```bash
   gcloud run services describe puda-api \
     --project <project> \
     --region asia-south1 \
     --format='value(status.traffic.revisionName,status.traffic.percent)'
   ```
2. Route 100% back to stable revision:
   ```bash
   gcloud run services update-traffic puda-api \
     --project <project> \
     --region asia-south1 \
     --to-revisions <stable_revision>=100
   ```
3. Record incident summary and affected window in deployment notes.

## Exit Criteria
- 5xx ratio back below SLO threshold.
- p95 latency back within SLO.
- No sustained DB pool saturation.
