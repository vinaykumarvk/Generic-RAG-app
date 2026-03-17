import { defineConfig, devices } from "@playwright/test";

const citizenPort = Number(process.env.CITIZEN_PREVIEW_PORT || 4173);
const officerPort = Number(process.env.OFFICER_PREVIEW_PORT || 4174);

export default defineConfig({
  testDir: "./tests",
  testMatch: /a11y-smoke\.spec\.ts/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: `npm --prefix ../apps/citizen run preview -- --host 127.0.0.1 --port ${citizenPort} --strictPort`,
      url: `http://127.0.0.1:${citizenPort}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
    {
      command: `npm --prefix ../apps/officer run preview -- --host 127.0.0.1 --port ${officerPort} --strictPort`,
      url: `http://127.0.0.1:${officerPort}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
  ],
  projects: [
    {
      name: "citizen-a11y",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: `http://127.0.0.1:${citizenPort}`,
      },
    },
    {
      name: "officer-a11y",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: `http://127.0.0.1:${officerPort}`,
      },
    },
    {
      name: "citizen-a11y-mobile",
      use: {
        ...devices["Pixel 5"],
        baseURL: `http://127.0.0.1:${citizenPort}`,
      },
    },
  ],
});
