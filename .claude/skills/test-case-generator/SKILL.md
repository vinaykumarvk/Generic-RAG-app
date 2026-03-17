---
name: test-case-generator
description: Generate functional test cases from BRD requirements documents. Reads BRDs from docs/policing_apps_brd/, extracts FRs/ACs/BRs, and produces test case specifications in the established format.
argument-hint: "[system] [fr-range]"
---

# Functional Test Case Generator

Generate comprehensive functional test cases from BRD requirements documents. Produces test case specifications in the established TC ID format with full traceability to functional requirements.

## Scoping

Parse the user's arguments to determine scope:

- **Single system**: `/test-case-generator DOPAMS` — generate for one system only.
- **FR range**: `/test-case-generator Forensic FR-01 FR-05` — generate for a specific FR range within a system.
- **No arguments**: generate for all systems.

System name mapping:

| Argument (case-insensitive) | BRD File | TC Output File | TC ID Prefix |
|-----------------------------|----------|----------------|--------------|
| `DOPAMS` | `docs/policing_apps_brd/DOPAMS_Refined_BRD_AI_Ready.md` | `docs/test-cases/DOPAMS_Functional_Test_Cases.md` | `TC-DOPAMS` |
| `Forensic` | `docs/policing_apps_brd/Refined_BRD_Forensic_AI_Platform.md` | `docs/test-cases/Forensic_Functional_Test_Cases.md` | `TC-FORENSIC` |
| `SocialMedia` | `docs/policing_apps_brd/TEF_AI_Social_Media_Refined_BRD_v2.md` | `docs/test-cases/SocialMedia_Functional_Test_Cases.md` | `TC-SMM` |
| `PUDA` | `docs/policing_apps_brd/Citizen_App_BRD.md` + service-packs | `docs/test-cases/PUDA_Functional_Test_Cases.md` | `TC-PUDA` |

## Operating Rules

- Evidence-first: every test case must trace back to a specific FR, AC, BR, or constraint in the BRD.
- Use the exact table format and TC ID convention from existing test case documents.
- Priority distribution target: ~30% P1 (critical path), ~35% P2 (important), ~20% P3 (edge/failure), ~15% P4 (low/cosmetic).

### Priority Definitions

| Priority | Label | Definition | Example |
|---|---|---|---|
| P1 | Critical | Core functionality, critical path, data integrity, access control | Login, data creation, permission checks |
| P2 | Important | Important features, operational rules, graceful degradation | Search filters, validation rules, error messages |
| P3 | Standard | Edge cases, boundary conditions, concurrent operations | Empty inputs, max-length fields, timeout behavior |
| P4 | Low | Rare scenarios, cosmetic issues, non-critical config | UI label text, tooltip content, default sort order |

### Priority Decision Tree (Borderline Cases)

When a test case does not clearly fit a single priority level, use this decision tree:

```
1. Is it a core user workflow (login, create, submit, approve)?            --> P1
2. Is it a data integrity rule (unique constraint, state guard, FK)?       --> P1
3. Is it access control or security enforcement?                           --> P1
4. Is it a supporting feature (search, filter, sort, export, pagination)?  --> P2
5. Is it error handling for expected failures (validation, 404, 409)?      --> P2
6. Is it graceful degradation (offline, timeout, retry)?                   --> P2
7. Is it behavior at boundaries (max length, empty input, concurrency)?    --> P3
8. Is it a rare failure mode (DB down, disk full, malformed JWT)?          --> P3
9. Is it cosmetic or rarely triggered (tooltip, default sort, label)?      --> P4
10. Is it configuration or environment-specific behavior?                  --> P4
```

Walk the tree top-to-bottom. The **first matching rule** determines the priority.

