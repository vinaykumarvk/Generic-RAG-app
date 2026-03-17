# @puda/shared — Shared Package

Shared TypeScript types, UI components, form renderer, and utilities used by both the citizen and officer portals.

## Installation

This package is consumed via npm workspaces. No separate install is needed — it's linked automatically when you run `npm install` from the repo root.

```typescript
import { FormRenderer, Button, Modal, useToast } from "@puda/shared";
```

## Exports

### Form Renderer (`form-renderer.tsx`)

The dynamic form rendering engine that powers all application forms. It reads the `form.json` from a service pack and renders multi-page forms with validation.

```typescript
import { FormRenderer } from "@puda/shared";

<FormRenderer
  formDef={serviceConfig.form}
  data={formData}
  onChange={(updated) => setFormData(updated)}
  onSubmit={(data) => submitApplication(data)}
  sharedSections={sharedSections}
/>
```

Features:
- Multi-page navigation with progress indicator
- On-blur field validation
- ARIA attributes for accessibility (`aria-invalid`, `aria-describedby`)
- Shared section resolution (e.g., `{ "sharedSection": "applicant" }`)
- Field types: text, number, enum (select/radio), date, boolean, textarea, file

### UI Components (`ui.tsx`)

A minimal design-system component library.

| Component | Description |
|-----------|-------------|
| `Button` | Variants: primary, secondary, ghost, success, warning, danger. Sizes: sm, md, lg. |
| `Alert` | Info, success, warning, error alert banners. |
| `Field` | Form field wrapper with label, hint, and error display. |
| `Modal` | Accessible dialog with focus trap, close on Escape, and overlay click. |
| `ToastProvider` / `useToast` | Non-blocking toast notification system with auto-dismiss. |
| `Breadcrumb` | Navigation breadcrumb trail. |
| `ProgressBar` | Determinate progress bar (0–100%). |
| `SkeletonBlock` | Content placeholder with pulse animation for loading states. |

**Toast usage:**

```typescript
import { useToast } from "@puda/shared";

function MyComponent() {
  const showToast = useToast();
  showToast("Application submitted successfully!", "success");
}
```

**Modal usage:**

```typescript
import { Modal } from "@puda/shared";

<Modal open={isOpen} title="Confirm" onClose={() => setOpen(false)} actions={<Button>OK</Button>}>
  Are you sure?
</Modal>
```

### Utilities (`utils.ts`)

| Function | Description |
|----------|-------------|
| `formatDate(dateStr)` | Format ISO date to locale string |
| `getStatusBadgeClass(stateId)` | CSS class name for application state badge |
| `getStatusLabel(stateId)` | Human-readable label for application state |
| `getServiceDisplayName(key)` | Display name for a service key |
| `timeAgo(dateStr)` | Relative time string ("2 hours ago") |

### Constants (`constants.ts`)

Canonical enums used across frontend and API:

- `ApplicationState` — DRAFT, SUBMITTED, PENDING_AT_CLERK, APPROVED, REJECTED, CLOSED, etc.
- `TaskStatus` — PENDING, IN_PROGRESS, COMPLETED
- `SystemRole` — CLERK, PUDA_SR_ASST, ACCOUNT_OFFICER, JUNIOR_ENGINEER, SDO, DRAFTSMAN, ADMIN
- `EventType` — APPLICATION_SUBMITTED, QUERY_RAISED, etc.

### Master Model (`master-model/`)

Zod schemas and TypeScript types for the complete data model:

| Module | Coverage |
|--------|----------|
| `applicant.ts` | Applicant personal details |
| `application.ts` | Application entity |
| `audit.ts` | Audit events and hash chain |
| `communications.ts` | Notices, emails, SMS logs |
| `decision-outputs.ts` | Decision records and output generation |
| `declarations.ts` | Applicant declarations |
| `documents.ts` | Document types and metadata |
| `fees-payments.ts` | Fee schedules and payment records |
| `inspections.ts` | Physical verification records |
| `parties.ts` | Third-party stakeholders |
| `primitives.ts` | Shared primitive types (IDs, dates, enums) |
| `professionals.ts` | Licensed professionals (architects, engineers) |
| `property.ts` | Property details |
| `service-config.ts` | Service pack configuration types |
| `service-request.ts` | Service request wrapper |
| `workflow.ts` | Workflow state and transition types |

### Error Reporting (`error-reporting.ts`)

Pluggable error reporting that integrates with Sentry when configured, or falls back to a `fetch`/`sendBeacon`-based reporter.

```typescript
import { initErrorReporting, getErrorReporter } from "@puda/shared/error-reporting";

initErrorReporting({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  app: "citizen-portal",
});

getErrorReporter().captureException(error);
```

## Development

This package has no build step — it's consumed directly as TypeScript source via workspace linking. Both Vite (frontends) and tsx (API) resolve it at build/runtime.

To add a new export, update `src/index.ts`.
