# Runbook: Workflow Stuck / Backlog Growth

## Triggers
- Alert: `PudaApiWorkflowOverdueBacklog`
- User reports: applications not progressing, inbox backlog growth
- Metrics:
  - `puda_api_workflow_backlog_open_tasks` climbing continuously
  - `puda_api_workflow_backlog_overdue_tasks` above threshold

## Immediate Checks (first 10 minutes)
1. Check backlog metrics trend (open vs overdue).
2. Inspect task state distribution:
   - `PENDING`, `IN_PROGRESS`, `COMPLETED`.
3. Check latest deployment and service-pack config changes.

## Diagnosis
1. Validate workflow engine logs for:
   - transition guard failures
   - lock timeout / replay errors
2. Find top blocked states:
   - query tasks grouped by `state_id` and age.
3. Verify officer assignment health:
   - missing assignee postings
   - authority-role mismatches.
4. Verify dependent subsystems:
   - document verification prerequisites
   - fee/payment gates not satisfied.

## Mitigation
1. If assignment drift:
   - fix designation-role mappings and reassign pending tasks.
2. If workflow config regression:
   - rollback affected service version / workflow definition.
3. If specific tasks are deadlocked:
   - perform controlled manual intervention with audit trail.
4. If widespread SLA breach:
   - prioritize oldest overdue tasks and initiate incident bridge.

## Recovery Validation
1. Overdue backlog trending down for 30 minutes.
2. New submissions progress to next expected state within normal SLA.
3. No new guard-failure spikes in logs.

## Follow-up Tasks
1. Add targeted integration tests for the failing state transitions.
2. Add authority-specific backlog dashboards if needed.
3. Document corrective action in incident review and architecture backlog delta.
