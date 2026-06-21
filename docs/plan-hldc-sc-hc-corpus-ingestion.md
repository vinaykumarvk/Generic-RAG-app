# Development Plan: HLDC, Supreme Court, and High Court Corpus Ingestion

## Overview
Build a governed corpus ingestion path for three legal sources: HLDC Hindi district-court text, AWS Open Data Supreme Court judgments, and AWS Open Data High Court judgments. The goal is to first stage raw corpora in GCP, then catalog source metadata, then enqueue controlled batches through redaction, translation, chunking, embedding, KG extraction, and legal wiki generation.

## Assumptions
- GCP work should run under `vk@adssoftek.com` on project `policing-apps`; the currently active local gcloud account is `vkumar@primesoft.net` and does not have Cloud Run access to `policing-apps`.
- HLDC is non-commercial (`CC-BY-NC`) and must remain physically and logically separated from commercial-safe retrieval.
- AWS Supreme Court and High Court judgment buckets are treated as commercial-safe only with source attribution and preserved provenance.
- We should not create `document` rows for every mirrored object immediately; first create a manifest/catalog, then enqueue ingestion in batches.
- "DDL format from HLDC" means DDL-compatible normalized fields in `district_case`, not exact DDL source rows, because HLDC may not contain every structured DDL column.

## Codebase Findings
- `apps/worker/src/sources/ddl_metadata.py` - defines the normalized `DistrictCaseRecord` contract and `upsert_records` path for `district_case`.
- `apps/worker/src/sources/hldc.py` - currently normalizes only stable id, text, language, and non-commercial license classification.
- `apps/api/src/migrations/028_district_court_foundation.sql` - stores district metadata in `district_case`, `district_case_source`, `district_target_cnr`, and `district_fetch_attempt`.
- `apps/api/src/migrations/029_district_text_acquisition.sql` - links source text artifacts to district cases through `district_text_artifact`.
- `apps/worker/src/district/artifact_document.py` - creates linked `document`, `district_text_artifact`, provenance, and initial `ingestion_job` rows for district-court text.
- `apps/api/src/routes/document-routes.ts` - already knows both AWS buckets: `indian-supreme-court-judgments` and `indian-high-court-judgments`.
- `apps/web/src/components/documents/AwsJudgmentImport.tsx` - UI currently exposes only the High Court repository for dropdown import.
- `apps/worker/src/job_poller.py` - pipeline already runs `VALIDATE -> SPLIT -> NORMALIZE -> CONVERT -> METADATA_EXTRACT -> REDACT -> TRANSLATE -> CHUNK -> EMBED`, with optional `KG_EXTRACT`.
- `docs/legal/district-court-source-register.md` - classifies HLDC as `non_commercial` and AWS SC/HC buckets as commercial-safe with provenance controls.

## Architecture Decisions
- **Raw mirror before processing**: Copy HLDC and AWS SC/HC source files to GCS first, then ingest from GCS. This avoids API request timeouts, browser-driven bulk work, and repeated cross-cloud downloads.
- **Manifest-first ingestion**: Add a source object manifest that records bucket/key/path/checksum/license/status before document creation. This supports restartable ingestion and cost/rate control.
- **HLDC metadata as DDL-compatible, not DDL-identical**: Normalize whatever can be deterministically extracted into `district_case`, keep the raw HLDC payload in `source_payload`, and attach a metadata confidence score.
- **Source partitioning**: HLDC documents, chunks, translations, KG nodes, and wiki articles must carry `commercial_safe=false` and `license_classification=non_commercial`.
- **Batch pipeline**: Enqueue SC/HC ingestion in court/year batches and HLDC in sampled then scaled batches. KG and wiki should run only after chunk quality is acceptable.

## Dependency Graph
```text
Phase 1 --> Phase 2 --> Phase 4 --> Phase 6
       \              \-> Phase 5 --> Phase 6
        \-> Phase 3 ----------------> Phase 6
```

## Conventions
- Use `source_name=hldc`, `source_name=aws_supreme_court`, and `source_name=aws_high_court`.
- Preserve source object URI, original source URL, checksum, dataset version, license, and source payload on every catalog/document row.
- Do not expose HLDC-derived text, translations, KG, or wiki in commercial-safe retrieval.
- Use resumable/retryable GCP jobs for all bulk copy and ingest work.
- Keep every phase independently testable with a small pilot before scaling.

---

