/**
 * C7: E2E test — Citizen login flow
 */
import { test, expect } from "@playwright/test";

test.describe("Citizen Login", () => {
  test("should show login page", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h1")).toContainText("PUDA");
  });

  test("should login with password", async ({ page }) => {
    await page.goto("/");
    await page.fill('input[placeholder*="citizen"]', "citizen1");
    await page.fill('input[type="password"]', "password123");
    await page.click('button[type="submit"]');
    // Should redirect to dashboard
    await expect(page.locator("text=Dashboard")).toBeVisible({ timeout: 10000 });
  });

  test("should show error for invalid credentials", async ({ page }) => {
    await page.goto("/");
    await page.fill('input[placeholder*="citizen"]', "invalid");
    await page.fill('input[type="password"]', "wrong");
    await page.click('button[type="submit"]');
    await expect(page.locator(".error, [class*=error]")).toBeVisible({ timeout: 5000 });
  });

  test("should have language switcher", async ({ page }) => {
    await page.goto("/");
    const langButton = page.locator('button[aria-label="Switch language"]');
    await expect(langButton).toBeVisible();
    await langButton.click();
    // After clicking, should switch to Punjabi
    await expect(page.locator("h1")).toContainText("ਪੁਡਾ");
  });
});
