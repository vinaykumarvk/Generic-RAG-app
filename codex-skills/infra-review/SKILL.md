---
name: infra-review
description: Review architecture, performance, reliability, observability, build pipelines, configuration, and deployment readiness when the user asks for infrastructure or operability analysis. Use for services, monorepos, Docker or CI setups, and release-readiness checks.
---

# Infrastructure Review

Use this skill when the user wants an architecture review, deployment-readiness check, Docker or CI critique, or a grounded answer about system reliability and operability.

## Scope

- Prefer the user-specified app, service, package, or deployment surface.
- If no target is given, review the whole system but keep the result organized by runtime component.
- Capture environment limits early: no Docker daemon, no cloud access, no running database, or no CI logs.

## Workflow

1. Build the system map.
- Enumerate runtime pieces: apps, APIs, workers, cron jobs, queues, databases, caches, and external services.
- Identify build and deploy scripts, Dockerfiles, compose manifests, CI workflows, and environment files.

2. Review architecture and dependency boundaries.
- Module ownership, package layering, circular dependencies, unstable shared code, and accidental coupling between apps or runtime tiers.

3. Review performance and scalability.
- Obvious query hot spots, synchronous bottlenecks, oversized frontend bundles, missing caching, and any design that blocks horizontal scaling.

4. Review reliability and recovery.
- Startup and shutdown behavior, health and readiness checks, migration safety, retry strategy, timeouts, backpressure, idempotency, and failure isolation.

5. Review observability and operations.
- Structured logging, metrics, tracing, dashboards, alert hooks, auditability, and whether failures would be diagnosable in production.

6. Review build and delivery surfaces.
- Dockerfile quality, multi-stage builds, dependency caching, artifact paths, CI gate coverage, secret handling in pipelines, and rollout safety.

7. Review configuration and deployment readiness.
- Environment-variable sprawl, unsafe defaults, config drift across environments, secret management, static asset serving, port binding, and zero-downtime concerns where relevant.

8. Produce the review.
- Findings first, ordered by severity.
- For each finding include: `severity`, `confidence`, `operational risk`, `evidence`, `fix`, and `how to verify`.
- End with blocked checks, quick wins, and a verdict: `READY`, `CONDITIONAL`, or `NOT-READY`.

## Severity

- `P0`: likely outage, data-loss, or unrecoverable deployment risk.
- `P1`: strong reliability or operability risk in an important production path.
- `P2`: meaningful hardening or scalability gap.
- `P3`: optimization, cleanup, or future-proofing.

## Rules

- Do not confuse missing local tooling with a production flaw; report it as a verification limit unless the code or config itself is broken.
- Prefer failure-mode analysis over architecture theater. A short, accurate system map is better than a speculative diagram.
- Never mark observability as good unless you found the emitting code, dashboards, or checks that support the claim.
- If you save a report, use `docs/reviews/infra-review-{targetSlug}-{YYYY-MM-DD}.md`.
