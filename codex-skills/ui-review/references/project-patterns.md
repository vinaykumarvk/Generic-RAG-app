# Project UI Patterns

Read this only when the repo looks like IntelliRAG or one of the related policing apps, or when you need to preserve the project-specific expectations captured in the older Claude playbook.

## Login expectations

- Full-height layout should prefer `100dvh` over `100vh`.
- Login should have a branded header, theme selector, loading and disabled states, keyboard-friendly form semantics, and clear error handling.
- "Remember me" may persist username, not password.
- If the app is localized, login strings should come from locale files rather than hardcoded text.

## Mobile navigation expectations

- Sidebar-based apps should expose a mobile entry point such as a hamburger or bottom-nav overflow path.
- Off-canvas navigation should include overlay or backdrop handling, escape or close affordances, and accessible labels.
- Navigation items should keep usable touch targets and meaningful icons when collapsed.

## Faceted list filters

- If list views expose filter dropdowns, prefer API-backed facet counts instead of static options when the product already supports that pattern.
- Fallback behavior should remain usable if facet data fails to load.

## Dashboard drill-down

- Clickable stat cards should use button semantics, not generic clickable containers.
- Hover, active, and focus-visible states should be explicit.
- Cards should route to a real destination instead of acting as dead affordances.

## Theme system

- Active, hover, disabled, selected, and dark-mode states must all use the same token system.
- Theme application should happen early enough to avoid a flash of the wrong theme.
- Readability bugs often come from mixing an "active text" token with a softened background state or from bypassing tokens with hardcoded values.
