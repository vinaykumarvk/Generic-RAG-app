# District Court Data Contract

This contract defines how district-court metadata, source documents, extracted text, translations, redactions, analytics facts, and RAG-ready chunks must be represented before implementation starts. It is intentionally separate from the Supreme Court and High Court AWS Open Data contract because district-court records are metadata-heavy, multilingual, and source-fragmented.

## Contract Principles

- Metadata-only cases are first-class records. They must not create `document` rows until there is an eligible text or PDF artifact to process.
- CNR is the preferred join key across DDL, eCourts, Indian Kanoon, HLDC, and future datasets. If a source has no CNR, preserve the source identifier and record the match confidence.
- Original-language text is canonical. OCR, redacted text, and translations are derived artifacts with their own provenance.
- Every source record must carry source, license, dataset version, retrieval timestamp, and checksum where content exists.
- Sensitive records must be redacted or restricted before user-facing retrieval.
- Non-commercial content must be physically and logically partitioned so commercial-safe retrieval can exclude it.

## Source Classifications

| Classification | Meaning | Retrieval behavior |
|---|---|---|
| `commercial_safe` | Approved for commercial product use subject to attribution and source obligations. | May be used when `COMMERCIAL_MODE=true`. |
| `internal_only` | Can support internal RAG/analysis, but raw content must not be redistributed. | Retrieval may cite snippets only when policy allows. |
| `non_commercial` | Research or non-commercial use only. | Excluded when `COMMERCIAL_MODE=true`. |
| `blocked` | Do not ingest until legal review changes the classification. | Not loaded or queried. |
| `pending_review` | Metadata may be tracked, but content ingestion is blocked. | Not exposed to retrieval. |

## Canonical Entities

### `district_case`

One normalized case row per CNR or source case identifier.

Required fields:

- `district_case_id`
- `cnr`
- `source_case_id`
- `state_code`
- `state_name`
- `district_code`
- `district_name`
- `court_code`
- `court_name`
- `court_level`
- `case_type`
- `filing_date`
- `registration_date`
- `decision_date`
- `disposition`
- `acts_cited`
- `sections_cited`
- `offence_categories`
- `judge_position`
- `metadata_source`
- `dataset_version`
- `commercial_safe`
- `sensitive_data_flags`
- `created_at`
- `updated_at`

Rules:

- `cnr` should be unique per workspace/source when available.
- `acts_cited`, `sections_cited`, and `offence_categories` must be normalized arrays, not raw semicolon-delimited strings.
- Party names are optional and must be omitted or redacted for protected victims, minors, witnesses, or sealed records.
- Raw source fields should be preserved under `source_payload` for audit, but analytics must use normalized columns.

### `district_case_event`

Case lifecycle events derived from DDL/eCourts metadata and text-bearing documents.

Required fields:

- `district_case_event_id`
- `district_case_id`
- `event_type`
- `event_date`
- `event_label`
- `source_name`
- `source_confidence`
- `metadata`

Allowed `event_type` values:

- `filing`
- `registration`
- `hearing`
- `order`
- `bail_order`
- `charge_framing`
- `judgment`
- `disposal`
- `transfer`
- `appeal_link`
- `status_refresh`

### `district_case_source`

Source-specific provenance for each case.

Required fields:

- `district_case_source_id`
- `district_case_id`
- `source_name`
- `source_url`
- `source_case_id`
- `license`
- `license_classification`
- `dataset_version`
- `retrieved_at`
- `checksum_sha256`
- `raw_storage_uri`
- `metadata`

Rules:

- For metadata-only sources, `checksum_sha256` can be the source-row checksum.
- For PDFs/text, `checksum_sha256` must be the content checksum.
- `raw_storage_uri` should point to GCS or another object store, not local disk.

### `district_text_artifact`

Text-bearing or binary artifacts linked to a district case and optionally to an IntelliRAG `document`.

Required fields:

- `district_text_artifact_id`
- `district_case_id`
- `document_id`
- `artifact_type`
- `source_name`
- `source_url`
- `storage_uri`
- `mime_type`
- `language`
- `script`
- `text_quality_score`
- `ocr_required`
- `ocr_provider`
- `ocr_confidence`
- `redaction_status`
- `translation_status`
- `license_classification`
- `commercial_safe`
- `checksum_sha256`
- `created_at`

Allowed `artifact_type` values:

- `source_pdf`
- `source_html`
- `source_text`
- `ocr_text`
- `redacted_text`
- `translated_text`
- `metadata_only`

