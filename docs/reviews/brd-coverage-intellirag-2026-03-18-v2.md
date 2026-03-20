# BRD Coverage Audit — IntelliRAG (Post-Remediation)

```
┌─────────────────────────────────────────────────┐
│ BRD COVERAGE AUDIT — IntelliRAG                 │
├─────────────────────────────────────────────────┤
│ BRD:                IntelliRAG_BRD_v1.0.docx    │
│ Audit Date:         2026-03-18 (v2)             │
│ Total FRs:          25                          │
│ Total Line Items:   149                         │
│ Implementation:     92 DONE, 47 PARTIAL, 10 NOT_FOUND │
│ DONE Rate:          61.7% (was 17.4%)           │
│ Test Coverage:      ~35/149 automated (23.5%)   │
│ Gaps:               57 (P0=7 P1=38 P2=12)      │
│ Previous Gaps:      123 (P0=52 P1=59 P2=12)    │
│ Gaps Closed:        66 (54% reduction)          │
│ P0 Reduction:       52 → 7 (87% reduction)      │
│ Verdict:            GAPS-FOUND → AT-RISK*       │
└─────────────────────────────────────────────────┘
* AC DONE rate 59.3% is below 70% threshold for GAPS-FOUND,
  but P0 count (7) is dramatically reduced from 52.
  Effective risk posture is significantly improved.
```

---

## Comparison: Before vs After Remediation

| Metric | Before (v1) | After (v2) | Change |
|--------|-------------|------------|--------|
| DONE | 26 (17.4%) | 92 (61.7%) | +66 (+254%) |
| PARTIAL | 68 (45.6%) | 47 (31.5%) | -21 |
| NOT_FOUND | 55 (36.9%) | 10 (6.7%) | -45 (82% reduction) |
| P0 Critical Gaps | 52 | 7 | -45 (87% reduction) |
| P1 High Gaps | 59 | 38 | -21 (36% reduction) |
| P2 Medium Gaps | 12 | 12 | 0 |
| Total Gaps | 123 | 57 | -66 (54% reduction) |

---

## Requirements Inventory

| FR ID | FR Title | Priority | ACs | BRs | FHs | Total |
|-------|----------|----------|-----|-----|-----|-------|
| FR-001 | Multi-Format Document Upload | Must Have | 5 | 3 | 2 | 10 |
| FR-002 | Automated Format Conversion | Must Have | 5 | 3 | 0 | 8 |
| FR-003 | OCR Processing | Must Have | 5 | 3 | 0 | 8 |
| FR-004 | Data Transformation | Must Have | 5 | 0 | 0 | 5 |
| FR-005 | Cloud Storage Integration | Must Have | 5 | 0 | 0 | 5 |
| FR-006 | Intelligent Document Chunking | Must Have | 6 | 3 | 0 | 9 |
| FR-007 | Metadata Extraction & Storage | Must Have | 5 | 0 | 0 | 5 |
| FR-008 | Vector Embedding Generation | Must Have | 5 | 0 | 0 | 5 |
| FR-009 | Entity Extraction | Must Have | 5 | 0 | 0 | 5 |
| FR-010 | Relationship Extraction | Must Have | 5 | 0 | 0 | 5 |
| FR-011 | KG Storage in PostgreSQL | Must Have | 5 | 0 | 0 | 5 |
| FR-012 | Step-Back Reasoning | Must Have | 5 | 0 | 0 | 5 |
| FR-013 | KG-Augmented Retrieval | Must Have | 5 | 0 | 0 | 5 |
| FR-014 | Vector Search & Answer Gen | Must Have | 7 | 0 | 0 | 7 |
| FR-015 | Answer References | Must Have | 5 | 0 | 0 | 5 |
| FR-016 | Document Upload Interface | Must Have | 6 | 0 | 0 | 6 |
| FR-017 | Conversation Management | Must Have | 7 | 0 | 0 | 7 |
| FR-018 | Q&A Interface | Must Have | 7 | 0 | 0 | 7 |
| FR-019 | Brief/Detailed Mode | Must Have | 5 | 0 | 0 | 5 |
| FR-020 | Answer Caching & History | Should Have | 5 | 0 | 0 | 5 |
| FR-021 | User Onboarding & UX | Should Have | 7 | 0 | 0 | 7 |
| FR-022 | User Management | Must Have | 5 | 0 | 0 | 5 |
| FR-023 | System Configuration | Must Have | 5 | 0 | 0 | 5 |
| FR-024 | Ingestion Monitoring | Must Have | 5 | 0 | 0 | 5 |
| FR-025 | Analytics & Reporting | Should Have | 5 | 0 | 0 | 5 |
| **TOTAL** | | | **135** | **12** | **2** | **149** |

---

## Code Traceability Matrix

### Module A: File Ingestion (FR-001 to FR-004)

#### FR-001 — Multi-Format Document Upload

| Item | Type | Verdict | Evidence | Gap Detail |
|------|------|---------|----------|------------|
| AC-001-01 | AC | PARTIAL | DocumentUpload.tsx:6-9, config.py:48-63 | MIME validation happens in worker, not at upload time — user gets 201 then FAILED |
| AC-001-02 | AC | DONE | index.ts:87 (100MB limit), config.py:12 | — |
| AC-001-03 | AC | DONE | DocumentUpload.tsx:10 (MAX_FILES=20), line 131 | — |
| AC-001-04 | AC | DONE | DocumentUpload.tsx:102-105 (xhr.upload.onprogress), lines 389-407 | — |
| AC-001-05 | AC | DONE | document-routes.ts:144 (SHA-256), status UPLOADED | — |
| BR-001-01 | BR | DONE | document-routes.ts:147-154 (409), DocumentUpload.tsx:421-456 (ConfirmDialog + ?force) | — |
| BR-001-02 | BR | DONE | sanitize-filename.ts:1-43, document-routes.ts:142 | — |
| BR-001-03 | BR | DONE | document-routes.ts:177-183 (audit_log, action=document.upload) | — |
| FH-001-01 | FH | NOT_FOUND | searched: retry, backoff, setTimeout in web/src | No client-side upload retry |
| FH-001-02 | FH | DONE | document-routes.ts:128,132,137 (reply.code(422)) | — |

