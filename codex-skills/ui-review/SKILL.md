---
name: ui-review
description: Review web UI/UX quality when the user asks about readability, layout, navigation, responsiveness, accessibility, interaction states, theme regressions, or release readiness for a frontend. Use for React, Vite, dashboard, admin, and screenshot-driven UI bugs.
---

# UI/UX Review

Use this skill for frontend review requests, screenshot-led visual debugging, accessibility audits, responsive navigation issues, design-system drift, or pre-release UI readiness checks.

## Scope

- Prefer the user-specified app, route, screen, or component.
- Otherwise detect UI targets from `apps/*/src`, route entrypoints, and shared UI packages.
- Classify the task early as one of: `bug hunt`, `page review`, or `release-readiness sweep`.
- Capture whether the review is code-only, screenshot-only, or backed by a runnable app.

## Workflow

1. Map the surface area.
- Identify entry routes, layout shells, theme/token files, shared component primitives, form/table/dialog patterns, and any i18n or theme hooks.
- If the repo still contains a richer project-specific playbook such as `.claude/skills/ui-review/SKILL.md`, read it only after you understand the current implementation.

2. Collect evidence before judging.
- Start from the failing screen, screenshot, or route and trace to the owning component, style source, and state logic.
- Prefer exact evidence: component file, token definition, route config, test, and build output.
- Mark visual conclusions as inferred unless you can confirm them from code or from a running build.

3. Review the highest-value areas.

### Visual system

- Theme token usage, typography, spacing, contrast, and component state styling.
- Hardcoded colors or inline styles that bypass the design system.
- Dark mode or multi-theme coverage, especially for hover, active, disabled, and selected states.

### Layout and navigation

- Desktop and mobile navigation, drawers, sidebars, tabs, route affordances, and sticky headers.
- `100dvh` vs `100vh`, safe-area handling, overflow, truncation, and touch-target sizing.
- Whether important actions remain discoverable at narrow widths.

### Accessibility

- Landmarks, accessible names, focus order, `focus-visible`, keyboard operability, dialog semantics, live regions, reduced motion, and contrast.
- Whether critical flows remain usable without a mouse.

### Interaction and state completeness

- Loading, empty, error, disabled, pending, offline, retry, destructive-confirmation, and success states.
- Form validation quality, double-submit prevention, and error recovery.
- Whether feedback is timely and specific instead of silent or ambiguous.

### Content quality

- i18n coverage, long-string resilience, date and number formatting, and microcopy clarity.
- Consistency across routes and components that should share wording.

### Performance and perceived speed

- Route splitting, large bundle suspects, expensive table or list rendering, and needless re-renders.
- Skeletons, optimistic states, and progressive disclosure for slow operations.

4. Apply project-specific checks only when relevant.
- IntelliRAG-style apps: inspect login, sidebar/header shell, theme tokens, dashboard/query/admin flows, and workspace navigation.
- Policing-style apps: inspect login completeness, locale coverage, faceted filters, clickable stat cards, and mobile list/detail behavior.
- If those patterns matter, read [project-patterns](references/project-patterns.md).

5. Produce the review.
- Findings first, ordered by severity.
- For each finding include: `severity`, `confidence`, `what breaks`, `evidence`, `fix`, and `how to verify`.
- End with open questions, notable passes, and a verdict: `GO`, `CONDITIONAL`, or `NO-GO`.

## Severity

- `P0`: inaccessible or unusable core flow, destructive action without safeguards, or severe contrast/focus failure in a critical path.
- `P1`: strong UX regression, broken responsive or navigation behavior, or missing critical state handling.
- `P2`: noticeable inconsistency, partial accessibility or i18n gap, or non-blocking but important polish issue.
- `P3`: cleanup, consistency, or low-risk refinement.

## Rules

- Do not give generic design opinions without tying them to user impact.
- Do not mark a check as passed unless you inspected the code or ran the relevant build or test.
- For screenshot-led bugs, identify whether the root cause is token misuse, state-specific styling, layout overflow, or a missing theme override.
- Prefer a small number of well-supported findings over a long list of weak opinions.
- If you save a report, use `docs/reviews/ui-review-{targetSlug}-{YYYY-MM-DD}.md`.
