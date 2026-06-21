# Development Plan: District Court Ingestion and Analytics

## Overview
Build a district-court data layer that treats metadata, source documents, extracted text, translations, analytics, and RAG retrieval as separate but linked products. The core strategy is metadata-first: load millions of district-court case records into dedicated case tables, use filters to decide which CNRs deserve text acquisition, then pass only text-bearing artifacts into the existing document ingestion pipeline.

## Assumptions
- The first production slice remains criminal-law focused: POCSO, IPC 302, 354, 363-366, 375, 376, BNS equivalents, NDPS, and JJ Act.
- Initial state scope is UP, Maharashtra, Karnataka, Tamil Nadu, and Delhi unless a narrower pilot state is chosen.
- Metadata-only records can be stored in Cloud SQL, but high-volume raw source archives and intermediate Parquet files should live in object storage.
- The existing `document`, `ingestion_job`, `chunk`, `judgment_metadata`, and KG tables remain the authoritative pipeline for text-bearing documents.
- HLDC and any other non-commercial corpus must be physically and logically partitioned from commercial-safe corpora.
- Translation should preserve the original text and store English output as a derived artifact, not overwrite the source language.
- eCourts CAPTCHA handling requires legal and operational approval before any automated solver is used.

## Codebase Findings
- `docs/DISTRICT_COURT_INGESTION_BRIEF.md` - Existing brief correctly identifies that district courts have no AWS-equivalent bulk full-text source, so the ingestion model must be metadata-first and targeted.
- `docs/JUDGMENT_INGESTION_BRIEF.md` - Existing SC/HC plan assumes AWS Open Data PDFs and metadata; district court work should extend the same source-adapter model but cannot reuse the same source economics.
- `apps/api/src/migrations/006_documents.sql` - The current `document` table is designed for files that enter the ingestion pipeline. It should not be used as the primary table for millions of metadata-only district cases.
- `apps/api/src/migrations/025_judgment_metadata.sql` - Judgment-specific metadata, statute sections, parties, outcomes, redaction status, and provenance already exist and should be populated when a district case has text.
- `apps/worker/src/job_poller.py` - The worker already processes `VALIDATE -> SPLIT -> NORMALIZE -> CONVERT -> METADATA_EXTRACT -> CHUNK -> EMBED -> KG_EXTRACT`. District acquisition should enqueue into this flow instead of duplicating it.
- `apps/worker/src/pipeline/normalizer.py` - Text extraction, OCR fallback, language detection, and extraction-result storage already exist, but district courts need stronger OCR quality scoring, regional language packs, and redaction before external translation.
- `apps/worker/src/pipeline/metadata_extractor.py` - The LLM metadata prompt already has judgment fields including CNR, court level, statutes, outcomes, sensitive flags, and redaction status. It needs district-specific deterministic metadata merging from DDL/eCourts before LLM enrichment.
- `apps/api/src/routes/document-routes.ts` and `apps/web/src/components/documents/AwsJudgmentImport.tsx` - Existing AWS import UI/API are useful patterns for source browsing and enqueueing, but district imports need queue-based batch acquisition rather than user-selected PDF-only import.
- `apps/api/src/routes/ingestion-routes.ts` and `apps/web/src/components/admin/IngestionMonitor.tsx` - There is an ingestion-monitor pattern, but district source health needs source-level run stats, CNR coverage, text coverage, translation coverage, and dashboard aggregates.
- `apps/api/src/retrieval/judgment-filters.ts` and `apps/api/src/retrieval/pipeline.ts` - Retrieval already supports judgment filters and case-specific scoping. District metadata should feed these filters with court, state, district, statute, section, disposition, language, and text-availability dimensions.

## Architecture Decisions
- **Separate metadata lake from document pipeline**: Create `district_case` and related tables for metadata-only records. Create `document` rows only when a judgment/order text, PDF, IK text, or HLDC record is ready for processing.
- **Use CNR as the district-court spine**: Normalize all DDL, eCourts, Indian Kanoon, HLDC, and future sources around CNR where available, with source-specific alternate IDs when CNR is missing.
- **Store original and derived text separately**: Raw text, OCR text, redacted text, and translated English text must each have provenance, provider, confidence, checksum, and license fields.
- **Run text acquisition as a queue, not a request/response action**: Indian Kanoon lookup, eCourts fetch, OCR, redaction, and translation should be background jobs with retries and rate limits.
- **Support analytics before full-text coverage is complete**: Metadata dashboards can be useful immediately after DDL/eCourts metadata load, even before documents are downloaded.
- **Use materialized analytics tables for Cloud SQL**: Dashboards should query precomputed aggregates instead of scanning millions of district-case rows on every page load.
- **Keep bilingual retrieval explicit**: The source-language chunk and English translation chunk should both be searchable, with answers citing the original and optionally showing the translation.
- **Gate sensitive and non-commercial sources**: POCSO/rape records need redaction rules before display or external translation; HLDC requires `commercial_safe = false` and retrieval exclusion when commercial mode is enabled.

