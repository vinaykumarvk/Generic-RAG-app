# Document Ingestion Pipeline Failures

## Symptoms

- Documents stuck in any processing state: `VALIDATING`, `NORMALIZING`, `CHUNKING`, `EMBEDDING`, or `KG_EXTRACTING`
- Users report uploaded documents that never become searchable or active
- The `ingestion_job` table shows jobs with `status = 'FAILED'` accumulating
- Worker logs show repeated errors for specific pipeline steps
- The document list shows a growing number of documents in non-terminal states

## Severity

**Page** if multiple documents across workspaces are affected and the pipeline is fully stalled. **Warning** if failures are isolated to specific documents or file types.

## Diagnosis

### Step 1: Get the pipeline failure overview

```sql
-- Failures grouped by pipeline step
SELECT step, status, COUNT(*) AS job_count,
       MIN(created_at) AS oldest_failure,
       MAX(updated_at) AS most_recent
FROM ingestion_job
WHERE status IN ('FAILED', 'PROCESSING', 'RETRYING')
GROUP BY step, status
ORDER BY step, status;
```

### Step 2: Identify which step is the bottleneck

```sql
-- Documents stuck in each processing state with age
SELECT status, COUNT(*) AS count,
       MIN(updated_at) AS oldest,
       AVG(EXTRACT(EPOCH FROM (now() - updated_at)))::int AS avg_age_seconds
FROM document
WHERE status IN ('VALIDATING', 'NORMALIZING', 'CHUNKING', 'EMBEDDING', 'KG_EXTRACTING')
GROUP BY status
ORDER BY count DESC;
```

### Step 3: Get error details for failed jobs

```sql
-- Top error messages by frequency
SELECT step, error_message, COUNT(*) AS occurrences
FROM ingestion_job
WHERE status = 'FAILED'
  AND created_at > now() - INTERVAL '24 hours'
GROUP BY step, error_message
ORDER BY occurrences DESC
LIMIT 20;
```

### Step 4: Check failed jobs for specific documents

```sql
-- Full detail for the most recent failures
SELECT j.job_id, j.step, j.status, j.attempt, j.max_attempts,
       j.error_message, j.started_at, j.completed_at,
       d.title, d.file_name, d.mime_type, d.file_size_bytes, d.status AS doc_status
FROM ingestion_job j
JOIN document d ON d.document_id = j.document_id
WHERE j.status = 'FAILED'
  AND j.created_at > now() - INTERVAL '24 hours'
ORDER BY j.updated_at DESC
LIMIT 20;
```

### Step 5: Check worker health

```bash
# Is the worker running?
docker compose ps worker

# Recent worker logs
docker compose logs --tail=300 worker

# Worker resource usage
docker stats intellirag-worker --no-stream
```

### Step 6: Check dependent services

```bash
# PostgreSQL connectivity
docker compose exec postgres pg_isready -U intellirag

# Ollama availability (needed for EMBED and KG_EXTRACT steps)
docker compose exec ollama curl -sf http://localhost:11434/api/tags > /dev/null && echo "OK" || echo "DOWN"

# Check shared upload volume is accessible
docker compose exec worker ls -la /app/uploads/
```

## Resolution

### VALIDATE step failures

Validation fails when the uploaded file does not match expected formats or is corrupted.

```bash
# Check the specific file that failed
docker compose exec worker ls -la /app/uploads/<document_path>

# Check file type detection
docker compose exec worker file /app/uploads/<document_path>
```

**Common fixes:**
- Unsupported MIME type: Update the allowed MIME types in the API configuration
- Corrupted upload: Ask the user to re-upload the document
- File size exceeds limit: Check and adjust the upload size limit

```sql
-- Mark corrupt/invalid documents as permanently failed
UPDATE document SET status = 'FAILED',
  error_message = 'Validation failed: unsupported or corrupted file',
  updated_at = now()
WHERE status = 'VALIDATING'
  AND updated_at < now() - INTERVAL '30 minutes';
```

### NORMALIZE step failures

Normalization handles format conversion (PDF text extraction, DOCX parsing, OCR for scanned documents).