#### FR-002 — Automated Format Conversion

| Item | Type | Verdict | Evidence | Gap Detail |
|------|------|---------|----------|------------|
| AC-002-01 | AC | PARTIAL | normalizer.py:245-278 | No 30s timeout, no 50MB sub-limit, output is text not CSV file |
| AC-002-02 | AC | PARTIAL | normalizer.py:156-209 | Converts DOC→TXT (not DOC→DOCX as BRD specifies) |
| AC-002-03 | AC | DONE | normalizer.py:136-153 (_strip_markdown) | — |
| AC-002-04 | AC | DONE | converter.py:50-88, normalizer.py:219-241 | — |
| AC-002-05 | AC | DONE | migration 014:16-21, job_poller.py:20,29-30 (CONVERT step) | — |
| BR-002-01 | BR | PARTIAL | normalizer.py:248-258 | Sheets separated in text but not stored as individual CSV files |
| BR-002-02 | BR | DONE | job_poller.py:127-150, config.py:11 (MAX_RETRIES=3) | — |
| BR-002-03 | BR | DONE | document-routes.ts:157-159, gcs-provider.ts:34-51 | — |

#### FR-003 — OCR Processing

| Item | Type | Verdict | Evidence | Gap Detail |
|------|------|---------|----------|------------|
| AC-003-01 | AC | DONE | normalizer.py:56-57, ocr_provider.py:21-27 | — |
| AC-003-02 | AC | PARTIAL | normalizer.py:61-65 | <10 chars check is per-document not per-page |
| AC-003-03 | AC | PARTIAL | ocr_provider.py:124 (300 DPI) | No accuracy measurement/verification |
| AC-003-04 | AC | PARTIAL | ocr_provider.py:62-79 | Block-level text; no explicit table/header/list structure preservation |
| AC-003-05 | AC | DONE | ocr_provider.py:103-111, migration 014:9-10 | — |
| BR-003-01 | BR | DONE | config.py:46 (120s), ocr_provider.py:140 | — |
| BR-003-02 | BR | DONE | config.py:44 (10), ocr_provider.py:131 (ThreadPoolExecutor) | — |
| BR-003-03 | BR | DONE | config.py:45 (0.7), ocr_provider.py:82-86 | — |

#### FR-004 — Data Transformation

| Item | Type | Verdict | Evidence | Gap Detail |
|------|------|---------|----------|------------|
| AC-004-01 | AC | PARTIAL | converter.py:50-88 | Format is [{header:val},...] not {headers,rows,caption} |
| AC-004-02 | AC | PARTIAL | converter.py:91-163 | Hierarchy works but no explicit 5-level cap |
| AC-004-03 | AC | DONE | chunker.py:140-163 (heading detection + heading_path) | — |
| AC-004-04 | AC | DONE | normalizer.py:69-70 (unicodedata.normalize("NFC")) | — |
| AC-004-05 | AC | DONE | chunker.py:70-91 (chunk INSERT) | — |

### Module B: Storage, Chunking & Vectorization (FR-005 to FR-008)

#### FR-005 — Cloud Storage Integration

| Item | Type | Verdict | Evidence | Gap Detail |
|------|------|---------|----------|------------|
| AC-005-01 | AC | PARTIAL | gcs-provider.ts:27-31 | Path uses {docId}{ext} not {document_id}/{filename} |
| AC-005-02 | AC | NOT_FOUND | searched: artifacts, converted storage | Converted content stored in DB, not GCS |
| AC-005-03 | AC | NOT_FOUND | searched: lifecycle, Nearline, Coldline | No lifecycle management code or IaC |
| AC-005-04 | AC | NOT_FOUND | searched: AES, encrypt, CMEK | No encryption config (GCS default, but unverified) |
| AC-005-05 | AC | DONE | gcs-provider.ts:50-51, document-routes.ts:168, migration 014:7 | — |

#### FR-006 — Intelligent Document Chunking

| Item | Type | Verdict | Evidence | Gap Detail |
|------|------|---------|----------|------------|
| AC-006-01 | AC | DONE | config.py:13-14 (512 tokens, 50 overlap) | — |
| AC-006-02 | AC | NOT_FOUND | searched: semantic, cosine, embedding in chunker | No embedding-based semantic chunking |
| AC-006-03 | AC | DONE | chunker.py:198-225 (_split_by_paragraphs) | — |
| AC-006-04 | AC | DONE | chunker.py:112-115, 228-253 | — |
| AC-006-05 | AC | PARTIAL | config.py:13-15 | No per-upload strategy override |
| AC-006-06 | AC | PARTIAL | chunker.py:75-85, migration 006:82-98 | page_start/page_end never populated by chunker |
| BR-006-01 | BR | DONE | chunker.py:13,63-64 (MAX_CHUNK_CHARS=10000) | — |
| BR-006-02 | BR | DONE | chunker.py:14,275-287 (MIN_CHUNK_CHARS=50) | — |
| BR-006-03 | BR | DONE | chunker.py:15,228-253 (TABLE_SPLIT_ROWS=50) | — |

#### FR-007 — Metadata Extraction & Storage

