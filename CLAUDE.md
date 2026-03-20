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

# Lint: all coding-standards checks (21 rules, baseline ratchet)
npm run lint                # full scan — fails on regressions from baseline
npm run lint:staged         # staged files only (used by pre-commit hook)
npm run lint:baseline       # ratchet baseline down after fixing violations
npm run lint:security       # security checks only (SEC-*)
npm run lint:quality        # quality checks only (QUA-*)
npm run lint:ui             # UI/a11y checks only (UID-*/UIA-*/UIT-*)
npm run lint:infra          # infra checks only (INF-*)
npm run lint:theme          # theme token violations (standalone, human-readable)

# Clean build artifacts
npm run clean
```

### Lint Baseline Ratchet

The lint system uses a **baseline ratchet** (`scripts/.lint-baseline.json`). Commits are blocked only if a check's violation count *increases* beyond baseline. After fixing violations, run `npm run lint:baseline` to ratchet the baseline down. The pre-commit hook (`husky`) runs `lint:staged` automatically.

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

## Coding Standards (apply proactively when writing code)

Full reference: `.claude/coding-standards.md` (216 rules). The critical subset below MUST be followed when writing any code — not just during review.

### Security — NEVER do these
- **SQL injection**: Always use parameterized queries (`$1`, `$2`). Never concatenate/interpolate user input into SQL.
- **No `eval()`/`exec()`/`spawn()`** with user input. No `dangerouslySetInnerHTML` without DOMPurify.
- **No hardcoded secrets** in source code, Dockerfiles, or CI configs. `.env` in `.gitignore`.
- **Auth tokens in httpOnly+secure+sameSite cookies only** — never localStorage.
- **Every mutation endpoint has authorization checks**. Read endpoints filter by user scope. No IDOR.
- **No sensitive data in logs** (passwords, tokens, PII). Use structured logger, not `console.log`.
- **File paths from user input**: validate and sandbox — no `../` traversal. Use generated filenames for uploads.

### Code Quality — ALWAYS do these
- **No `any` or `as any`** in new code. Use `unknown` + type narrowing.
- **Validate all API inputs** with Zod schemas server-side before processing.
- **Error handling on every async operation**. Never swallow errors silently. Use project helpers (`send400()`, `send404()`).
- **No N+1 queries**. Use JOINs or `WHERE id = ANY($1)`. Transactions for multi-step mutations.
- **All list endpoints have LIMIT/pagination**. No unbounded queries.
- **Migrations**: idempotent (`IF NOT EXISTS`), backward-compatible.
- **Import via workspace aliases** (`@puda/shared`, `@puda/api-core`), not relative paths into `packages/`.
- **Functions <= 50 lines, files <= 500 lines**. No commented-out code. Remove dead imports.

### UI/UX & Accessibility (WCAG 2.1 AA) — ALWAYS do these
- **No `<div onClick>`** — use semantic `<button>` or `<a>`. Icon-only buttons need `aria-label`.
- **Buttons specify `type="button"` or `type="submit"`** explicitly.
- **Decorative SVGs**: `aria-hidden="true"`. All `<img>` have `alt`.
- **Every data component has loading, empty, and error states**. Search/filter "no results" is distinct from data-empty.
- **Submit buttons disabled with loading indicator** during submission (double-submit prevention).
- **Confirmation dialogs use explicit action labels** (e.g., "Delete workspace") — never generic "OK".
- **No hardcoded hex/rgb colors or pixel spacing** — use CSS variables/design tokens. Applies to dark mode too.
- **Responsive**: use `100dvh` not `100vh`, breakpoints in `rem`, no fixed px widths >= 100px.
- **Data tables**: semantic `<table>`/`<th scope="col">` on desktop, but mobile must reflow dense row data into stacked cards instead of relying on horizontal scroll. Keep table empty state and selection/actions usable in both layouts.
- **Modals**: focus trapped, Escape to close, focus returns to trigger on close, `aria-labelledby` on heading.
- **Search inputs**: debounce 300-500ms, clear button, `type="search"`.
- **`credentials: "include"`** on all fetch calls to own API.
- **Route-level code splitting** with `React.lazy` + `Suspense`.

### Infrastructure — ALWAYS do these
- **Dockerfiles**: non-root user, pinned base image versions, multi-stage builds, `npm ci`.
- **Graceful shutdown**: SIGTERM/SIGINT handlers drain requests, close DB connections.
- **Health/readiness endpoints** verify actual dependencies.
- **Env var validation at startup** — throw on missing required vars.
- **Structured JSON logs** with consistent fields (timestamp, level, service, message).

## Notes

- `build:packages` must complete before building any app — packages have sequential build dependencies
- nl-assistant has no build step; it's consumed as TypeScript source with peer deps on React
- Python worker polls `ingestion_job` table with `SELECT FOR UPDATE SKIP LOCKED`
- The document workflow uses `@puda/workflow-engine` state machine for lifecycle management
- Retrieval presets: `concise` (10 chunks, fast), `balanced` (20 chunks), `detailed` (40 chunks, 2-hop graph)