## Data Strategy
- **Metadata corpus**: DDL judicial data for 2010-2018, eCourts/NJDG-style live metadata for 2019-current where obtainable, and periodic eCourts refresh for status/disposition deltas.
- **Text corpus**: Indian Kanoon clean text first where matched; eCourts PDFs/orders second; HLDC Hindi UP text as non-commercial research corpus; later, other open datasets only after license review.
- **Translation corpus**: Source-language text stays canonical; English translation is derived per chunk/document using a provider, glossary, and confidence score.
- **Analytics corpus**: Case-level facts, event-level dates, source coverage, disposition outcomes, delay metrics, statute/section metrics, language/OCR quality, and ingestion health are computed into aggregate tables.
- **RAG corpus**: Only redaction-approved, license-allowed, text-bearing records enter `document`, `chunk`, `judgment_metadata`, and the KG.

## Core Entity Model
- `district_case`: one row per CNR/source case, including state, district, court, case type, filing/registration/decision dates, disposition, acts, sections, judge position, parties when legally safe, and source metadata.
- `district_case_event`: normalized lifecycle events such as filing, registration, hearing, order, judgment, bail, charge framing, disposal, transfer, and appeal linkage.
- `district_case_source`: source-specific identifiers, URLs, license, dataset version, checksums, and fetch timestamps.
- `district_text_artifact`: original PDF/text/OCR/redacted/translation artifacts linked to a CNR and optionally a `document_id`.
- `district_translation`: provider, model/version, source language, target language, glossary version, confidence, and QA status.
- `district_fetch_attempt`: every IK/eCourts/HLDC lookup attempt, outcome, status code, bytes, CAPTCHA outcome, and retry metadata.
- `district_case_fact_daily` and aggregate materialized views: dashboard-ready counts by state, district, court, statute, section, disposition, date bucket, source coverage, text coverage, and language.

## Analytics Strategy
- **Coverage dashboard**: total metadata records, criminal target count, text available, OCR required, translated, redacted, active in RAG, failed, and dead CNRs.
- **Case volume dashboard**: filings, registrations, decisions, and pending/disposed cases by state, district, court level, year, month, case type, statute, and section.
- **Outcome dashboard**: conviction, acquittal, bail granted/rejected, dismissed, compromise, withdrawal, transfer, and other normalized dispositions by offence category.
- **Delay dashboard**: filing-to-registration, registration-to-decision, FIR-to-disposal where available, and aging buckets by court/district/statute.
- **Language and text quality dashboard**: language distribution, OCR confidence, translation coverage, translation QA failures, redaction queue, and source extraction quality.
- **Source performance dashboard**: DDL load counts, IK hit rate, eCourts hit/miss/CAPTCHA/rate-limit stats, HLDC load status, cost estimates, and worker throughput.
- **Investigative/RAG filters**: state, district, court level, statute, section, disposition, date window, language, text availability, commercial-safe only, sensitive-data status, and source.

## Translation Strategy
- Detect language at document and chunk level using script detection plus `langdetect` or a more reliable Indic-language detector.
- Preserve the source-language text as the legal record. Store English translation as a derived artifact with provider, model, glossary, confidence, and review status. The approved default provider is OpenAI via the existing `OPENAI_API_KEY` / `OPEN_AI_API_KEY` secret by setting `TRANSLATION_PROVIDER=openai`.
- Chunk before translation for long documents, but keep chunk IDs aligned so original and translation can be cited together.
- Use a legal glossary for recurring terms: FIR, charge sheet, bail, cognizance, victim/prosecutrix, accused, compromise, hostile witness, acquittal, conviction, POCSO sections, IPC/BNS sections, and local court terms.
- For sensitive POCSO/rape cases, redact victim identifiers before sending text to any external translation API. Use local/offline translation for records that cannot leave the environment.
- Store both source-language and English embeddings if the embedding model is multilingual enough; otherwise store English embeddings for retrieval and source text for citation/display.
- Add QA sampling: back-translate or LLM-check a statistically significant sample by language, state, and provider before enabling translated text in user-facing answers.

