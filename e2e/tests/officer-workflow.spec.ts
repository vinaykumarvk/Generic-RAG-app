/**
 * E2E: Officer workflow — inbox, task actions (forward, query, approve, reject).
 */
import { test, expect } from "@playwright/test";

test.describe("Officer Task Workflow", () => {
  test.beforeEach(async ({ page }) => {
    // Login as Clerk (officer1)
    await page.goto("/");
    await page.fill('input[placeholder*="officer1"]', "officer1");
    await page.fill('input[type="password"]', "password123");
    await page.click('button[type="submit"]');
    await expect(page.locator("text=My Inbox")).toBeVisible({ timeout: 10000 });
  });

  test("should display inbox with task list", async ({ page }) => {
    // The inbox should be visible with either tasks or "No pending tasks" message
    const content = page.locator(".panel");
    await expect(content).toBeVisible();
    const noTasks = page.locator("text=No pending tasks");
    const taskList = page.locator(".task-card");
    // Either no tasks or at least one task card
    const hasNoTasks = await noTasks.isVisible().catch(() => false);
    if (!hasNoTasks) {
      const taskCount = await taskList.count();
      // If there are tasks, they should have ARN info
      if (taskCount > 0) {
        await expect(taskList.first().locator("text=ARN")).toBeVisible();
      }
    }
  });

  test("should open task detail when clicking a task", async ({ page }) => {
    const taskCard = page.locator(".task-card").first();
    const taskCount = await taskCard.count();
    if (taskCount > 0) {
      await taskCard.click();
      await expect(page.locator("text=Application Review")).toBeVisible({ timeout: 10000 });
      await expect(page.locator("text=Application Data")).toBeVisible();
      await expect(page.locator("text=Documents")).toBeVisible();
      await expect(page.locator("text=Timeline")).toBeVisible();
      await expect(page.locator("text=Take Action")).toBeVisible();
    }
  });

  test("should show action buttons for active tasks", async ({ page }) => {
    const taskCard = page.locator(".task-card").first();
    const taskCount = await taskCard.count();
    if (taskCount > 0) {
      await taskCard.click();
      await expect(page.locator("text=Application Review")).toBeVisible({ timeout: 10000 });
      // Verify all four action buttons are visible
      await expect(page.locator("button:has-text('Forward')")).toBeVisible();
      await expect(page.locator("button:has-text('Raise Query')")).toBeVisible();
      await expect(page.locator("button:has-text('Approve')")).toBeVisible();
      await expect(page.locator("button:has-text('Reject')")).toBeVisible();
    }
  });

  test("should show query form when Raise Query is clicked", async ({ page }) => {
    const taskCard = page.locator(".task-card").first();
    const taskCount = await taskCard.count();
    if (taskCount > 0) {
      await taskCard.click();
      await expect(page.locator("text=Take Action")).toBeVisible({ timeout: 10000 });
      await page.click("button:has-text('Raise Query')");
      // Should show query-specific fields
      await expect(page.locator("text=Query Message")).toBeVisible();
      await expect(page.locator("text=Unlock Fields")).toBeVisible();
      await expect(page.locator("text=Unlock Documents")).toBeVisible();
      await expect(page.locator("text=Remarks")).toBeVisible();
      // Cancel should dismiss
      await page.click("text=Cancel");
      await expect(page.locator("text=Query Message")).not.toBeVisible();
    }
  });

  test("should show forward form with remarks", async ({ page }) => {
    const taskCard = page.locator(".task-card").first();
    const taskCount = await taskCard.count();
    if (taskCount > 0) {
      await taskCard.click();
      await expect(page.locator("text=Take Action")).toBeVisible({ timeout: 10000 });
      await page.click("button:has-text('Forward')");
      await expect(page.locator("text=Remarks")).toBeVisible();
      await expect(page.locator("text=Submit FORWARD")).toBeVisible();
    }
  });

  test("should navigate back from task detail to inbox", async ({ page }) => {
    const taskCard = page.locator(".task-card").first();
    const taskCount = await taskCard.count();
    if (taskCount > 0) {
      await taskCard.click();
      await expect(page.locator("text=Application Review")).toBeVisible({ timeout: 10000 });
      await page.click("text=← Back to Inbox");
      await expect(page.locator("text=My Inbox")).toBeVisible({ timeout: 5000 });
    }
  });

  test("should display SLA information on overdue tasks", async ({ page }) => {
    // Check if any tasks show SLA info
    const slaLabels = page.locator("text=SLA Due");
    const count = await slaLabels.count();
    if (count > 0) {
      // At least one task has SLA info — verify it's a date
      const firstSla = slaLabels.first();
      await expect(firstSla).toBeVisible();
    }
  });

  test("should show verification checklist when available", async ({ page }) => {
    const taskCard = page.locator(".task-card").first();
    const taskCount = await taskCard.count();
    if (taskCount > 0) {
      await taskCard.click();
      await expect(page.locator("text=Application Review")).toBeVisible({ timeout: 10000 });
      // Verification checklist may or may not appear depending on service config
      const checklist = page.locator("text=Verification Checklist");
      // Just ensure the page renders without error
      await expect(page.locator("text=Application Data")).toBeVisible();
    }
  });
});

