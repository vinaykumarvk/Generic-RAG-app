# Development Plan: District Judgment Fetch

## Overview
Add a case-level "Fetch judgment" workflow to the District Analytics drilldown. The button should first reuse any already-linked judgment artifact, otherwise enqueue approved source lookups, fetch the best available judgment/order text or PDF, create a linked `document`, and let the existing redaction, translation, chunking, embedding, and judgment metadata pipeline process it.

## Assumptions
- The button is an asynchronous request. It should return current/queued status immediately and should not block the browser while Indian Kanoon, eCourts, OCR, redaction, or translation runs.
- Indian Kanoon is the first lookup source because it can return clean text; eCourts is the official fallback; HLDC is available only for non-commercial Uttar Pradesh research coverage.
- Automated eCourts CAPTCHA solving remains disabled unless legal/operational sign-off updates `docs/legal/captcha-strategy.md`.
- Existing production schema is sufficient for the first implementation. No new migration is required unless implementation discovers a missing provenance field.

## Codebase Findings
- `apps/api/src/migrations/028_district_court_foundation.sql` - already defines `district_case`, `district_case_source`, `district_target_cnr`, and `district_fetch_attempt`.
- `apps/api/src/migrations/029_district_text_acquisition.sql` - already defines `district_text_artifact`, `district_acquisition_queue`, source quota tracking, and the trigger that marks cases `text_ready` when a text artifact exists.
- `apps/api/src/routes/district-analytics-routes.ts` - the detail API already returns case metadata, linked text artifacts, acquisition queue rows, and fetch attempts.
- `apps/api/src/routes/district-source-routes.ts` - source status APIs already aggregate queue, attempts, and artifacts for dashboard visibility.
- `apps/worker/src/district/acquisition_queue.py` - already plans source order as Indian Kanoon, eCourts, HLDC, but needs execution and a UP code review for HLDC eligibility.
- `apps/worker/src/sources/indian_kanoon_district.py` and `apps/worker/src/sources/ecourts_district.py` - currently contain lookup/planning helpers, not live fetch implementations.
- `apps/worker/src/job_poller.py` - the normal document ingestion pipeline already runs `VALIDATE -> SPLIT -> NORMALIZE -> CONVERT -> METADATA_EXTRACT -> REDACT -> TRANSLATE -> CHUNK -> EMBED`.
- `apps/worker/src/pipeline/normalizer.py` - supports PDFs and plain text, which covers eCourts PDF and Indian Kanoon text artifacts.
- `docs/legal/district-court-source-register.md` - classifies DDL metadata as commercial-safe, Indian Kanoon and eCourts as internal-only, and HLDC as non-commercial.

## Architecture Decisions
- **Idempotent case fetch:** `POST /district/cases/:caseId/fetch-judgment` first checks `district_text_artifact.document_id` and open queue rows. Existing artifacts are returned instead of refetched.
- **Queue-backed acquisition:** The API inserts or reuses `district_acquisition_queue` rows using the existing source-order planner. Workers own network fetches, retries, cost/quota tracking, and artifact creation.
- **CNR-first matching:** Exact CNR match is required for high-confidence auto-linking. Metadata fallback matches must be stored with confidence and may require review before becoming searchable.
- **Artifact then document:** A successful source hit creates `district_text_artifact`, a `document` row, an initial `ingestion_job`, and a provenance row. The artifact stores source/license metadata and links back to `district_case`.
- **Redaction before retrieval:** All district judgment documents go through the existing `REDACT` step before `TRANSLATE`, `CHUNK`, and `EMBED`.
- **No raw redistribution:** UI may show status, source, linked document, and safe metadata. Raw Indian Kanoon/eCourts text display follows document sensitivity and license controls.

## Dependency Graph
```text
Phase 1 --> Phase 2 --> Phase 4 --> Phase 5 --> Phase 6
          \-> Phase 3 ----/
```

## Conventions
- Reuse existing route style in `apps/api/src/routes/district-analytics-routes.ts`.
- Reuse `district_acquisition_queue`, `district_fetch_attempt`, and `district_text_artifact`; avoid duplicate workflow tables.
- Store source provenance and license classification on every source, artifact, document metadata, and fetch attempt.
- Treat HLDC as `commercial_safe=false` and exclude it from commercial-safe retrieval.

