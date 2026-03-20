---
name: security-review
description: Audit codebases for authentication, authorization, injection, secrets, data protection, logging, dependency, and runtime security issues. Use when the user asks for a security review, exploit-risk triage, compliance readiness, or hardening guidance.
---

# Security Review

Use this skill when the user wants a security audit, exploit-risk assessment, auth review, secrets scan, or release-readiness check from a security angle.

## Scope

- Prefer the user-specified app, package, service, or flow.
- Otherwise review the whole codebase but keep a clear attack-surface map so the result does not become a vague checklist dump.
- Capture whether you can only inspect code or can also run tests, builds, dependency audits, or the app itself.

## Workflow

1. Map the attack surface.
- Enumerate entry points: HTTP routes, jobs, queues, CLI tools, file uploads, webhooks, admin screens, and external integrations.
- Note trust boundaries: anonymous users, authenticated users, admins, internal services, third-party systems, and background workers.

2. Trace sensitive flows.
- Focus on login and session handling, authorization checks, user-controlled input, secret access, file handling, data export, and audit logging.
- Where a risk depends on multiple files, show the source-to-sink path.

3. Run focused review passes.

### AuthN and session handling

- Credential storage, password hashing, token or cookie handling, session expiry, logout invalidation, and rate limiting on login or password-reset surfaces.

### AuthZ and tenancy

- Route guards, role checks, resource scoping, object-level authorization, workspace or tenant isolation, and mutation protection.

### Input validation and injection

- SQL or ORM query construction, command execution, template or markdown rendering, SSRF paths, path traversal, unsafe deserialization, and file upload validation.

### Secrets and data protection

- Hardcoded secrets, secret propagation through config and logs, encryption at rest or in transit where applicable, data minimization, and sensitive export paths.

### Logging, audit, and abuse prevention

- Audit completeness for critical actions, log redaction, abuse controls, rate limiting, and whether security-relevant failures are observable.

### Dependency and runtime posture

- Dependency vulnerabilities, risky transitive packages, container hardening, insecure defaults, permissive CORS or headers, and production-only config gaps.

4. Triage aggressively.
- Separate confirmed issues from hypotheses.
- Avoid false positives from tests, docs, type definitions, or safe abstractions that only look suspicious in grep output.
- Prioritize exploitability and blast radius over checklist count.

5. Produce the review.
- Findings first, ordered by severity.
- For each finding include: `severity`, `confidence`, `status`, `exploit path`, `evidence`, `fix`, and `how to verify`.
- End with compensating controls, blocked checks, and a verdict: `SECURE`, `AT-RISK`, or `CRITICAL`.

## Severity

- `P0`: practical authentication bypass, authorization bypass, injection, secret exposure, or clear path to major data compromise.
- `P1`: strong exploit potential, sensitive-data leakage, or missing control in an important path.
- `P2`: real hardening gap with limited exploitability or blast radius.
- `P3`: defense-in-depth improvement or cleanup.

## Rules

- Do not overstate dependency risk if you did not run an audit or inspect advisories.
- Distinguish dev-only shortcuts from production exposure; downgrade when the risky path is genuinely non-shipping.
- Prefer one strong exploit narrative over many weak grep hits.
- Never claim a control exists unless you found the enforcing code or ran the relevant verification.
- If you save a report, use `docs/reviews/security-review-{targetSlug}-{YYYY-MM-DD}.md`.