Rules:

- Only `source_pdf`, `source_text`, `ocr_text`, `redacted_text`, or `translated_text` may create `document` rows.
- `metadata_only` artifacts are audit records and must not enter chunking.
- `redaction_status` must be `redacted` or `not_required` before retrieval for protected sexual-offence records.

### `district_translation`

Derived translation records aligned to a source artifact, document, or chunk.

Required fields:

- `district_translation_id`
- `district_text_artifact_id`
- `document_id`
- `chunk_id`
- `source_language`
- `target_language`
- `provider`
- `model_name`
- `provider_version`
- `glossary_version`
- `translation_confidence`
- `qa_status`
- `cost_units`
- `created_at`

Allowed `qa_status` values:

- `pending`
- `sampled`
- `approved`
- `rejected`
- `needs_review`

Rules:

- Translation must never overwrite original text.
- Chunk-aligned translations should preserve source chunk IDs in metadata.
- Translations produced after redaction must record the redaction artifact used as input.

### `district_fetch_attempt`

Operational log for all external source lookups.

Required fields:

- `district_fetch_attempt_id`
- `district_case_id`
- `source_name`
- `attempted_at`
- `outcome`
- `http_status`
- `bytes`
- `rate_limit_delay_ms`
- `captcha_outcome`
- `cost_units`
- `notes`

Allowed `outcome` values:

- `hit`
- `miss`
- `captcha_required`
- `captcha_failed`
- `rate_limited`
- `http_error`
- `ocr_failed`
- `blocked_by_policy`
- `duplicate`

### `district_case_fact_daily`

Dashboard-ready facts, refreshed by batch job.

Required dimensions:

- `fact_date`
- `state_code`
- `district_code`
- `court_level`
- `case_type`
- `statute`
- `section`
- `offence_category`
- `disposition`
- `language`
- `source_name`
- `license_classification`
- `commercial_safe`

Required measures:

- `metadata_case_count`
- `criminal_target_count`
- `text_available_count`
- `ocr_required_count`
- `translated_count`
- `redacted_count`
- `rag_active_count`
- `fetch_failed_count`
- `avg_days_registration_to_decision`
- `p95_days_registration_to_decision`

## Integration With Existing Tables

- `document.metadata` must include district source fields when a district artifact creates a document.
- `judgment_metadata.cnr`, `court_code`, `court_name`, `court_level`, `decision_date`, `disposal_nature`, `statutes`, `sections`, `source_uri`, `source_license`, `sensitive_data_flags`, and `redaction_status` must be populated from deterministic district fields before LLM enrichment.
- `chunk.legal_metadata` must include CNR, state, district, court level, statute, section, disposition, source language, translation status, commercial safety, and source artifact ID.
- `review_queue` must receive low-confidence OCR, low-confidence translation, redaction uncertainty, and license-policy exceptions.

## Redaction Policy Contract

Always redact before retrieval or external translation:

- Victim names and aliases in POCSO or sexual-offence cases.
- Minor names, school names, addresses, guardians, and dates of birth when they can identify a child.
- Witness names where the order indicates confidentiality or protected identity.
- Phone numbers, Aadhaar, PAN, email addresses, and exact residential addresses.
- Medical identifiers, school identifiers, and sealed-record details.

Preserve when legally safe:

- Court name, judge name, counsel name, police station, FIR number, statute, section, case number, CNR, generalized district/state, and final outcome.
- Accused names only when public-record use is approved by policy and the record is not restricted.

## Translation Policy Contract

- Original-language text must remain available for audit and citation.
- English translation is a derived artifact for retrieval and user comprehension.
- Sensitive protected text must be redacted before external translation.
- Translation providers must be recorded per artifact and must be disabled for records whose sensitivity policy forbids external processing.
- Glossary version must be stored so translations can be regenerated when legal terminology changes.

## Analytics Contract

Analytics APIs must query aggregate tables or materialized views for dashboard pages. They must not scan raw district-case tables for common dashboard requests.

Required filters:

- State
- District
- Court level
- Court code
- Date range
- Statute
- Section
- Offence category
- Disposition
- Language
- Source
- Text availability
- Translation availability
- Redaction status
- License classification
- Commercial-safe only

Required dashboard outputs:

- Metadata coverage
- Text acquisition coverage
- Source hit/miss/failure rates
- Translation coverage and QA status
- Redaction queue size
- Case volume over time
- Outcome distribution
- Delay distribution
- Offence/statute distribution