| Item | Type | Verdict | Evidence | Gap Detail |
|------|------|---------|----------|------------|
| AC-007-01 | AC | PARTIAL | normalizer.py:95-105 | Missing "Keywords" field extraction |
| AC-007-02 | AC | DONE | normalizer.py:106-119 | — |
| AC-007-03 | AC | DONE | document-routes.ts:126-134, document.ts:74 | — |
| AC-007-04 | AC | PARTIAL | migration 012:9-13 | GIN on metadata JSONB, but no FTS on extracted_metadata or custom_tags |
| AC-007-05 | AC | DONE | normalizer.py:74,125-133 (langdetect) | — |

#### FR-008 — Vector Embedding Generation

| Item | Type | Verdict | Evidence | Gap Detail |
|------|------|---------|----------|------------|
| AC-008-01 | AC | PARTIAL | embedder.py:67,90 | 60s per API call, not E2E guarantee |
| AC-008-02 | AC | DONE | embedder.py:10 (BATCH_SIZE=1000) | — |
| AC-008-03 | AC | DONE | config.py:16, migration 006:95 (vector(768)) | — |
| AC-008-04 | AC | DONE | migration 006:100-103 (HNSW index) | — |
| AC-008-05 | AC | DONE | config.py:11, job_poller.py:132-150 | — |

### Module C: Knowledge Graph (FR-009 to FR-011)

#### FR-009 — Entity Extraction

| Item | Type | Verdict | Evidence | Gap Detail |
|------|------|---------|----------|------------|
| AC-009-01 | AC | DONE | kg_extractor.py:794, config.py:35 (0.75 threshold) | — |
| AC-009-02 | AC | DONE | kg_extractor.py:519-579, config.py:32 (0.90 threshold) | — |
| AC-009-03 | AC | DONE | kg_extractor.py:702-729, migration 013:61-83 (kg_provenance) | — |
| AC-009-04 | AC | PARTIAL | kg_extractor.py:811-814 | Rate logged but not benchmarked or enforced |
| AC-009-05 | AC | DONE | kg_extractor.py:132-156, WorkspaceSettings.tsx (ontology UI) | — |

#### FR-010 — Relationship Extraction & Edge Creation

| Item | Type | Verdict | Evidence | Gap Detail |
|------|------|---------|----------|------------|
| AC-010-01 | AC | DONE | kg_extractor.py:64-89 (24 edge types) | — |
| AC-010-02 | AC | DONE | migration 008:48, migration 014:82-84 (CHECK 0-1) | — |
| AC-010-03 | AC | DONE | kg_extractor.py:687-695, migration 014:79-80 (UNIQUE + ON CONFLICT) | — |
| AC-010-04 | AC | DONE | migration 008:50, kg_extractor.py:694 (evidence_chunk_id) | — |
| AC-010-05 | AC | DONE | graph-routes.ts:81,130, graph-context.ts:106 (OR on source/target) | — |

#### FR-011 — Knowledge Graph Storage in PostgreSQL

| Item | Type | Verdict | Evidence | Gap Detail |
|------|------|---------|----------|------------|
| AC-011-01 | AC | PARTIAL | graph-routes.ts:101 (3-hop BFS) | No performance benchmark at 1M nodes |
| AC-011-02 | AC | DONE | migration 014:89-90 (composite indexes) | — |
| AC-011-03 | AC | PARTIAL | migration 008:28-29 (trigram), migration 014:93-94 (aliases GIN) | Trigram not true FTS (tsvector) |
| AC-011-04 | AC | PARTIAL | graph-routes.ts:152-194 (API endpoint exists) | No frontend UI button to trigger reindex |
| AC-011-05 | AC | PARTIAL | graph-routes.ts:197-229 (stats API) | Stats on Graph Explorer page, not admin dashboard |

### Module D: RAG Search (FR-012 to FR-015)

#### FR-012 — Step-Back Reasoning

| Item | Type | Verdict | Evidence | Gap Detail |
|------|------|---------|----------|------------|
| AC-012-01 | AC | PARTIAL | query-expander.ts:25,34 | expanded_intent generated but discarded, not persisted |
| AC-012-02 | AC | DONE | query-expander.ts:8,21-22,44 (Promise.race 500ms) | — |
| AC-012-03 | AC | DONE | pipeline.ts:142-145, query-expander.ts:30-31 | — |
| AC-012-04 | AC | DONE | query-expander.ts:30-31 (step-back prompt) | — |
| AC-012-05 | AC | DONE | query-expander.ts:14-18 (<3 words guard) | — |

#### FR-013 — Knowledge Graph-Augmented Retrieval

| Item | Type | Verdict | Evidence | Gap Detail |
|------|------|---------|----------|------------|
| AC-013-01 | AC | DONE | graph-context.ts:71-84 (trigram similarity match) | — |
| AC-013-02 | AC | DONE | graph-context.ts:94-122 (BFS loop, graphHops config) | — |
| AC-013-03 | AC | DONE | graph-context.ts:147-154 (NL format) | — |
| AC-013-04 | AC | DONE | graph-context.ts:18, pipeline.ts:162-172 (300ms Promise.race) | — |
| AC-013-05 | AC | DONE | graph-context.ts:162, pipeline.ts:249-255, migration 014:104 | — |

#### FR-014 — Vector Search & Answer Generation

