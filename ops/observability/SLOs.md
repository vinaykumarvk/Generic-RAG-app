# PUDA API SLOs (Phase-2)

## Scope
- Service: `puda-api`
- Metric source: `/metrics` (Prometheus scrape)
- Window: rolling 30 days (burn-rate alerts evaluate 5m/30m windows)

## SLO Targets
1. Availability SLO: `>= 99.5%`
   - Definition: non-5xx HTTP responses / total responses.
   - PromQL:
     ```promql
     1 - (
       sum(rate(puda_api_http_errors_total[5m]))
       /
       clamp_min(sum(rate(puda_api_http_requests_total[5m])), 1)
     )
     ```

2. Latency SLO (API): `p95 <= 1.5s`, `p99 <= 3.0s`
   - Definition: request latency histogram quantiles.
   - PromQL:
     ```promql
     histogram_quantile(
       0.95,
       sum(rate(puda_api_http_request_duration_seconds_bucket[5m])) by (le)
     )
     ```

3. DB Saturation SLO: waiting clients normally `0`, sustained `> 5` is incident
   - Definition: `puda_api_db_pool_waiting_clients`.

4. Workflow backlog SLO: overdue workflow tasks kept below `25`
   - Definition: `puda_api_workflow_backlog_overdue_tasks`.

## Alert-to-Runbook Mapping
- `PudaApiHighErrorRate` -> `ops/runbooks/auth-outage.md`
- `PudaApiSloErrorBudgetBurnFast` -> `ops/runbooks/auth-outage.md`
- `PudaApiSloErrorBudgetBurnSlow` -> `ops/runbooks/auth-outage.md`
- `PudaApiHighLatencyP95` -> `ops/runbooks/db-degradation.md`
- `PudaApiDbPoolSaturation` -> `ops/runbooks/db-degradation.md`
- `PudaApiWorkflowOverdueBacklog` -> `ops/runbooks/workflow-stuck-states.md`
- `PudaApiAuthLoginFailuresSpike` -> `ops/runbooks/auth-outage.md`