## Dependency Graph
```text
Phase 1 --> Phase 2 --> Phase 3 --> Phase 4 --> Phase 5 --> Phase 7
              |           |           |           |
              |           |           v           v
              |           +--------> Phase 6 -----+
              v
            Phase 8
```

## Conventions
- Add database changes as numbered migrations under `apps/api/src/migrations/`.
- Use deterministic parsers and source metadata first; use LLM extraction only to enrich missing or unstructured fields.
- Keep large raw data outside Cloud SQL in GCS or another object store; store pointers, checksums, and normalized facts in Cloud SQL.
- Use `COPY`/staging-table loads for bulk metadata imports rather than row-by-row API inserts.
- Every source record must carry `source_name`, `source_url`, `license`, `dataset_version`, `retrieval_timestamp`, and `checksum_sha256` where content exists.
- All eCourts scraping must use explicit rate limits, backoff, fetch logs, and an operator-visible queue.
- Do not expose district-court sexual-offence text until redaction status is `redacted` or `not_required`.
- Do not include HLDC in commercial retrieval when `COMMERCIAL_MODE=true`.
- Keep tests with the code phase that introduces the behavior.

---

## Phase 1: Source Governance and Data Contracts
**Dependencies:** none

**Description:**
Define the legal, licensing, privacy, and schema contracts before data movement. This phase prevents a mixed-license or sensitive-data corpus from contaminating production retrieval.

**Tasks:**
1. Convert `docs/DISTRICT_COURT_INGESTION_BRIEF.md` into an approved source register covering DDL, eCourts, Indian Kanoon, HLDC, NyayaAnumana, and any future datasets.
2. Create a data contract for metadata-only cases, text-bearing artifacts, translations, redactions, and analytics facts.
3. Document source-specific license constraints, especially HLDC `CC-BY-NC`, Indian Kanoon ToS, and eCourts CAPTCHA/legal boundaries.
4. Define the canonical district filters in YAML: states, acts, sections, court levels, date windows, document types, and commercial-safety behavior.
5. Define PII/redaction policy for POCSO, rape, minors, witnesses, addresses, schools, phone numbers, Aadhaar/PAN, and sealed records.

**Files to create/modify:**
- `docs/DISTRICT_COURT_INGESTION_BRIEF.md` - Add final source-governance decisions and pilot scope.
- `docs/district-court-data-contract.md` - New contract for tables, required fields, licenses, and derived artifacts.
- `docs/legal/district-court-source-register.md` - New legal/source register.
- `docs/legal/captcha-strategy.md` - New CAPTCHA and rate-limit approval document.
- `apps/worker/config/district_filters.yaml` - New canonical filter file.

**Acceptance criteria:**
- Each source has an approved license classification: commercial-safe, internal-only, non-commercial, or blocked.
- The district filter config can express at least the current criminal-law scope.
- Redaction policy is explicit enough to implement as code without further legal interpretation.
- No implementation phase depends on an undocumented source or ambiguous license.

---

## Phase 2: Metadata Foundation
**Dependencies:** Phase 1

**Description:**
Load millions of district-court metadata rows into normalized, queryable tables without creating `document` rows. This creates the analytics foundation and the CNR universe for text acquisition.

**Tasks:**
1. Add district metadata migrations for case, event, source, target queue, fetch attempt, and aggregate tables.
2. Build a bulk loader for DDL Parquet/CSV files using DuckDB for local filtering and PostgreSQL `COPY` for Cloud SQL ingestion.
3. Normalize state, district, court, case type, court level, statute, section, disposition, and date fields.
4. Add a deterministic criminal-target classifier that maps DDL/eCourts fields to offence categories and source confidence.
5. Produce first count report: total rows, criminal target rows, rows by state/district/year/statute/disposition, and missing-CNR rate.
6. Store raw DDL/eCourts source archives in GCS with dataset version and checksum metadata.