## Phase 1: Source Access and GCP Staging
**Dependencies:** none

**Description:**
Prepare the correct GCP identity and durable GCS staging paths for HLDC, Supreme Court, and High Court corpora.

**Tasks:**
1. Switch and verify GCP identity with `gcloud config set account vk@adssoftek.com` and `gcloud config set project policing-apps`.
2. Verify IAM permissions for Cloud Storage, Cloud Run Jobs, Artifact Registry, Secret Manager, and Cloud SQL.
3. Create or confirm staging prefixes:
   - `gs://police-cases-kb-uploads-809677427844/legal-corpus/raw/hldc/`
   - `gs://police-cases-kb-uploads-809677427844/legal-corpus/raw/aws/supreme_court/`
   - `gs://police-cases-kb-uploads-809677427844/legal-corpus/raw/aws/high_court/`
4. Define retention and lifecycle rules for raw, normalized, and failed objects.

**Files to create/modify:**
- `docs/runbooks/legal-corpus-gcp-staging.md` - account, bucket, prefix, IAM, and retry instructions.

**Acceptance criteria:**
- `gcloud auth list` shows `vk@adssoftek.com` active.
- `gcloud config get-value project` returns `policing-apps`.
- GCS prefixes are writable from the worker/job service account.

---

## Phase 2: Corpus Manifest and Bulk Mirror
**Dependencies:** Phase 1

**Description:**
Create a durable manifest for external source objects and mirror source files into GCS without creating application documents yet.

**Tasks:**
1. Add a manifest table for source objects with source name, source bucket, source key, GCS URI, size, ETag/checksum, license, copy status, ingest status, and error metadata.
2. Build a Cloud Run Job or worker script to list AWS public S3 objects and copy them to GCS in restartable batches.
3. Build an HLDC fetch/stage job that downloads the official release files into GCS and writes manifest rows.
4. Support dry-run, limit, prefix/year/court filters, and resume by manifest status.
5. Add counts by source, court/year, status, copied bytes, and failures.

**Files to create/modify:**
- `apps/api/src/migrations/034_legal_corpus_manifest.sql` - source object manifest and indexes.
- `apps/worker/scripts/mirror_legal_corpus_to_gcs.py` - S3/HLDC listing and GCS copy.
- `apps/worker/Dockerfile.corpus` - Cloud Run Job image for bulk mirror/catalog work.
- `apps/worker/tests/test_legal_corpus_manifest.py` - manifest normalization and idempotency tests.

**Acceptance criteria:**
- A 100-object AWS High Court dry run writes manifest rows without creating `document` rows.
- A 100-object copy pilot writes source PDFs to GCS and marks manifest rows copied.
- HLDC staging writes source release metadata and marks all rows `commercial_safe=false`.

---

## Phase 3: HLDC DDL-Compatible Metadata Extraction
**Dependencies:** Phase 1

**Description:**
Extend the HLDC loader so each HLDC document can create or link a `district_case` row with DDL-compatible metadata where available.

**Tasks:**
1. Extend `HldcRecord` to carry normalized district metadata fields:
   - `source_case_id`, `cnr`, `state_code`, `state_name`, `district_code`, `district_name`
   - `court_name`, `court_level`, `case_type`, `decision_date`, `disposition`
   - `acts_cited`, `sections_cited`, `offence_categories`, `sensitive_data_flags`
   - `language`, `source_confidence`, `license_classification`, `commercial_safe`
2. Add deterministic parsing for CNR, court name, district name, dates, acts, sections, and bail outcome labels.
3. Reuse `DistrictCaseRecord` / `upsert_records` where possible; otherwise add an adapter that produces the same database columns.
4. Store ambiguous or unavailable fields as `NULL`, not fabricated values.
5. Preserve the full HLDC JSON record in `source_payload`.
6. Add match confidence and a mapping report: exact CNR match, fuzzy court/date match, HLDC-only case, and unmapped.

**Files to create/modify:**
- `apps/worker/src/sources/hldc.py` - richer metadata normalization.
- `apps/worker/scripts/ingest_hldc_corpus.py` - staged HLDC to `district_case`, `district_text_artifact`, and `document` rows.
- `apps/worker/tests/test_hldc_metadata_loader.py` - DDL-compatible mapping and non-commercial partition tests.
- `docs/reports/hldc-metadata-mapping-report.md` - pilot field coverage report.

