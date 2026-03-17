---
name: brd-coverage
description: Full BRD audit — maps every line-item requirement (AC, BR, edge case, failure handling) to implemented code and test coverage. Produces a comprehensive gap list, traceability report, and compliance verdict. Works with any app.
argument-hint: "<brd-file> <app-dir> [ui-dir] [phase]"
---

# BRD Coverage Audit — Line-Item Granularity

Perform a comprehensive BRD audit at the **individual line-item level**: every acceptance criterion, business rule, edge case, and failure handling item is separately verified against the codebase. Produce a full traceability report, a flat sortable gap list (big and small items alike), and a compliance verdict.

## Scoping

Parse the user's arguments to determine scope. The skill is **generic** — it works with any app, not just predefined systems.

### Argument Parsing

```
/brd-coverage <brd-file> <app-dir> [ui-dir] [phase]
```

- **`<brd-file>`** (required): Path to the BRD markdown file (e.g. `docs/policing_apps_brd/DOPAMS_Refined_BRD_AI_Ready.md`)
- **`<app-dir>`** (required): Path to the backend/API app directory (e.g. `apps/dopams-api/`)
- **`[ui-dir]`** (optional): Path to the frontend/UI app directory (e.g. `apps/dopams-ui/`). If omitted, skip UI-layer verification.
- **`[phase]`** (optional): Phase filter keyword (see below). Default: `full`.

### Shorthand System Names (Convenience Aliases)

For known systems in this repo, a single name can substitute for the full paths:

| Alias (case-insensitive) | BRD File | API Dir | UI Dir | Report Slug |
|--------------------------|----------|---------|--------|-------------|
| `DOPAMS` | `docs/policing_apps_brd/DOPAMS_Refined_BRD_AI_Ready.md` | `apps/dopams-api/` | `apps/dopams-ui/` | `dopams` |
| `Forensic` | `docs/policing_apps_brd/Refined_BRD_Forensic_AI_Platform.md` | `apps/forensic-api/` | `apps/forensic-ui/` | `forensic` |
| `SocialMedia` | `docs/policing_apps_brd/TEF_AI_Social_Media_Refined_BRD_v2.md` | `apps/social-media-api/` | `apps/social-media-ui/` | `socialmedia` |
| `Citizen` | `docs/policing_apps_brd/Citizen_App_BRD.md` (verify exists) | `apps/api/` | `apps/citizen/` | `citizen` |
| `Officer` | `docs/policing_apps_brd/Officer_App_BRD.md` (verify exists) | `apps/api/` | `apps/officer/` | `officer` |

**Note**: Citizen and Officer BRD paths are placeholders — verify the file exists during Phase 0 preflight. If the BRD file is not found, ask the user for the correct path before proceeding.

When aliases don't apply, derive the report slug from the BRD filename (lowercase, hyphens).

### Phase Keywords

| Keyword | Phases Run |
|---------|------------|
| `code-only` | Phases 0-2 only (preflight + extraction + code traceability) |
| `test-only` | Phases 0-1, 3 only (preflight + extraction + test coverage) |
| `gaps-only` | Phases 0-2, 4 only (preflight + extraction + code traceability + gap list) |
| `full` (default) | All phases 0-6 |

### No Arguments

If invoked with no arguments, ask the user which BRD and app directory to audit. Do NOT default to "audit all systems" — that's too broad for line-item auditing.

## Operating Rules

### Evidence Standards

- **Evidence-first**: cite exact `file_path:line_number` for every implementation claim.
- **Confirmed vs Inferred**: mark evidence as `CONFIRMED` (exact code match) or `INFERRED` (reasonable deduction from nearby code). Never mark `CONFIRMED` without a file:line cite.
- **Never assume implementation**: if you cannot find concrete code evidence, verdict is `NOT_FOUND` — even if "it probably exists somewhere."
- **Ambiguous = PARTIAL**: if evidence exists but doesn't fully satisfy the line item's assertion, mark `PARTIAL` with explanation of what's missing.

### Search Discipline

- For each line item, use **at least 3 search strategies** before concluding `NOT_FOUND`:
  1. Keyword search (terms from the requirement text)
  2. Entity search (table names, column names, route paths, component names)
  3. Semantic search (related concepts — e.g., for "retry with exponential backoff" search for `retry`, `backoff`, `setTimeout`, `delay`)
