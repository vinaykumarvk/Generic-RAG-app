# Ollama Service Failure and Cloud LLM Fallback

## Symptoms

- Ollama container is unhealthy, restarting, or unreachable
- LLM-powered features return null/empty results (RAG answers, KG extraction, query expansion)
- API logs show `LLM circuit breaker OPEN` messages for the Ollama host
- High latency on LLM-dependent endpoints (answer generation, entity detection)
- Model prediction logs show `fallback_used = true` or no recent entries
- Worker ingestion pipeline stalls at EMBED or KG_EXTRACT steps

## Severity

**Page** -- Ollama is the default LLM provider. When it is down, all LLM-dependent functionality is degraded: semantic search, RAG answer generation, KG extraction, query expansion, and document classification.

## Diagnosis

### Step 1: Check Ollama container status

```bash
# Is the container running?
docker compose ps ollama

# Check restart count (high count indicates crash loop)
docker inspect intellirag-ollama --format='{{.RestartCount}}'

# Check Ollama health endpoint
docker compose exec ollama curl -sf http://localhost:11434/ && echo "HEALTHY" || echo "UNREACHABLE"
```

### Step 2: Check Ollama resource usage

```bash
# Memory and CPU usage
docker stats intellirag-ollama --no-stream

# Check if Ollama was OOM-killed
docker inspect intellirag-ollama --format='{{.State.OOMKilled}}'

# Check Ollama logs for errors
docker compose logs --tail=300 ollama | grep -iE "error|oom|killed|panic|fail|gpu|cuda|memory"
```

### Step 3: Verify models are loaded

```bash
# List available models
docker compose exec ollama ollama list

# Check which models are currently loaded in memory
docker compose exec ollama ollama ps

# Test the chat model
docker compose exec ollama curl -s -X POST http://localhost:11434/api/chat \
  -d '{"model":"qwen3:35b","messages":[{"role":"user","content":"Reply OK"}],"stream":false}' \
  | jq '.message.content'

# Test the embedding model
docker compose exec ollama curl -s -X POST http://localhost:11434/api/embed \
  -d '{"model":"nomic-embed-text","input":["test"]}' \
  | jq '.embeddings | length'
```

### Step 4: Check the LLM circuit breaker state in API logs

```bash
# Look for circuit breaker messages
docker compose logs --tail=500 api | grep -iE "circuit breaker|LLM.*fail|LLM.*error|LLM.*timeout"
```

### Step 5: Check recent prediction log for failures

```sql
-- Recent LLM calls: are they succeeding?
SELECT provider, model_name, fallback_used,
       COUNT(*) AS count,
       AVG(latency_ms)::int AS avg_latency_ms
FROM model_prediction_log
WHERE created_at > now() - INTERVAL '1 hour'
GROUP BY provider, model_name, fallback_used
ORDER BY count DESC;
```

### Step 6: Check current LLM provider configuration

```sql
SELECT config_id, provider, display_name, model_id,
       is_active, is_default, api_base_url, timeout_ms
FROM llm_provider_config
ORDER BY is_default DESC, is_active DESC;
```

## Resolution

### Immediate actions

1. **Restart Ollama** and verify recovery:

   ```bash
   docker compose restart ollama

   # Wait for startup
   sleep 15

   # Verify models are accessible
   docker compose exec ollama ollama list
   docker compose exec ollama curl -s http://localhost:11434/api/tags | jq '.models[].name'
   ```

2. **If models need re-pulling** (volume lost or corrupted):

   ```bash
   docker compose exec ollama ollama pull qwen3:35b
   docker compose exec ollama ollama pull nomic-embed-text
   ```

3. **Clear the API circuit breaker** by restarting the API service (circuit breaker state is in-memory):

   ```bash
   docker compose restart api
   ```

### Switch to a cloud LLM provider (fallback)

If Ollama cannot be restored quickly, switch to a cloud LLM provider. The `llm_provider_config` table supports multiple providers.

**Option A: Switch to OpenAI**

