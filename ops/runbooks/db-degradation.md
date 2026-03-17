# Database Performance Degradation

## Symptoms

- `IntelliRagApiHighLatencyP95` alert firing: p95 latency exceeds 1.5 seconds for 10 minutes
- `IntelliRagApiDbPoolSaturation` alert firing: pool waiting clients sustained above 5
- Grafana "DB Pool Saturation" panel shows rising `waiting` count
- Grafana "HTTP Latency Quantiles" panel shows p95/p99 spiking
- Users experience slow page loads, search timeouts, or hanging requests
- API logs show connection timeout or pool exhaustion errors

## Severity

**Page** for sustained pool saturation (> 5 waiting clients for > 5 minutes) or p95 latency above 1.5 seconds. These directly violate the 99.5% availability SLO.

## Diagnosis

### Step 1: Confirm database health

```bash
# Is PostgreSQL responding?
docker compose exec postgres pg_isready -U intellirag

# Check container resource usage
docker stats intellirag-postgres --no-stream
```

### Step 2: Inspect active connections and their states

```sql
-- Connection state distribution
SELECT state, COUNT(*) AS count,
       MAX(now() - state_change) AS max_age
FROM pg_stat_activity
WHERE datname = 'intellirag'
GROUP BY state
ORDER BY count DESC;
```

### Step 3: Find long-running queries

```sql
-- Queries running for more than 5 seconds
SELECT pid, state, query_start,
       now() - query_start AS duration,
       LEFT(query, 200) AS query_preview,
       wait_event_type, wait_event
FROM pg_stat_activity
WHERE datname = 'intellirag'
  AND state = 'active'
  AND query_start < now() - INTERVAL '5 seconds'
ORDER BY query_start ASC;
```

### Step 4: Check for lock contention

```sql
-- Blocked queries and what is blocking them
SELECT blocked.pid AS blocked_pid,
       blocked.query AS blocked_query,
       blocking.pid AS blocking_pid,
       blocking.query AS blocking_query,
       now() - blocked.query_start AS blocked_duration
FROM pg_stat_activity blocked
JOIN pg_locks bl ON bl.pid = blocked.pid AND NOT bl.granted
JOIN pg_locks gl ON gl.locktype = bl.locktype
  AND gl.database IS NOT DISTINCT FROM bl.database
  AND gl.relation IS NOT DISTINCT FROM bl.relation
  AND gl.page IS NOT DISTINCT FROM bl.page
  AND gl.tuple IS NOT DISTINCT FROM bl.tuple
  AND gl.pid != bl.pid
  AND gl.granted
JOIN pg_stat_activity blocking ON blocking.pid = gl.pid
WHERE blocked.datname = 'intellirag';
```

### Step 5: Check for idle-in-transaction connections (connection leaks)

```sql
-- Connections stuck in 'idle in transaction' state
SELECT pid, state, query_start, state_change,
       now() - state_change AS idle_duration,
       LEFT(query, 200) AS last_query
FROM pg_stat_activity
WHERE datname = 'intellirag'
  AND state = 'idle in transaction'
  AND state_change < now() - INTERVAL '1 minute'
ORDER BY state_change ASC;
```

### Step 6: Check connection pool headroom

```sql
-- Current vs max connections
SELECT
  (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS max_connections,
  (SELECT COUNT(*) FROM pg_stat_activity WHERE datname = 'intellirag') AS active_connections,
  (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') -
  (SELECT COUNT(*) FROM pg_stat_activity WHERE datname = 'intellirag') AS available;
```

### Step 7: Check table bloat and vacuum status

```sql
-- Table sizes and dead tuple counts for core tables
SELECT schemaname, relname,
       n_live_tup, n_dead_tup,
       CASE WHEN n_live_tup > 0
         THEN round(100.0 * n_dead_tup / n_live_tup, 1)
         ELSE 0 END AS dead_pct,
       last_vacuum, last_autovacuum, last_analyze
FROM pg_stat_user_tables
WHERE relname IN ('document', 'chunk', 'ingestion_job', 'graph_node', 'graph_edge',
                  'workspace', 'user_account', 'audit_log', 'model_prediction_log')
ORDER BY n_dead_tup DESC;
```

### Step 8: Check pgvector HNSW index health

```sql
-- Verify HNSW indexes exist and get their size
SELECT indexrelid::regclass AS index_name,
       pg_size_pretty(pg_relation_size(indexrelid)) AS index_size,
       idx_scan, idx_tup_read
FROM pg_stat_user_indexes
WHERE indexrelid::regclass::text LIKE '%embedding%'
   OR indexrelid::regclass::text LIKE '%hnsw%';

-- Check the chunk table size and embedding column usage
SELECT pg_size_pretty(pg_total_relation_size('chunk')) AS chunk_table_total,
       pg_size_pretty(pg_relation_size('chunk')) AS chunk_table_data,
       (SELECT COUNT(*) FROM chunk) AS total_chunks,
       (SELECT COUNT(*) FROM chunk WHERE embedding IS NOT NULL) AS chunks_with_embeddings;
```

### Step 9: Check disk I/O and table scan patterns

```sql
-- Tables with high sequential scans (missing indexes or bad queries)
SELECT schemaname, relname,
       seq_scan, seq_tup_read,
       idx_scan, idx_tup_fetch,
       CASE WHEN seq_scan > 0
         THEN round(seq_tup_read::numeric / seq_scan, 0)
         ELSE 0 END AS avg_seq_rows
FROM pg_stat_user_tables
WHERE seq_scan > 100
ORDER BY seq_tup_read DESC
LIMIT 10;
```

## Resolution

