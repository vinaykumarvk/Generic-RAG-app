/**
 * IntelliRAG E2E: Administration tests
 * Maps to: TC-FR022-01 through TC-FR022-05 (Admin UI)
 *
 * Tests the admin page for LLM provider management, test button,
 * and access restriction for non-admin users.
 */
import { test, expect, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const adminUser = {
  user_id: "usr-admin",
  username: "admin",
  email: "admin@example.com",
  full_name: "Admin User",
  user_type: "ADMIN",
};

const regularUser = {
  user_id: "usr-1",
  username: "testuser",
  email: "testuser@example.com",
  full_name: "Test User",
  user_type: "USER",
};

const mockToken = "mock-jwt-token-for-tests";

const mockProviders = [
  {
    config_id: "llm-1",
    provider: "openai",
    display_name: "GPT-4o Production",
    api_base_url: "https://api.openai.com/v1",
    model_id: "gpt-4o",
    is_active: true,
    is_default: true,
    max_tokens: 4096,
    temperature: 0.3,
  },
  {
    config_id: "llm-2",
    provider: "anthropic",
    display_name: "Claude 3.5 Sonnet",
    api_base_url: "https://api.anthropic.com/v1",
    model_id: "claude-3-5-sonnet-20241022",
    is_active: true,
    is_default: false,
    max_tokens: 4096,
    temperature: 0.2,
  },
  {
    config_id: "llm-3",
    provider: "ollama",
    display_name: "Local Llama 3.1",
    api_base_url: "http://localhost:11434",
    model_id: "llama3.1:8b",
    is_active: false,
    is_default: false,
    max_tokens: 2048,
    temperature: 0.5,
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedAuth(page: Page, user: typeof adminUser) {
  await page.addInitScript(
    ({ token }) => {
      localStorage.setItem("intellirag_token", token);
    },
    { token: mockToken },
  );
  // We also need the /users/me route to return the correct user, so we pass
  // the user identity through a page-level variable that the route handler reads.
  await page.addInitScript(
    ({ u }) => {
      (window as any).__test_user = u;
    },
    { u: user },
  );
}

async function installApiMocks(page: Page, user: typeof adminUser) {
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;

    if (req.method() === "GET" && path === "/api/v1/users/me") {
      return route.fulfill({ status: 200, json: user });
    }

    if (req.method() === "GET" && path === "/api/v1/workspaces") {
      return route.fulfill({ status: 200, json: { workspaces: [] } });
    }

    // LLM providers list
    if (req.method() === "GET" && path === "/api/v1/admin/llm/providers") {
      return route.fulfill({ status: 200, json: { providers: mockProviders } });
    }

    // LLM test endpoint
    if (req.method() === "POST" && path === "/api/v1/admin/llm/test") {
      const body = JSON.parse(req.postData() || "{}");
      const configId = body.config_id;

      if (configId === "llm-3") {
        // Simulate failure for the inactive provider
        return route.fulfill({
          status: 200,
          json: { success: false, latencyMs: 0, error: "Connection refused" },
        });
      }

      return route.fulfill({
        status: 200,
        json: { success: true, latencyMs: 245 },
      });
    }

    return route.fulfill({ status: 404, json: { error: `Unmocked: ${req.method()} ${path}` } });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("IntelliRAG Administration (TC-FR022)", () => {
  test("admin page shows LLM providers (TC-FR022-01)", async ({ page }) => {
    await seedAuth(page, adminUser);
    await installApiMocks(page, adminUser);

    await page.goto("/admin");

    // Page heading
    await expect(page.getByRole("heading", { name: /administration/i })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Manage LLM providers and system configuration")).toBeVisible();

    // LLM Providers section
    await expect(page.getByText("LLM Providers")).toBeVisible();

    // Provider names
    await expect(page.getByText("GPT-4o Production")).toBeVisible();
    await expect(page.getByText("Claude 3.5 Sonnet")).toBeVisible();
    await expect(page.getByText("Local Llama 3.1")).toBeVisible();

    // Provider details (model/endpoint)
    await expect(page.getByText(/openai \/ gpt-4o/i)).toBeVisible();
    await expect(page.getByText(/anthropic \/ claude-3-5-sonnet/i)).toBeVisible();
    await expect(page.getByText(/ollama \/ llama3\.1:8b/i)).toBeVisible();

    // Status badges
    await expect(page.getByText("Active").first()).toBeVisible();
    await expect(page.getByText("Default")).toBeVisible();

    // Test buttons for each provider
    const testButtons = page.getByRole("button", { name: /^test$/i });
    await expect(testButtons).toHaveCount(3);
  });

  test("test button triggers LLM connectivity test (TC-FR022-02)", async ({ page }) => {
    await seedAuth(page, adminUser);
    await installApiMocks(page, adminUser);

    await page.goto("/admin");
    await expect(page.getByText("LLM Providers")).toBeVisible({ timeout: 10000 });

    // Click the first "Test" button (for GPT-4o Production)
    const testButtons = page.getByRole("button", { name: /^test$/i });
    await testButtons.first().click();

    // Should show a success result with latency
    await expect(page.getByText("245ms")).toBeVisible({ timeout: 5000 });
  });

  test("non-admin user cannot access admin page (TC-FR022-03)", async ({ page }) => {
    await seedAuth(page, regularUser);
    await installApiMocks(page, regularUser);

    await page.goto("/admin");

    // The AdminPage checks isAdmin and shows a gatekeeper message
    await expect(page.getByText("Admin access required")).toBeVisible({ timeout: 10000 });

    // LLM Providers section should NOT be visible
    await expect(page.getByText("LLM Providers")).not.toBeVisible();
  });
});
