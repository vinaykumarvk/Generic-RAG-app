# Runbook: Auth Outage / Login Failure Spike

## Triggers
- Alert: `PudaApiAuthLoginFailuresSpike`
- Alert: `PudaApiHighErrorRate` with concentration on `/api/v1/auth/*`
- User reports: widespread login failure, token rejection, or forced logout loops

## Immediate Checks (first 5 minutes)
1. Confirm scope in dashboard:
   - login failure rate panel
   - route-level 5xx on `/api/v1/auth/login`, `/api/v1/auth/me`
2. Check app logs for:
   - `INVALID_TOKEN`, `AUTHENTICATION_REQUIRED`
   - JWT secret/config errors
3. Check release activity:
   - recent deployment
   - env var changes (`JWT_SECRET`, `JWT_EXPIRES_IN`)

## Diagnosis
1. Validate JWT secret consistency across instances.
2. Validate clock skew:
   - compare API host time vs DB host time (token `iat/exp` issues).
3. Check DB reachability for auth lookups:
   - `SELECT 1`
   - user lookup latency/errors.
4. Confirm no accidental test/dev bypass flags in production (legacy `AUTH_DISABLED` has been removed).

## Mitigation
1. If config drift:
   - roll back to previous known-good env revision.
2. If release regression:
   - roll back service revision immediately.
3. If only login path degraded:
   - temporarily increase replicas and DB connection cap, then investigate root cause.
4. Communicate status in incident channel and user-facing status page.

## Recovery Validation
1. Login failure rate below baseline for 15 minutes.
2. 5xx error rate below SLO threshold.
3. Synthetic login check passes from at least two locations.

## Follow-up Tasks
1. Document root cause and exact bad config/change.
2. Add/adjust guardrail tests for the failing auth path.
3. Add alert suppression window only if false-positive behavior is confirmed.