---

## Phase 1: API Fetch Contract
**Dependencies:** none

**Description:**
Add an idempotent API endpoint that lets the UI request judgment acquisition for one district case and inspect the current fetch state.

**Tasks:**
1. Add `POST /api/v1/workspaces/:wid/district/cases/:caseId/fetch-judgment` in `apps/api/src/routes/district-analytics-routes.ts`.
2. Check workspace/case existence, existing `district_text_artifact` rows, existing linked `document_id`, and pending/processing queue rows before inserting new queue rows.
3. Use source planning semantics from `apps/worker/src/district/acquisition_queue.py` in TypeScript or create a small shared SQL/API-side planner with the same rules.
4. Return a compact status payload: `case_id`, `text_status`, `document_id`, `artifact_id`, queue rows, last attempts, and `already_available`.
5. Add route tests in `apps/api/src/__tests__/routes/district-analytics-routes.test.ts`.

**Files to create/modify:**
- `apps/api/src/routes/district-analytics-routes.ts` - endpoint and status response.
- `apps/api/src/__tests__/routes/district-analytics-routes.test.ts` - idempotency, artifact reuse, and queue insertion coverage.

**Acceptance criteria:**
- Clicking fetch on a case with an existing artifact returns the linked document without creating duplicate queue rows.
- Clicking fetch on a metadata-only case creates pending queue rows in approved source order.
- Repeated clicks are safe and return the same pending/available state.

---

## Phase 2: Indian Kanoon Acquisition Worker
**Dependencies:** Phase 1

**Description:**
Implement the first live source because it can return clean text and avoids OCR when a match exists.

**Tasks:**
1. Add a district acquisition poller that locks one `district_acquisition_queue` row with `FOR UPDATE SKIP LOCKED`.
2. Implement Indian Kanoon search and document fetch in `apps/worker/src/sources/indian_kanoon_district.py` using exact CNR first, then conservative metadata fallback.
3. Record every hit, miss, duplicate, HTTP error, rate-limit, and cost event in `district_fetch_attempt`.
4. On a high-confidence hit, write the text/HTML artifact to configured storage, create `district_text_artifact`, create/link a `document`, insert a `VALIDATE` ingestion job, and mark the queue row `succeeded`.
5. Add worker tests for hit, miss, duplicate, rate-limit retry, and low-confidence fallback.

**Files to create/modify:**
- `apps/worker/src/district/acquisition_worker.py` - queue polling and status transitions.
- `apps/worker/src/sources/indian_kanoon_district.py` - live API client and parser.
- `apps/worker/tests/test_district_acquisition_queue.py` - queue execution tests.
- `apps/worker/config/` - source config for API key, quota, and rate limits.

**Acceptance criteria:**
- A queued Indian Kanoon row can become `succeeded`, `miss`, `rate_limited`, or `failed` with a durable fetch-attempt row.
- Successful hits create exactly one linked artifact and one linked document.
- The normal ingestion pipeline receives a `VALIDATE` job for the created document.

---

## Phase 3: eCourts Fallback and CAPTCHA Handling
**Dependencies:** Phase 1

**Description:**
Implement official eCourts fallback while respecting the documented CAPTCHA and rate-limit policy.

**Tasks:**
1. Extend `apps/worker/src/sources/ecourts_district.py` from payload planning to a real CNR lookup adapter.
2. If CAPTCHA is encountered and no approved solver is configured, write `captcha_required`, mark the queue row `blocked` or `rate_limited`, and expose the status to the UI.
3. If an order/PDF is fetched, store source PDF artifact metadata with `license_classification='internal_only'`, checksum, source URL, and bytes.
4. Add strict per-source rate limits, backoff, and stop-window logic using the existing `ECourtsRateLimit` helper.
5. Add tests for PDF hit, miss, CAPTCHA required, rate-limited retry, and blocked-by-policy.

**Files to create/modify:**
- `apps/worker/src/sources/ecourts_district.py` - CNR fetch adapter.
- `apps/worker/src/district/acquisition_worker.py` - eCourts execution branch.
- `apps/worker/tests/test_district_acquisition_queue.py` - fallback and policy tests.
- `docs/legal/captcha-strategy.md` - update only if policy changes are explicitly approved.