**Files to create/modify:**
- `apps/api/src/migrations/028_district_court_foundation.sql` - District metadata and source tables.
- `apps/worker/src/sources/base.py` - Source adapter abstractions if not already present.
- `apps/worker/src/sources/ddl_metadata.py` - DDL loader and normalizer.
- `apps/worker/src/district/criminal_filter.py` - Deterministic offence classifier.
- `apps/worker/scripts/ingest_district_metadata.py` - CLI for metadata bootstrap and count reports.
- `apps/worker/tests/test_district_metadata_loader.py` - Loader and normalization tests.
- `docs/reports/district-metadata-pilot-counts.md` - First pilot count report.

**Acceptance criteria:**
- A single command loads a pilot DDL sample into district metadata tables without creating `document` rows.
- Criminal target filtering produces explainable offence-category tags.
- Metadata load is idempotent by CNR/source/dataset version.
- Count report includes state, district, year, statute, section, disposition, language when known, and missing-field rates.

---

## Phase 3: Text Acquisition Queue
**Dependencies:** Phase 2

**Description:**
Create a durable acquisition queue that decides which CNRs should get text, tries cheap clean-text sources first, and falls back to eCourts PDF/order fetches with rate limits.

**Tasks:**
1. Add queue statuses for text acquisition: `metadata_only`, `targeted`, `ik_pending`, `ik_hit`, `ik_miss`, `ecourts_pending`, `ecourts_hit`, `ocr_pending`, `text_ready`, `dead`, and `blocked`.
2. Implement Indian Kanoon district lookup by CNR and fallback heuristics using party/date/court/case-type metadata.
3. Implement eCourts CNR lookup and order/PDF fetch adapter with configurable rate limits, retry/backoff, and CAPTCHA outcome logging.
4. Implement HLDC loader as a separate non-commercial partition for UP Hindi text.
5. Link fetched text/PDF artifacts to `district_text_artifact`; create `document` rows only when an artifact is eligible for pipeline processing.
6. Add cost and quota accounting for Indian Kanoon and translation providers.

**Files to create/modify:**
- `apps/api/src/migrations/029_district_text_acquisition.sql` - Text artifact, acquisition queue, and source attempt schema.
- `apps/worker/src/sources/indian_kanoon_district.py` - IK lookup and text acquisition.
- `apps/worker/src/sources/ecourts_district.py` - eCourts CNR/order/PDF fetch adapter.
- `apps/worker/src/sources/hldc.py` - HLDC loader with non-commercial partitioning.
- `apps/worker/src/district/acquisition_queue.py` - Queue planner and worker logic.
- `apps/worker/tests/test_district_acquisition_queue.py` - Status transitions and idempotency.
- `apps/api/src/routes/district-source-routes.ts` - Admin APIs for source status and queue controls.

**Acceptance criteria:**
- A target CNR can move through IK lookup, eCourts fallback, artifact creation, and document enqueueing with complete provenance.
- One failed or duplicate CNR does not block the rest of the queue.
- eCourts fetches respect configured per-source rate limits and write every attempt to `district_fetch_attempt`.
- HLDC records are marked `commercial_safe = false` and excluded by commercial-safe retrieval filters.
- Operators can see source hit/miss/error counts through an API.

---

## Phase 4: Text Normalization, OCR, Redaction, and Judgment Metadata
**Dependencies:** Phase 3

**Description:**
Process fetched PDFs/text through the existing worker while adding district-specific OCR quality controls, redaction, and deterministic metadata merging.

**Tasks:**
1. Extend normalization to record text-layer quality, OCR provider, OCR confidence, language, script, and regional language pack used.
2. Add district-aware OCR configuration for Hindi, Marathi, Kannada, Tamil, and English.
3. Add a redaction stage before embedding/display for POCSO, rape, minors, witnesses, addresses, schools, phone numbers, Aadhaar/PAN, and sealed-record flags.
4. Merge deterministic district metadata into `judgment_metadata` before or alongside LLM metadata extraction.
5. Add review-queue entries for low OCR confidence, missing mandatory judgment fields, sensitive-data flags, and redaction uncertainty.
6. Add chunk metadata fields for CNR, state, district, court level, statute, section, disposition, source language, translation status, and commercial safety.

**Files to create/modify:**
- `apps/api/src/migrations/030_district_redaction_translation.sql` - Redaction log, text artifact quality, translation fields, and indexes.
- `apps/worker/src/pipeline/normalizer.py` - OCR quality, language/script metadata, and regional handling.
- `apps/worker/src/pipeline/redactor.py` - New PII and victim/witness redaction stage.
- `apps/worker/src/job_poller.py` - Add redaction step if implemented as a first-class ingestion step.
- `apps/worker/src/pipeline/metadata_extractor.py` - Merge district deterministic fields and write district-specific judgment metadata.
- `apps/worker/tests/test_district_redactor.py` - Redaction rule tests.
- `apps/worker/tests/test_district_judgment_metadata.py` - Metadata merge tests.