**Acceptance criteria:**
- HLDC sample records normalize into `district_case`-compatible records.
- Missing DDL fields remain null with raw source preserved.
- All HLDC rows have `license_classification=non_commercial` and `commercial_safe=false`.
- Pilot report shows coverage for CNR, district, court, date, acts, sections, and bail/disposition fields.

---

## Phase 4: Controlled Document Ingestion From GCS
**Dependencies:** Phase 2, Phase 3

**Description:**
Create documents from copied GCS objects in controlled batches and run the normal ingestion pipeline.

**Tasks:**
1. Add a manifest-to-document enqueue job that creates `document` rows only for selected copied manifest objects.
2. For AWS SC/HC, set category `judgment`, subcategory `Supreme Court` or `High Court`, source path, AWS metadata, and `license=CC BY 4.0`.
3. For HLDC, create linked district documents with `district_text_artifact`, `document.metadata.district`, and `language=hi`.
4. Add batch controls: source, court, year, max documents, concurrency, retry failed only.
5. Update source dashboards with copied, queued, searchable, failed, translated, KG-ready, and active counts.

**Files to create/modify:**
- `apps/worker/scripts/enqueue_legal_corpus_documents.py` - manifest to `document` and `ingestion_job`.
- `apps/api/src/routes/legal-corpus-routes.ts` - source status and batch enqueue endpoints.
- `apps/web/src/components/admin/LegalCorpusDashboard.tsx` - operator dashboard.
- `apps/worker/tests/test_legal_corpus_enqueue.py` - idempotent document creation tests.

**Acceptance criteria:**
- A 25-document AWS SC pilot becomes `SEARCHABLE` or `ACTIVE` without duplicate documents.
- A 25-document HLDC pilot creates linked district artifacts and proceeds through translation.
- Failed rows remain restartable from manifest status.

---

## Phase 5: KG and Legal Wiki Batch Enablement
**Dependencies:** Phase 4

**Description:**
Run KG extraction and legal wiki generation gradually after searchable chunks exist.

**Tasks:**
1. Confirm `kg_extraction` feature flag and worker capacity before enabling broad KG jobs.
2. Add batch selection rules for court/source/year/legal topic to avoid uncontrolled API cost.
3. Store KG quality reports for judgment extraction and keep low-confidence assertions in review.
4. Generate wiki articles only from approved or high-confidence KG/chunk evidence.
5. Enforce anti-circularity: wiki and KG can aid retrieval, but legal answers must cite raw judgment chunks.
6. Add source partition checks so HLDC-derived wiki/KG cannot appear in commercial-safe mode.

**Files to create/modify:**
- `apps/worker/scripts/enqueue_kg_for_corpus.py` - KG batch enqueue.
- `apps/worker/scripts/generate_legal_wiki_from_corpus.py` - wiki batch generation.
- `apps/api/src/retrieval/wiki-selector.ts` - verify commercial-safe source partitioning.
- `apps/worker/tests/test_hldc_commercial_safe_gate.py` - HLDC retrieval/wiki exclusion tests.

**Acceptance criteria:**
- KG extraction can be enabled for a bounded pilot and stopped cleanly.
- Wiki articles cite source judgments and carry source corpus metadata.
- HLDC-derived KG/wiki content is excluded when commercial-safe mode is active.

---

## Phase 6: Integration, Monitoring, and Scale-Up
**Dependencies:** Phase 2, Phase 3, Phase 4, Phase 5

**Description:**
Validate the combined pipeline, then scale source by source using operational dashboards and cost gates.

**Tasks:**
1. Run pilot sequence: 100 HLDC, 100 SC, 100 HC.
2. Review extraction quality: OCR quality, metadata confidence, translation QA, chunk count, embedding success, KG quality.
3. Scale in waves by source/year/court, with stop conditions for failure rate, translation cost, OCR failure, and KG quality.
4. Add scheduled reports for corpus counts, bytes copied, documents active, chunks, vectors, KG nodes/edges, wiki articles, and failed items.
5. Document rollback/retry operations.

**Files to create/modify:**
- `docs/reports/legal-corpus-pilot-report.md` - pilot results and scale decision.
- `docs/runbooks/legal-corpus-operations.md` - monitoring, retry, rollback, and cost controls.

**Acceptance criteria:**
- Pilot reports show acceptable document ingestion, translation, embedding, and KG quality.
- Batch scale-up is restartable and source-filtered.
- Operator can answer: how much is copied, how much is ingested, how much is searchable, and what failed.
