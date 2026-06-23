# District Court CAPTCHA and Rate-Limit Strategy

This document defines the only approved CAPTCHA and rate-limit behavior for district-court eCourts acquisition until a later legal review changes it.

## Decision

The default production strategy is **human-in-the-loop CAPTCHA handling with strict request throttling**. Automated CAPTCHA solving via an approved third-party solving service (Mode 4) is authorized for district-court wide-coverage acquisition under the conditions in this revision. Local OCR (Mode 3) remains blocked. The automated path stays behind a default-off feature flag and must retain throttling, stop conditions, redaction, and full attempt logging.

## Authorization Record

| Field | Value |
|---|---|
| Revision | r2 — Mode 4 automated solving authorized for wide-coverage district acquisition |
| Authorized by (owner/operations) | vinaykumarvk (project owner) |
| Authorization date | 2026-06-23 |
| Scope | district-court eCourts CNR search + order/judgement PDF download |
| Feature flag (default OFF) | `ECOURTS_COMMERCIAL_CAPTCHA_SOLVER_ENABLED` |
| Counsel attestation | ⚠ NOT OBTAINED — **OVERRIDDEN by owner (vinaykumarvk) on 2026-06-23**: owner elected to enable Mode 4 in production without counsel sign-off, accepting the legal/operational risk. Counsel review still outstanding and should be completed retroactively. |
| Data-processing review | ⚠ NOT OBTAINED — overridden by owner under the same decision; vendor DPA for the third-party CAPTCHA solver still outstanding. |
| Production enablement | Mode 4 enabled in `police-cases-kb-worker` (policing-apps) on owner's instruction, 2026-06-23. |

> Engineering note: the counsel attestation and data-processing review were **not** completed; the project owner explicitly overrode these gates to enable `ECOURTS_COMMERCIAL_CAPTCHA_SOLVER_ENABLED=true` in production on 2026-06-23. This record preserves that this was an owner risk-acceptance, not a counsel approval. Retain throttling, stop conditions, and redaction at all times; complete counsel + DPA review as soon as possible.

## Why This Exists

District-court text acquisition may require eCourts CNR lookups or order downloads. The service can present CAPTCHA and rate-limit controls. Bypassing those controls at scale creates legal, operational, and availability risk. The ingestion system must therefore make CAPTCHA handling explicit, auditable, and reversible.

## Allowed Modes

### Mode 1: Metadata-only load

- **Status**: Approved.
- **Use**: DDL and other licensed metadata sources.
- **CAPTCHA**: None.
- **Rate limit**: Source-specific download limits.

### Mode 2: CNR lookup with operator CAPTCHA queue

- **Status**: Approved for pilot.
- **Use**: eCourts text/PDF fallback for targeted CNRs.
- **CAPTCHA**: Presented to a human operator through an internal queue.
- **Rate limit**: Default 1 request per 3 seconds per worker, exponential backoff on 429/503.
- **Logging**: Every attempt must write `district_fetch_attempt` with `captcha_outcome`.

### Mode 3: Local OCR CAPTCHA assistance

- **Status**: Blocked pending legal review.
- **Use**: Not enabled.
- **Risk**: Automated CAPTCHA bypass concern.
- **Activation requirement**: Written approval and a feature flag defaulting to disabled.

### Mode 4: Commercial CAPTCHA-solving services

- **Status**: Approved (owner-authorized 2026-06-23; see Authorization Record). Production enablement still requires the counsel attestation and data-processing review boxes to be signed.
- **Use**: Automated district-court eCourts acquisition for wide coverage. CAPTCHA images from the eCourts CNR search and order/PDF view are submitted to an approved third-party solving service; the returned text is replayed to the portal.
- **Risk**: Legal, ethical, and operational exposure — captcha images (and the session that retrieves PII-bearing judgements) transit an external vendor. Bulk automated access to a public-justice service carries availability and blocking risk.
- **Required controls (all mandatory when enabled)**:
  - Default-off flag `ECOURTS_COMMERCIAL_CAPTCHA_SOLVER_ENABLED`; API key supplied only via environment variable, never committed.
  - Retain all operational limits below (throttle, daily cap, backoff) and the stop conditions.
  - Apply redaction before display, external translation, or retrieval for protected records.
  - Log every solve with `cost_units` and every fetch in `district_fetch_attempt`.
  - Vendor must be on an approved list with a signed data-processing agreement; no protected victim/witness identifiers are sent beyond the raw captcha image.

## Operational Limits

Default eCourts pilot limits:

- `ECOURTS_MAX_WORKERS=1`
- `ECOURTS_MIN_DELAY_MS=3000`
- `ECOURTS_MAX_RETRIES=3`
- `ECOURTS_BACKOFF_MULTIPLIER=2`
- `ECOURTS_DAILY_FETCH_LIMIT=25000`
- `ECOURTS_CAPTCHA_MODE=operator_queue`

Backoff triggers:

- HTTP 429
- HTTP 503
- repeated CAPTCHA failures
- portal timeout
- malformed response
- schema parse failure over threshold

Stop conditions:

- More than 20 percent CAPTCHA failures over a rolling hour.
- More than 10 percent HTTP 429/503 over a rolling hour.
- Any IP block, account warning, or legal notice.
- Any evidence that protected victim data is being exposed before redaction.

## Queue Requirements

The operator queue must show:

- CNR
- state and district
- source URL
- requested action
- CAPTCHA image or challenge payload when legally allowed
- attempt number
- previous failure reason
- sensitivity warning when the case is POCSO, rape, minor-related, or sealed

The queue must not show protected victim or witness details unless required for the CAPTCHA task and approved by policy.

## Audit Requirements

Every eCourts attempt must record:

- CNR or source case ID
- source URL
- timestamp
- worker ID
- request mode
- CAPTCHA mode
- CAPTCHA outcome
- HTTP status
- bytes returned
- delay applied
- retry count
- failure reason
- content checksum if content was fetched

## Feature Flags

Required feature flags:

- `ECOURTS_FETCH_ENABLED`
- `ECOURTS_CAPTCHA_OPERATOR_QUEUE_ENABLED`
- `ECOURTS_LOCAL_CAPTCHA_OCR_ENABLED`
- `ECOURTS_COMMERCIAL_CAPTCHA_SOLVER_ENABLED`

`ECOURTS_CAPTCHA_OPERATOR_QUEUE_ENABLED` (Mode 2) and `ECOURTS_COMMERCIAL_CAPTCHA_SOLVER_ENABLED` (Mode 4, owner-authorized 2026-06-23) may be enabled. `ECOURTS_LOCAL_CAPTCHA_OCR_ENABLED` (Mode 3) remains blocked. All flags default to disabled; Mode 4 production enablement is further gated on the pending counsel attestation in the Authorization Record.

## Release Gate

Before eCourts acquisition moves beyond pilot:

- Legal approval must confirm the chosen CAPTCHA strategy.
- Operations must confirm rate limits and stop conditions.
- Redaction must be implemented for protected records.
- A seven-day pilot must complete without blocks, warnings, or excessive rate-limit failures.

