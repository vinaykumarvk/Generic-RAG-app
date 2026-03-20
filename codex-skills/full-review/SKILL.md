---
name: full-review
description: Run a consolidated engineering review across standards, quality, security, UI, and infrastructure when the user wants a single prioritized verdict on release readiness. Use for full-repo audits, pre-release checks, or "review everything" requests.
---

# Full Review

Use this skill when the user wants one combined review instead of separate UI, security, quality, and infrastructure reports.

## Scope

- Prefer the user-specified app, package, or repo slice.
- If no target is given, review the whole repo and make applicability explicit for each review axis.
- Default to review-only. Remediation is opt-in and should happen only if the user explicitly asks for fixes.

## Workflow

1. Preflight
- Identify the target, stack, available scripts, and hard constraints.
- Decide which review axes actually apply: `standards`, `quality`, `security`, `ui`, and `infra`.
- If an axis is skipped, say why.

2. Run the domain passes in this order.

### Standards baseline

- Check repo-specific standards, enforced tooling, and obvious policy violations.

### Quality and completeness

- Look for functional gaps, data or API correctness issues, testing weakness, and maintainability hot spots.

### Security

- Review attack surface, auth, data handling, and exploit risk.

### UI

- Only if the target has meaningful frontend code. Review accessibility, responsiveness, state coverage, and design-system health.

### Infrastructure

- Only if the target has runtime, build, delivery, or operability surfaces worth reviewing.

3. Run a final sanity pass.
- Look for cross-domain contradictions, missing verification, duplicated findings, and proposed fixes that would create regressions elsewhere.

4. Consolidate.
- Deduplicate by root cause and keep the highest severity.
- Merge corroborating evidence from multiple passes instead of repeating the same bug in multiple sections.
- Resolve conflicts in this order: security, correctness, reliability, accessibility, usability, style.

5. Optional remediation.
- Only if the user asked for fixes.
- Prefer narrow, reversible fixes with targeted verification.
- Stop and ask before large refactors, broad sweeps, or risky migrations.

6. Produce the review.
- Findings first, ordered by severity.
- For each finding include: `domain`, `severity`, `evidence`, `impact`, `fix`, and `how to verify`.
- End with blocked checks, a gate scorecard by domain, and a verdict: `PASS`, `CONDITIONAL`, or `FAIL`.

## Severity

- `CRITICAL`: direct breach, outage, or correctness failure with major blast radius.
- `HIGH`: serious release blocker that should be fixed before shipping.
- `MEDIUM`: important issue that may be acceptable only with explicit tradeoff.
- `LOW`: cleanup or non-blocking improvement.

## Rules

- Do not pretend a clean bill of health if an important domain was not reviewable.
- Do not auto-start a fix campaign unless the user asked for one.
- Prefer one consolidated finding per root cause rather than repeating the same issue across domains.
- If you save a report, use `docs/reviews/full-review-{targetSlug}-{YYYY-MM-DD}.md`.