**Acceptance criteria:**
- District text-bearing artifacts produce normal `document`, `extraction_result`, `chunk`, and `judgment_metadata` rows.
- Sensitive sexual-offence records cannot become retrievable until redaction status is acceptable.
- OCR confidence and language metadata are populated for every processed district document.
- Deterministic CNR/state/district/statute fields survive LLM extraction and cannot be overwritten by hallucinated values.

---

## Phase 5: Translation and Bilingual Retrieval
**Dependencies:** Phase 4

**Description:**
Bring Hindi and regional-language text into a common platform by translating to English while preserving original-language citations and retrieval controls.

**Tasks:**
1. Add translation queue statuses and provider configuration for OpenAI, Google Cloud Translation, IndicTrans2, or another approved provider.
2. Build chunk-aligned translation so source chunks and English chunks can be linked one-to-one.
3. Add legal glossary enforcement for statutes, sections, roles, outcomes, and district-court terms.
4. Store translation artifacts with provider, model/version, glossary version, confidence, cost, and QA status.
5. Update embedding logic to support source-language embeddings, translated-English embeddings, or both based on model support.
6. Update answer generation to cite original text and show English translation when the source language is not English.
7. Add translation QA sampling and review workflow for low-confidence translations.

**Files to create/modify:**
- `apps/worker/src/pipeline/translator.py` - Translation provider, glossary, chunk alignment, and QA hooks.
- `apps/worker/src/pipeline/embedder.py` - Embedding policy for multilingual and translated chunks.
- `apps/api/src/retrieval/vector-search.ts` - Retrieval over source/translation embedding variants.
- `apps/api/src/retrieval/answer-generator.ts` - Bilingual citation and translation display behavior.
- `apps/web/src/components/conversation/ReferencesSection.tsx` - Show original language and translated excerpt.
- `apps/worker/config/legal_translation_glossary.yaml` - Controlled glossary.
- `apps/worker/tests/test_district_translation.py` - Translation artifact and glossary tests.

**Acceptance criteria:**
- Hindi UP documents can be ingested, translated, embedded, and retrieved in English queries.
- Original text remains available for citation/audit.
- Translations carry provider/version/confidence metadata and can be excluded if QA status is not approved.
- Sensitive records are redacted before external translation unless an approved local/offline provider is used.

---

## Phase 6: Analytics APIs and Dashboards
**Dependencies:** Phase 2, Phase 3, Phase 4

**Description:**
Expose district-court analytics that are useful even before all text is acquired: metadata coverage, criminal trends, delay/outcome metrics, source performance, and text/translation readiness.

**Tasks:**
1. Build materialized aggregate refresh jobs for case volume, outcomes, delay metrics, source coverage, text coverage, language/OCR quality, and translation coverage.
2. Add district analytics API endpoints with filters for state, district, court, date range, statute, section, offence category, disposition, language, source, and commercial-safe mode.
3. Add admin source dashboard for DDL/eCourts/IK/HLDC load status, quotas, hit rates, failure reasons, and queue depth.
4. Add user-facing analytics dashboards for case volume, outcomes, delays, offences, district/court comparisons, and text availability.
5. Add export endpoints for aggregate CSV downloads and filtered CNR lists for follow-up acquisition.
6. Add guardrails so sensitive or non-commercial fields are excluded from unauthorized analytics views.

**Files to create/modify:**
- `apps/api/src/migrations/031_district_analytics.sql` - Materialized views and aggregate tables.
- `apps/api/src/routes/district-analytics-routes.ts` - Analytics APIs.
- `apps/worker/src/district/analytics_refresh.py` - Aggregate refresh job.
- `apps/web/src/pages/DistrictAnalyticsPage.tsx` - Dashboard page.
- `apps/web/src/components/admin/DistrictSourceDashboard.tsx` - Source operations dashboard.
- `apps/web/src/components/analytics/DistrictCaseVolumeChart.tsx` - Case volume chart.
- `apps/web/src/components/analytics/DistrictOutcomeChart.tsx` - Outcome chart.
- `apps/web/src/components/analytics/DistrictCoveragePanel.tsx` - Coverage and quality panel.
- `apps/api/src/__tests__/routes/district-analytics-routes.test.ts` - API tests.

