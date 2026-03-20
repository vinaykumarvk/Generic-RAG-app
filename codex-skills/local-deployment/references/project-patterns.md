# Local Verification Patterns

Read this only when the repo matches the older ADS or PUDA-style monorepos, or when the current target shows the same patterns.

## Monorepo rebuild order

- If the target imports compiled workspace packages, rebuild the dependency chain before assuming the app is broken.
- A common chain in these repos is:
  `shared -> workflow-engine -> api-core -> api-integrations -> target app`
- Stale `dist/` outputs can make a local dev server look healthy while still executing old package code.

## Frontend-to-API pairing

- Derive the actual frontend-to-API mapping from current code, not memory.
- Useful clues: `vite.config.*`, proxy blocks, `VITE_API_BASE_URL`, route manifests, and fetch helpers.
- In older repos, UI apps such as `citizen` and `officer` shared a common API service, while other app families had distinct `-ui` and `-api` pairs.

## Cookie auth and proxy pitfalls

- If the UI talks to `/api/...` on the same origin via nginx or another reverse proxy, preserve an intentionally empty `VITE_API_BASE_URL`.
- Do not replace empty-string config with a fallback by using `||`; prefer `??` when the empty string is meaningful.
- For cookie auth, verify both client-side `credentials: "include"` behavior and server-side CORS or same-origin assumptions.

## Local infrastructure pitfalls

- Port conflicts are common. Identify the process before killing anything.
- Local database failures often come from stale `.env` ports or cloud proxy ports copied into a local setup.
- Login request shapes vary by app; derive the payload fields from the live route schema instead of assuming `username`, `email`, or `login`.
