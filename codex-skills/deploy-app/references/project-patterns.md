# Deployment Patterns

Read this only when the repo or target service matches these patterns. Do not assume they apply everywhere.

## Cloud Run image builds with non-standard Dockerfiles

- `gcloud builds submit --tag ...` does not let you pick a non-default Dockerfile.
- When the repo uses `Dockerfile.<service>` or requires build args, prefer an explicit `cloudbuild.yaml` or equivalent scripted build step.

## UI plus API deploy ordering

- For app families with separate API and UI services, deploy the API first when the UI needs the API URL baked into the build.
- Capture the deployed API URL or revision output before building the UI.
- If the UI instead uses a same-origin reverse proxy, do not inject a direct API origin into the bundle.

## Reverse proxy and cookie auth

- Some older ADS or PUDA apps relied on nginx or another reverse proxy so the browser could call `/api/...` on the same origin.
- In that setup, an intentionally empty `VITE_API_BASE_URL` or similar setting is valid and should be preserved.
- Treat empty-string config carefully: `??` preserves it; `||` can break it.

## Cloud SQL socket deployments

- If a service connects to Cloud SQL through the platform socket path, verify both the socket annotation and the app's SSL mode.
- Older Node services sometimes defaulted to SSL for normal TCP connections and crashed on Cloud SQL Unix sockets unless SSL was explicitly disabled.

## Docker-unavailable environments

- If the local Docker daemon is unavailable, do not pretend a container smoke test passed.
- Either stop with a clear verification limit or continue with a remote build path if the user still wants deployment.

## Rollback discipline

- Capture the prior revision name or image digest before rollout when the platform exposes it.
- A deployment workflow is incomplete if the agent cannot tell the user what to roll back to.