**Acceptance criteria:**
- Dashboard queries do not scan raw millions-row tables directly.
- Users can filter analytics by state, district, court level, statute, section, date, and disposition.
- Operators can see acquisition and translation bottlenecks by source and state.
- Commercial-safe mode excludes non-commercial and restricted-sensitive corpus contributions.

---

## Phase 7: RAG, KG, and Legal Wiki Integration
**Dependencies:** Phase 5, Phase 6

**Description:**
Use district-court metadata and text inside retrieval, graph extraction, and legal wiki synthesis without lowering citation quality or exposing restricted records.

**Tasks:**
1. Extend judgment retrieval filters for district/state/court-level/source-language/translation/commercial-safety dimensions.
2. Update query planning to route district analytics questions to analytics APIs and legal reasoning questions to triad retrieval.
3. Extend KG extraction prompts and ontology expectations for trial-court facts, witness credibility, evidence gaps, bail outcomes, sentencing, and procedural defects.
4. Add district-court legal wiki coverage gaps by statute/section/outcome/court level.
5. Add eval cases for district-court criminal retrieval, translation retrieval, analytics questions, and mixed metadata-plus-text questions.
6. Ensure answer journey panels expose source, translation, redaction, and commercial-safety decisions.

**Files to create/modify:**
- `apps/api/src/retrieval/judgment-filters.ts` - District filter support.
- `apps/api/src/retrieval/query-planner.ts` - Analytics-vs-RAG routing.
- `apps/api/src/retrieval/pipeline.ts` - District metadata and translation-aware retrieval.
- `apps/worker/src/pipeline/kg_extractor.py` - District trial-court extraction examples and validation.
- `docs/evaluations/district-court-pilot-eval-set.md` - Evaluation set.
- `e2e/tests/intellirag-district-court.spec.ts` - End-to-end district workflow test.

**Acceptance criteria:**
- A user can ask metadata questions, text questions, and comparative district-court questions with correct routing.
- Every generated legal answer cites original chunks and clearly labels translations.
- Restricted, unredacted, and non-commercial records are excluded when policy requires exclusion.
- District KG extraction creates reviewable assertions without mixing unverified source claims into approved wiki content.

---

## Phase 8: Pilot, Scale, and Release Verification
**Dependencies:** Phase 2, Phase 3, Phase 4, Phase 5, Phase 6, Phase 7

**Description:**
Run a controlled pilot before broad ingestion. The pilot should prove data quality, source reliability, translation quality, redaction safety, analytics usefulness, and operational cost.

**Tasks:**
1. Pilot one state first, preferably UP because it tests Hindi, HLDC, POCSO/IPC volume, and translation/redaction requirements.
2. Load at least 100,000 metadata records or a representative full district/year slice, whichever is smaller for the first run.
3. Acquire text for a stratified sample across courts, years, offences, and source paths.
4. Run redaction and translation QA on a statistically meaningful sample.
5. Run analytics refresh and validate dashboard totals against source-count reports.
6. Run retrieval evals for at least 50 district-court questions and 20 analytics questions.
7. Produce an operational report with source hit rates, cost per text-bearing document, OCR failure rate, translation confidence, redaction review rate, and estimated monthly scale cost.
8. Decide whether to scale to all five states, narrow the offence scope, or adjust source priorities.

**Files to create/modify:**
- `docs/reports/district-court-pilot-results.md` - Pilot results and release decision.
- `docs/reports/district-court-operational-costs.md` - Cost and throughput model.
- `docs/reviews/district-court-release-readiness.md` - Release checklist.
- `apps/worker/tests/fixtures/district/` - Pilot fixtures where license permits test fixtures.
- `e2e/tests/intellirag-district-court.spec.ts` - Final smoke test updates.

**Acceptance criteria:**
- Pilot reaches agreed metadata coverage and text-acquisition targets.
- Redaction and translation QA pass documented thresholds before user-facing enablement.
- Analytics numbers reconcile with source counts within an agreed tolerance.
- Retrieval eval meets the target relevance threshold and all answers cite allowed sources.
- Legal/source-governance sign-offs are attached for eCourts strategy, HLDC use, translation provider, and sensitive-data handling.
- The plan is ready for a scale/no-scale decision based on measured cost and quality, not assumptions.
