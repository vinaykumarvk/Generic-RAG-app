/**
 * IntelliRAG E2E: Authentication tests
 * Maps to: TC-FR001-01 (Authentication & Security)
 *
 * Tests login/logout flows and route protection using API mocks.
 * The app stores its JWT as "intellirag_token" in localStorage.
 */
import { test, expect, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

const mockUser = {
  user_id: "usr-1",
  username: "testuser",
  email: "testuser@example.com",
  full_name: "Test User",
  user_type: "USER",
};

const mockToken = "mock-jwt-token-for-tests";

/** Seed localStorage so the app considers the user already authenticated. */
async function seedAuth(page: Page) {
  await page.addInitScript(
    ({ user, token }) => {
      localStorage.setItem("intellirag_token", token);
      // Pre-cache user so the /users/me call can be intercepted before redirect
      (window as any).__intellirag_seeded_user = user;
    },
    { user: mockUser, token: mockToken },
  );
}

/** Install route-level API mocks that the auth flow depends on. */
async function installAuthApiMocks(page: Page, { rejectLogin }: { rejectLogin?: boolean } = {}) {
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;

    // POST /auth/login
    if (req.method() === "POST" && path === "/api/v1/auth/login") {
      if (rejectLogin) {
        return route.fulfill({
          status: 401,
          json: { message: "Invalid username or password" },
        });
      }
      return route.fulfill({
        status: 200,
        json: { token: mockToken, user: mockUser },
      });
    }

    // GET /users/me — return the seeded user
    if (req.method() === "GET" && path === "/api/v1/users/me") {
      return route.fulfill({ status: 200, json: mockUser });
    }

    // GET /workspaces — dashboard needs this
    if (req.method() === "GET" && path === "/api/v1/workspaces") {
      return route.fulfill({ status: 200, json: { workspaces: [] } });
    }

    // Fallback
    return route.fulfill({ status: 404, json: { error: `Unmocked: ${req.method()} ${path}` } });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("IntelliRAG Authentication (TC-FR001-01)", () => {
  test("login with valid credentials redirects to dashboard", async ({ page }) => {
    await installAuthApiMocks(page);

    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText("IntelliRAG")).toBeVisible();

    // Fill login form
    await page.getByLabel("Username").fill("testuser");
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: /sign in/i }).click();

    // After successful login the app navigates to the dashboard
    await expect(page.getByRole("heading", { name: /workspaces/i })).toBeVisible({ timeout: 10000 });
  });

  test("login with invalid credentials shows error message", async ({ page }) => {
    await installAuthApiMocks(page, { rejectLogin: true });

    await page.goto("/login");

    await page.getByLabel("Username").fill("wronguser");
    await page.getByLabel("Password").fill("wrongpass");
    await page.getByRole("button", { name: /sign in/i }).click();

    // The LoginPage renders the error string in a red div
    await expect(page.getByText(/invalid username or password/i)).toBeVisible({ timeout: 5000 });
  });

  test("logout clears session and returns to login", async ({ page }) => {
    await seedAuth(page);
    await installAuthApiMocks(page);

    await page.goto("/");
    await expect(page.getByRole("heading", { name: /workspaces/i })).toBeVisible({ timeout: 10000 });

    // Click the logout button (in the header, title="Logout")
    await page.getByRole("button", { name: /logout/i }).click();

    // Should return to the login page
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("IntelliRAG")).toBeVisible();

    // localStorage token should be gone
    const token = await page.evaluate(() => localStorage.getItem("intellirag_token"));
    expect(token).toBeNull();
  });

  test("protected page redirects to login when not authenticated", async ({ page }) => {
    // Do NOT seed auth — user is unauthenticated
    await installAuthApiMocks(page);

    await page.goto("/");

    // The app should redirect to /login because there is no token
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText("IntelliRAG")).toBeVisible();
  });
});
