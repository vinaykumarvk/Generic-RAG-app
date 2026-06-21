# Development Plan: District Cloud DB Metadata Sync

## Overview
Fix the empty District Analytics dashboard by making the shared Cloud SQL database contain the district-court metadata expected by the local and Cloud Run deployments. The local deployment already points to Cloud SQL; the missing piece is loading DDL/eCourts metadata into `district_case` and refreshing analytics facts.

## Assumptions
- The target workspace remains `183174b5-9ee5-4812-9a8d-665f020fde91`.
- The immediate goal is to restore usable district analytics and fetch-judgment testing, not to bypass eCourts CAPTCHA or fetch judgment PDFs at scale.
- DDL/eCourts metadata is the approved commercial-safe source for metadata-only rows.

## Codebase Findings
- `apps/worker/scripts/ingest_district_metadata.py` streams DDL case and act/section tarballs, normalizes criminal-law records, and upserts into `district_case`.
- `apps/api/src/migrations/028_district_court_foundation.sql` through `033_district_rag_wiki_integration.sql` define the district schema and analytics refresh function.
- `docs/reports/district-metadata-pilot-counts.md` documents the intended production load: `318,950` rows for 2015-2018 serious criminal-law cases.
- Cloud Run `police-cases-kb-api` and `police-cases-kb-worker` both use `police-cases-kb-database-url`, which points to `policing-db-v2 / police_kb`; local `.env` points to the same database through the Cloud SQL proxy.

## Architecture Decisions
- **Do not fork local data:** local and cloud continue to use the same Cloud SQL DB.
- **Load metadata before text:** restore `district_case` first, then refresh `district_case_fact_daily`; judgment fetching remains queue-based.
- **Use idempotent loader path:** use existing upsert and CNR de-duplication rather than manual SQL inserts.

## Dependency Graph
```text
Phase 1 -> Phase 2 -> Phase 3 -> Phase 4
```

---

## Phase 1: Confirm Target DB and Schema
**Dependencies:** none

**Tasks:**
1. Verify local and Cloud Run target the same Cloud SQL DB.
2. Ensure migrations through `033` exist.
3. Confirm current row counts for `district_case`, queue, attempts, and facts.

**Files to create/modify:**
- None expected.

**Acceptance criteria:**
- DB target is confirmed as Cloud SQL `policing-db-v2 / police_kb`.
- `schema_migration.max(version) = 33`.

---

## Phase 2: Acquire or Reconstruct DDL Source Inputs
**Dependencies:** Phase 1

**Tasks:**
1. Locate local DDL keys and source archives.
2. If archives are missing, fetch approved DDL public data links.
3. Validate source inputs without inserting rows.

**Files to create/modify:**
- `data/ddl/` - source archives/keys if downloaded.
- `docs/reports/district-metadata-cloud-sync-2026-05-23.json` - validation/load report.

**Acceptance criteria:**
- Loader can stream DDL cases and act/section metadata.
- Report-only run returns non-zero target rows.

---

## Phase 3: Load District Metadata Into Cloud SQL
**Dependencies:** Phase 2

**Tasks:**
1. Run `apps/worker/scripts/ingest_district_metadata.py` for the configured workspace.
2. Load at least the documented production pilot slice, or a safe first batch if source download/runtime limits block full load.
3. Refresh district analytics facts.

**Files to create/modify:**
- `docs/reports/district-metadata-cloud-sync-2026-05-23.json` - final load report.

**Acceptance criteria:**
- `district_case` has non-zero rows for the judgment workspace.
- `district_case_fact_daily` has non-zero rows after refresh.
- Case drilldown can return rows from the local API.

---

## Phase 4: Verify UI and Fetch-Judgment Queue
**Dependencies:** Phase 3

**Tasks:**
1. Verify local District Analytics shows real state/district filters and cases.
2. Click Fetch judgment on a case and confirm queue rows appear.
3. Verify progress panel displays queue status.

**Files to create/modify:**
- Update docs only if operational commands differ from the plan.

**Acceptance criteria:**
- Local dashboard shows real district metadata.
- Fetch progress is visible and backed by Cloud SQL queue rows.
```
