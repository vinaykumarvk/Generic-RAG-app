---
name: local-deployment
description: Verify a target app or service works end-to-end in the local environment by rebuilding dependencies, starting the right dev processes, checking auth, data, routes, and feature paths, and confirming manual-test readiness.
---

# Local Deployment

Use this skill when the user wants a local end-to-end verification run, asks you to start the app locally, or wants proof that a feature actually works outside static build and unit-test checks.

## Scope

- Prefer a user-specified app, service, or route. If the target is ambiguous, resolve it from the repo layout before asking.
- Default to full local verification. Honor narrower asks such as API-only, UI-only, report-only, or skip-rebuild when the user makes that intent explicit.
- Treat this as a runtime verification workflow, not a broad code cleanup pass.

## Workflow

1. Preflight
- Identify the target app, its backing services, likely ports, env files, and required local dependencies.
- Check repo state, recent changes, and whether the target depends on workspace packages that may need rebuilding.
- Capture environment limits early: missing database, missing Docker, missing cloud proxy, missing credentials, or blocked network access.

2. Rebuild what the target actually depends on
- Prefer existing repo scripts.
- In monorepos, rebuild upstream packages whose compiled outputs may be stale before starting the target service.
- If the repo still contains a richer local-deployment playbook under `.claude/skills`, read only the parts that match the current target after you understand the live codebase.

3. Verify local prerequisites
- Confirm required env vars exist and are shaped plausibly.
- Verify local infrastructure that the target truly needs: database, cache, queue, object storage emulator, or other sidecars.
- Distinguish app defects from environment blockers.

4. Start the local stack
- Launch only the processes needed for the requested verification scope.
- Do not kill existing processes blindly. Identify what owns a conflicting port and ask before terminating processes that may belong to the user.
- Record the exact commands used, the ports opened, and where logs are going.

5. Run end-to-end smoke checks
- Health and readiness endpoints.
- Authentication and session propagation.
- Public versus protected routes.
- Critical API endpoints and their backing data paths.
- The user-requested feature flow, if one was named.
- Frontend-to-API integration details such as base URL handling, cookies, CORS, and proxy behavior.

6. Fix only critical blockers on the path
- Prefer narrow, reversible fixes.
- Rebuild or restart only the affected pieces after each fix.
- Stop and ask before broad refactors, data migrations with risk, or anything destructive.

7. Report readiness
- State what was executed, what passed, what failed, and what remains unverified.
- Include the local URLs, login path, any credential source the user needs, and any cleanup steps for the spawned processes.

## Verification Gates

- `BLOCKED`: a required dependency or environment capability is missing.
- `NOT-READY`: the app starts but a critical auth, route, or feature path fails.
- `READY-FOR-MANUAL-TEST`: the requested local flow was exercised successfully and the app is ready for human validation.

## Rules

- Never claim a runtime path works unless you executed it.
- Prefer evidence from the running app over source-code inference, but make source-code-backed inferences explicit when runtime validation is impossible.
- Keep process ownership clear: note which sessions you started and which existing processes you left untouched.
- If you save a report, use `docs/reviews/local-deployment-{targetSlug}-{YYYY-MM-DD}.md`.