| Item | Type | Verdict | Evidence | Gap Detail |
|------|------|---------|----------|------------|
| AC-014-01 | AC | DONE | vector-search.ts:54-67 (cosine <=> operator, LIMIT) | — |
| AC-014-02 | AC | DONE | answer-generator.ts:56-85 (system+graph+chunks+question) | — |
| AC-014-03 | AC | DONE | answer-generator.ts:51-53 ([Source: Doc, Page X]) | — |
| AC-014-04 | AC | DONE | answer-generator.ts:13-17 (concise 150w, detailed 1000w) | — |
| AC-014-05 | AC | NOT_FOUND | searched: model routing, useCase mapping in llm-provider | Single default model for all presets |
| AC-014-06 | AC | DONE | answer-generator.ts:43-46, pipeline.ts:193-212 | — |
| AC-014-07 | AC | PARTIAL | analytics-routes.ts:28 (P95 tracked) | Tracked but no enforcement/alerting |

#### FR-015 — Answer References & Source Attribution

| Item | Type | Verdict | Evidence | Gap Detail |
|------|------|---------|----------|------------|
| AC-015-01 | AC | DONE | answer-generator.ts:121-129 (**References** section) | — |
| AC-015-02 | AC | DONE | answer-generator.ts:108-118, CitationPanel.tsx:29-36 | — |
| AC-015-03 | AC | DONE | ChatPanel.tsx:177,275-282, DocumentPreviewModal.tsx:1-59 | — |
| AC-015-04 | AC | DONE | migration 007:70-82,88-94 (citation table + cache JSONB) | — |
| AC-015-05 | AC | DONE | answer-generator.ts:10,107 (MAX_REFERENCES=10) | — |

### Module E: User Interface (FR-016 to FR-021)

#### FR-016 — Document Upload Interface

| Item | Type | Verdict | Evidence | Gap Detail |
|------|------|---------|----------|------------|
| AC-016-01 | AC | DONE | DocumentUpload.tsx:228-250 (dashed border, Upload icon) | — |
| AC-016-02 | AC | PARTIAL | DocumentUpload.tsx:359-367 | "Browse more" only appears after initial selection; no always-visible Browse button |
| AC-016-03 | AC | DONE | DocumentUpload.tsx:381-407 (per-file + overall progress bars) | — |
| AC-016-04 | AC | PARTIAL | DocumentList.tsx:334-427 | Missing uploader column |
| AC-016-05 | AC | DONE | DocumentList.tsx:106-151 (color-coded badges, retry button) | — |
| AC-016-06 | AC | PARTIAL | DocumentList.tsx:271-305 (batch delete + retry) | Missing "download original" batch action |

#### FR-017 — Conversation Management

| Item | Type | Verdict | Evidence | Gap Detail |
|------|------|---------|----------|------------|
| AC-017-01 | AC | DONE | QueryPage.tsx:86-93 (New conversation button) | — |
| AC-017-02 | AC | DONE | pipeline.ts:81-83, QueryPage.tsx:129-147 (double-click rename) | — |
| AC-017-03 | AC | DONE | rag-routes.ts:123 (ORDER BY is_pinned DESC, updated_at DESC) | — |
| AC-017-04 | AC | PARTIAL | QueryPage.tsx:79,150,155 | message_count fetched but not rendered in sidebar |
| AC-017-05 | AC | DONE | QueryPage.tsx:46-48,136 (pin icon, sorted first) | — |
| AC-017-06 | AC | DONE | QueryPage.tsx:169-175,189-198 (ConfirmDialog) | — |
| AC-017-07 | AC | DONE | QueryPage.tsx:95-114 (debounced search, clear button) | — |

#### FR-018 — Question & Answer Interface

| Item | Type | Verdict | Evidence | Gap Detail |
|------|------|---------|----------|------------|
| AC-018-01 | AC | DONE | ChatPanel.tsx:91-98,304-312 (auto-expand, max 5 lines) | — |
| AC-018-02 | AC | DONE | ChatPanel.tsx:110-115 (Enter sends, Shift+Enter newline) | — |
| AC-018-03 | AC | DONE | ChatPanel.tsx:250-263 (animated bounce dots) | — |
| AC-018-04 | AC | DONE | MarkdownContent.tsx:1-46 (ReactMarkdown + remarkGfm) | — |
| AC-018-05 | AC | PARTIAL | ChatPanel.tsx:207-222 | Thumbs up/down present but no optional text feedback input |
| AC-018-06 | AC | DONE | ChatPanel.tsx:225-236 (clipboard + Check icon) | — |
| AC-018-07 | AC | DONE | ChatPanel.tsx:288-300 (Regenerate button) | — |

#### FR-019 — Brief/Detailed Answer Mode

| Item | Type | Verdict | Evidence | Gap Detail |
|------|------|---------|----------|------------|
| AC-019-01 | AC | PARTIAL | PresetSelector.tsx:3-7 | 3-way Concise/Balanced/Detailed (not "Brief|Detailed" toggle) |
| AC-019-02 | AC | PARTIAL | usePreferences.ts:5-11 | Hook exists but ChatPanel doesn't consume it; defaults to "balanced" |
| AC-019-03 | AC | DONE | ChatPanel.tsx:54,72-76 | — |
| AC-019-04 | AC | DONE | PresetSelector.tsx:25-32 (icons: Zap, Scale, BookOpen) | — |
| AC-019-05 | AC | DONE | ChatPanel.tsx:183-189 (Cpu icon + model_provider/model_id) | — |

#### FR-020 — Answer Caching & History (Should Have)

| Item | Type | Verdict | Evidence | Gap Detail |
|------|------|---------|----------|------------|
| AC-020-01 | AC | PARTIAL | cache.ts:26-37 (HNSW-backed lookup) | No <200ms SLA enforcement or measurement |
| AC-020-02 | AC | DONE | ChatPanel.tsx:192-197 (Cached badge), line 288-300 (Regenerate) | — |
| AC-020-03 | AC | DONE | document-routes.ts:185-186, graph-routes.ts:185-186, migration 007:98 (TTL) | — |
| AC-020-04 | AC | DONE | cache.ts:19,32,90 (preset-based cache) | — |
| AC-020-05 | AC | PARTIAL | AnalyticsDashboard.tsx:65-77 | Only top questions visible; no full Q&A history browsing |