- Generate 4-6 test cases per FR: happy path (AC coverage), business rule validation (BR), edge cases, failure/error scenarios, security/access control where applicable.
- Pre-conditions must be specific and testable (concrete user IDs, roles, data states).
- Test steps must be numbered and include both UI and API verification where relevant.
- Expected results must be precise and verifiable (HTTP status codes, field values, state transitions).
- Never invent requirements — only generate test cases for what the BRD explicitly states.
- If the BRD is ambiguous on a requirement, note it in the test description with `[BRD-AMBIGUOUS]`.
- If two requirements within the same FR contradict each other, tag with `[BRD-CONFLICT]` and generate test cases for both interpretations.
- If a BRD section lacks structured AC/BR IDs, extract testable statements and assign synthetic IDs.

### Common Issues

| Issue | Symptom | Resolution |
|-------|---------|------------|
| BRD has no structured AC/BR IDs | No `AC-` or `BR-` patterns found during Phase 1 extraction | Extract testable statements from prose, assign synthetic IDs with `[SYNTHETIC]` prefix (e.g., `[SYNTHETIC] AC-01`). Note in preflight report. |
| BRD FR count does not match table of contents | Phase 0.5 count differs from TOC/summary | Note the discrepancy in the preflight report. Use the actual heading count as the source of truth. List missing/extra FRs. |
| Existing TC file has gaps in TC ID numbering | TC IDs skip numbers (e.g., 001, 002, 004) | Preserve existing IDs exactly as they are. Append new TCs starting from the next available number after the highest existing ID in that FR section. Never renumber. |
| BRD references external documents not available | FR text mentions "see [Document X]" or "as defined in [Standard Y]" | Mark affected test cases with `[EXTERNAL-DEP]` tag in the description. Add a pre-condition noting the external dependency. Generate test cases based on available context only. |
| BRD has duplicate FR IDs | Two sections share the same FR-nn heading | Flag in preflight report. Append a suffix to distinguish them (e.g., `FR-05a`, `FR-05b`) and note the duplication. |
| AC/BR references are inconsistent across FRs | Some FRs use `AC-01` while others use `AC-FR-01-01` | Detect the dominant convention per BRD during Phase 1. Use the BRD's own convention in TC references. Note mixed conventions in preflight. |

## Phase 0 — Preflight

Before generating test cases:

1. **Locate BRD**: Read the BRD file for the target system(s). If not found, report error and stop.
2. **Check existing test cases**: Read existing test case file in `docs/test-cases/` if it exists.
3. **Determine delta scope**: If existing test cases exist, identify which FRs already have coverage and which are new/changed.
4. **Report preflight summary**: System name, BRD location, FR count, existing TC count (if any), delta scope.

Output a preflight block so the user understands the generation scope.

## Phase 0.5 — Validation

After preflight, run diagnostic checks before proceeding to analysis. Report all findings to the user.

### BRD File Validation

1. **Verify BRD is valid structured markdown** — check heading structure:
   ```bash
   rg '^## FR-|^### ' <brd-file> | head -20
   ```
   Confirm FR headings exist and follow a consistent pattern (`## FR-01`, `## FR-02`, etc.).

2. **Count FRs in BRD and compare to metadata** — count all FR headings and verify the count matches any table of contents or summary section in the BRD. If they differ, note the discrepancy in the preflight report.

3. **Check for BRD structural issues**:
   - Missing AC sections (FR has no `AC-` references) — flag as `[NO-AC]`.
   - Missing BR sections (FR has no `BR-` references) — flag as `[NO-BR]` (acceptable for simple FRs).
   - Malformed IDs (e.g., `AC01` without hyphen, `BR -01` with space) — normalize during extraction.
   - FRs with only a title and no body content — flag as `[STUB-FR]`.

### Existing TC File Validation (if applicable)

4. **Verify TC output file format integrity**:
   ```bash
   rg '^\| TC-' <tc-file> | head -10
   ```
   Confirm table rows follow the expected `| TC-{SYSTEM}-FR{nn}-{nnn} |` pattern.