### Immediate actions

1. **Kill long-running queries** that are blocking others:

   ```sql
   -- Terminate queries running longer than 2 minutes
   SELECT pg_terminate_backend(pid)
   FROM pg_stat_activity
   WHERE datname = 'intellirag'
     AND state = 'active'
     AND query_start < now() - INTERVAL '2 minutes'
     AND pid != pg_backend_pid();
   ```

2. **Kill idle-in-transaction connections** (connection pool leaks):

   ```sql
   SELECT pg_terminate_backend(pid)
   FROM pg_stat_activity
   WHERE datname = 'intellirag'
     AND state = 'idle in transaction'
     AND state_change < now() - INTERVAL '5 minutes';
   ```

3. **Restart the API** to reset the connection pool if it is in a bad state:

   ```bash
   docker compose restart api
   ```

4. **Increase the connection pool size** temporarily if pool exhaustion is the immediate cause:

   Set `DATABASE_POOL_MAX` (or equivalent) in the API environment. For the `pg` library, this is typically controlled by the pool configuration in code. If environment-driven:

   ```bash
   # Edit docker-compose.yml to add: DATABASE_POOL_MAX: "30"
   docker compose up -d api
   ```

5. **Increase PostgreSQL max_connections** if the total connection count is near the limit:

   ```bash
   docker compose exec postgres psql -U intellirag -c "ALTER SYSTEM SET max_connections = 200;"
   docker compose restart postgres
   ```

### Root cause fixes

1. **VACUUM ANALYZE on bloated tables**:

   ```sql
   VACUUM ANALYZE chunk;
   VACUUM ANALYZE ingestion_job;
   VACUUM ANALYZE document;
   VACUUM ANALYZE graph_node;
   VACUUM ANALYZE graph_edge;
   VACUUM ANALYZE audit_log;
   VACUUM ANALYZE model_prediction_log;
   ```

2. **Rebuild HNSW indexes** if vector search is slow or the index is corrupted:

   ```sql
   -- CAUTION: This locks the table during rebuild. Schedule during low-traffic window.
   REINDEX INDEX CONCURRENTLY idx_chunk_embedding;
   REINDEX INDEX CONCURRENTLY idx_graph_node_desc_embedding;
   ```

3. **Tune HNSW index parameters** for better performance:

   ```sql
   -- Increase ef_search for better recall at the cost of latency
   SET hnsw.ef_search = 100;  -- default is 40

   -- Or decrease for faster searches with lower recall
   SET hnsw.ef_search = 20;
   ```

4. **Add missing indexes** if sequential scans are identified:

   ```sql
   -- Example: if queries frequently filter ingestion_job by document_id and status
   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ingestion_job_doc_status
     ON ingestion_job (document_id, status);
   ```

5. **Partition large tables** if the `model_prediction_log` or `audit_log` tables have grown very large:

   ```sql
   -- Check table sizes
   SELECT relname, pg_size_pretty(pg_total_relation_size(relid))
   FROM pg_stat_user_tables
   WHERE relname IN ('model_prediction_log', 'audit_log', 'chunk')
   ORDER BY pg_total_relation_size(relid) DESC;
   ```

6. **Fix embedding dimension mismatch**: If the embedding model was changed and new embeddings have a different dimension, vector comparisons will fail or produce garbage results:

   ```sql
   -- Check for dimension consistency
   SELECT vector_dims(embedding) AS dims, COUNT(*) AS count
   FROM chunk
   WHERE embedding IS NOT NULL
   GROUP BY dims;
   -- All rows should show 768. If not, re-embed mismatched chunks.
   ```

### Workspace-scoped query optimization

Many queries in IntelliRAG are scoped by `workspace_id`. Ensure composite indexes include `workspace_id` as the leading column:

```sql
-- Verify key indexes exist
SELECT indexrelid::regclass, indkey
FROM pg_index
WHERE indrelid IN ('chunk'::regclass, 'document'::regclass, 'graph_node'::regclass)
ORDER BY indexrelid::regclass;
```

## Prevention

- **Autovacuum tuning**: Ensure autovacuum runs frequently enough for high-write tables (`ingestion_job`, `audit_log`, `model_prediction_log`)
- **Connection pool monitoring**: Alert on `intellirag_api_db_pool_waiting_clients > 3` as an early warning
- **Statement timeout**: Set a global statement timeout to prevent runaway queries:

  ```sql
  ALTER DATABASE intellirag SET statement_timeout = '30s';
  ```

- **Idle-in-transaction timeout**: Prevent connection leaks:

  ```sql
  ALTER DATABASE intellirag SET idle_in_transaction_session_timeout = '60s';
  ```

- **Regular REINDEX**: Schedule weekly REINDEX CONCURRENTLY for HNSW indexes during low-traffic windows
- **Log slow queries**: Enable `log_min_duration_statement` to capture slow queries for analysis:

  ```sql
  ALTER SYSTEM SET log_min_duration_statement = 1000;  -- log queries > 1 second
  SELECT pg_reload_conf();
  ```

- **SLO targets**: 99.5% availability, p95 latency below 1.5 seconds

## Related Alerts

- `IntelliRagApiHighLatencyP95` -- primary latency trigger for this runbook
- `IntelliRagApiDbPoolSaturation` -- primary pool saturation trigger for this runbook
- `IntelliRagApiHighErrorRate` -- DB degradation often cascades into 5xx errors; see [api-high-error-rate.md](api-high-error-rate.md)
- `IntelliRagApiSloErrorBudgetBurnFast` / `IntelliRagApiSloErrorBudgetBurnSlow` -- error budget alerts fire when latency causes timeouts
