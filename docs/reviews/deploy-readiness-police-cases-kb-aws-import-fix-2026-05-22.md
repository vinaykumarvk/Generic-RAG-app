# Deployment Report: police-cases-kb AWS Import Fix

Date: 2026-05-22
Project: policing-apps
Region: asia-southeast1

## Scope

Deployed the API and web services for the judgment workspace AWS Open Data import fixes:

- API guard for malformed workspace ids on AWS import routes.
- Documents page guard for invalid workspace routes.
- AWS import option-load error display.
- Guided tour backdrop no longer intercepts document page clicks.

## Pre-Deploy Verification

- `npm --workspace apps/api run typecheck`: passed.
- `npm --workspace apps/api run test -- document-routes.test.ts`: passed, 18 tests.
- `npm --workspace apps/web run build`: passed.
- `git diff --check`: passed.
- Local browser smoke: AWS Open Data dropdowns populated; Import PDF trial click passed.

## Rollback Revisions

- API previous revision: `police-cases-kb-api-00029-qx8`
- Web previous revision: `police-cases-kb-00023-nf8`

Rollback commands:

```bash
gcloud run services update-traffic police-cases-kb-api --project policing-apps --region asia-southeast1 --to-revisions police-cases-kb-api-00029-qx8=100
gcloud run services update-traffic police-cases-kb --project policing-apps --region asia-southeast1 --to-revisions police-cases-kb-00023-nf8=100
```

## Build And Deploy

API build:

```bash
gcloud builds submit . --project policing-apps --config cloudbuild-api-generic.yaml --substitutions "_DOCKERFILE=Dockerfile.api,_IMAGE=asia-southeast1-docker.pkg.dev/policing-apps/policing-apps/police-cases-kb-api:latest" --quiet
```

API build result: `ddff8aaf-ad48-4573-80b8-4492d8714182`, success.

Web build:

```bash
gcloud builds submit . --project policing-apps --config cloudbuild-frontend.yaml --substitutions "_IMAGE=asia-southeast1-docker.pkg.dev/policing-apps/policing-apps/police-cases-kb:latest,_VITE_API_BASE_URL=" --quiet
```

Web build result: `ccd4aba1-d05a-4a75-b796-380011964bc3`, success.

Deploy results:

- API new revision: `police-cases-kb-api-00030-m6x`, serving 100%.
- Web new revision: `police-cases-kb-00024-knm`, serving 100%.

## Live Verification

- API health: `https://police-cases-kb-api-809677427844.asia-southeast1.run.app/health` returned 200.
- Custom domain login: `https://police-case-history.adssoftek.com/login` returned 200.
- Custom domain browser smoke: AWS Open Data dropdowns populated; Import PDF trial click passed; no unexpected error displayed.
- Real AWS import smoke: `JKHC020000032022_1_2026-03-30.pdf` imported as document `adb14b67-a87b-4d5c-aff3-8793d607563d`; worker processed it to `ACTIVE` with 2 chunks.

## Follow-Up Web Cache Fix

After a user report that the unexpected error still appeared, the web service was redeployed with:

- `index.html`/SPA fallback cache headers set to `no-store, no-cache, must-revalidate`.
- A one-time client reload guard for Vite stale chunk and preload failures.

Web follow-up build:

```bash
gcloud builds submit . --project policing-apps --config cloudbuild-frontend.yaml --substitutions "_IMAGE=asia-southeast1-docker.pkg.dev/policing-apps/policing-apps/police-cases-kb:latest,_VITE_API_BASE_URL=" --quiet
```

Web follow-up build result: `96739ef8-0d75-4b37-838b-39bd145a0698`, success.

Web follow-up deploy result:

- Web new revision: `police-cases-kb-00025-zkd`, serving 100%.
- Custom domain `index.html` now references `/assets/index-Mt_fq4b0.js`.
- Custom domain `index.html` now returns `Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0`.
- Custom domain browser smoke passed again: AWS Open Data dropdowns populated; Import PDF trial click passed; no unexpected error displayed.

Verdict: DEPLOYED-VERIFIED.