5. **Check for TC ID gaps** — identify any missing sequential IDs within each FR section (e.g., FR01 has 001, 002, 004 but no 003). Note gaps but do not renumber existing IDs.

6. **Verify column count consistency** — ensure all table rows have the same number of pipe-delimited columns (7 columns per the table format).

## Phase 1 — BRD Analysis

Before extracting requirements, identify the BRD's naming conventions:
- Search for `AC-` pattern to determine if it uses `AC-nn` or `AC-FR-nn-nn` format
- Search for `BR-` pattern similarly
- If no structured IDs found, extract testable statements and assign synthetic IDs with `[SYNTHETIC]` prefix

For each FR in scope, extract:

- **FR ID and title** (e.g., FR-01: Identity, Access Control, Approvals, and Audit).
- **Acceptance Criteria** (AC-01, AC-02, ...) — each AC becomes at least one happy-path test case.
- **Business Rules** (BR-01, BR-02, ...) — each BR becomes at least one validation test case.

**Note**: AC/BR naming conventions vary by BRD:
- DOPAMS: `AC-01`, `BR-01` (simple sequential)
- Forensic/SocialMedia: `AC-FR-01-01`, `BR-FR-01-01` (prefixed with FR number)
Detect the convention during Phase 1 extraction and use it consistently in TC references.

- **Constraints** (CNS-*) — boundary conditions, limits, thresholds.
- **Scope items** (SCP-IS-*, SCP-OS-*) — in-scope items need coverage, out-of-scope items are excluded.
- **Edge cases and failure modes** — infer from AC/BR descriptions (e.g., "must not exceed", "if unavailable", "when duplicate").
- **Security/access control requirements** — role-based access, jurisdiction scoping, audit logging.
- **Integration points** — external systems, connectors, APIs referenced in the FR.

Produce a structured FR inventory table before generating test cases.

## Phase 2 — Test Design

For each FR, generate test cases covering these categories:

**Note on intent**: These test cases are designed for **manual QA execution**. For automated test implementation, each TC maps to one or more integration test functions.

### Pre-condition Templates

Use these templates as starting points for common pre-condition patterns. Adapt specifics (user IDs, table names, states) to the system under test.

- **Login pre-condition**: "1. User 'test-officer-1' exists with role CLERK. 2. User is authenticated via POST /api/v1/auth/login."
- **Data pre-condition**: "1. At least 3 records exist in {entity} table. 2. Record R1 has state_id='OPEN'."
- **Permission pre-condition**: "1. User has system_role_id 'SDO'. 2. User is posted to authority_id 'AUTH-001'."
- **Workflow pre-condition**: "1. Application APP-001 exists with status 'SUBMITTED'. 2. Current workflow step is 'FIELD_INSPECTION'."
- **Integration pre-condition**: "1. External connector {connector_name} is configured and reachable. 2. API key for {service} is valid."
- **Negative pre-condition**: "1. User 'test-viewer-1' exists with role VIEWER (read-only). 2. No write permissions are assigned."

### Category 1: Happy Path (AC Coverage)
- One test case per AC demonstrating the expected behavior. Related ACs within the same FR may be combined into a single test case when they represent a single user workflow. Reference all covered ACs in the FR Ref column (e.g., "FR-01 AC-01, AC-02, AC-05").
- Priority: P1 for core functionality, P2 for supporting features.

### Category 2: Business Rule Validation (BR)
- One test case per BR verifying the rule is enforced.
- Include both valid (rule satisfied) and invalid (rule violated) scenarios.
- Priority: P1 for data integrity rules, P2 for operational rules.

### Category 3: Edge Cases
- Boundary conditions (min/max values, empty inputs, large payloads).
- Concurrent operations (two users editing the same record).
- State transition edge cases (action on already-completed item).
- Priority: P2 or P3.

### Category 4: Failure Scenarios
- External dependency failures (DB down, service unavailable).
- Invalid input handling (malformed data, missing required fields).
- Timeout and retry behavior.
- Priority: P2 for graceful degradation, P3 for rare failure modes.

