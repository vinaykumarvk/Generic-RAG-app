/**
 * Hash-based routing utility — shared by citizen + officer apps.
 * Pure TypeScript, no React dependency.
 */

let _suppressed = false;

/** Whether the most recent history change was programmatic (should be skipped by popstate). */
export function isSuppressed(): boolean {
  return _suppressed;
}

export type ParsedHash = {
  view: string;
  resourceId?: string;
  params: Record<string, string>;
};

/**
 * Parse a hash like `#/track/PUDA/BP/2025/001?status=DRAFT` into structured data.
 * ARN slashes are handled by joining all segments after the view segment.
 */
export function parseHash(hash: string): ParsedHash {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const [pathPart, queryPart] = raw.split("?", 2);
  const segments = pathPart.split("/").filter(Boolean);

  const params: Record<string, string> = {};
  if (queryPart) {
    for (const pair of queryPart.split("&")) {
      const [k, v] = pair.split("=", 2);
      if (k) params[decodeURIComponent(k)] = v ? decodeURIComponent(v) : "";
    }
  }

  const view = segments[0] || "";
  const resourceId = segments.length > 1 ? segments.slice(1).join("/") : undefined;

  return { view, resourceId, params };
}

/**
 * Build a hash string from parts.
 * e.g. `buildHash("track", "PUDA/BP/2025/001")` → `"#/track/PUDA/BP/2025/001"`
 */
export function buildHash(view: string, resourceId?: string, params?: Record<string, string>): string {
  let hash = `#/${view}`;
  if (resourceId) hash += `/${resourceId}`;
  if (params && Object.keys(params).length > 0) {
    const qs = Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");
    hash += `?${qs}`;
  }
  return hash;
}

/** Push a new history entry. Suppresses popstate to prevent re-entrant handling. */
export function pushHash(hash: string): void {
  if (window.location.hash === hash) return;
  _suppressed = true;
  window.history.pushState(null, "", hash);
  // Release suppression asynchronously so the (non-existent for pushState) popstate is skipped
  queueMicrotask(() => { _suppressed = false; });
}

/** Replace the current history entry. Suppresses popstate. */
export function replaceHash(hash: string): void {
  _suppressed = true;
  window.history.replaceState(null, "", hash);
  queueMicrotask(() => { _suppressed = false; });
}

/**
 * Validate a parsed view string against a list of valid views.
 * Returns the view if valid, or the fallback otherwise.
 */
export function validateView<T extends string>(view: string, validViews: readonly T[], fallback: T): T {
  return (validViews as readonly string[]).includes(view) ? (view as T) : fallback;
}
