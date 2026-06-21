# IntelliRAG — Project Summary

**Intelligent Retrieval-Augmented Generation & Knowledge Graph Platform**

---

## Table of Contents

- [1. Overview](#1-overview)
- [2. Main Features](#2-main-features)
  - [2.1 Document Management & Ingestion](#21-document-management--ingestion)
  - [2.2 Intelligent Query & Retrieval](#22-intelligent-query--retrieval)
  - [2.3 Knowledge Graph Explorer](#23-knowledge-graph-explorer)
  - [2.4 Conversation Management](#24-conversation-management)
  - [2.5 Analytics & Reporting](#25-analytics--reporting)
  - [2.6 Administration & User Management](#26-administration--user-management)
  - [2.7 Notifications & Alerts](#27-notifications--alerts)
  - [2.8 Feedback & Quality Assurance](#28-feedback--quality-assurance)
  - [2.9 Audit & Compliance](#29-audit--compliance)
- [3. Technical Architecture](#3-technical-architecture)
  - [3.1 Tech Stack](#31-tech-stack)
  - [3.2 System Architecture](#32-system-architecture)
  - [3.3 Authentication & Authorization](#33-authentication--authorization)
  - [3.4 Data Flow](#34-data-flow)
  - [3.5 Deployment Model](#35-deployment-model)
  - [3.6 Notable Design Patterns](#36-notable-design-patterns)
- [4. Benefits for the Police Department](#4-benefits-for-the-police-department)

---

## 1. Overview

**IntelliRAG** is a domain-agnostic, enterprise-grade platform that combines Retrieval-Augmented Generation (RAG) with automated Knowledge Graph construction to transform how organizations search, analyze, and extract actionable insights from large document repositories. Designed for high-security, high-volume environments such as law enforcement agencies, it ingests documents in any format — PDFs, scanned images, spreadsheets, and text files — automatically extracting, indexing, and interlinking their contents using advanced AI models.

The platform enables officers and analysts to ask natural-language questions across thousands of documents and receive precise, citation-backed answers in seconds, while a visual Knowledge Graph reveals hidden connections between people, locations, cases, and events. Built with multi-level security clearances, comprehensive audit trails, and support for multiple AI providers, IntelliRAG is purpose-built for organizations that demand both intelligence and accountability.

---

## 2. Main Features

### 2.1 Document Management & Ingestion

| Feature | Description |
|---------|-------------|
| **Multi-Format Upload** | Supports PDF, DOCX, DOC, XLSX, XLS, CSV, TXT, Markdown, and image files (JPEG, PNG, TIFF) with drag-and-drop or folder upload. |
| **Automatic OCR** | Scanned documents and images are processed via Google Document AI with confidence scoring; low-quality extractions are flagged for human review. |
| **Large PDF Auto-Splitting** | PDFs exceeding a configurable size threshold are automatically split into manageable parts for parallel processing. |
| **Intelligent Chunking** | Documents are split into semantically meaningful chunks using heading-aware, table-detecting algorithms that preserve context across sections. |
| **Metadata Extraction** | AI-powered extraction of structured metadata including case references, FIR numbers, police station codes, dates, legal sections, involved parties, and sensitivity classifications. |
| **Duplicate Detection** | SHA-256 content hashing prevents re-uploading identical documents, with an option to override when a new version is intended. |
| **Document Versioning** | Full version history is maintained for every document, enabling traceability back to the original upload. |
| **Sensitivity Classification** | Four-tier classification (Public, Internal, Restricted, Sealed) controls who can view document content and derived answers. |
| **Batch Operations** | Bulk retry of failed documents, batch reprocessing by case reference or station, and multi-select delete. |
| **Real-Time Progress Tracking** | Live status updates via server-sent events show each document's journey through the eight-stage ingestion pipeline. |
| **Concurrent Uploads** | Up to four files upload simultaneously with per-file progress bars, automatic retry on transient failures, and session keepalive for large batches. |

---

### 2.2 Intelligent Query & Retrieval

| Feature | Description |
|---------|-------------|
| **Natural-Language Q&A** | Officers ask plain-English questions and receive AI-generated answers grounded in the organization's own documents. |
| **Hybrid Search Pipeline** | An 11-step retrieval pipeline combines vector similarity search, full-text lexical search, and Knowledge Graph traversal for maximum recall and precision. |
| **Citation-Backed Answers** | Every answer includes numbered references linking back to the specific document passages that support it, with one-click preview. |
| **Query Expansion** | The system automatically generates expanded intents, step-back questions, and related queries to capture results the user may not have thought to ask for. |
| **Retrieval Presets** | Three built-in presets — Concise (fast, 10 chunks), Balanced (default, 20 chunks), and Detailed (thorough, 40 chunks with 2-hop graph) — let users trade speed for depth. |
| **Retrieval Mode Selection** | Users can restrict search to specific methods: hybrid (all), vector-only, metadata-only, or graph-only. |
| **Smart Metadata Filters** | Queries can be scoped by category, date range, organizational unit, case reference, FIR number, station code, language, and sensitivity level. |
| **Inferred Filter Detection** | The system automatically detects and applies relevant filters from the natural-language query itself. |
| **Semantic Answer Caching** | Answers to similar questions are cached and served instantly, with access-aware cache keys ensuring users only see results they are authorized to view. |
| **Streaming Responses** | Answers are streamed in real time via server-sent events for a responsive conversational experience. |
| **Follow-Up Suggestions** | After each answer, the system suggests relevant follow-up questions to guide deeper exploration. |
| **Multi-Language Translation** | Answers and summaries can be translated into Telugu, Urdu, and Hindi on demand. |

---

### 2.3 Knowledge Graph Explorer

| Feature | Description |
|---------|-------------|
| **Automatic Graph Construction** | AI models extract entities (persons, organizations, locations, legal instruments, events, and 25+ other types) and their relationships from every ingested document. |
| **Interactive Visualization** | A visual node-link graph lets users explore connections between entities with click-to-inspect detail panels. |
| **Configurable Traversal Depth** | Users can explore 1-hop, 2-hop, or 3-hop neighborhoods around any entity to uncover indirect connections. |
| **Type-Based Filtering** | Graph nodes can be filtered by entity type to focus on specific categories such as persons, locations, or case IDs. |
| **Full-Text & Semantic Search** | Nodes are searchable by name, alias, or description using both keyword and similarity-based matching. |
| **Entity Deduplication** | Confidence-based deduplication merges variant names and aliases into unified entity records. |
| **Provenance Tracking** | Every extracted entity and relationship tracks the source document, extraction model, and confidence score for auditability. |
| **Graph Statistics Dashboard** | Administrators can view aggregate node and edge counts, most-connected entities, and type distributions. |
| **Custom Ontology Configuration** | Workspace-level settings allow administrators to define domain-specific entity and relationship types. |

---

### 2.4 Conversation Management

| Feature | Description |
|---------|-------------|
| **Multi-Turn Conversations** | The system maintains conversation context across multiple questions, resolving pronouns and references to earlier answers. |
| **Conversation Library** | All past conversations are saved, searchable, and organized with timestamps and message counts. |
| **Pin & Archive** | Important conversations can be pinned for quick access; completed investigations can be archived to reduce clutter. |
| **Pinned Filters** | Persistent per-conversation filters allow scoping an entire investigation to a specific case, station, or date range. |
| **Inline Rename** | Conversations can be renamed on the fly for better organization. |
| **Conversation Summaries** | AI-generated summaries distill long conversations into concise overviews. |
| **Answer Regeneration** | Unsatisfactory answers can be regenerated with a single click using an upgraded AI model. |
| **Export** | Conversations can be exported as JSON or CSV, with automatic masking of restricted content for lower-clearance users. |
| **PDF Download** | Individual answers with their citations can be downloaded as PDF for offline reference or evidence submission. |
| **Answer Journey** | A transparency panel shows every step of the retrieval pipeline for any given answer, including latency, cache status, model used, and cost. |

---

### 2.5 Analytics & Reporting

| Feature | Description |
|---------|-------------|
| **Workspace Dashboard** | At-a-glance KPI cards show document count, 7-day query volume, cache hit rate, and average response latency. |
| **Query Volume Trends** | Time-series charts display daily query volumes over configurable 30- to 90-day windows. |
| **Ingestion Volume Trends** | Charts track document ingestion throughput and pipeline performance over time. |
| **Cache Performance** | Hit rate metrics and most-frequently-hit queries help optimize retrieval cost and speed. |
| **User Activity Analytics** | Per-user query counts and active user tracking over 30-day windows provide usage visibility. |
| **LLM Usage & Cost Breakdown** | Detailed breakdowns by AI provider and model show call volumes, average latency, and token costs. |
| **Document Status Distribution** | Visual breakdown of documents by processing state and file type. |
| **OCR Quality Metrics** | Aggregated confidence scores and review-flagged document counts help monitor extraction quality. |
| **Ingestion SLA Tracking** | Per-pipeline-step average and 95th-percentile durations ensure processing meets operational targets. |
| **Q&A History** | Searchable, sortable history of all questions and answers across the workspace. |
| **CSV Export** | All analytics data can be exported to CSV for offline analysis or integration with existing BI tools. |

---

### 2.6 Administration & User Management

| Feature | Description |
|---------|-------------|
| **User CRUD** | Administrators can create, edit, archive, and delete user accounts with automatic document reassignment on deletion. |
| **Role-Based Access Control** | Four system roles (Admin, Member, Viewer, API Key) and four workspace roles (Owner, Admin, Editor, Viewer) provide granular permission control. |
| **Workspace Management** | Create isolated workspaces with independent document collections, user memberships, and configuration settings. |
| **LLM Provider Configuration** | Add, test, and configure multiple AI providers (OpenAI, Google Gemini, Anthropic Claude, Ollama, OpenRouter) with per-use-case routing and cost tracking. |
| **System Settings** | 16+ configurable parameters covering storage limits, chunking behavior, OCR thresholds, caching TTL, and Knowledge Graph confidence levels. |
| **Ingestion Monitor** | Real-time view of the document processing queue with job status, step history, and timing breakdown. |
| **Review Queue** | Documents or entities flagged for human review can be assigned to reviewers and resolved with notes. |
| **Organization Units** | Hierarchical organizational structure (e.g., divisions, stations) can be defined and used for document scoping and access control. |
| **Feature Flags** | Runtime-toggleable feature flags control the availability of capabilities like Knowledge Graph extraction. |
| **Account Security** | Automatic account locking after failed login attempts, token revocation support, and password hashing with bcrypt. |

---

### 2.7 Notifications & Alerts

| Feature | Description |
|---------|-------------|
| **In-App Notifications** | Real-time notifications for events such as ingestion failures, graph extraction completions, and critical feedback. |
| **Severity Levels** | Notifications are classified as Info, Warning, or Critical, with critical alerts overriding user opt-out preferences. |
| **User Preferences** | Each user can customize which event types generate notifications and through which channels. |
| **Batch Management** | Mark all notifications as read or dismiss individual items to keep the notification center clean. |

---

### 2.8 Feedback & Quality Assurance

| Feature | Description |
|---------|-------------|
| **Three-Level Feedback** | Users rate answers as Helpful, Partially Helpful, or Not Helpful, with an optional comment and issue tags. |
| **Feedback Dashboard** | Aggregated statistics, trend charts, and top issue tags help administrators identify systematic quality gaps. |
| **Resolution Workflow** | Administrators can review feedback items, add resolution notes, and mark issues as resolved. |
| **Quality Metrics** | Feedback distribution and trends feed directly into the analytics dashboard for continuous improvement tracking. |

---

### 2.9 Audit & Compliance

| Feature | Description |
|---------|-------------|
| **Comprehensive Audit Trail** | Every data mutation (create, update, delete) is logged with user identity, timestamp, action type, resource details, and workspace context. |
| **Audit Log Search** | Logs are searchable by user, action type, resource, date range, and event subtype. |
| **Audit Export** | Full audit logs can be exported as JSON or CSV for compliance reporting and external review. |
| **Clipboard Tracking** | Copy-to-clipboard actions on answer content are logged for data leak prevention. |
| **Export Watermarking** | Exported conversations carry confidentiality watermarks and record the exporting user's identity. |
| **Stale Citation Detection** | Exports flag when cited document versions have been superseded, ensuring reports use current information. |
| **Sensitivity-Based Masking** | Content is automatically masked in exports for users without sufficient clearance. |

---

## 3. Technical Architecture

### 3.1 Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | React 18, Vite, Tailwind CSS, React Router, TanStack Query |
| **Backend API** | Fastify 5 (TypeScript, ES2022) |
| **Ingestion Worker** | Python 3.11, FastAPI (health endpoints) |
| **Database** | PostgreSQL 16 with pgvector (semantic search) and pg_trgm (trigram matching) |
| **AI / LLM** | Multi-provider: OpenAI GPT-5.2, Google Gemini, Anthropic Claude, Ollama (local), OpenRouter |
| **Embeddings** | OpenAI text-embedding-3-small (768 dimensions) or Ollama nomic-embed-text |
| **OCR** | Google Document AI, Tesseract (fallback) |
| **Containerization** | Docker with multi-stage builds, Docker Compose for local development |
| **Cloud Platform** | Google Cloud (Cloud Run, Cloud SQL, Secret Manager, Artifact Registry, Cloud Trace) |
| **Infrastructure-as-Code** | Terraform |
| **Reverse Proxy** | nginx 1.27 |
| **Validation** | Zod (TypeScript), Pydantic (Python) |
| **State Management** | Custom workflow engine with optimistic locking and lifecycle hooks |
| **Observability** | Prometheus metrics, OpenTelemetry (optional), structured JSON logging, GCP Cloud Monitoring |

---

### 3.2 System Architecture

IntelliRAG follows a **monorepo microservices architecture** with three independently deployable services backed by a unified PostgreSQL database.

```
                          ┌──────────────────────┐
                          │   React Frontend     │
                          │   (Vite + Tailwind)   │
                          └──────────┬───────────┘
                                     │ HTTPS
                          ┌──────────▼───────────┐
                          │   nginx Reverse Proxy │
                          └──────────┬───────────┘
                                     │
                   ┌─────────────────┼─────────────────┐
                   │                 │                   │
        ┌──────────▼──────┐         │         ┌────────▼────────┐
        │  Fastify API    │         │         │  Python Worker  │
        │  (TypeScript)   │         │         │  (FastAPI)      │
        │                 │         │         │                 │
        │ • Auth & RBAC   │         │         │ • Validator     │
        │ • RAG Pipeline  │         │         │ • OCR/Normalize │
        │ • Graph Routes  │         │         │ • Chunker       │
        │ • Analytics     │         │         │ • Embedder      │
        │ • Audit         │         │         │ • KG Extractor  │
        └────────┬────────┘         │         └────────┬────────┘
                 │                  │                   │
                 └──────────┬──────┘───────────────────┘
                            │
                 ┌──────────▼──────────┐
                 │  PostgreSQL 16      │
                 │  + pgvector         │
                 │  + Full-Text Search │
                 └──────────┬──────────┘
                            │
                 ┌──────────▼──────────┐
                 │  LLM Providers      │
                 │  (OpenAI / Gemini / │
                 │   Claude / Ollama)  │
                 └─────────────────────┘
```

Shared libraries (types, schemas, workflow engine, API core, UI components) are organized as npm workspace packages with strict dependency ordering, promoting code reuse and consistency.

---

### 3.3 Authentication & Authorization

- **Authentication**: JWT-based sessions stored in httpOnly, secure, SameSite cookies — never in localStorage.
- **Password Security**: bcrypt hashing with automatic account locking after repeated failed login attempts.
- **Role-Based Access Control**: Two-tier RBAC — system-level roles (Admin, Member, Viewer) and workspace-level roles (Owner, Admin, Editor, Viewer).
- **Sensitivity Clearance**: Four-level document sensitivity (Public, Internal, Restricted, Sealed) with per-user clearance levels. Time-bound access grants enable temporary elevation.
- **Workspace Isolation**: Users only see workspaces they belong to; all queries and document access are scoped by membership.
- **Cache Safety**: Answer cache keys incorporate the user's access signature, preventing cross-clearance information leakage.
- **SSO Ready**: OIDC and LDAP integration points are built into the authentication layer.

---

### 3.4 Data Flow

**Document Ingestion Flow:**

1. User uploads a document via the web interface (drag-and-drop or file browser).
2. The API validates the file, computes a SHA-256 hash for deduplication, stores it on disk or cloud storage, and creates an ingestion job.
3. The Python worker picks up the job using lock-free concurrent polling.
4. The document passes through eight sequential pipeline stages: Validate → Split (if large) → Normalize/OCR → Convert → Metadata Extract → Chunk → Embed → KG Extract.
5. At each stage, the worker updates the document status in the database; the frontend receives real-time progress via server-sent events.
6. Once embedding is complete, the document becomes searchable; once KG extraction finishes, it reaches Active status.

**Query & Retrieval Flow:**

1. User submits a natural-language question.
2. The API checks the semantic cache for a sufficiently similar prior answer.
3. If no cache hit, the 11-step pipeline fires: query expansion → entity detection → vector search → lexical search → graph context → metadata filtering → reranking → access filtering → answer generation → cache write.
4. The generated answer, with citations and retrieval trace, is streamed back to the user in real time.

---

### 3.5 Deployment Model

- **Cloud Runtime**: Google Cloud Run v2 (managed, serverless, auto-scaling from 1 to 20 instances).
- **Database**: Cloud SQL for PostgreSQL 16 with pgvector extension, connected via secure Unix sockets.
- **Secrets**: Google Secret Manager injects sensitive configuration at runtime (JWT keys, API keys, database credentials).
- **Container Images**: Multi-stage Docker builds with non-root execution (UID 1001), pinned base images, and production-optimized layers.
- **CI/CD**: Cloud Build for image construction with automated deployment to Cloud Run. Canary deployment scripts support gradual rollout.
- **Infrastructure-as-Code**: Terraform modules define all cloud resources, IAM roles, and service configurations.
- **Monitoring**: Prometheus metrics with SLO-based alerting (99.5% availability, p95 latency under 1.5 seconds), runbook-linked alert policies, and optional OpenTelemetry integration.
- **Local Development**: Docker Compose stack with PostgreSQL, Ollama (local LLM), API server, Python worker, and nginx proxy.

---

### 3.6 Notable Design Patterns

- **Workflow State Machine**: A declarative, Zod-validated state machine governs the document lifecycle with guards, actions, optimistic locking, and SLA-aware task management.
- **Multi-LLM Router**: A provider-agnostic abstraction routes different AI tasks (embedding, extraction, generation, translation) to the optimal provider based on configuration, with automatic fallback.
- **Semantic Caching**: Query embeddings enable fuzzy cache matching, dramatically reducing LLM costs for repeated or similar questions while respecting access controls.
- **Lock-Free Job Polling**: The Python worker uses PostgreSQL's `SELECT FOR UPDATE SKIP LOCKED` for high-throughput, contention-free concurrent job processing.
- **Monorepo with Workspace Packages**: Shared types, schemas, and utilities are published as internal npm packages with strict build ordering, ensuring type safety across frontend, backend, and worker.
- **Baseline Ratchet Linting**: A 216-rule coding standards system with ratcheting baselines prevents quality regressions while allowing incremental improvement.

---

## 4. Benefits for the Police Department

### Operational Efficiency

- **Instant Case Research**: Officers can query thousands of case files, FIRs, and intelligence reports in natural language and receive precise, citation-backed answers in seconds — replacing hours of manual document review.
- **Automated Document Processing**: The ingestion pipeline handles OCR on scanned documents, extracts structured metadata (case references, FIR numbers, station codes, involved parties), and indexes everything automatically — eliminating manual data entry.
- **Faster Investigations**: The Knowledge Graph automatically surfaces connections between suspects, locations, vehicles, and cases that would take investigators days to piece together manually.

### Data-Driven Decision Making

- **Analytics Dashboard**: Leadership gains visibility into query volumes, system usage patterns, document ingestion rates, and officer activity — enabling resource allocation based on actual demand.
- **Trend Analysis**: Time-series analytics on query patterns and document volumes help identify emerging crime trends and hotspots before they escalate.
- **Quality Metrics**: Feedback tracking and OCR confidence scoring provide objective measures of information quality, driving continuous improvement.

### Enhanced Inter-Departmental Coordination

- **Workspace Isolation with Cross-Reference**: Each division, unit, or task force operates in its own workspace while the Knowledge Graph reveals connections across organizational boundaries.
- **Multi-Language Support**: Built-in translation to Telugu, Urdu, and Hindi ensures that officers across linguistically diverse regions can access and contribute intelligence in their preferred language.
- **Organizational Unit Hierarchy**: The system mirrors the department's organizational structure, enabling natural scoping of documents and queries by division, station, or specialized unit.

### Compliance & Audit Readiness

- **Immutable Audit Trail**: Every action — document upload, query, answer export, metadata change, user login — is logged with full attribution, timestamps, and context, satisfying regulatory and judicial audit requirements.
- **Exportable Audit Records**: Audit logs can be exported as CSV or JSON for submission to oversight bodies, internal affairs, or court proceedings.
- **Clipboard & Export Tracking**: Data exfiltration risk is mitigated by tracking clipboard copy events, applying confidentiality watermarks to exports, and masking restricted content for lower-clearance personnel.
- **Citation Provenance**: Every AI-generated answer traces back to specific document passages, ensuring that investigative conclusions can always be verified against source material.

### Officer Safety & Accountability

- **Rapid Intelligence Access**: Field officers can quickly check for known associates, prior incidents at a location, or outstanding warrants, improving situational awareness before engagements.
- **Sensitivity-Tiered Access**: Four clearance levels ensure that sealed evidence, witness protection details, and classified intelligence are only visible to authorized personnel.
- **Time-Bound Access Grants**: Temporary access elevation for special operations or inter-agency collaboration expires automatically, maintaining the principle of least privilege.

### Cost Savings & Resource Optimization

- **Semantic Answer Caching**: Frequently asked questions are served from cache, reducing AI compute costs by avoiding redundant LLM calls.
- **Multi-Provider LLM Strategy**: The platform routes different tasks to the most cost-effective AI provider — using affordable models for routine tasks and premium models only for complex analysis.
- **LLM Cost Tracking**: Per-provider, per-model cost breakdowns give administrators full visibility into AI spending, enabling informed budget decisions.
- **Reduced Manual Labor**: Automated metadata extraction, document classification, and entity linking eliminate repetitive clerical work, freeing officers for field duties.

### Public Trust & Transparency

- **Traceable AI Reasoning**: The Answer Journey feature shows every step of how an answer was derived — which documents were searched, what entities were detected, and how results were ranked — building confidence in AI-assisted decision making.
- **Feedback Loop**: Officers can rate answer quality, flag inaccuracies, and submit corrections, creating a continuous improvement cycle that increases system reliability over time.
- **Review Queue**: Flagged documents and low-confidence extractions are routed to human reviewers, ensuring that AI outputs are validated before being acted upon in sensitive contexts.
- **Version Control**: Full document version history and stale-citation detection ensure that decisions are based on the most current information available.

---

*Document generated on 2026-03-30. For technical implementation details, refer to the project's CLAUDE.md and source code documentation.*