- Search across ALL layers: routes, migrations, models, middleware, validators, services, utilities, UI components, shared packages, workflow configs, test files.
- For UI requirements, search the UI directory for: component files, form fields, labels, validation messages, CSS classes, route definitions.

### Prioritization

When auditing a large BRD, process requirements in this priority order:
1. Must Have / P0 FRs first
2. Should Have / P1 FRs next
3. Could Have / P2 FRs last
4. Within each FR: ACs first, then BRs, then edge cases, then failure handling

## Phase 0 — Preflight

Verify and report:

1. **BRD file**: Confirm exists, is readable, note size and FR count from a quick scan.
2. **API/backend directory**: Confirm exists. List key subdirectories (routes, migrations, models, services, tests, middleware).
3. **UI directory** (if provided): Confirm exists. List key subdirectories (components, pages, hooks, locales).
4. **Shared packages**: Check for `packages/shared/`, `packages/workflow-engine/`, `packages/api-core/`, etc.
5. **Test infrastructure**: Locate unit tests, integration tests, E2E tests, and functional test case docs.
6. **Git state**: Branch, commit hash, any uncommitted changes in relevant directories.
7. **Scope summary**: Total FRs, estimated total line items (ACs + BRs + edge cases + failure handling), phase filter.

Output a compact preflight block.

## Phase 1 — Requirement Extraction (Line-Item Inventory)

Read the **entire** BRD file. Extract every auditable line item into a flat inventory.

### What to Extract

For each FR in the BRD, extract ALL of these item types:

| Item Type | ID Pattern | Description |
|-----------|------------|-------------|
| **Acceptance Criterion** | `AC-nn` (under FR-nn) | Testable functional assertion |
| **Business Rule** | `BR-nn` (under FR-nn) | Validation constraint, data rule, or policy |
| **Edge Case** | `EC-nn` or narrative bullet | Boundary/corner-case behavior (may not have formal IDs — assign `EC-FR-nn-nn` sequentially) |
| **Failure Handling** | `FH-nn` or narrative bullet | Error recovery behavior (may not have formal IDs — assign `FH-FR-nn-nn` sequentially) |
| **User Story** | `US-FR-nn-nn` | User-facing intent (audit for UI evidence if UI dir provided) |
| **Scope Item** | `SCP-IS-nnn` | In-scope commitment (verify something addresses it) |

**Also extract but do NOT audit as gaps:**
- Out-of-scope items (`SCP-OOS-nnn` or `SCP-OS-nnn` — both prefixes mean "out of scope"; BRDs use either convention) — note them to avoid false positives
- Assumptions (`ASM-nnn`) — reference only
- Constraints (`CNS-nnn`, `CON-nnn`) — audit as a separate category (infrastructure/compliance)

### Handling Ambiguous or Conflicting Requirements

- **Ambiguous**: If a requirement's intent is unclear, mark the line item with `[AMBIGUOUS]` and audit against the most reasonable interpretation. Note the ambiguity in the Gap Detail column.
- **Conflicting**: If two requirements contradict each other, mark both with `[CONFLICT]`, audit each independently, and flag the conflict in the gap list for BRD owner resolution.
- **Unstructured prose**: Some BRDs have requirements in narrative form without AC/BR IDs. Extract testable assertions and assign synthetic IDs: `AC-FR-nn-S01`, `BR-FR-nn-S01` (S = synthetic).

### Inventory Output

Produce a summary table:

| FR ID | FR Title | Priority | ACs | BRs | ECs | FHs | Total Items |
|-------|----------|----------|-----|-----|-----|-----|-------------|

And a total row:
```
Total: {n} FRs, {ac} ACs, {br} BRs, {ec} Edge Cases, {fh} Failure Handling = {total} auditable line items
Constraints: {cns} (audited separately)
Out-of-scope exclusions: {oos}
```

### Full Line-Item Registry