### Category 5: Security & Access Control
- Role-based access verification (authorized vs unauthorized).
- Jurisdiction scoping enforcement.
- Audit trail generation verification.
- Priority: P1 for access control, P2 for audit logging.

### TC ID Format

`TC-{SYSTEM}-FR{nn}-{nnn}`

- `{SYSTEM}`: `DOPAMS`, `FORENSIC`, `SMM`, or `PUDA`
- `{nn}`: FR number, zero-padded to 2 digits (e.g., `FR01`, `FR12`)
- `{nnn}`: Sequential test case number within the FR, zero-padded to 3 digits (e.g., `001`, `012`)

### Table Format

Each FR section uses this table:

```markdown
| TC ID | FR Ref | Test Description | Pre-conditions | Test Steps | Expected Result | Priority |
|-------|--------|------------------|----------------|------------|-----------------|----------|
```

- **TC ID**: `TC-{SYSTEM}-FR{nn}-{nnn}`
- **FR Ref**: FR ID with specific AC/BR references (e.g., `FR-01 AC-01, AC-02`)
- **Test Description**: Concise description starting with "Verify..." (include category tag for edge/failure cases)
- **Pre-conditions**: Numbered list of specific, testable preconditions
- **Test Steps**: Numbered steps including both UI and API actions
- **Expected Result**: Precise, verifiable outcomes with HTTP codes, field values, state changes
- **Priority**: P1, P2, P3, or P4

## Phase 3 — Output

Generate the complete test case document with these sections:

### Document Header

```markdown
# {System} Functional Test Cases

| Field | Value |
|-------|-------|
| **Project** | {Full system name} |
| **Document Type** | Functional Test Case Specification |
| **Version** | {version — 1.0 for new, increment for updates} |
| **Date** | {YYYY-MM-DD} |
| **Author** | QA Engineering Team |
| **BRD Reference** | {BRD filename} |
| **Technology Stack** | React (Frontend), Node.js / Fastify (API), PostgreSQL (DB) |
| **Total FRs Covered** | FR-01 through FR-{nn} ({count} Functional Requirements) |
| **Total Test Cases** | {total count} |
```

### Table of Contents

After the document header, include a table of contents:

```markdown
## Table of Contents
1. [Test Case Summary](#1-test-case-summary)
2. [Test Cases by Functional Requirement](#2-test-cases-by-functional-requirement)
3. [Traceability Matrix](#3-traceability-matrix)
4. [Clarification Register](#4-clarification-register) *(only if [BRD-AMBIGUOUS], [BRD-CONFLICT], or [BLOCKED] tags were used)*
```

### Section 1: Test Case Summary

Summary table showing per-FR test case counts and priority spread.

### Section 2: Test Cases by Functional Requirement

All test cases organized by FR, each FR as a subsection with its own table.

### Section 3: Traceability Matrix

| FR ID | FR Title | AC Count | BR Count | TC Count | Coverage |
|-------|----------|----------|----------|----------|----------|

Coverage: `Full` (all ACs and BRs have at least one TC), `Partial` (some gaps), `Minimal` (only happy path).

### Output File

Write to: `docs/test-cases/{System}_Functional_Test_Cases.md`

If `docs/test-cases/` does not exist, create it.

## Phase 4 — Delta Report

If existing test cases were found in Phase 0:

1. **New FRs**: List FRs that are in the BRD but had no existing test cases.
2. **Updated FRs**: List FRs where the BRD has changed (new ACs/BRs) requiring additional test cases.
3. **Unchanged FRs**: List FRs with existing adequate coverage.
4. **Removed FRs**: List FRs in existing test cases but no longer in the BRD.

Present delta as a summary table:

| FR ID | Status | Action | Details |
|-------|--------|--------|---------|
| FR-01 | Unchanged | None | 6 existing TCs cover all ACs |
| FR-27 | New | Generate | 3 ACs, 2 BRs — needs 5-6 TCs |

