---
name: deploy-app
description: Execute a deployment workflow for a target app or service by checking readiness, building the correct artifact or image, deploying with the repo's configured platform flow, and verifying the live result.
---

# Deploy App

Use this skill when the user wants to deploy an app or service, run a release workflow, publish a Cloud Run or Docker-backed service, or verify a live rollout end-to-end.

## Scope

- Prefer a user-specified app, service, or deployment surface.
- If the user names an app family that clearly expands to multiple services, map the concrete API and UI targets before acting.
- Treat deployment as an execution workflow. Do not silently turn it into a broad refactor or cleanup project.

## Workflow

1. Preflight
- Identify the deployable unit, artifact type, Dockerfile or build script, target platform, project, region, and current live revision if one exists.
- Capture environment limits immediately: missing Docker daemon, missing cloud CLI auth, blocked network, missing secret access, or missing deploy permissions.
- If the repo still contains a richer deployment playbook under `.claude/skills`, read only the parts that match the current target after you map the live deployment surface.

2. Readiness gate
- Check required env vars, secrets, runtime configuration, port binding, health paths, auth mode, and API-to-UI integration shape.
- Review Dockerfiles, build scripts, static asset paths, and any platform-specific startup assumptions.
- Stop with a clear blocker list if readiness is red and the user did not ask for remediation.

3. Build and verify the artifact
- Prefer the repo's existing build and image scripts.
- If local Docker is unavailable, say so explicitly and only switch to remote build flows when the user still wants deployment.
- Verify the produced artifact at the highest level you can: local container run, local binary start, or at minimum a successful production build with clear limits.

4. Deploy
- Use the least surprising existing deployment path first: repo script, make target, cloudbuild file, or documented CLI command.
- Log the exact command, image or artifact identifier, target service, and resulting revision or URL.
- Do not change cloud project or region implicitly; confirm the active context from tooling or repo config.

5. Post-deploy verification
- Check health and readiness.
- Check authentication or session bootstrap if the service is user-facing.
- Check one or two critical feature paths, not just the root URL.
- Check logs for startup or runtime failures after the new revision receives traffic.

6. Rollback readiness
- Record the last known good revision or image if discoverable.
- Provide the concrete rollback command or next action if the new rollout is bad.

7. Report
- State readiness before deploy, what was deployed, what was verified live, what remains unverified, and any follow-up actions.

## Deployment States

- `BLOCKED`: missing capability, credentials, or hard readiness failure.
- `READY-TO-DEPLOY`: the artifact and config passed the pre-deploy gate but deployment was not executed.
- `DEPLOYED-WITH-LIMITS`: deployment succeeded but some meaningful live checks were not possible.
- `DEPLOYED-VERIFIED`: deployment succeeded and the requested live checks passed.

## Rules

- Never claim a service is deployed correctly unless you verified the resulting revision, URL, or runtime state.
- Default to fixing only narrow deploy blockers. Ask before broad cleanup sweeps, schema changes with risk, or commits and tags.
- Keep readiness review and release execution conceptually separate in the final output.
- If you save a report, use `docs/reviews/deploy-readiness-{targetSlug}-{YYYY-MM-DD}.md`.
- If the target looks like one of the older Cloud Run monorepos, read [project-patterns](references/project-patterns.md).
