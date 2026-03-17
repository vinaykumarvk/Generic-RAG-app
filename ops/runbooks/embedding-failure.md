# Embedding Generation Failures

## Symptoms

- Documents stuck in `EMBEDDING` status and not progressing to `SEARCHABLE`
- Chunks exist in the `chunk` table but have `NULL` embedding vectors
- Worker logs show errors calling the Ollama `/api/embed` endpoint
- Vector similarity search returns no results for recently ingested documents
- The `ingestion_job` table has `step = 'EMBED'` jobs in `FAILED` or `PROCESSING` status

## Severity

**Page** -- Without embeddings, documents cannot be searched via semantic retrieval. This directly impacts the core RAG functionality. Treat as critical if more than 10 documents are affected or if the failure is ongoing.

## Diagnosis

### Step 1: Count stuck embedding jobs

```sql
-- Jobs stuck or failed at the EMBED step
SELECT status, COUNT(*) AS job_count,
       MIN(created_at) AS oldest,
       MAX(updated_at) AS newest
FROM ingestion_job
WHERE step = 'EMBED'
  AND status IN ('PROCESSING', 'FAILED', 'RETRYING')
GROUP BY status;
```

### Step 2: Count chunks with null embeddings

```sql
-- Chunks that should have embeddings but do not
SELECT d.workspace_id, d.document_id, d.title, d.status,
       COUNT(*) FILTER (WHERE c.embedding IS NULL) AS null_embeddings,
       COUNT(*) AS total_chunks
FROM chunk c
JOIN document d ON d.document_id = c.document_id
WHERE d.status IN ('EMBEDDING', 'SEARCHABLE', 'KG_EXTRACTING', 'ACTIVE')
GROUP BY d.workspace_id, d.document_id, d.title, d.status
HAVING COUNT(*) FILTER (WHERE c.embedding IS NULL) > 0
ORDER BY null_embeddings DESC;
```

### Step 3: Check total null embedding count across the system

```sql
SELECT COUNT(*) AS total_null_embeddings
FROM chunk
WHERE embedding IS NULL;
```

### Step 4: Verify the Ollama embedding endpoint

```bash
# Test the embed endpoint directly
docker compose exec ollama curl -s -X POST http://localhost:11434/api/embed \
  -d '{"model":"nomic-embed-text","input":["test embedding generation"]}' | jq '.embeddings | length'

# If the above returns 0 or errors, check if the model is loaded
docker compose exec ollama ollama list
```

### Step 5: Check if the embedding model is available

```bash
# List loaded models -- look for nomic-embed-text
docker compose exec ollama ollama list | grep -i embed

# Check Ollama logs for model load errors
docker compose logs --tail=300 ollama | grep -iE "error|nomic|embed|load"
```

### Step 6: Check worker connectivity to Ollama

```bash
# From the worker container, verify it can reach Ollama
docker compose exec worker curl -sf http://ollama:11434/api/tags > /dev/null && echo "OK" || echo "UNREACHABLE"

# Check worker logs for embedding-related errors
docker compose logs --tail=300 worker | grep -iE "embed|vector|dimension|ollama"
```

### Step 7: Verify embedding dimensions match the schema

```sql
-- The chunk table expects vector(768). Confirm the model produces 768-dim vectors.
-- If there is a dimension mismatch, inserts will fail silently or error.
SELECT atttypmod
FROM pg_attribute
WHERE attrelid = 'chunk'::regclass AND attname = 'embedding';
-- Expected: 768 (stored as atttypmod - 4 internally, but this confirms the column exists)
```

## Resolution

### Immediate actions

1. **Pull or reload the embedding model** if it is not loaded:

   ```bash
   docker compose exec ollama ollama pull nomic-embed-text
   ```

2. **Restart Ollama** if the embed endpoint is unresponsive:

   ```bash
   docker compose restart ollama

   # Wait for startup and verify
   sleep 15
   docker compose exec ollama curl -s http://localhost:11434/api/tags | jq '.models[].name'
   ```

3. **Restart the worker** to re-poll failed jobs:

   ```bash
   docker compose restart worker
   ```

4. **Reset failed embedding jobs** for re-processing:

   ```sql
   -- Reset FAILED embed jobs to PENDING
   UPDATE ingestion_job
   SET status = 'PENDING',
       attempt = 0,
       started_at = NULL,
       locked_until = NULL,
       error_message = NULL,
       updated_at = now()
   WHERE step = 'EMBED'
     AND status IN ('FAILED', 'PROCESSING')
     AND started_at < now() - INTERVAL '10 minutes';

   -- Also reset the corresponding documents back to EMBEDDING status
   UPDATE document
   SET status = 'EMBEDDING', updated_at = now()
   WHERE status = 'FAILED'
     AND document_id IN (
       SELECT document_id FROM ingestion_job
       WHERE step = 'EMBED' AND status = 'PENDING'
     );
   ```

### Root cause fixes

1. **Embedding model not persisted**: If Ollama loses the model on restart, ensure the volume is mounted correctly:

   ```bash
   # Verify the volume mount
   docker compose exec ollama ls -la /root/.ollama/models/
   ```

2. **Dimension mismatch**: If the embedding model produces a different dimension than 768 (e.g., you switched models), you must either:

   a. Switch back to a 768-dimension model (nomic-embed-text produces 768)

   b. Or alter the chunk table and rebuild the HNSW index:

   ```sql
   -- CAUTION: This drops all existing embeddings. Only do this if switching models entirely.
   ALTER TABLE chunk ALTER COLUMN embedding TYPE vector(<NEW_DIM>);
   DROP INDEX IF EXISTS idx_chunk_embedding;
   CREATE INDEX idx_chunk_embedding ON chunk
     USING hnsw (embedding vector_cosine_ops)
     WITH (m = 16, ef_construction = 200);
   ```

3. **Memory pressure on Ollama**: The embedding model may fail to load if Ollama is already loaded with a large chat model. Check and potentially unload the chat model temporarily:

   ```bash
   # Check loaded models and their sizes
   docker compose exec ollama ollama ps
   ```

4. **Worker batch size too large**: If the worker sends too many chunks in a single embed request, reduce the batch size:

   Set `WORKER_BATCH_SIZE=1` in the worker environment to isolate the issue, then gradually increase.

## Prevention

- **Startup verification**: On worker startup, verify the embedding endpoint returns a valid response before accepting jobs
- **Health check for embedding model**: Periodically call `/api/embed` with a test string and confirm the response has the expected dimension count
- **Monitor null embedding ratio**: Alert when the ratio of `chunk.embedding IS NULL` to total chunks exceeds 1% for documents in ACTIVE or SEARCHABLE status
- **Pin embedding model version**: Use a specific model tag (e.g., `nomic-embed-text:v1.5`) rather than `latest` to prevent unexpected dimension changes

## Related Alerts

- `IntelliRagApiHighErrorRate` -- embedding failures may cascade into API errors when search returns no results
- `IntelliRagApiWorkflowOverdueBacklog` -- stuck embedding jobs block the document workflow