When updating an existing file, merge new test cases into the appropriate FR sections rather than overwriting the entire file. Preserve existing TC IDs — only append new ones.

## Phase 5 — Remediation & Feedback

After generating test cases, review the output for issues that require attention and document them.

### Blocked & Ambiguous Test Cases

1. **[BRD-AMBIGUOUS] test cases**: For each test case tagged `[BRD-AMBIGUOUS]`, add an entry to the **Clarification Register** appendix (Section 4 in the output). Include:
   - TC ID
   - FR/AC/BR reference
   - The ambiguous statement from the BRD
   - The interpretation used for the test case
   - Suggested clarification question for the BRD author

2. **[BRD-CONFLICT] test cases**: For each `[BRD-CONFLICT]` tag, add an entry to the Clarification Register noting both conflicting requirements and the two test case interpretations generated.

3. **[BLOCKED] test cases**: If a test case cannot be fully written due to missing context (e.g., external system API not documented, referenced document unavailable), mark the test case with `[BLOCKED]` in the description and include:
   - The reason for the block
   - What information is needed to unblock
   - A partial test case covering what is known

4. **[EXTERNAL-DEP] test cases**: For test cases dependent on external documents or systems, note the dependency and generate the test case based on available context only.

### Priority Distribution Review

After all test cases are generated, compute the actual priority distribution and compare to the target (30/35/20/15):

```
Actual: P1={n} ({pct}%) | P2={n} ({pct}%) | P3={n} ({pct}%) | P4={n} ({pct}%)
Target: P1=30%           | P2=35%           | P3=20%           | P4=15%
```

If the distribution deviates by more than 10 percentage points in any category, note the deviation and explain the reason (e.g., "System is heavily access-control focused, driving P1 higher than typical").

### Under-coverage Justification

If any FR has fewer than 4 test cases, document the reason:

| FR ID | TC Count | Reason |
|-------|----------|--------|
| FR-08 | 2 | FR has only 1 AC and no BRs; scope is a single read-only display |
| FR-15 | 3 | FR references external system with `[EXTERNAL-DEP]`; 1 TC blocked |

### Clarification Register (Output Appendix)

Add a **Section 4: Clarification Register** to the output document when any `[BRD-AMBIGUOUS]`, `[BRD-CONFLICT]`, or `[BLOCKED]` tags were used:

```markdown
## 4. Clarification Register

| # | TC ID | FR Ref | Tag | BRD Statement | Interpretation Used | Clarification Needed |
|---|-------|--------|-----|---------------|--------------------|--------------------|
| 1 | TC-DOPAMS-FR03-005 | FR-03 AC-04 | [BRD-AMBIGUOUS] | "Approvals may require multiple levels" | Tested with 2-level approval chain | How many approval levels are supported? What determines the chain? |
```

If no tags were used, omit Section 4 and note "No clarifications needed" in the Phase 5 summary.

## Quality Checklist

Before finalizing output, verify:

```
□ Phase 0.5 validation passed — BRD structure is sound, no unresolved issues
□ Every AC in the BRD has at least one test case
□ Every BR in the BRD has at least one test case
□ Priority distribution is approximately 30/35/20/15 (P1/P2/P3/P4) — deviations documented
□ TC IDs are sequential within each FR with no gaps (existing gaps preserved)
□ All pre-conditions are specific and testable (use pre-condition templates)
□ All expected results include verifiable assertions
□ Table format matches existing test case documents exactly
□ Traceability matrix accounts for all FRs
□ No requirements were invented beyond what the BRD states
□ All [BRD-AMBIGUOUS] and [BRD-CONFLICT] tags have entries in the Clarification Register
□ All [BLOCKED] test cases document what is needed to unblock
□ FRs with fewer than 4 test cases have documented justification
□ Priority decision tree was applied consistently for borderline cases
```