Internally maintain a flat list of every line item with:
- `item_id`: e.g. `FR-01/AC-03`, `FR-07/BR-02`, `FR-03/EC-01`, `FR-05/FH-02`
- `parent_fr`: FR ID
- `type`: AC | BR | EC | FH | US | SCP | CNS
- `text`: The full requirement text
- `priority`: Inherited from parent FR (Must Have / Should Have / Could Have)

## Phase 2 — Code Traceability (Line-Item Level)

For **every** line item in the registry, search the codebase for implementation evidence.

### Search Layers

Search these locations (adapt paths based on actual directory structure found in preflight):

**Backend/API:**
1. `{app-dir}/src/routes/` — endpoint definitions, request handlers, validation
2. `{app-dir}/migrations/` or `{app-dir}/src/migrations/` — schema, tables, columns, indexes, seeds
3. `{app-dir}/src/` — services, business logic, utilities, middleware, validators, schedulers
4. `{app-dir}/src/workflows/` or workflow config files — state machines, transitions, guards

**Frontend/UI (if ui-dir provided):**
5. `{ui-dir}/src/` — React/Vue/Angular components, pages, forms, hooks
6. `{ui-dir}/src/locales/` — i18n translation files
7. `{ui-dir}/src/styles/` or CSS files — responsive design, accessibility

**Shared:**
8. `packages/shared/` — shared types, schemas, utilities, components
9. `packages/*/` — other shared packages (workflow-engine, api-core, etc.)

### Search Depth Guidelines

- **Per line item**: Spend no more than 2-3 minutes searching. If 3 search strategies yield no results, verdict is `NOT_FOUND`.
- **Per FR batch**: Complete a batch of 3-5 FRs before writing results to the output file.
- **Stop on first CONFIRMED match**: Once you find a clear `file:line` match, you can stop searching for that item.
- **Ambiguous matches**: If a match is close but not exact, continue searching. If no better match found, mark as `PARTIAL`.

### Common False Negatives

Before marking `NOT_FOUND`, check these often-missed locations:
- **Middleware**: Auth, validation, and audit logic may be in middleware (not route handlers)
- **Shared packages**: `packages/api-core/`, `packages/shared/` — requirements may be implemented generically
- **Workflow configs**: `service-packs/*/workflow.json` — state guards, transitions, SLA rules
- **Database constraints**: CHECK constraints, UNIQUE constraints may enforce BRs at the DB level
- **Config files**: `.env`, `config.ts` — feature flags, rate limits, thresholds

### Search Strategy Per Line Item

For each line item, execute this search sequence:

1. **Extract keywords**: Pull 3-5 key terms from the requirement text.
2. **Search by keywords**: Grep for those terms across all layers.
3. **Search by entities**: If the requirement mentions a table, column, field, route, or component — search for that entity name.
4. **Search by behavior**: For behavioral requirements (e.g., "retry 3 times"), search for implementation patterns (e.g., `retry`, `attempts`, `maxRetries`).
5. **Search by negation**: For prohibition requirements (e.g., "shall NOT overwrite"), search for the positive action and verify the guard exists.
6. **Cross-reference**: If a related line item was found in a specific file, check that file for evidence of this item too.

### Verdict Per Line Item

| Verdict | Criteria | Evidence Required |
|---------|----------|-------------------|
| `DONE` | Clear, complete code evidence satisfying the full assertion | At least one `CONFIRMED` file:line cite |
| `PARTIAL` | Some aspects implemented, others missing | File:line cite + explicit note of what's missing |
| `STUB` | Code structure exists but implementation is placeholder/TODO/stub | File:line cite showing the stub |
| `NOT_FOUND` | No code evidence found after exhaustive search | List of search terms tried |
| `OUT_OF_SCOPE` | Explicitly excluded by SCP-OOS | Reference to the exclusion |
| `DEFERRED` | BRD marks as Phase 2/3 or future release | Reference to the deferral |

### Output: Code Traceability Matrix

Produce a **per-FR section** with a table for each FR:

```markdown
### FR-01 — Identity, access control, approvals, and audit

| Item | Type | Requirement Summary | Verdict | Evidence | Gap Detail |
|------|------|---------------------|---------|----------|------------|
| FR-01/AC-01 | AC | Enforce roles from Section 3 server-side | DONE | routes/auth.ts:45 | — |
| FR-01/AC-02 | AC | Jurisdiction scope filtering | PARTIAL | middleware/jurisdiction.ts:12 | POLICE_STATION level not implemented |
| FR-01/BR-03 | BR | Sensitive export requires justification code | NOT_FOUND | searched: export, justification, sensitive | No export justification mechanism found |
| FR-01/EC-01 | EC | Suspended user forced re-auth | NOT_FOUND | searched: suspended, revoke, session | No session revocation on suspension |
| FR-01/FH-01 | FH | Block approvals when audit log unavailable | STUB | middleware/audit.ts:78 | TODO comment, no actual check |
```

**Important**: Do NOT collapse multiple line items into a single row. Every AC, BR, EC, and FH gets its own row.

## Phase 3 — Test Coverage (Line-Item Level)

For each line item, check for test coverage across available test layers.

### Test Layers to Search

1. **Functional Test Case docs**: `docs/test-cases/` — look for TC IDs that reference the FR or specific AC/BR.
2. **Unit/Integration tests**: `{app-dir}/src/__tests__/`, `{app-dir}/tests/`, `{app-dir}/src/**/*.test.*`, `{app-dir}/src/**/*.spec.*`
3. **E2E tests**: `{app-dir}/e2e/`, `e2e/`, `tests/e2e/`
4. **UI tests**: `{ui-dir}/src/**/*.test.*`, `{ui-dir}/src/**/*.spec.*`, `{ui-dir}/e2e/`

### Test Verdict Per Line Item

| Verdict | Criteria |
|---------|----------|
| `TESTED` | At least one test (any layer) directly exercises this requirement |
| `INDIRECT` | A test exercises the parent feature but doesn't isolate this specific assertion |
| `TC_ONLY` | Functional test case doc exists but no automated test code |
| `UNTESTED` | No test evidence found |

### Output: Test Coverage Column

Add test verdict as an additional column to the traceability matrix (or produce a companion table).

## Phase 4 — Comprehensive Gap List

This is the **primary deliverable**. Produce a single, flat, sortable gap list containing **every line item that is not `DONE`+`TESTED`**.

### Gap List Format

```markdown
## Comprehensive Gap List

Total line items audited: {n}
Fully implemented + tested: {done_tested} ({percentage}%)
Gaps found: {gap_count}

### Gap Register

| # | Item ID | FR | Type | Priority | Code | Test | Requirement Summary | What's Missing | Size |
|---|---------|-----|------|----------|------|------|---------------------|----------------|------|
| 1 | FR-01/AC-02 | FR-01 | AC | Must Have | PARTIAL | UNTESTED | Jurisdiction scope filtering | POLICE_STATION level not implemented | M |
| 2 | FR-01/BR-03 | FR-01 | BR | Must Have | NOT_FOUND | UNTESTED | Sensitive export requires justification | No export justification mechanism | S |
| 3 | FR-01/EC-01 | FR-01 | EC | Must Have | NOT_FOUND | UNTESTED | Suspended user forced re-auth | No session revocation | S |
| 4 | FR-03/AC-01 | FR-03 | AC | Must Have | STUB | TC_ONLY | Telugu/English OCR | OCR engine is a stub/placeholder | L |
...
```

### Gap Sizing

| Size | Definition |
|------|------------|
| `XS` | Config change, flag toggle, or single-line fix |
| `S` | < 2 hours — validation, guard clause, error message, simple UI element |
| `M` | 2 hours – 2 days — new route, component, migration, or service method |
| `L` | 2-5 days — significant feature, multi-file change, new workflow |
| `XL` | > 5 days — major subsystem, integration, or architectural change |

### Gap Categories

After the flat list, group gaps into categories for navigation:

**A) Unimplemented (NOT_FOUND)** — no code evidence at all
**B) Stubbed (STUB)** — placeholder code exists but not functional
**C) Partially Implemented (PARTIAL)** — code exists but doesn't fully satisfy the requirement
**D) Implemented but Untested (DONE + UNTESTED)** — code works but no test coverage
**E) Constraint Gaps** — CNS items not satisfied by infrastructure/config
**F) UI-Only Gaps** — requirements satisfied in backend but missing in frontend (or vice versa)

Each category gets a count and a sub-table filtered from the master gap register.

