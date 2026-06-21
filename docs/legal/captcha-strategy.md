# District Court CAPTCHA and Rate-Limit Strategy

This document defines the only approved CAPTCHA and rate-limit behavior for district-court eCourts acquisition until a later legal review changes it.

## Decision

The default production strategy is **human-in-the-loop CAPTCHA handling with strict request throttling**. Automated CAPTCHA solving is blocked unless counsel and operations explicitly approve a new revision of this document.

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

- **Status**: Blocked.
- **Use**: Not enabled.
- **Risk**: Legal, ethical, and operational exposure.
- **Activation requirement**: Counsel approval, vendor review, data-processing review, and explicit production change approval.

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

Only `ECOURTS_CAPTCHA_OPERATOR_QUEUE_ENABLED` may be enabled during the initial pilot.

## Release Gate

Before eCourts acquisition moves beyond pilot:

- Legal approval must confirm the chosen CAPTCHA strategy.
- Operations must confirm rate limits and stop conditions.
- Redaction must be implemented for protected records.
- A seven-day pilot must complete without blocks, warnings, or excessive rate-limit failures.