#### FR-021 — User Onboarding & UX (Should Have)

| Item | Type | Verdict | Evidence | Gap Detail |
|------|------|---------|----------|------------|
| AC-021-01 | AC | NOT_FOUND | searched: tour, joyride, shepherd, intro, onboarding | No guided tour |
| AC-021-02 | AC | NOT_FOUND | searched: help tooltip, contextual help, HelpCircle | No help tooltip system |
| AC-021-03 | AC | PARTIAL | AppLayout.tsx:23-33 (Ctrl+B), ConfirmDialog.tsx:29 (Esc) | Missing Ctrl+N and Ctrl+Enter shortcuts |
| AC-021-04 | AC | DONE | AppLayout.tsx:11-21 (matchMedia 768px), 100dvh, responsive grids | — |
| AC-021-05 | AC | DONE | useTheme.ts:105-113 (prefers-color-scheme detection) | — |
| AC-021-06 | AC | PARTIAL | Widespread aria-labels, aria-hidden, role attrs, focus traps | Missing skip-to-content link; no automated WCAG audit |
| AC-021-07 | AC | PARTIAL | animate-spin, animate-pulse loading states | No toast notification system; limited skeleton loaders |

### Module F: Administration & System Management (FR-022 to FR-025)

#### FR-022 — User Management

| Item | Type | Verdict | Evidence | Gap Detail |
|------|------|---------|----------|------------|
| AC-022-01 | AC | PARTIAL | UserManagement.tsx:77-131, user-routes.ts:24-28 | Missing created_at column; component is **orphaned** (not rendered in any page) |
| AC-022-02 | AC | PARTIAL | CreateUserForm.tsx:11-19,92-127 | Route mismatch (/admin/users vs /users); component **orphaned** |
| AC-022-03 | AC | PARTIAL | user-routes.ts:83-117 (email immutable) | No frontend edit UI exists |
| AC-022-04 | AC | PARTIAL | user-routes.ts:142-150 | Deletes from `auth_session` which doesn't exist; silently catches error |
| AC-022-05 | AC | PARTIAL | user-routes.ts:119-153, migration 014:33-38 | ARCHIVED status set; but no resource reassignment to [archived] user |

#### FR-023 — System Configuration Dashboard

| Item | Type | Verdict | Evidence | Gap Detail |
|------|------|---------|----------|------------|
| AC-023-01 | AC | PARTIAL | admin-routes.ts:28-54, migration 014:57-74 | API groups by category; categories don't match BRD naming; **no frontend UI** |
| AC-023-02 | AC | DONE | admin-routes.ts:33-93 (GET + PUT endpoints) | — |
| AC-023-03 | AC | DONE | admin-routes.ts:74-85 (type-based validation) | — |
| AC-023-04 | AC | NOT_FOUND | searched: audit_log in admin-routes.ts | Setting changes not logged to audit_log |
| AC-023-05 | AC | DONE | admin-routes.ts:95-128 (POST reset with confirm=true guard) | — |

#### FR-024 — Ingestion Pipeline Monitoring

| Item | Type | Verdict | Evidence | Gap Detail |
|------|------|---------|----------|------------|
| AC-024-01 | AC | PARTIAL | IngestionMonitor.tsx:47-70 | Only 3 of 5 cards (missing Total, Pending); component **orphaned** |
| AC-024-02 | AC | PARTIAL | IngestionMonitor.tsx:85-138 | Only 2 of 6 columns (doc name, status); missing job_type, started_at, duration, worker_id |
| AC-024-03 | AC | DONE | IngestionVolumeChart.tsx:1-123 (Recharts + 7/30/90d toggle) | — |
| AC-024-04 | AC | PARTIAL | IngestionMonitor.tsx:96-137 | Retry button exists but component is **orphaned** |
| AC-024-05 | AC | DONE | IngestionMonitor.tsx:22 (refetchInterval:3000), lines 72-83 (manual refresh) | — |

#### FR-025 — Analytics & Reporting Dashboard (Should Have)

| Item | Type | Verdict | Evidence | Gap Detail |
|------|------|---------|----------|------------|
| AC-025-01 | AC | PARTIAL | analytics-routes.ts:19-103, AnalyticsDashboard.tsx:25-77 | KPI cards present; **no query volume chart** rendered (data available from API) |
| AC-025-02 | AC | PARTIAL | analytics-routes.ts:33-36 | Hit rate shown; missing cache size and most-hit queries |
| AC-025-03 | AC | NOT_FOUND | searched: user analytics, active users, queries per user | No user analytics API or UI |
| AC-025-04 | AC | PARTIAL | graph-routes.ts:196-229 | Nodes by type available; missing edges by type, most-connected entities |
| AC-025-05 | AC | PARTIAL | IngestionVolumeChart.tsx:25-36 | CSV export + date range only on ingestion chart; not on analytics dashboard |

---

## Comprehensive Gap List

**Total line items audited: 149**
**Fully implemented (DONE): 92 (61.7%)**
**Gaps found: 57**

### Gap Register

