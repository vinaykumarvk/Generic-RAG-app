# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**IntelliRAG** — Domain-agnostic, multi-LLM RAG + Knowledge Graph platform. Monorepo using npm workspaces with reusable packages ported from the policing-apps project.

## Build Commands

```bash
# Build all shared packages (must run before app builds)
npm run build:packages    # shared → workflow-engine → api-core → api-integrations

# Build API application
npm run build:api

# Build web frontend
npm run build:web

# Build everything
npm run build:all

# Typecheck
npm run typecheck

# Clean build artifacts
npm run clean
```

## Dev Commands

```bash
npm run dev:api    # Fastify API with hot reload (tsx watch)
npm run dev:web    # Vite dev server for React frontend

# Docker
npm run docker:up      # Start all services
npm run docker:down    # Stop all services
npm run docker:build   # Build Docker images
```

## Test Commands

```bash
npm run test:workflow-engine    # Vitest unit tests
npm run test:api               # API unit tests
npm run test:e2e               # Playwright (a11y)
npm run test:api:load          # Load tests
```

## Architecture

```
React Frontend (Vite + Tailwind + React Router + TanStack Query)
        │
Fastify API (TypeScript) — reuses @puda/api-core
  ├── Auth, RBAC, audit, rate limiting, LLM router
  ├── Document upload, workspace CRUD
  ├── RAG retrieval pipeline (vector + lexical + graph + metadata)
  └── Conversation management, citations, caching
        │
Python Workers (FastAPI health + PostgreSQL job poller)
  ├── Validator → Normalizer/OCR → Chunker → Embedder → [SEARCHABLE]
  └── KG Extractor (async, after searchable) → [ACTIVE]
        │
PostgreSQL + pgvector (unified store)
Ollama (local) or OpenAI/Claude/Gemini (cloud)
```

**Monorepo layout:** `packages/*` (shared libraries), `apps/*` (applications), `e2e/` (Playwright tests), `ops/` (infra/observability), `scripts/` (deployment).

### Apps

- **`apps/api/`** — Fastify API server. Entry: `src/index.ts`. Migrations: `src/migrations/`.
- **`apps/web/`** — React frontend (Vite). Pages: Login, Dashboard, Workspace, Documents, Query, Graph Explorer, Admin.
- **`apps/worker/`** — Python ingestion worker. Entry: `src/main.py`. Pipeline: validator, normalizer, chunker, embedder, kg_extractor.

### Package dependency graph

```
shared (base types, Zod schemas, IntelliRAG model, UI components)
  ↑
workflow-engine (state machine, guards, transitions, PostgreSQL transactions)
  ↑
api-core (Fastify app factory, auth, middleware, LLM provider + embeddings, routes)
  ↑
api-integrations (PDF/DOCX reports, connectors, retry/DLQ)
  ↑
nl-assistant (React: NL query panel, page agent UI — peer-depends on React 18+)
```

### Key modules

- **`apps/api/src/retrieval/pipeline.ts`** — 10-step RAG orchestrator (cache → expand → entities → vector → lexical → graph → metadata → rerank → generate → cache)
- **`apps/api/src/workflows/document-workflow.ts`** — Document lifecycle state machine (UPLOADED → ... → ACTIVE)
- **`apps/worker/src/pipeline/chunker.py`** — Adaptive chunking (heading-aware, table detection, overlap)
- **`apps/worker/src/pipeline/kg_extractor.py`** — LLM-based KG entity/relationship extraction
- **`packages/api-core/src/llm/llm-provider.ts`** — Multi-LLM abstraction (completions + embeddings)
- **`packages/shared/src/intellirag-model/`** — Domain Zod schemas (Workspace, Document, Chunk, Graph, Conversation, Retrieval)

### LLM Use Cases

**Legacy:** CLASSIFICATION, TRANSLATION, NARCOTICS_ANALYSIS, RISK_NARRATIVE, INVESTIGATION_SUMMARY, CASE_SUMMARY, LEGAL_REFERENCES, FINAL_SUBMISSION, NL_QUERY, PAGE_AGENT

**RAG:** EMBEDDING, CHUNK_SUMMARY, KG_EXTRACTION, QUERY_EXPANSION, ENTITY_DETECTION, RERANK, ANSWER_GENERATION, DOCUMENT_CLASSIFY, OCR_CORRECTION, GENERAL

### Infrastructure

- **Runtime:** Node.js + TypeScript (ES2022, CommonJS) / Python 3.11
- **Backend:** Fastify 5
- **Frontend:** React 18, Vite, Tailwind CSS, TanStack Query
- **Database:** PostgreSQL 16 + pgvector + pg_trgm
- **LLM:** Ollama (local, default) / OpenAI / Claude / Gemini
- **Docker:** pgvector/pgvector:pg16, ollama/ollama:latest, Node 20-slim, Python 3.11-slim

### Database migrations

Located in `apps/api/src/migrations/`:
- `001_foundation.sql` — Extensions, workspaces, users, roles, LLM config, audit, feature flags, seed data
- `006_documents.sql` — Documents, chunks with pgvector embeddings + FTS, ingestion jobs
- `007_conversations.sql` — Conversations, messages, retrieval runs, citations, answer cache
- `008_knowledge_graph.sql` — Graph nodes with description embeddings, edges with evidence
- `009_feedback_analytics.sql` — Feedback, notification events

## Notes

- `build:packages` must complete before building any app — packages have sequential build dependencies
- nl-assistant has no build step; it's consumed as TypeScript source with peer deps on React
- Python worker polls `ingestion_job` table with `SELECT FOR UPDATE SKIP LOCKED`
- The document workflow uses `@puda/workflow-engine` state machine for lifecycle management
- Retrieval presets: `concise` (10 chunks, fast), `balanced` (20 chunks), `detailed` (40 chunks, 2-hop graph)
