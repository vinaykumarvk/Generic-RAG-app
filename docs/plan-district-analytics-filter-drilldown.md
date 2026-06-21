# Development Plan: District Analytics Filter and Drilldown

## Overview
Add user-friendly multi-select filters and case drilldown to the District Analytics dashboard so users can filter by names, not only numeric codes, and inspect the metadata behind any case.

## Assumptions
- Existing `district_case` records remain the source of truth for case metadata and human-readable state/district labels.
- Analytics endpoints continue to use `district_case_fact_daily` for aggregate performance.
- Case search should match district case UUID, CNR, source case ID, court name, state name, and district name.

## Codebase Findings
- `apps/api/src/routes/district-analytics-routes.ts` currently accepts only single-value string filters.
- `apps/web/src/pages/DistrictAnalyticsPage.tsx` uses free-text inputs for state, district, statute, section, and other filters.
- `district_case` has `state_name`, `district_name`, and `source_payload`; `district_case_fact_daily` does not.
- `apps/worker/scripts/ingest_district_metadata.py` decorates DDL rows with names, but the district-key lookup needs unpadded-code fallback for future loads.

## Architecture Decisions
- **Option endpoint**: Add `/district/analytics/filter-options` backed by `district_case` and fact aggregates.
- **Repeated query params**: Encode multi-select filters as repeated query params like `state_code=1&state_code=13`.
- **Composite district keys**: Use `state_code:district_code` for district selection to avoid ambiguity across states.
- **Case drilldown**: Add `/district/cases` for filtered/searchable case lists and `/district/cases/:caseId` for complete metadata, provenance, queue, text artifact, and event details.
- **Name backfill**: Backfill current production district names from `cases_district_key.csv` and fix future DDL lookup behavior.

## Dependency Graph
```text
Phase 1 --> Phase 2 --> Phase 3 --> Phase 4
```

---

## Phase 1: API Contracts
**Dependencies:** none

**Tasks:**
1. Extend district analytics filters to accept multi-value query params.
2. Add filter options endpoint with labels, codes, names, and counts.
3. Add case list and case detail endpoints.
4. Update route tests for multi-select filters and drilldown.

**Files to create/modify:**
- `apps/api/src/routes/district-analytics-routes.ts`
- `apps/api/src/__tests__/routes/district-analytics-routes.test.ts`

**Acceptance criteria:**
- Existing analytics endpoints accept repeated state, district, section, statute, offence, disposition, language, source, and court filters.
- Case search returns matching metadata rows and detail returns raw metadata.

---

## Phase 2: Dashboard UI
**Dependencies:** Phase 1

**Tasks:**
1. Replace code text filters with searchable multi-select dropdowns.
2. Display state and district names next to codes.
3. Add case search and drilldown panel.

**Files to create/modify:**
- `apps/web/src/pages/DistrictAnalyticsPage.tsx`
- `apps/web/src/components/analytics/DistrictCaseDrilldown.tsx`

**Acceptance criteria:**
- Users can select multiple states, districts, IPC sections, statutes, outcomes, languages, and sources.
- Users can search by case ID/CNR/source case ID and inspect ingested metadata.

---

## Phase 3: DDL Name Quality
**Dependencies:** none

**Tasks:**
1. Fix future DDL district-name lookup for padded and unpadded key codes.
2. Backfill production `district_case.district_name` from local DDL keys.

**Files to create/modify:**
- `apps/worker/scripts/ingest_district_metadata.py`

**Acceptance criteria:**
- Current Cloud SQL district rows have district names where DDL keys provide them.
- Future loads populate district names without manual repair.

---

## Phase 4: Verification
**Dependencies:** Phase 1, Phase 2, Phase 3

**Tasks:**
1. Run API route tests and web build.
2. Smoke-test local API and dashboard against Cloud SQL.
3. Verify screenshots and API outputs for filters and drilldown.

**Files to create/modify:**
- No additional files unless a verification note is needed.

**Acceptance criteria:**
- Builds/tests pass.
- Local dashboard renders with human-readable filters and drilldown data.