```sql
-- First, deactivate Ollama as default
UPDATE llm_provider_config
SET is_default = FALSE, updated_at = now()
WHERE provider = 'ollama';

-- Insert or update OpenAI config
INSERT INTO llm_provider_config
  (provider, display_name, api_base_url, api_key_enc, model_id,
   is_active, is_default, max_tokens, temperature, timeout_ms, max_retries,
   config_jsonb)
VALUES
  ('openai', 'OpenAI (Fallback)', 'https://api.openai.com/v1',
   '<YOUR_OPENAI_API_KEY>', 'gpt-4o',
   TRUE, TRUE, 2048, 0.3, 30000, 2,
   '{"embedding_model": "text-embedding-3-small", "embedding_dimensions": 768}')
ON CONFLICT DO NOTHING;

-- If the row already exists, activate it
UPDATE llm_provider_config
SET is_active = TRUE, is_default = TRUE,
    api_key_enc = '<YOUR_OPENAI_API_KEY>',
    updated_at = now()
WHERE provider = 'openai';
```

**Option B: Switch to Claude (Anthropic)**

```sql
UPDATE llm_provider_config
SET is_default = FALSE, updated_at = now()
WHERE provider = 'ollama';

INSERT INTO llm_provider_config
  (provider, display_name, api_base_url, api_key_enc, model_id,
   is_active, is_default, max_tokens, temperature, timeout_ms, max_retries,
   config_jsonb)
VALUES
  ('claude', 'Claude (Fallback)', 'https://api.anthropic.com/v1',
   '<YOUR_ANTHROPIC_API_KEY>', 'claude-sonnet-4-20250514',
   TRUE, TRUE, 2048, 0.3, 60000, 2, '{}')
ON CONFLICT DO NOTHING;

UPDATE llm_provider_config
SET is_active = TRUE, is_default = TRUE,
    api_key_enc = '<YOUR_ANTHROPIC_API_KEY>',
    updated_at = now()
WHERE provider = 'claude';
```

**After switching providers:**

```bash
# Restart the API to clear the provider config cache (60s TTL, but restart is immediate)
docker compose restart api

# Verify the new provider is active
docker compose exec api curl -s http://localhost:3001/api/v1/llm/status | jq .
```

**Important note on embeddings when switching providers:**

If switching the embedding provider, be aware that different models produce different vector spaces. Existing embeddings generated by `nomic-embed-text` (768 dimensions) will not be compatible with `text-embedding-3-small` (1536 dimensions by default) unless dimension truncation is configured. Options:

- Configure OpenAI embeddings to output 768 dimensions via the `dimensions` parameter in `config_jsonb`
- Or keep Ollama running solely for embeddings while using a cloud provider for chat/completion
- Or re-embed all documents (expensive and time-consuming)

### Restore Ollama after cloud fallback

Once Ollama is healthy again:

```sql
-- Reactivate Ollama as default
UPDATE llm_provider_config
SET is_default = TRUE, is_active = TRUE, updated_at = now()
WHERE provider = 'ollama';

-- Deactivate the cloud fallback
UPDATE llm_provider_config
SET is_default = FALSE, updated_at = now()
WHERE provider IN ('openai', 'claude', 'gemini')
  AND is_default = TRUE;
```

```bash
docker compose restart api
```

## Prevention

- **Ollama health check in Docker Compose**: Add a health check for the Ollama service:

  ```yaml
  healthcheck:
    test: ["CMD", "curl", "-sf", "http://localhost:11434/"]
    interval: 30s
    timeout: 10s
    retries: 3
  ```

- **Pre-configured cloud fallback**: Keep at least one cloud provider row in `llm_provider_config` with `is_active = TRUE` and `is_default = FALSE`, so switching requires only flipping `is_default`
- **Memory reservation**: The `docker-compose.yml` reserves 4GB for Ollama. Ensure this is sufficient for your model combination (chat + embedding models loaded simultaneously)
- **Model preload on startup**: Add an entrypoint script that pulls required models on first boot
- **Circuit breaker monitoring**: Log and alert when the circuit breaker opens, as it indicates sustained LLM failures

## Related Alerts

- `IntelliRagApiHighErrorRate` -- LLM failures cascade into API 5xx errors on RAG endpoints
- `IntelliRagApiHighLatencyP95` -- Ollama slowness directly increases response latency
- `IntelliRagApiWorkflowOverdueBacklog` -- EMBED and KG_EXTRACT steps stall when Ollama is down