| # | Item ID | FR | Type | Priority | Code | Requirement Summary | What's Missing | Size |
|---|---------|-----|------|----------|------|---------------------|----------------|------|
| 1 | FR-001/AC-01 | FR-001 | AC | P1 | PARTIAL | Upload accepts 14 formats | MIME validation in worker, not at upload time | S |
| 2 | FR-001/FH-01 | FR-001 | FH | P0 | NOT_FOUND | Client-side retry with backoff | No retry logic in XHR upload | S |
| 3 | FR-002/AC-01 | FR-002 | AC | P1 | PARTIAL | XLSX/XLS to CSV within 30s | No timeout; output is text not CSV file | S |
| 4 | FR-002/AC-02 | FR-002 | AC | P1 | PARTIAL | DOC to DOCX via LibreOffice | Converts DOC→TXT instead of DOC→DOCX | S |
| 5 | FR-002/BR-01 | FR-002 | BR | P1 | PARTIAL | Multi-sheet XLSX separate CSVs | Sheets separated in text, not individual CSVs | S |
| 6 | FR-003/AC-02 | FR-003 | AC | P1 | PARTIAL | PDF OCR <10 chars/page | Check is per-document, not per-page | S |
| 7 | FR-003/AC-03 | FR-003 | AC | P1 | PARTIAL | OCR >= 95% accuracy | No accuracy measurement/verification | XS |
| 8 | FR-003/AC-04 | FR-003 | AC | P1 | PARTIAL | OCR preserves structure | Block-level text; no table/header/list structure in OCR | M |
| 9 | FR-004/AC-01 | FR-004 | AC | P1 | PARTIAL | Tables to JSON {headers,rows,caption} | Format is [{header:val},...]; no caption | S |
| 10 | FR-004/AC-02 | FR-004 | AC | P1 | PARTIAL | Nested lists 5 levels | Works but no explicit 5-level cap | XS |
| 11 | FR-005/AC-01 | FR-005 | AC | P1 | PARTIAL | GCS path with document_id/filename | Uses flat {docId}{ext} not {docId}/{filename} | XS |
| 12 | FR-005/AC-02 | FR-005 | AC | P0 | NOT_FOUND | Artifacts stored in GCS | Converted content in DB, not GCS | M |
| 13 | FR-005/AC-03 | FR-005 | AC | P0 | NOT_FOUND | Storage lifecycle (Nearline/Coldline) | No lifecycle management code or IaC | S |
| 14 | FR-005/AC-04 | FR-005 | AC | P0 | NOT_FOUND | AES-256 encryption at rest | No encryption config/verification | XS |
| 15 | FR-006/AC-02 | FR-006 | AC | P0 | NOT_FOUND | Semantic chunking | No embedding-based splitting in chunker | L |
| 16 | FR-006/AC-05 | FR-006 | AC | P1 | PARTIAL | Per-upload strategy override | Only global env vars | M |
| 17 | FR-006/AC-06 | FR-006 | AC | P1 | PARTIAL | Chunk stores page_numbers | page_start/page_end never populated | S |
| 18 | FR-007/AC-01 | FR-007 | AC | P1 | PARTIAL | PDF metadata extraction | Missing "Keywords" field | XS |
| 19 | FR-007/AC-04 | FR-007 | AC | P1 | PARTIAL | Metadata FTS index | GIN on JSONB; no FTS on extracted_metadata or custom_tags | S |
| 20 | FR-008/AC-01 | FR-008 | AC | P1 | PARTIAL | Embeddings within 60s | Per-call timeout, not E2E guarantee | XS |
| 21 | FR-009/AC-04 | FR-009 | AC | P1 | PARTIAL | 100 chunks/min rate | Logged but not benchmarked/enforced | XS |
| 22 | FR-011/AC-01 | FR-011 | AC | P1 | PARTIAL | 3-hop traversal <500ms | Implemented but no benchmark at 1M scale | XS |
| 23 | FR-011/AC-03 | FR-011 | AC | P1 | PARTIAL | FTS on entity_name + aliases | Trigram, not true tsvector FTS | S |
| 24 | FR-011/AC-04 | FR-011 | AC | P1 | PARTIAL | Admin re-index KG | API endpoint exists; no frontend button | S |
| 25 | FR-011/AC-05 | FR-011 | AC | P1 | PARTIAL | Graph stats on admin dashboard | Stats on Graph Explorer, not admin dashboard | S |
| 26 | FR-012/AC-01 | FR-012 | AC | P1 | PARTIAL | expanded_intent stored | Generated but discarded; not persisted | S |
| 27 | FR-014/AC-05 | FR-014 | AC | P0 | NOT_FOUND | Model routing by preset | Single default model for all presets | M |
| 28 | FR-014/AC-07 | FR-014 | AC | P1 | PARTIAL | E2E <3s P95 | Tracked in analytics but no enforcement | XS |
| 29 | FR-016/AC-02 | FR-016 | AC | P1 | PARTIAL | "Browse Files" button | No always-visible separate Browse button | XS |
| 30 | FR-016/AC-04 | FR-016 | AC | P1 | PARTIAL | Doc library: uploader column | Backend stores uploaded_by; UI doesn't display | S |
| 31 | FR-016/AC-06 | FR-016 | AC | P1 | PARTIAL | Batch download original | Batch delete+retry exist; missing download | S |
| 32 | FR-017/AC-04 | FR-017 | AC | P1 | PARTIAL | Message count in sidebar | Fetched but not rendered | XS |
| 33 | FR-018/AC-05 | FR-018 | AC | P1 | PARTIAL | Rating text feedback | Thumbs present; no optional text input | S |
| 34 | FR-019/AC-01 | FR-019 | AC | P1 | PARTIAL | "Brief | Detailed" toggle | 3-way Concise/Balanced/Detailed instead | S |
| 35 | FR-019/AC-02 | FR-019 | AC | P1 | PARTIAL | Default mode from preferences | usePreferences hook exists but not wired to ChatPanel | XS |
| 36 | FR-020/AC-01 | FR-020 | AC | P2 | PARTIAL | Cached answers <200ms | No SLA enforcement | XS |
| 37 | FR-020/AC-05 | FR-020 | AC | P2 | PARTIAL | Admin Q&A history | Only top questions; no full history browse | M |
| 38 | FR-021/AC-01 | FR-021 | AC | P2 | NOT_FOUND | 5-step guided tour | No tour library installed | M |
| 39 | FR-021/AC-02 | FR-021 | AC | P2 | NOT_FOUND | Contextual help tooltips | No help tooltip system | S |
| 40 | FR-021/AC-03 | FR-021 | AC | P2 | PARTIAL | Keyboard shortcuts | Only Ctrl+B and Esc; missing Ctrl+N, Ctrl+Enter | S |
| 41 | FR-021/AC-06 | FR-021 | AC | P2 | PARTIAL | WCAG 2.1 AA | Good foundation; missing skip-to-content | S |
| 42 | FR-021/AC-07 | FR-021 | AC | P2 | PARTIAL | Skeleton loaders + toasts | Limited skeletons; no toast system | S |
| 43 | FR-022/AC-01 | FR-022 | AC | P1 | PARTIAL | User list table | Component built but **orphaned** (not rendered) | XS |
| 44 | FR-022/AC-02 | FR-022 | AC | P1 | PARTIAL | Create user form | Route mismatch; component **orphaned** | S |
| 45 | FR-022/AC-03 | FR-022 | AC | P1 | PARTIAL | Edit user UI | API works; no frontend edit form | S |
| 46 | FR-022/AC-04 | FR-022 | AC | P1 | PARTIAL | Deactivate invalidates sessions | Targets nonexistent auth_session table | S |
| 47 | FR-022/AC-05 | FR-022 | AC | P1 | PARTIAL | Soft-delete + reassign | ARCHIVED status set; no resource reassignment | M |
| 48 | FR-023/AC-01 | FR-023 | AC | P1 | PARTIAL | Settings by category | API works; no frontend UI | M |
| 49 | FR-023/AC-04 | FR-023 | AC | P0 | NOT_FOUND | Setting changes audited | No audit_log write in admin-routes | XS |
| 50 | FR-024/AC-01 | FR-024 | AC | P1 | PARTIAL | Ingestion summary cards | 3 of 5 cards; component **orphaned** | S |
| 51 | FR-024/AC-02 | FR-024 | AC | P1 | PARTIAL | Live job queue table | 2 of 6 columns; no ingestion-job API | M |
| 52 | FR-024/AC-04 | FR-024 | AC | P1 | PARTIAL | Errors with retry button | Works but component **orphaned** | XS |
| 53 | FR-025/AC-01 | FR-025 | AC | P2 | PARTIAL | Search analytics chart | KPI cards only; no query volume chart | M |
| 54 | FR-025/AC-02 | FR-025 | AC | P2 | PARTIAL | Cache analytics detail | Hit rate only; missing cache size, most-hit | S |
| 55 | FR-025/AC-03 | FR-025 | AC | P2 | NOT_FOUND | User analytics | No API or UI for user-level analytics | M |
| 56 | FR-025/AC-04 | FR-025 | AC | P2 | PARTIAL | KG most-connected entities | Nodes by type; missing edges by type, most-connected | S |
| 57 | FR-025/AC-05 | FR-025 | AC | P2 | PARTIAL | Date range + CSV on all charts | Only on ingestion chart; not analytics dashboard | S |

