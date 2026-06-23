# District Court Source Register

This register records the approved source strategy for district-court ingestion. It is based on `docs/DISTRICT_COURT_INGESTION_BRIEF.md` and should be treated as the source-control version of the legal and operational classification until counsel updates it.

## Classification Summary

| Source | Content | Initial classification | Production use | Required controls |
|---|---|---|---|---|
| Development Data Lab Judicial Data Portal | District-court metadata, 2010-2018 | `commercial_safe` for metadata | Metadata analytics and CNR universe | Attribution, dataset versioning, row checksums, ODbL review |
| eCourts Services portal | Live metadata, orders, PDFs | `internal_only` pending legal sign-off | Text acquisition fallback and current metadata | Rate limits, CAPTCHA policy, redaction, fetch logs |
| Indian Kanoon API | Clean text, citations, metadata where available | `internal_only` | Internal RAG enrichment, no raw redistribution | API key controls, quota/cost logs, ToS restrictions |
| HLDC | Hindi UP district-court text | `non_commercial` | Research/evaluation and non-commercial mode only | Physical partition, `commercial_safe=false`, retrieval gate |
| NyayaAnumana / other Hugging Face legal datasets | Mixed legal datasets | `pending_review` | Block content ingestion until license review | Source-by-source license approval |
| AWS Open Data SC/HC buckets | Supreme Court and High Court PDFs/metadata | `commercial_safe` | Existing SC/HC corpus, not district-court source | CC BY attribution and source provenance |
| SCC Online, Manupatra, LexisNexis, Westlaw, AIR, LawFinder | Subscription legal databases | `blocked` | Do not ingest | Contract prohibition review before any change |

## Source Details

### Development Data Lab Judicial Data Portal

- **Role**: Metadata foundation and historical CNR universe.
- **Content**: Case metadata, acts, sections, dates, dispositions, inferred gender fields, judge position, case type.
- **Limit**: No judgment/order text.
- **Classification**: `commercial_safe` for metadata, subject to ODbL/database-content obligations.
- **Implementation policy**:
  - Store raw archives in object storage with dataset version and checksum.
  - Load normalized rows into `district_case`.
  - Preserve source row payload for audit.
  - Use deterministic filters to create criminal target CNRs.

### eCourts Services Portal

- **Role**: Current metadata and text/PDF fallback for CNRs not found in clean-text sources.
- **Content**: CNR status, orders, PDFs, case events where accessible.
- **Limit**: CAPTCHA, rate limits, portal schema instability, sensitive records.
- **Classification**: `internal_only` until legal sign-off confirms broader use.
- **Implementation policy**:
  - Use CNR-specific lookup where available.
  - Respect configured request rate and backoff.
  - Log every attempt in `district_fetch_attempt`.
  - Do not use automated CAPTCHA solving unless `docs/legal/captcha-strategy.md` is approved for that method.
  - Apply redaction before display, external translation, or retrieval for protected records.

### Indian Kanoon API

- **Role**: Clean text and citation graph enrichment where coverage exists.
- **Content**: HTML/text, title, court, date, citations, metadata.
- **Limit**: Uneven district-court coverage and API ToS restrictions on raw redistribution.
- **Classification**: `internal_only`.
- **Implementation policy**:
  - Prefer exact CNR match; fallback to party/date/court heuristics with match confidence.
  - Store provider document ID and URL.
  - Store text artifacts with `license_classification=internal_only`.
  - Cite snippets only through allowed RAG behavior; do not expose bulk raw text.
  - Track API cost and quota usage.

### HLDC

- **Role**: Hindi UP district-court full-text corpus for research, evaluation, and non-commercial mode.
- **Content**: Hindi legal documents with segmentation and labels.
- **Limit**: Non-commercial license.
- **Classification**: `non_commercial`.
- **Implementation policy**:
  - Store in a separate source partition.
  - Mark every artifact and chunk `commercial_safe=false`.
  - Exclude from retrieval when `COMMERCIAL_MODE=true`.
  - Do not mix HLDC-derived translations into commercial-safe aggregate exports.

### NyayaAnumana and Other Open Datasets

- **Role**: Potential evaluation or supplemental source.
- **Classification**: `pending_review`.
- **Implementation policy**:
  - Do not ingest content until each dataset license is recorded.
  - Metadata-only cataloging is allowed only if license permits.
  - Add source-specific controls before enabling in worker config.

### Blocked Subscription Sources

- **Sources**: SCC Online, Manupatra, LexisNexis, Westlaw, AIR, LawFinder, and similar subscription databases.
- **Classification**: `blocked`.
- **Implementation policy**:
  - Do not ingest, scrape, embed, or use exports from these sources.
  - Do not use user-uploaded subscription exports unless counsel explicitly approves that document set.

## Required Provenance Fields

Every normalized district source row must carry:

- `source_name`
- `source_url`
- `source_case_id`
- `license`
- `license_classification`
- `dataset_version`
- `retrieved_at`
- `checksum_sha256`
- `raw_storage_uri`
- `commercial_safe`
- `sensitive_data_flags`

## Release Gate

Before Phase 3 text acquisition can run against production-scale sources:

- eCourts CAPTCHA and rate-limit strategy must be approved. **Status: Mode 4 (third-party solver) authorized 2026-06-23 (`docs/legal/captcha-strategy.md` r2); automated path stays behind `ECOURTS_COMMERCIAL_CAPTCHA_SOLVER_ENABLED` (default off) and the counsel attestation in that doc must be signed before production enablement.**
- Indian Kanoon API use must be reviewed against its ToS.
- HLDC must be proven excluded from commercial-safe retrieval.
- POCSO/rape/minor redaction rules must be implemented and tested. **(Phase 5 — pending.)**

