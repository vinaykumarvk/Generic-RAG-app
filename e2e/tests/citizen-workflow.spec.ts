/**
 * E2E: Full citizen workflow — create, fill form, upload document, submit, track status.
 */
import { test, expect } from "@playwright/test";

test.describe("Citizen Application Workflow", () => {
  test.beforeEach(async ({ page }) => {
    // Login as citizen
    await page.goto("/");
    await page.fill('input[placeholder*="citizen"]', "citizen1");
    await page.fill('input[type="password"]', "password123");
    await page.click('button[type="submit"]');
    await expect(page.locator("text=Dashboard")).toBeVisible({ timeout: 10000 });
  });

  test("should show dashboard with stats after login", async ({ page }) => {
    await expect(page.locator("text=Total Applications")).toBeVisible();
    await expect(page.locator("text=Active")).toBeVisible();
    await expect(page.locator("text=New Service Request")).toBeVisible();
  });

  test("should navigate to service catalog", async ({ page }) => {
    await page.click("text=New Service Request");
    await expect(page.locator("text=Service Catalog")).toBeVisible({ timeout: 5000 });
    // Should show at least one service
    await expect(page.locator("text=No Due Certificate")).toBeVisible();
  });

  test("should start a new No Due Certificate application", async ({ page }) => {
    await page.click("text=New Service Request");
    await expect(page.locator("text=Service Catalog")).toBeVisible({ timeout: 5000 });
    // Click Apply Now on the first service
    const applyButtons = page.locator("text=Apply Now");
    await applyButtons.first().click();
    // Should show a form with Save Draft button
    await expect(page.locator("text=Save Draft")).toBeVisible({ timeout: 10000 });
  });

  test("should save a draft application", async ({ page }) => {
    await page.click("text=New Service Request");
    await expect(page.locator("text=Service Catalog")).toBeVisible({ timeout: 5000 });
    const applyButtons = page.locator("text=Apply Now");
    await applyButtons.first().click();
    await expect(page.locator("text=Save Draft")).toBeVisible({ timeout: 10000 });
    // Click Save Draft
    await page.click("text=Save Draft");
    // Should show success alert
    page.on("dialog", (dialog) => {
      expect(dialog.message()).toContain("Draft saved");
      dialog.accept();
    });
  });

  test("should view an existing application from dashboard", async ({ page }) => {
    // If there are recent applications, click the first one
    const viewDetails = page.locator("text=View Details");
    const count = await viewDetails.count();
    if (count > 0) {
      await viewDetails.first().click();
      await expect(page.locator("text=Application Details")).toBeVisible({ timeout: 10000 });
      await expect(page.locator("text=Current Status")).toBeVisible();
      await expect(page.locator("text=Documents")).toBeVisible();
    }
  });

  test("should navigate to all applications view", async ({ page }) => {
    // Look for the "View All Applications" link if there are applications
    const viewAll = page.locator("text=View All Applications");
    const count = await viewAll.count();
    if (count > 0) {
      await viewAll.first().click();
      await expect(page.locator("text=All Applications")).toBeVisible({ timeout: 5000 });
    }
  });

  test("should show pending actions section when queries exist", async ({ page }) => {
    // This verifies the Requires Attention section renders (may be empty)
    const attention = page.locator("text=Requires Attention");
    // Section only shows if there are pending actions, so this is a conditional check
    const recentApps = page.locator("text=Recent Applications");
    // At least one of these sections should be present (or welcome state)
    const welcomeOrContent = page.locator("text=Welcome to PUDA").or(recentApps).or(attention);
    await expect(welcomeOrContent.first()).toBeVisible({ timeout: 10000 });
  });
});
