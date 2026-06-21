# Judgment Triad Pilot Results And Decision Record

## Pilot Scope

- Domain: NDPS Section 50, personal search, search and seizure, and chain-of-custody issues.
- Courts: Supreme Court of India, Delhi High Court, Punjab and Haryana High Court.
- Years: 2020-2025.
- Evaluation set: 50 officer-style questions in `docs/evaluations/judgment-pilot-eval-set.md`.

## Implementation Status

Completed in this branch:

- Judgment evidence contract and 50-question pilot evaluation set.
- Judgment ontology additions for authority, temporal validity, sensitive data, source quality, corpus scope, and high-risk legal edges.
- Workspace helper for applying the judgment ontology and retrieval profiles.
- Closed-schema KG extraction for judgment ontology workspaces.
- Judgment metadata, outcome, statute/section, source-quality, redaction, and provenance schema.
- Legal KG quality controls, high-impact edge review status, graph assertions, review queue categories, and QA reports.
- Legal wiki article, claim, source, embedding/FTS, review, and coverage-gap schema.
- Wiki selector, query planner, triad fusion tracing, and wiki/graph chunk boosts.
- Triad-aware answer prompt and UI surfaces for wiki, graph paths, evidence fusion, and layer-specific feedback.

## Verification Run

Runnable checks in this environment:

- `apps/worker/.venv/bin/python -m unittest apps/worker/tests/test_kg_extractor.py apps/worker/tests/test_metadata_extractor.py` - passed, 11 tests.
- `apps/worker/.venv/bin/python -m py_compile apps/worker/src/pipeline/kg_extractor.py apps/worker/src/pipeline/metadata_extractor.py` - passed.
- `python3 -m json.tool docs/ontology/judgment-legal-ontology-v1.json` - passed.
- Static checks with `rg` confirmed Phase 0-7 artifacts and migration sequence through 027.

Blocked in this shell:

- API, shared, web, and Playwright tests could not be executed because `node` and `npm` are not available on PATH.
- Database migrations could not be applied because no local PostgreSQL service/`psql` was available in this shell.
- Real pilot ingestion could not be run because the court corpus source path and storage credentials were not configured in this session.

## Pilot Measurement Plan

For each of the 50 pilot questions, compare these modes:

- `vector_only`
- `graph_only`
- `wiki_only`
- `hybrid` triad

Score each answer on:

- Citation correctness: every material claim has raw judgment chunk or paragraph support.
- Legal correctness: reviewer accepts court hierarchy, statute, temporal applicability, and outcome explanation.
- Outcome specificity: answer distinguishes accused, charge, section, appeal posture, and reason.
- Corpus honesty: pattern answers include denominator, exclusions, OCR/metadata caveats, and source scope.
- Officer usefulness: answer frames lessons as lawful procedure, evidence reliability, and documentation quality.
- Latency: total and per-step latency from answer journey.
- Coverage gap creation: failed doctrine/officer-lesson queries create wiki or graph gaps.

## Release Gate

Do not scale beyond the pilot corpus until:

- At least 30 reviewed wiki articles are approved with verified material-claim citations.
- High-impact graph edges have `source_span`, `review_status`, and reviewer decision coverage.
- Triad retrieval beats vector-only and graph-only on legal reviewer acceptance.
- Sensitive-data and redaction behavior is manually verified for any POCSO/sexual-offence expansion.
- Full API, worker, web, migration, and E2E test suites pass in an environment with Node, PostgreSQL, and Playwright available.

## Decision

Decision for current code state: implementation scaffold is ready for local integration testing, seeded corpus ingestion, and legal review, but not ready for production release until the blocked runtime checks and real-corpus pilot scoring are completed.
