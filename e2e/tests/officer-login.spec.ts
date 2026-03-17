/**
 * C7: E2E test — Officer login and RBAC-scoped inbox
 */
import { test, expect } from "@playwright/test";

test.describe("Officer Login & RBAC", () => {
  test("should show officer login page", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h1")).toContainText("Officer Login");
  });

  test("should login as Clerk and see clerk-level tasks", async ({ page }) => {
    await page.goto("/");
    await page.fill('input[placeholder*="officer1"]', "officer1");
    await page.fill('input[type="password"]', "password123");
    await page.click('button[type="submit"]');
    await expect(page.locator("text=My Inbox")).toBeVisible({ timeout: 10000 });
    // Should show Clerk role in subtitle
    await expect(page.locator("text=CLERK")).toBeVisible();
  });

  test("should login as Junior Engineer and see JE-level tasks", async ({ page }) => {
    await page.goto("/");
    await page.fill('input[placeholder*="officer1"]', "officer4");
    await page.fill('input[type="password"]', "password123");
    await page.click('button[type="submit"]');
    await expect(page.locator("text=My Inbox")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("text=JUNIOR_ENGINEER")).toBeVisible();
  });

  test("should reject citizen user login", async ({ page }) => {
    await page.goto("/");
    await page.fill('input[placeholder*="officer1"]', "citizen1");
    await page.fill('input[type="password"]', "password123");
    await page.click('button[type="submit"]');
    await expect(page.locator("text=Officer login only")).toBeVisible({ timeout: 5000 });
  });
});
