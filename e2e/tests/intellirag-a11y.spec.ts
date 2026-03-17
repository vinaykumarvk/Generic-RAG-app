/**
 * IntelliRAG E2E: Accessibility (WCAG 2.x) tests
 * Maps to: Existing a11y pattern from a11y-smoke.spec.ts, applied to
 * IntelliRAG-specific pages.
 *
 * Uses @axe-core/playwright to scan for serious/critical violations.
 */
import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function formatViolations(
  violations: { id: string; impact?: string | null; nodes: { target: string[] }[] }[],
): string {
  if (violations.length === 0) return "No serious/critical axe violations found.";
  return violations
    .map(
      (violation) =>
        `${violation.id} (${violation.impact || "unknown"}) on ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`,
    )
    .join("\n");
}

const mockUser = {
  user_id: "usr-1",
  username: "testuser",
  email: "testuser@example.com",
  full_name: "Test User",
  user_type: "USER",
};

const mockToken = "mock-jwt-token-for-tests";

const mockWorkspace = {
  workspace_id: "ws-1",
  name: "Research Papers",
  slug: "research-papers",
  description: "Collection of research documents",
  status: "ACTIVE",
  settings: {},
  member_count: 3,
  document_count: 12,
  created_at: "2026-03-01T10:00:00.000Z",
};

async function seedAuth(page: Page) {
  await page.addInitScript(
    ({ token }) => {
      localStorage.setItem("intellirag_token", token);
    },
    { token: mockToken },
  );
}

async function installApiMocks(page: Page) {
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;

    if (req.method() === "GET" && path === "/api/v1/users/me") {
      return route.fulfill({ status: 200, json: mockUser });
    }

    if (req.method() === "GET" && path === "/api/v1/workspaces") {
      return route.fulfill({
        status: 200,
        json: { workspaces: [mockWorkspace] },
      });
    }

    if (req.method() === "GET" && path === "/api/v1/workspaces/ws-1") {
      return route.fulfill({ status: 200, json: mockWorkspace });
    }

    if (req.method() === "GET" && path === "/api/v1/workspaces/ws-1/documents") {
      return route.fulfill({
        status: 200,
        json: { documents: [], total: 0 },
      });
    }

    if (req.method() === "GET" && path === "/api/v1/workspaces/ws-1/conversations") {
      return route.fulfill({
        status: 200,
        json: { conversations: [] },
      });
    }

    return route.fulfill({ status: 404, json: { error: `Unmocked: ${req.method()} ${path}` } });
  });
}

async function runAxeScan(page: Page) {
  const axeScan = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();

  return axeScan.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("IntelliRAG Accessibility", () => {
  test("login page has no critical WCAG violations", async ({ page }) => {
    // No auth needed — login page is the unauthenticated landing page
    await page.route("**/api/v1/**", async (route) => {
      return route.fulfill({ status: 404, json: {} });
    });

    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 10000 });

    const violations = await runAxeScan(page);
    expect(violations, formatViolations(violations)).toEqual([]);
  });

  test("login page supports keyboard focus progression", async ({ page }) => {
    await page.route("**/api/v1/**", async (route) => {
      return route.fulfill({ status: 404, json: {} });
    });

    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 10000 });

    // Press Tab — focus should move to the username input
    await page.keyboard.press("Tab");

    const activeElement = await page.evaluate(() => {
      const active = document.activeElement;
      return {
        tagName: active?.tagName || null,
        type: (active as HTMLInputElement)?.type || null,
      };
    });

    // Should focus an input, not remain on BODY
    expect(activeElement.tagName).not.toBe("BODY");
    expect(activeElement.tagName).toBe("INPUT");
  });

  test("dashboard page has no critical WCAG violations", async ({ page }) => {
    await seedAuth(page);
    await installApiMocks(page);

    await page.goto("/");
    await expect(page.getByRole("heading", { name: /workspaces/i })).toBeVisible({ timeout: 10000 });

    const violations = await runAxeScan(page);
    expect(violations, formatViolations(violations)).toEqual([]);
  });

  test("document upload page has no critical WCAG violations", async ({ page }) => {
    await seedAuth(page);
    await installApiMocks(page);

    await page.goto("/workspace/ws-1/documents");
    await expect(page.getByRole("heading", { name: /documents/i })).toBeVisible({ timeout: 10000 });

    const violations = await runAxeScan(page);
    expect(violations, formatViolations(violations)).toEqual([]);
  });

  test("query page has no critical WCAG violations", async ({ page }) => {
    await seedAuth(page);
    await installApiMocks(page);

    await page.goto("/workspace/ws-1/query");
    await expect(page.getByPlaceholder(/ask a question about your documents/i)).toBeVisible({ timeout: 10000 });

    const violations = await runAxeScan(page);
    expect(violations, formatViolations(violations)).toEqual([]);
  });
});