---

## Gap Categories

### A) NOT_FOUND — No Code Evidence (10 gaps)

| # | Item ID | Priority | Requirement | Size |
|---|---------|----------|-------------|------|
| 2 | FR-001/FH-01 | P0 | Client-side upload retry with backoff | S |
| 12 | FR-005/AC-02 | P0 | Converted artifacts stored in GCS | M |
| 13 | FR-005/AC-03 | P0 | Storage lifecycle (Nearline/Coldline) | S |
| 14 | FR-005/AC-04 | P0 | AES-256 encryption at rest | XS |
| 15 | FR-006/AC-02 | P0 | Semantic chunking | L |
| 27 | FR-014/AC-05 | P0 | Model routing by preset | M |
| 38 | FR-021/AC-01 | P2 | Guided tour | M |
| 39 | FR-021/AC-02 | P2 | Contextual help tooltips | S |
| 49 | FR-023/AC-04 | P0 | Setting changes audit log | XS |
| 55 | FR-025/AC-03 | P2 | User analytics | M |

### B) PARTIAL — Code Exists but Incomplete (47 gaps)

**Must Have PARTIAL (38):** Gaps #1,3-11,16-26,28-35,43-52
**Should Have PARTIAL (9):** Gaps #36-37,40-42,53-54,56-57

### C) Orphaned Components (Critical Pattern)

Three fully-built frontend components are **not rendered in any page**:
- `UserManagement.tsx` — FR-022
- `CreateUserForm.tsx` — FR-022
- `IngestionMonitor.tsx` — FR-024

These components work but are dead code. **Wiring them into AdminPage or WorkspacePage would instantly close 5+ gaps.**

---

## Coverage Scorecard