### Include Small Items

**Do NOT skip "trivial" gaps.** The gap list must include:
- Missing validation messages
- Missing error codes
- Missing audit log fields
- Missing config seeds/defaults
- Missing i18n keys
- Missing aria labels
- Missing edge case handling
- Missing retry logic
- Incomplete status enums
- Default values not matching BRD specs
- Field names diverging from BRD terminology

These small items are often the difference between "demo-ready" and "production-ready."

## Phase 5 — Constraint & NFR Audit

Separately audit constraints and non-functional requirements that appear in the BRD.

### Constraint Verification

For each constraint (CNS/CON), check:

| Constraint | Type | Assertion | Verdict | Evidence |
|------------|------|-----------|---------|----------|
| CNS-SEC-001 | Security | TLS 1.2+ on all APIs | DONE | Dockerfile:12, nginx.conf:8 |
| CNS-PER-001 | Performance | Core flows meet Section 8 baselines | NOT_VERIFIED | No load test evidence |

Verdicts: `DONE`, `PARTIAL`, `NOT_VERIFIED`, `NOT_APPLICABLE`

### NFR Summary

If BRD contains NFRs, list them with a brief verdict. Do not deep-audit NFRs (that's a separate review) but flag any obviously unmet ones.

## Phase 6 — Scorecard and Verdict

### Coverage Metrics

Calculate at **line-item level** (not FR level):

```
LINE-ITEM COVERAGE
==================
Total auditable items:        {total}
  Acceptance Criteria (AC):   {ac_total}   → {ac_done} DONE, {ac_partial} PARTIAL, {ac_notfound} NOT_FOUND
  Business Rules (BR):        {br_total}   → {br_done} DONE, {br_partial} PARTIAL, {br_notfound} NOT_FOUND
  Edge Cases (EC):            {ec_total}   → {ec_done} DONE, {ec_partial} PARTIAL, {ec_notfound} NOT_FOUND
  Failure Handling (FH):      {fh_total}   → {fh_done} DONE, {fh_partial} PARTIAL, {fh_notfound} NOT_FOUND

Implementation Rate:          {done + partial} / {total} = {pct}%
  Fully Implemented (DONE):   {done} / {total} = {pct}%
  Partially Implemented:      {partial} / {total} = {pct}%
  Not Found:                  {notfound} / {total} = {pct}%
  Stubbed:                    {stub} / {total} = {pct}%

TEST COVERAGE
=============
Tested (any layer):           {tested} / {total} = {pct}%
Untested:                     {untested} / {total} = {pct}%

GAP SUMMARY
===========
Total gaps:                   {gap_count}
  By size:  XS={xs}  S={s}  M={m}  L={l}  XL={xl}
  By type:  AC={ac_gaps}  BR={br_gaps}  EC={ec_gaps}  FH={fh_gaps}
  By priority: Must Have={must}  Should Have={should}  Could Have={could}
```

### Gap Severity Distribution

| Severity | Count | Criteria |
|----------|-------|----------|
| P0 — Critical | {n} | Must Have AC/BR that is NOT_FOUND or STUB |
| P1 — High | {n} | Must Have AC/BR that is PARTIAL, or Must Have EC/FH that is NOT_FOUND |
| P2 — Medium | {n} | Should Have gaps, or Must Have items that are DONE but UNTESTED |
| P3 — Low | {n} | Could Have gaps, edge cases partially handled, minor test gaps |

### Compliance Verdict

| Verdict | Criteria |
|---------|----------|
| `COMPLIANT` | ≥ 90% ACs DONE AND ≥ 80% BRs DONE AND zero P0 gaps AND ≥ 70% items tested |
| `GAPS-FOUND` | ≥ 70% ACs DONE AND ≤ 3 P0 gaps |
| `AT-RISK` | < 70% ACs DONE OR > 3 P0 gaps |

### Verdict Block

```
┌─────────────────────────────────────────────────┐
│ BRD COVERAGE AUDIT — {system name}              │
├─────────────────────────────────────────────────┤
│ BRD:                {brd filename}              │
│ Audit Date:         {YYYY-MM-DD}                │
│ Total FRs:          {count}                     │
│ Total Line Items:   {count}                     │
│ Implementation:     {pct}% ({done} DONE, {partial} PARTIAL, {notfound} NOT_FOUND) │
│ Test Coverage:      {pct}% ({tested}/{total})   │
│ Gaps:               {count} (P0={p0} P1={p1} P2={p2} P3={p3}) │
│ Verdict:            {COMPLIANT | GAPS-FOUND | AT-RISK} │
└─────────────────────────────────────────────────┘
```

### Remediation Patterns

For common gap types, use these fix approaches:

| Gap Type | Fix Pattern |
|----------|-------------|
| Missing validation (BR) | Add Zod schema or guard clause at the route handler level |
| Missing error handling (FH) | Wrap operation in try/catch, return structured error response |
| Missing audit logging (AC) | Add `auditLog.write({ actor, action, entity, entityId })` call |
| Missing state guard (BR) | Add transition guard in workflow config or route handler |
| Missing i18n key | Add key to all locale files (en, hi, te/pa) |
| Missing DB column | Create migration: `ALTER TABLE ... ADD COLUMN ...` |
| Missing endpoint | Create route handler with schema validation, auth middleware, and tests |
| Missing test coverage | Create test case document in `docs/test-cases/` and/or integration test |

### Top 10 Priority Actions

List the 10 most impactful actions to close gaps, ordered by severity then effort:

| # | Action | Item(s) | Severity | Size | Why It Matters |
|---|--------|---------|----------|------|----------------|
| 1 | ... | FR-01/AC-02 | P0 | M | ... |

## Output

### Report Sections (in order)

1. Verdict Block (at the top for quick reference)
2. Preflight Summary
3. Requirements Inventory (summary table + totals)
4. Code Traceability Matrix (per-FR sections with line-item rows)
5. **Comprehensive Gap List** (flat, sortable, every non-DONE item)
6. Gap Categories (grouped views of the same gaps)
7. Constraint & NFR Audit
8. Coverage Scorecard (detailed metrics)
9. Top 10 Priority Actions
10. Quality Checklist Verification

### Output File

Write to: `docs/reviews/brd-coverage-{slug}-{YYYY-MM-DD}.md`

Derive `{slug}` from:
- Known alias → use the alias slug (e.g., `dopams`, `forensic`)
- Custom path → derive from BRD filename, lowercase, hyphens (e.g., `inventory-system`)

If `docs/reviews/` does not exist, create it.

## Quality Checklist

Before finalizing, verify:

```
□ Every FR in the BRD has a section in the traceability matrix
□ Every AC, BR under every FR has its own row — none are skipped or merged
□ Edge cases and failure handling items are extracted and audited (even unnumbered ones)
□ Every verdict has supporting evidence (file:line) or explicit "searched: [terms]" for NOT_FOUND
□ PARTIAL verdicts explain exactly what's implemented and what's missing
□ The comprehensive gap list includes ALL non-DONE items — no filtering by "importance"
□ Gap sizes (XS/S/M/L/XL) are assigned to every gap
□ Out-of-scope items (SCP-OOS/SCP-OS) are excluded from gap counts
□ Scorecard arithmetic is correct (cross-check totals)
□ Verdict follows the defined criteria (not subjective)
□ Top 10 actions reference specific item IDs
□ Constraint items are audited separately from FRs
□ Report is saved to the correct output path
□ Small items (missing validations, config defaults, error codes) are NOT omitted
```

## Execution Strategy for Large BRDs

For BRDs with > 15 FRs (100+ line items), use this approach to manage context:

1. **Phase 0-1**: Read entire BRD, build complete line-item registry (Preflight + Extraction).
2. **Phase 2**: Process FRs in batches of 3-5. For each batch:
   - Search codebase for all items in the batch
   - Record verdicts immediately
   - Write partial results to the output file incrementally
3. **Phase 3**: Check test coverage for all line items (can overlap with Phase 2 batches).
4. **Phase 4**: After all FRs processed, compile the comprehensive gap list from all recorded verdicts.
5. **Phase 5**: Audit constraints and NFRs separately.
6. **Phase 6**: Calculate scorecard from the complete data set.

This prevents context overflow and ensures no line items are silently dropped.
