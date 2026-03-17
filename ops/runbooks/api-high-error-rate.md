# API High Error Rate

## Symptoms

- `IntelliRagApiHighErrorRate` alert firing: 5xx error ratio exceeds 1% for 10 minutes
- `IntelliRagApiSloErrorBudgetBurnFast` alert firing: rapid error budget consumption across 5m/30m windows
- `IntelliRagApiSloErrorBudgetBurnSlow` alert firing: elevated error budget burn across 30m/6h windows
- Users reporting failed API calls, timeouts, or "something went wrong" errors in the web frontend
- Grafana "HTTP Error Rate" panel on the IntelliRAG API Operability dashboard shows a spike

## Severity

**Page** for `IntelliRagApiHighErrorRate` and `IntelliRagApiSloErrorBudgetBurnFast`. **Warning** for `IntelliRagApiSloErrorBudgetBurnSlow`. Escalate to incident if error rate exceeds 5% or persists beyond 15 minutes.

## Diagnosis

### Step 1: Confirm the error rate and identify affected routes

```bash
# Check recent API error logs
docker compose logs --tail=500 api | grep -iE "\"statusCode\":5|\"status\":5|error|ERR"

# Look for the most common error patterns
docker compose logs --tail=1000 api | grep -oP '"route":"[^"]*".*"statusCode":\d+' | sort | uniq -c | sort -rn | head -20
```

### Step 2: Check API container health

```bash
# Is the API container running?
docker compose ps api

# Container resource usage
docker stats intellirag-api --no-stream

# Check restart count
docker inspect intellirag-api --format='{{.RestartCount}}'

# Hit the health endpoint
curl -sf http://localhost:3001/health && echo "HEALTHY" || echo "UNHEALTHY"
```

### Step 3: Check database connectivity

```bash
# Is PostgreSQL healthy?
docker compose exec postgres pg_isready -U intellirag

# Test a simple query from the API perspective
docker compose exec postgres psql -U intellirag -d intellirag -c "SELECT 1;"
```

```sql
-- Check active database connections
SELECT state, COUNT(*) AS count
FROM pg_stat_activity
WHERE datname = 'intellirag'
GROUP BY state;

-- Check for connection limit approaching
SELECT max_conn, used, max_conn - used AS available
FROM (SELECT setting::int AS max_conn FROM pg_settings WHERE name = 'max_connections') mc,
     (SELECT COUNT(*) AS used FROM pg_stat_activity) ua;
```

### Step 4: Check DB pool saturation (from Prometheus or logs)

```bash
# Look for pool exhaustion warnings in API logs
docker compose logs --tail=500 api | grep -iE "pool|connection|timeout|waiting"
```

### Step 5: Check memory and CPU pressure

```bash
# All service resource usage
docker stats --no-stream

# Check if the API is running out of memory (Node.js heap)
docker compose logs --tail=500 api | grep -iE "heap|memory|oom|javascript.*memory"
```

### Step 6: Check for recent deployments

```bash
# When was the API container last started?
docker inspect intellirag-api --format='{{.State.StartedAt}}'

# Check git log for recent changes (if deploying from source)
cd /path/to/intellirag && git log --oneline -10
```

### Step 7: Check Ollama dependency (LLM-dependent routes)

```bash
# Many routes depend on Ollama. If it is down, those routes will 5xx.
docker compose exec ollama curl -sf http://localhost:11434/ && echo "OK" || echo "OLLAMA DOWN"

# Check API logs for LLM-related errors
docker compose logs --tail=500 api | grep -iE "llm|ollama|circuit.breaker|completion.*fail"
```

### Step 8: Check for specific error patterns

```sql
-- Recent audit log errors (if the API logs structured errors to the DB)
SELECT action, resource_type, COUNT(*) AS count
FROM audit_log
WHERE created_at > now() - INTERVAL '1 hour'
  AND details->>'error' IS NOT NULL
GROUP BY action, resource_type
ORDER BY count DESC
LIMIT 10;
```

## Resolution

### Immediate actions

1. **If DB pool saturation** is the cause:

   ```bash
   # Restart the API to reset connections
   docker compose restart api
   ```

   ```sql
   -- Kill idle-in-transaction connections that may be leaking
   SELECT pg_terminate_backend(pid)
   FROM pg_stat_activity
   WHERE datname = 'intellirag'
     AND state = 'idle in transaction'
     AND state_change < now() - INTERVAL '5 minutes';
   ```

2. **If Ollama is down** and causing 5xx on LLM-dependent routes:

   See [ollama-fallback.md](ollama-fallback.md) for Ollama recovery and cloud LLM fallback procedures.

3. **If memory pressure** is causing crashes:

   ```bash
   # Increase the Node.js heap limit
   # In docker-compose.yml, add to api environment:
   #   NODE_OPTIONS: "--max-old-space-size=2048"
   docker compose up -d api
   ```

4. **If a recent deployment caused the regression**, roll back:

   ```bash
   # If using tagged images, revert to the previous tag
   # Edit docker-compose.yml to use the previous image tag, then:
   docker compose up -d api

   # If building from source, revert the code change
   git revert HEAD
   docker compose build api && docker compose up -d api
   ```

5. **If the error is route-specific** (e.g., only `/api/v1/query` is failing):

   - Check if it is an LLM-dependent route (query, answer, entity-detection) -- see Ollama status
   - Check if it is a DB-heavy route (document list, workspace stats) -- see DB diagnostics
   - Check if it is an auth route -- see [auth-outage.md](auth-outage.md)

### Root cause fixes

1. **DB connection leak**: Ensure all database queries use proper connection release (return connection to pool in `finally` blocks)

2. **Unhandled promise rejections**: Check for missing error handlers in Fastify route handlers

3. **Upstream timeout cascade**: If Ollama or external services are slow, the API may accumulate pending requests that exhaust memory or connection pools. Ensure timeouts are configured:

   ```sql
   -- Check LLM provider timeout settings
   SELECT provider, timeout_ms, max_retries
   FROM llm_provider_config
   WHERE is_active = TRUE;
   ```

4. **Request payload too large**: If specific uploads or requests cause crashes, check and enforce body size limits in the Fastify configuration

## Prevention

- **Error budget monitoring**: The slow-burn alert (`IntelliRagApiSloErrorBudgetBurnSlow`) provides early warning before SLO breach
- **Canary deployments**: Use the canary rollback procedure ([canary-rollback.md](canary-rollback.md)) for all production deployments
- **Connection pool monitoring**: Alert on `intellirag_api_db_pool_waiting_clients > 3` as an early warning
- **Health check dependencies**: The `/health` endpoint should verify DB connectivity and Ollama reachability
- **Load testing**: Run load tests (`npm run test:api:load`) before deploying changes to latency-sensitive routes
- **SLO target**: 99.5% availability, p95 latency below 1.5s

## Related Alerts

- `IntelliRagApiHighErrorRate` -- primary trigger for this runbook
- `IntelliRagApiSloErrorBudgetBurnFast` -- fast error budget burn (critical)
- `IntelliRagApiSloErrorBudgetBurnSlow` -- slow error budget burn (warning)
- `IntelliRagApiHighLatencyP95` -- often co-occurs; see [db-degradation.md](db-degradation.md)
- `IntelliRagApiDbPoolSaturation` -- common root cause; see [db-degradation.md](db-degradation.md)
- `IntelliRagApiAuthLoginFailuresSpike` -- if errors concentrate on auth routes; see [auth-outage.md](auth-outage.md)
