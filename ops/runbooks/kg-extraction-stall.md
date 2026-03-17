# KG Extraction Pipeline Stalls

## Symptoms

- Documents remain stuck in `KG_EXTRACTING` status for longer than expected (typically > 5 minutes per document)
- The knowledge graph is not growing: no new `graph_node` or `graph_edge` rows are being created
- Users report that recently ingested documents are "Searchable" but not "Active"
- Worker logs show repeated KG extraction timeouts or Ollama connection errors
- The `ingestion_job` table has jobs with `step = 'KG_EXTRACT'` stuck in `PROCESSING` status

## Severity

**Warning** -- Documents are already searchable (embeddings exist), but the knowledge graph will not reflect new content. Elevate to **Page** if the backlog exceeds 50 documents or if KG-dependent features (graph traversal, entity linking) are user-facing and broken.

## Diagnosis

### Step 1: Identify stuck KG extraction jobs

```sql
-- Jobs stuck in KG_EXTRACT for more than 10 minutes
SELECT j.job_id, j.document_id, j.status, j.attempt, j.max_attempts,
       j.error_message, j.started_at,
       now() - j.started_at AS age,
       d.title, d.workspace_id
FROM ingestion_job j
JOIN document d ON d.document_id = j.document_id
WHERE j.step = 'KG_EXTRACT'
  AND j.status IN ('PROCESSING', 'RETRYING')
  AND j.started_at < now() - INTERVAL '10 minutes'
ORDER BY j.started_at ASC;
```

### Step 2: Count documents stuck in KG_EXTRACTING

```sql
SELECT workspace_id, COUNT(*) AS stuck_count,
       MIN(updated_at) AS oldest_stuck
FROM document
WHERE status = 'KG_EXTRACTING'
GROUP BY workspace_id
ORDER BY stuck_count DESC;
```

### Step 3: Check worker container health

```bash
# Check if the worker container is running
docker compose ps worker

# View recent worker logs (last 200 lines)
docker compose logs --tail=200 worker

# Check worker memory and CPU usage
docker stats intellirag-worker --no-stream
```

### Step 4: Verify Ollama is responsive and the chat model is loaded

```bash
# Health check
docker compose exec ollama curl -s http://localhost:11434/api/tags | jq '.models[].name'

# Test the chat model used for KG extraction (default: qwen3:35b)
docker compose exec ollama curl -s -X POST http://localhost:11434/api/chat \
  -d '{"model":"qwen3:35b","messages":[{"role":"user","content":"Reply OK"}],"stream":false}' | jq '.message.content'

# Check Ollama container resource usage (GPU/memory)
docker stats intellirag-ollama --no-stream
```

### Step 5: Check for Ollama OOM or model load failures

```bash
# Look for out-of-memory or model load errors in Ollama logs
docker compose logs --tail=500 ollama | grep -iE "error|oom|killed|panic|fail|out of memory"
```

### Step 6: Verify graph node creation rate

```sql
-- Check recent graph node creation (should show steady flow)
SELECT date_trunc('hour', created_at) AS hour,
       COUNT(*) AS nodes_created
FROM graph_node
WHERE created_at > now() - INTERVAL '24 hours'
GROUP BY hour
ORDER BY hour DESC;
```

## Resolution

### Immediate actions

1. **Restart the worker** to clear any deadlocked processing threads:

   ```bash
   docker compose restart worker
   ```

2. **Reset stuck jobs** so they can be re-polled by the worker:

   ```sql
   -- Reset stuck KG_EXTRACT jobs to PENDING for re-processing
   UPDATE ingestion_job
   SET status = 'PENDING',
       started_at = NULL,
       locked_until = NULL,
       error_message = 'Reset: KG extraction stall detected',
       updated_at = now()
   WHERE step = 'KG_EXTRACT'
     AND status = 'PROCESSING'
     AND started_at < now() - INTERVAL '10 minutes';
   ```

3. **If Ollama is unresponsive**, restart it and verify model availability:

   ```bash
   docker compose restart ollama

   # Wait for Ollama to be ready, then verify the model
   sleep 10
   docker compose exec ollama ollama list
   ```

4. **If the model is not loaded**, pull it explicitly:

   ```bash
   docker compose exec ollama ollama pull qwen3:35b
   ```

### Root cause fixes

1. **Ollama memory pressure**: If the chat model is too large for available memory, switch to a smaller model:

   ```sql
   UPDATE llm_provider_config
   SET model_id = 'qwen3:8b',
       updated_at = now()
   WHERE provider = 'ollama' AND is_default = TRUE;
   ```

2. **Worker crash loop**: Check if the worker is restarting repeatedly. If so, review error logs and fix the underlying code or configuration issue.

3. **Timeout too aggressive**: If KG extraction consistently times out for large documents, increase the LLM timeout:

   ```sql
   UPDATE llm_provider_config
   SET timeout_ms = 120000,
       updated_at = now()
   WHERE provider = 'ollama' AND is_default = TRUE;
   ```

4. **Skip KG for backlog recovery**: If the backlog is critical and users need documents to be ACTIVE, skip KG extraction for stuck documents:

   ```sql
   -- Move stuck documents directly to ACTIVE (skipping KG)
   UPDATE document
   SET status = 'ACTIVE', updated_at = now()
   WHERE status = 'KG_EXTRACTING'
     AND updated_at < now() - INTERVAL '30 minutes';

   -- Mark the corresponding jobs as completed
   UPDATE ingestion_job
   SET status = 'COMPLETED', completed_at = now(), updated_at = now(),
       error_message = 'Skipped: manual recovery'
   WHERE step = 'KG_EXTRACT'
     AND status IN ('PROCESSING', 'PENDING', 'RETRYING')
     AND document_id IN (
       SELECT document_id FROM document WHERE status = 'ACTIVE'
     );
   ```

## Prevention

- **Monitor job age**: Alert when any `KG_EXTRACT` job has been in `PROCESSING` for more than 15 minutes
- **Worker health endpoint**: Ensure the worker exposes a health check that the orchestrator monitors
- **Ollama readiness probe**: Add a periodic check that Ollama responds to `/api/tags` before dispatching KG jobs
- **Batch size limits**: Ensure `WORKER_BATCH_SIZE` is not so high that the worker overwhelms Ollama with concurrent requests
- **Dead-letter threshold**: Jobs exceeding `max_attempts` (default 3) should be moved to FAILED with an alert

## Related Alerts

- `IntelliRagApiWorkflowOverdueBacklog` -- may fire if KG stall causes document workflow backlog
- `IntelliRagApiHighLatencyP95` -- Ollama slowness may also affect API-side LLM calls
