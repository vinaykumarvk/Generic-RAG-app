# Judgment Evidence Contract

## Phase 0 Pilot Scope

The first judgment workspace pilot is limited to NDPS Section 50, personal search, search and seizure, and chain-of-custody issues.

Initial corpus:

- Courts: Supreme Court of India, Delhi High Court, Punjab and Haryana High Court.
- Years: 2020-2025.
- Judgment type: criminal appeals, criminal revisions, bail orders only when Section 50/search/seizure reasoning is material.
- Primary questions: why a conviction was upheld, set aside, or an acquittal was sustained/reversed; what investigation or prosecution step materially affected the result.

This pilot is intentionally narrow. POCSO and sexual-offence cases should not be exposed officer-facing until redaction, role-based access, and audit logging are implemented and verified.

## Canonical Judgment Identity

Every ingested judgment must have a stable `canonical_judgment_id` before it enters retrieval or graph extraction.

Required identity fields:

- `canonical_judgment_id`: deterministic ID, preferably `court_code:decision_date:case_number_hash`.
- `source_uri`: original source URL or storage URI.
- `source_bucket`: Supreme Court, High Court, eCourts, SCC/Manupatra-equivalent licensed source, local upload, or other approved source.
- `court_code`: normalized court identifier.
- `court_name`: display name.
- `bench_strength`: single judge, division bench, full bench, constitution bench, unknown.
- `judge_names`: normalized judge names where available.
- `case_number`: normalized case number and raw case number.
- `neutral_citation` and `reporter_citations`: where available.
- `decision_date`: date of judgment/order.
- `appeal_posture`: appeal, revision, SLP, writ, bail, trial, unknown.
- `lower_court_reference`: lower court, case number, and order date where available.
- `document_id`: internal document row ID.
- `workspace_id`: judgment workspace ID.

## Legal And Temporal Validity

Every legally material answer must know which legal regime applies. The applicable law is usually tied to the incident/offence date, not only the judgment date.

Required fields:

- `incident_date` or `offence_date`, if available.
- `fir_date`, `arrest_date`, `search_date`, `seizure_date`, `sample_dispatch_date`, `fsl_report_date`, where available.
- `applicable_legal_regime`: `ipc_crpc_evidence_act`, `bns_bnss_bsa`, `transition_period`, `special_statute`, `state_amendment`, or `unknown`.
- `statute_versions`: statutes and sections applied by the court.
- `authority_status`: binding, persuasive, followed, distinguished, overruled, disapproved, per incuriam, doubted, unknown.
- `later_treatment`: later treatment source, treatment type, date, and source span.

If incident date is missing, the system must mark temporal applicability as `unknown` and avoid saying that a new code or amended section governed the case.

## Source Anchors

Every material extraction must point back to the raw judgment text.

Anchor levels:

- `paragraph_number`: preferred.
- `page_start` and `page_end`: required if paragraph numbers are missing.
- `chunk_id`: internal source chunk.
- `quote`: short supporting text span for high-risk assertions.
- `ocr_confidence`: source-level and page-level confidence when OCR was used.
- `anchor_quality`: paragraph, page-only, inferred, missing.

High-risk assertions without anchors must stay out of approved graph and officer-facing answers.

## Outcome Model

Outcomes must be represented per accused, per charge, and per statutory section.

Required structure:

- `accused_id` and normalized accused display label.
- `charge_id`.
- `statute` and `section`.
- `trial_outcome`, if available.
- `appeal_outcome`.
- `final_outcome`: conviction upheld, conviction set aside, acquittal, acquittal reversed, sentence modified, remand, bail granted/rejected, directions issued, unknown.
- `state_or_police_result`: favourable, adverse, mixed, neutral, unknown.
- `reason_category`: procedure, evidence, credibility, statutory interpretation, precedent, sentencing, jurisdiction, delay, unknown.
- `outcome_reason`: short normalized reason.
- `source_span`: paragraph/page/chunk and quote for the reason.

Mixed outcomes must not be flattened to one document-level label.

## Sensitive Data Governance

Sensitive material must be classified during ingestion and enforced during retrieval.

Sensitive markers:

- Victim identity.
- Minor identity.
- Sexual-offence details.
- Medical identity details.
- Address or family identifiers.
- Sealed or in-camera record.
- Redacted text.

Controls:

- Default display must redact victim/minor identity and unnecessary sexual-offence detail.
- Authorized access must be role-based and audited.
- Exports must preserve redaction rules.
- Retrieval traces must record sensitive access decisions.
- POCSO and sexual-offence answers must not produce officer-facing lessons until legal review has approved the article or graph assertion.

## Corpus Validity Card

Every pattern, trend, success-rate, or "why cases fail" answer must include a corpus card.

Required metrics:

- Courts included.
- Years included.
- Source buckets.
- Search/download filters used.
- Number of judgments considered.
- Number ingested successfully.
- Number excluded and reasons.
- OCR failure rate.
- Missing metadata rate.
- Reported/unreported coverage caveat.
- Criminal/civil classification confidence.
- Offence/statute classification confidence.
- Last ingestion date.

The system must not present pattern percentages without the denominator and exclusions.

## Extraction Quality Gates

The approved judgment graph must satisfy these gates:

- No out-of-ontology node or edge types.
- High-risk causal edges require quoted source spans.
- `outcome_caused_by`, `supports_acquittal`, `supports_conviction`, `lapse_caused_doubt`, and `non_compliance_with` default to unreviewed unless quote-backed.
- Authority and later-treatment edges require a reviewed source or recognized citation signal.
- Officer-facing lessons require reviewer approval.
- Wiki articles are synthesis artifacts only; raw judgment text remains the source of truth.

## Phase 0 Acceptance Checklist

- Pilot scope is explicit and manually reviewable.
- Every legally material answer claim has a required path to raw judgment text.
- Pattern-analysis answers require corpus validity cards.
- Sensitive-data rules exist before POCSO or sexual-offence exposure.
- Triad retrieval fusion remains gated until evidence contract and extraction quality checks pass.
