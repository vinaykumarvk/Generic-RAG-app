/**
 * C7: Playwright E2E test configuration.
 * Run: npx playwright test --config=e2e/playwright.config.ts
 *
 * Projects route tests to the correct dev server:
 *   - citizen-* specs → localhost:5173 (citizen portal)
 *   - officer-* specs → localhost:5174 (officer portal)
 *   - intellirag-* specs → localhost:5173 (IntelliRAG web app)
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "html",
  use: {
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "citizen-chromium",
      testMatch: /citizen-.*/,
      use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:5173" },
    },
    {
      name: "officer-chromium",
      testMatch: /officer-.*/,
      use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:5174" },
    },
    {
      name: "citizen-mobile",
      testMatch: /citizen-.*/,
      use: { ...devices["Pixel 5"], baseURL: "http://localhost:5173" },
    },
    {
      name: "intellirag-chromium",
      testMatch: /intellirag-.*/,
      use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:5173" },
    },
  ],
});