```bash
# Check if OCR / LibreOffice dependencies are available in the worker
docker compose exec worker which tesseract 2>/dev/null && echo "tesseract OK" || echo "tesseract MISSING"
docker compose exec worker which libreoffice 2>/dev/null && echo "libreoffice OK" || echo "libreoffice MISSING"

# Check worker logs for normalization errors
docker compose logs --tail=500 worker | grep -iE "normalize|ocr|libreoffice|pdf|parse"
```

**Common fixes:**
- OCR failure: Verify tesseract is installed and the correct language packs are available
- PDF parsing error: Specific PDFs may be encrypted or malformed -- isolate and test individually
- Memory exhaustion on large files: Increase the worker memory limit in `docker-compose.yml`

### CHUNK step failures

Chunking splits normalized text into overlapping segments for embedding.

```bash
# Check for memory-related errors during chunking
docker compose logs --tail=300 worker | grep -iE "chunk|memory|oom|killed"
```

**Common fixes:**
- Out of memory on very large documents: Increase worker memory or reduce document size limits
- Empty content after normalization: The normalize step produced no text -- check the source document

```sql
-- Check if any documents have 0 chunks despite being past the CHUNKING step
SELECT d.document_id, d.title, d.status, d.chunk_count
FROM document d
WHERE d.status IN ('EMBEDDING', 'SEARCHABLE', 'ACTIVE')
  AND d.chunk_count = 0;
```

### EMBED step failures

See the dedicated runbook: [embedding-failure.md](embedding-failure.md)

### KG_EXTRACT step failures

See the dedicated runbook: [kg-extraction-stall.md](kg-extraction-stall.md)

### Bulk reset of failed jobs

When the root cause has been fixed and you want to retry all failed jobs:

```sql
-- Reset all FAILED jobs from the last 24 hours for re-processing
UPDATE ingestion_job
SET status = 'PENDING',
    attempt = 0,
    started_at = NULL,
    locked_until = NULL,
    error_message = NULL,
    updated_at = now()
WHERE status = 'FAILED'
  AND created_at > now() - INTERVAL '24 hours';

-- Reset the corresponding documents to their pre-failure step status
-- For each step, reset the document to the state that precedes it
UPDATE document SET status = 'UPLOADED', updated_at = now()
WHERE status = 'FAILED'
  AND document_id IN (SELECT document_id FROM ingestion_job WHERE step = 'VALIDATE' AND status = 'PENDING');

UPDATE document SET status = 'VALIDATING', updated_at = now()
WHERE status = 'FAILED'
  AND document_id IN (SELECT document_id FROM ingestion_job WHERE step = 'NORMALIZE' AND status = 'PENDING');

UPDATE document SET status = 'NORMALIZING', updated_at = now()
WHERE status = 'FAILED'
  AND document_id IN (SELECT document_id FROM ingestion_job WHERE step = 'CHUNK' AND status = 'PENDING');

UPDATE document SET status = 'CHUNKING', updated_at = now()
WHERE status = 'FAILED'
  AND document_id IN (SELECT document_id FROM ingestion_job WHERE step = 'EMBED' AND status = 'PENDING');

UPDATE document SET status = 'EMBEDDING', updated_at = now()
WHERE status = 'FAILED'
  AND document_id IN (SELECT document_id FROM ingestion_job WHERE step = 'KG_EXTRACT' AND status = 'PENDING');
```

### Restart the worker after fixes

```bash
docker compose restart worker

# Confirm it picks up the reset jobs
docker compose logs -f worker | head -50
```

## Prevention

- **Per-step health checks**: The worker should validate prerequisites for each step before starting (e.g., Ollama availability for EMBED/KG_EXTRACT)
- **Dead-letter alerting**: Alert when `ingestion_job` rows with `status = 'FAILED'` exceed a threshold (e.g., 10 in 1 hour)
- **File type validation at upload**: Reject unsupported file types at the API layer before creating ingestion jobs
- **Worker memory monitoring**: Alert when the worker container exceeds 80% of its memory limit
- **Retry budget**: Jobs exceeding `max_attempts` (default 3) should not be retried automatically -- require manual intervention

## Related Alerts

- `IntelliRagApiWorkflowOverdueBacklog` -- pipeline failures cause document workflow backlog growth
- `IntelliRagApiHighErrorRate` -- upload API may return errors if the worker queue is saturated
- `IntelliRagApiHighLatencyP95` -- a flooded ingestion queue can impact database performance