```
LINE-ITEM COVERAGE
==================
Total auditable items:        149
  Acceptance Criteria (AC):   135  → 80 DONE, 46 PARTIAL, 9 NOT_FOUND
  Business Rules (BR):        12   → 11 DONE, 1 PARTIAL, 0 NOT_FOUND
  Failure Handling (FH):      2    → 1 DONE, 0 PARTIAL, 1 NOT_FOUND

Implementation Rate:          139 / 149 = 93.3% (DONE + PARTIAL)
  Fully Implemented (DONE):   92 / 149 = 61.7%
  Partially Implemented:      47 / 149 = 31.5%
  Not Found:                  10 / 149 = 6.7%
  Stubbed:                    0

AC DONE Rate:                 80 / 135 = 59.3%
BR DONE Rate:                 11 / 12 = 91.7%

TEST COVERAGE (estimated)
=========================
Tested (any layer):           ~35 / 149 = ~23.5%

GAP SUMMARY
===========
Total gaps:                   57
  By size:  XS=16  S=24  M=12  L=1  XL=0
  By type:  AC=55  BR=1  FH=1
  By priority: P0=7  P1=38  P2=12
```

### Gap Severity Distribution

| Severity | Count | Previous | Change |
|----------|-------|----------|--------|
| P0 — Critical | 7 | 52 | -45 (87% reduction) |
| P1 — High | 38 | 59 | -21 (36% reduction) |
| P2 — Medium | 12 | 12 | 0 |
| P3 — Low | 0 | 0 | 0 |
| **Total** | **57** | **123** | **-66 (54% reduction)** |

### Per-Module Scorecard

| Module | Items | DONE | PARTIAL | NOT_FOUND | DONE % |
|--------|-------|------|---------|-----------|--------|
| A: File Ingestion | 31 | 21 | 9 | 1 | 67.7% |
| B: Storage/Chunking | 24 | 14 | 6 | 4 | 58.3% |
| C: Knowledge Graph | 15 | 10 | 5 | 0 | 66.7% |
| D: RAG Search | 22 | 19 | 2 | 1 | 86.4% |
| E: User Interface | 37 | 23 | 12 | 2 | 62.2% |
| F: Admin/System | 20 | 5 | 13 | 2 | 25.0% |
| **Total** | **149** | **92** | **47** | **10** | **61.7%** |

### Strongest FRs (100% DONE)

- **FR-010**: Relationship Extraction (5/5 DONE)
- **FR-013**: KG-Augmented Retrieval (5/5 DONE)
- **FR-015**: Answer References (5/5 DONE)

### Weakest FR (highest gap density)

- **FR-022**: User Management (0/5 DONE, all PARTIAL — orphaned components)
- **FR-025**: Analytics (0/5 DONE, all PARTIAL/NOT_FOUND)
- **FR-005**: Cloud Storage (1/5 DONE, 3 NOT_FOUND — infra gaps)

---

## Constraint & NFR Audit

| Constraint | Type | Assertion | Verdict | Evidence |
|------------|------|-----------|---------|----------|
| CNS-01 | Technical | PostgreSQL for KG (not Neo4j) | DONE | All graph data in PostgreSQL (migration 008) |
| CNS-02 | Security | AES-256 at rest + TLS 1.2+ in transit | PARTIAL | AES-256 is GCS default but unverified; TLS via HTTPS assumed |
| CNS-03 | Performance | P95 query <3 seconds | PARTIAL | Tracked via analytics; no enforcement mechanism |
| CNS-04 | Compliance | Audit logging for all data access | PARTIAL | audit_log table exists; not all mutations are logged (settings gap) |
| CNS-05 | Budget | Use managed services | DONE | GCS, Document AI, Vertex AI are managed services |

---

## Top 10 Priority Actions

| # | Action | Item(s) | Severity | Size | Impact |
|---|--------|---------|----------|------|--------|
| 1 | **Wire orphaned components into pages** | FR-022/AC-01-02, FR-024/AC-01,02,04 | P1 | XS | Instantly closes 5+ gaps — components exist but aren't rendered |
| 2 | **Add audit_log INSERT to settings PUT** | FR-023/AC-04 | P0 | XS | Single-line fix closes a P0 gap |
| 3 | **Add AES-256 verification** (GCS default documentation) | FR-005/AC-04 | P0 | XS | Document that GCS provides AES-256 by default |
| 4 | **Add client-side upload retry** with backoff | FR-001/FH-01 | P0 | S | Add retry loop around XHR upload in DocumentUpload.tsx |
| 5 | **Implement model routing** by preset | FR-014/AC-05 | P0 | M | Add useCase-to-model mapping in llm-provider.ts |
| 6 | **Add GCS lifecycle policy** via IaC | FR-005/AC-03 | P0 | S | Terraform/gcloud bucket lifecycle configuration |
| 7 | **Store converted artifacts in GCS** | FR-005/AC-02 | P0 | M | Extend converter to upload JSON artifacts to GCS path |
| 8 | **Fix session invalidation** | FR-022/AC-04 | P1 | S | Use auth_token_denylist instead of nonexistent auth_session |
| 9 | **Wire usePreferences to ChatPanel** | FR-019/AC-02 | P1 | XS | One-line change to read defaultPreset from hook |
| 10 | **Add message_count to sidebar** | FR-017/AC-04 | P1 | XS | Data already fetched; just render it |

---

## Quality Checklist

- [x] Every FR in the BRD has a section in the traceability matrix (25/25)
- [x] Every AC, BR, FH has its own row — none skipped or merged (149 rows)
- [x] Edge cases and failure handling items extracted and audited
- [x] Every verdict has supporting evidence (file:line) or "searched:" terms
- [x] PARTIAL verdicts explain what's implemented and what's missing
- [x] Gap list includes ALL non-DONE items (57 gaps)
- [x] Gap sizes assigned to every gap
- [x] Out-of-scope items excluded from gap counts
- [x] Scorecard arithmetic verified (92+47+10=149)
- [x] Verdict follows defined criteria
- [x] Top 10 actions reference specific item IDs
- [x] Constraint items audited separately
- [x] Report saved to correct output path
- [x] Small items (missing columns, config tweaks) included