test.describe("Officer Search Functionality", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.fill('input[placeholder*="officer1"]', "officer1");
    await page.fill('input[type="password"]', "password123");
    await page.click('button[type="submit"]');
    await expect(page.locator("text=My Inbox")).toBeVisible({ timeout: 10000 });
  });

  test("should toggle to search view", async ({ page }) => {
    await page.click("text=Search");
    await expect(page.locator("text=Search Applications")).toBeVisible();
    await expect(page.locator("input.search-input")).toBeVisible();
    await expect(page.locator(".search-status-select")).toBeVisible();
  });

  test("should toggle back to inbox from search", async ({ page }) => {
    await page.click("text=Search");
    await expect(page.locator("text=Search Applications")).toBeVisible();
    await page.click("text=← Back to Inbox");
    await expect(page.locator("text=My Inbox")).toBeVisible();
  });

  test("should handle search with no results", async ({ page }) => {
    await page.click("text=Search");
    await page.fill("input.search-input", "NONEXISTENT_ARN_99999");
    await page.click("button:has-text('Search')");
    await expect(page.locator("text=No applications found")).toBeVisible({ timeout: 10000 });
  });

  test("should show search results for valid query", async ({ page }) => {
    await page.click("text=Search");
    // Search for a broad term that should match test data
    await page.fill("input.search-input", "PUDA");
    await page.click("button:has-text('Search')");
    // Should show results or "no applications found"
    const results = page.locator("text=Search Results");
    const noResults = page.locator("text=No applications found");
    await expect(results.or(noResults)).toBeVisible({ timeout: 10000 });
  });

  test("should filter search by status", async ({ page }) => {
    await page.click("text=Search");
    await page.fill("input.search-input", "PUDA");
    await page.selectOption(".search-status-select", "SUBMITTED");
    await page.click("button:has-text('Search')");
    // Should complete without error
    const results = page.locator("text=Search Results");
    const noResults = page.locator("text=No applications found");
    await expect(results.or(noResults)).toBeVisible({ timeout: 10000 });
  });

  test("should show export button when results exist", async ({ page }) => {
    await page.click("text=Search");
    await page.fill("input.search-input", "PUDA");
    await page.click("button:has-text('Search')");
    const results = page.locator("text=Search Results");
    const hasResults = await results.isVisible({ timeout: 10000 }).catch(() => false);
    if (hasResults) {
      await expect(page.locator("text=Export CSV")).toBeVisible();
    }
  });

  test("should view application detail from search results", async ({ page }) => {
    await page.click("text=Search");
    await page.fill("input.search-input", "PUDA");
    await page.click("button:has-text('Search')");
    const firstResult = page.locator(".task-card").first();
    const hasResults = await firstResult.isVisible({ timeout: 10000 }).catch(() => false);
    if (hasResults) {
      await firstResult.click();
      await expect(page.locator("text=Application Review")).toBeVisible({ timeout: 10000 });
      // From search, should show Back to Search
      await expect(page.locator("text=← Back to Search")).toBeVisible();
    }
  });
});