**Acceptance criteria:**
- eCourts fetches never bypass CAPTCHA policy by default.
- Every eCourts attempt is visible in `district_fetch_attempt`.
- A successful PDF fetch links to the district case and enters the document ingestion pipeline.

---

## Phase 4: Artifact, Document, and Judgment Metadata Linkage
**Dependencies:** Phase 2, Phase 3

**Description:**
Make fetched judgments first-class documents while preserving their district-case linkage for analytics and retrieval.

**Tasks:**
1. Create a helper to insert document rows for district artifacts with metadata including CNR, district case ID, source name, license classification, court, state, district, statutes, sections, decision date, and source URL.
2. Link `district_text_artifact.document_id` to the document and set `district_case.text_status` through the existing artifact trigger.
3. Ensure deterministic district metadata is merged into `judgment_metadata` during `METADATA_EXTRACT`.
4. Ensure `chunk.metadata` and retrieval filters preserve CNR, state, district, court level, language, translation, redaction, and commercial safety.
5. Refresh district analytics facts after successful artifact ingestion, or mark a refresh-needed flag for the existing refresh endpoint.

**Files to create/modify:**
- `apps/worker/src/district/artifact_document.py` - artifact storage and document creation helper.
- `apps/worker/src/pipeline/metadata_extractor.py` - verify/extend district metadata merge.
- `apps/worker/src/pipeline/chunker.py` - verify/extend district metadata propagation.
- `apps/api/src/retrieval/judgment-filters.ts` - verify district document filters.

**Acceptance criteria:**
- The case drilldown shows a linked document after successful acquisition.
- Retrieval can scope to the fetched judgment by CNR/case metadata after ingestion completes.
- Commercial-safe filtering excludes internal-only/non-commercial artifacts when required.

---

## Phase 5: Drilldown UI Fetch Experience
**Dependencies:** Phase 4

**Description:**
Add the user-facing button and status states in the same Case Drilldown card.

**Tasks:**
1. Add a "Fetch judgment" button to `apps/web/src/components/analytics/DistrictCaseDrilldown.tsx`.
2. Disable or relabel the button when an artifact/document already exists, when a queue row is pending/processing, or when the case is blocked by policy.
3. Show status chips for Available, Pending, Indian Kanoon miss, eCourts CAPTCHA required, Failed, or Blocked.
4. Link to the created document detail page when `document_id` exists.
5. Hide raw provider payloads; display source, license, last attempt, and safe metadata only.

**Files to create/modify:**
- `apps/web/src/components/analytics/DistrictCaseDrilldown.tsx` - fetch button, linked document, and status display.
- `apps/web/src/pages/DistrictAnalyticsPage.tsx` - no major changes expected beyond query invalidation if needed.

**Acceptance criteria:**
- User can request fetch from the selected case card.
- User can see whether the judgment is already available without refetching.
- User can open the linked document once ingestion creates it.

---

## Phase 6: Integration and Release Verification
**Dependencies:** Phase 1, Phase 2, Phase 3, Phase 4, Phase 5

**Description:**
Validate the complete case-to-judgment acquisition loop, including source misses, retries, security controls, and local/cloud behavior.

**Tasks:**
1. Run API route tests, worker acquisition tests, and web build.
2. Run a local Playwright smoke against Cloud SQL: fetch existing artifact, enqueue new fetch, observe pending status, and verify no duplicate queue rows.
3. Run a controlled source smoke with a small approved CNR list and record hit/miss/CAPTCHA outcomes.
4. Verify that POCSO/sexual-offence documents remain redacted before retrieval and external translation.
5. Update `docs/reports/` with source hit rates, queue outcomes, and any policy blockers.

**Files to create/modify:**
- `e2e/tests/intellirag-district-court.spec.ts` - UI fetch smoke when stable.
- `docs/reports/` - acquisition pilot report.

**Acceptance criteria:**
- A fetched judgment is linked to its `district_case` and is not fetched again on repeated visits.
- Failed/missed/CAPTCHA-required cases show actionable status in the UI.
- No internal-only or non-commercial raw text is exposed outside the approved retrieval/display controls.
- All relevant tests and local smoke checks pass.
