import { defineConfig, devices } from "@playwright/test";

const citizenPort = Number(process.env.CITIZEN_PREVIEW_PORT || 4173);

export default defineConfig({
  testDir: "./tests",
  testMatch: /citizen-resilience\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  webServer: {
    command: `npm --prefix ../apps/citizen run preview -- --host 127.0.0.1 --port ${citizenPort} --strictPort`,
    url: `http://127.0.0.1:${citizenPort}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120000
  },
  projects: [
    {
      name: "citizen-resilience-desktop",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: `http://127.0.0.1:${citizenPort}`
      }
    },
    {
      name: "citizen-resilience-mobile",
      use: {
        ...devices["Pixel 5"],
        baseURL: `http://127.0.0.1:${citizenPort}`
      }
    }
  ]
});
