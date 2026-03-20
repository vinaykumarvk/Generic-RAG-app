---
name: quality-review
description: Review feature completeness, API quality, data-layer correctness, error handling, tests, maintainability, and i18n when the user asks for code quality or functional gap analysis. Use for backend, frontend, or full-stack quality audits.
---

# Quality Review

Use this skill when the user wants a code quality review, completeness assessment, maintainability audit, or a grounded answer to "what is missing or weak in this implementation?"

## Scope

- Prefer the user-specified app, package, feature, or route.
- If no target is given, review the whole codebase but keep the result organized by subsystem.
- Identify whether the task is requirements-driven, implementation-driven, or both.

## Workflow

1. Build context first.
- Find requirements sources if they exist: BRDs, specs, ADRs, issues, docs, tests, or prior review notes.
- If no requirements exist, infer expected behavior from routes, pages, API shapes, tests, and naming.
- Capture environment constraints that limit certainty, such as missing databases, fixtures, or external services.

2. Map the implementation.
- Identify entry points, major modules, data models, APIs, migrations, background jobs, shared utilities, and test suites.
- Note where the code is thin glue versus where business logic actually lives.

3. Review the key quality dimensions.

### Functional completeness

- Missing flows, partial implementations, dead-end UI, stub APIs, and features implied by docs or tests but not actually delivered.

### API and contract quality

- Request validation, response consistency, error contracts, versioning discipline, and mismatch risk between callers and providers.

### Data-layer correctness

- Schema design, migration safety, query correctness, transactional integrity, indexes, and model-to-database drift.

### Error handling and resilience

- Boundary validation, retry or fallback behavior, useful error surfaces, and graceful degradation in both API and UI paths.

### Tests and verification

- Coverage of important logic, test depth, fixture realism, regression protection, and whether the current tests would catch the likely failures.

### Maintainability

- Duplication, complexity hotspots, hidden coupling, unclear ownership, misleading naming, dead code, and brittle abstractions.

### i18n and content hygiene

- Hardcoded strings in localizable surfaces, missing locale keys, and inconsistent user-facing copy.

4. Separate facts from assumptions.
- Mark what is confirmed in code or tests versus what is inferred from gaps.
- Do not treat "untested" as "broken"; call it out as a confidence gap instead.

5. Produce the review.
- Findings first, ordered by severity.
- For each finding include: `severity`, `confidence`, `what is incomplete or risky`, `evidence`, `fix`, and `how to verify`.
- End with blocked checks, notable strengths, and a verdict: `SOLID`, `NEEDS-WORK`, or `AT-RISK`.

## Severity

- `P0`: clear data-loss, corruption, or correctness failure in a core path.
- `P1`: significant missing feature, broken contract, or weak error handling in an important flow.
- `P2`: maintainability, testing, or completeness gap that should be addressed soon but is not immediately dangerous.
- `P3`: cleanup, simplification, or low-risk hardening.

## Rules

- Prefer evidence-backed product gaps over stylistic complaints.
- Do not infer a feature exists just because a route, type, or table exists; trace the end-to-end behavior.
- Use tests as evidence, not as proof of completeness.
- If requirements are missing, say so and switch explicitly to a code-inferred review.
- If you save a report, use `docs/reviews/quality-review-{targetSlug}-{YYYY-MM-DD}.md`.
