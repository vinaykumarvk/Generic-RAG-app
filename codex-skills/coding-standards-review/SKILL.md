---
name: coding-standards-review
description: Review a codebase against its explicit engineering standards and strong default conventions across security, correctness, UI, tests, and operations. Use when the user asks for standards compliance, baseline hygiene, or a broad policy-style review.
---

# Coding Standards Review

Use this skill when the user wants one review pass against engineering standards rather than a deep domain audit of only security, UI, or infrastructure.

## Scope

- Prefer the user-specified directory, app, or package.
- If no target is given, review the whole repo but organize the result by domain and by standard source.
- Identify the hierarchy of truth before flagging violations.

## Source of truth order

1. Repo-specific standards and docs such as `CLAUDE.md`, architecture docs, contribution guides, ADRs, or review playbooks.
2. Enforced tooling such as lint configs, formatters, type-check settings, tests, and CI gates.
3. Strong default engineering conventions when the repo is silent.

Do not present a preference as a standard unless it is backed by one of the three sources above.

## Workflow

1. Discover the standards surface.
- Find standards docs, lint and formatter config, type-check configuration, test scripts, design-system tokens, and deployment gates.
- Note which standards are actually enforced versus merely documented.

2. Build a compact review matrix.
- Security and data safety.
- Correctness and type discipline.
- API and data-layer practices.
- UI, accessibility, and theming.
- Testing and verification.
- Configuration and operations hygiene.

3. Review each domain with evidence.
- Prefer a smaller set of high-confidence violations over a long list of nitpicks.
- When a standard is ambiguous, explain the ambiguity instead of forcing a weak finding.

4. Produce the review.
- Findings first, ordered by severity.
- For each finding include: `standard`, `severity`, `evidence`, `why it violates the standard`, `fix`, and `how to verify`.
- End with a scorecard showing `PASS`, `PARTIAL`, `FAIL`, or `NOT APPLICABLE` by domain and a verdict: `COMPLIANT`, `NEEDS-WORK`, or `NON-COMPLIANT`.

## Severity

- `P0`: violation with direct security, data-loss, or outage potential.
- `P1`: important standards breach likely to cause bugs, accessibility failures, or operational pain.
- `P2`: meaningful inconsistency or maintainability issue.
- `P3`: low-risk cleanup or polish.

## Rules

- Favor enforceable standards over taste.
- If the repo standard conflicts with a generic convention, follow the repo standard and note the tradeoff.
- Do not call something compliant unless you checked the relevant code or gate.
- If you save a report, use `docs/reviews/coding-standards-review-{targetSlug}-{YYYY-MM-DD}.md`.
