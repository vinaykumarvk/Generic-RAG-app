import { expect, test, type Page } from "@playwright/test";

const mockUser = {
  user_id: "citizen-1",
  login: "citizen1",
  name: "Citizen One",
  email: "citizen1@example.com",
  user_type: "CITIZEN" as const
};

const mockService = {
  serviceKey: "no_due_certificate",
  displayName: "No Due Certificate",
  category: "Property",
  description: "Issue no due certificate for a property."
};

const mockServiceConfig = {
  serviceKey: "no_due_certificate",
  displayName: "No Due Certificate",
  form: {
    formId: "ndc-form",
    version: "1.0.0",
    pages: [
      {
        pageId: "property",
        title: "Property Information",
        sections: [
          {
            sectionId: "property-details",
            title: "Property Details",
            fields: [
              {
                key: "property.plot_no",
                label: "Plot Number",
                type: "string",
                required: true,
                placeholder: "Enter plot number"
              }
            ]
          }
        ]
      }
    ]
  },
  documents: {
    documentTypes: [
      {
        docTypeId: "tax_receipt",
        name: "Tax Receipt",
        allowedMimeTypes: [".pdf", ".jpg", ".png"]
      }
    ]
  }
};

const mockApplication = {
  arn: "ARN-TEST-001",
  service_key: "no_due_certificate",
  state_id: "DRAFT",
  created_at: "2026-02-20T10:00:00.000Z",
  data_jsonb: {
    property: {
      plot_no: "P-100"
    }
  },
  documents: [],
  rowVersion: 1
};

const mockApplicationDetail = {
  ...mockApplication,
  queries: [],
  timeline: [],
  tasks: []
};

async function seedCitizenAuth(page: Page) {
  await page.addInitScript((user) => {
    localStorage.setItem("puda_citizen_auth", JSON.stringify(user));
    localStorage.setItem("puda_citizen_token", "mock-citizen-token");
  }, mockUser);
}

async function seedCitizenCacheEntries(page: Page) {
  await page.addInitScript(() => {
    const now = new Date().toISOString();

    localStorage.setItem(
      "puda_citizen_cache_services",
      JSON.stringify({
        schemaVersion: 1,
        schema: "citizen-services-v1",
        data: [{ serviceKey: "no_due_certificate", displayName: "No Due Certificate", category: "Property" }],
        fetchedAt: now
      })
    );
    localStorage.setItem(
      "puda_citizen_cache_profile_citizen-1",
      JSON.stringify({
        schemaVersion: 1,
        schema: "citizen-profile-v1",
        data: { applicant: { full_name: "Citizen One" }, completeness: { isComplete: true, missingFields: [] } },
        fetchedAt: now
      })
    );
    localStorage.setItem(
      "puda_citizen_dashboard_cache_citizen-1",
      JSON.stringify({
        schemaVersion: 1,
        schema: "citizen-dashboard-v1",
        data: { stats: null, applications: [], pendingActions: null, notifications: [] },
        fetchedAt: now
      })
    );
    localStorage.setItem(
      "puda_citizen_resume_v1_citizen-1",
      JSON.stringify({
        schemaVersion: 1,
        schema: "citizen-resume-v1",
        data: { view: "catalog", showDashboard: true, selectedService: null, currentApplication: null, formData: {}, updatedAt: now },
        fetchedAt: now
      })
    );
    localStorage.setItem("puda_citizen_last_sync_citizen-1", now);
    localStorage.setItem("non_citizen_key_should_remain", "keep-me");
  });
}

async function installCitizenApiMocks(page: Page) {
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;

    if (req.method() === "GET" && path === "/api/v1/config/services") {
      return route.fulfill({ status: 200, json: { services: [mockService] } });
    }

    if (req.method() === "GET" && path === `/api/v1/config/services/${mockService.serviceKey}`) {
      return route.fulfill({ status: 200, json: mockServiceConfig });
    }

    if (req.method() === "GET" && path === "/api/v1/profile/me") {
      return route.fulfill({
        status: 200,
        json: {
          applicant: {
            full_name: "Citizen One"
          },
          completeness: {
            isComplete: true,
            missingFields: []
          }
        }
      });
    }

    if (req.method() === "GET" && path === "/api/v1/applications/stats") {
      return route.fulfill({
        status: 200,
        json: {
          total: 1,
          active: 1,
          pendingAction: 0,
          approved: 0
        }
      });
    }

    if (req.method() === "GET" && path === "/api/v1/applications/pending-actions") {
      return route.fulfill({
        status: 200,
        json: {
          queries: [],
          documentRequests: []
        }
      });
    }

    if (req.method() === "GET" && path === "/api/v1/notifications") {
      return route.fulfill({
        status: 200,
        json: {
          notifications: []
        }
      });
    }

    if (req.method() === "GET" && path === "/api/v1/applications") {
      return route.fulfill({
        status: 200,
        json: {
          applications: [mockApplication]
        }
      });
    }

    if (req.method() === "GET" && path === `/api/v1/applications/${mockApplication.arn}`) {
      return route.fulfill({
        status: 200,
        json: mockApplicationDetail
      });
    }

    return route.fulfill({
      status: 404,
      json: {
        error: `Unmocked API route: ${req.method()} ${path}`
      }
    });
  });
}

async function switchOffline(page: Page) {
  await page.context().setOffline(true);
  await page.evaluate(() => {
    window.dispatchEvent(new Event("offline"));
  });
}

async function switchOnline(page: Page) {
  await page.context().setOffline(false);
  await page.evaluate(() => {
    window.dispatchEvent(new Event("online"));
  });
}

test.describe("Citizen resilience gates", () => {
  test.beforeEach(async ({ page }) => {
    await page.context().setOffline(false);
    await seedCitizenAuth(page);
    await installCitizenApiMocks(page);
  });

  test("shows offline banner and disables mutation CTA on dashboard", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    const newServiceButton = page.getByRole("button", { name: /New Service Request/i });
    await expect(newServiceButton).toBeEnabled();

    await switchOffline(page);

    await expect(page.getByText("Offline mode is active. Changes are disabled.")).toBeVisible();
    await expect(page.getByText(/Showing cached data from/)).toBeVisible();
    await expect(newServiceButton).toBeDisabled();
  });

  test("flushes cache telemetry after reconnect following offline fallback", async ({ page }) => {
    const telemetryPayloads: Array<Record<string, unknown>> = [];
    await page.route("**/api/v1/client-telemetry/cache", async (route) => {
      const req = route.request();
      const rawBody = req.postData() || "{}";
      telemetryPayloads.push(JSON.parse(rawBody) as Record<string, unknown>);
      await route.fulfill({ status: 202, json: { accepted: true, eventId: "test-telemetry-event" } });
    });

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    await switchOffline(page);
    await expect(page.getByText("Offline mode is active. Changes are disabled.")).toBeVisible();

    await switchOnline(page);
    await expect.poll(() => telemetryPayloads.length, { timeout: 5000 }).toBeGreaterThan(0);
    const telemetryBody = telemetryPayloads[0];
    expect(telemetryBody.app).toBe("citizen");
    expect(typeof telemetryBody.clientUpdatedAt).toBe("string");
    expect((telemetryBody.counterDelta as any)?.cache_fallback_offline).toBeGreaterThan(0);
  });

  test("restores in-progress create form state after reload", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    await page.getByRole("button", { name: /New Service Request/i }).click();
    await expect(page.getByRole("heading", { name: "Service Catalog" })).toBeVisible();

    await page.getByRole("button", { name: "Apply Now" }).first().click();
    await expect(page.getByText("Save Draft")).toBeVisible();

    const plotNumberInput = page
      .locator(".field", { hasText: "Plot Number" })
      .locator('input[type="text"]');
    await plotNumberInput.fill("P-4242");

    await page.reload();

    await expect(page.getByText(/Resumed your previous session/)).toBeVisible();
    await expect(page.getByText("Save Draft")).toBeVisible();
    await expect(
      page.locator(".field", { hasText: "Plot Number" }).locator('input[type="text"]')
    ).toHaveValue("P-4242");
  });

  test("switches application detail to read-only degraded mode offline", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    await page.getByRole("button", { name: /ARN-TEST-001/i }).first().click();
    await expect(page.getByRole("heading", { name: "Application Details" })).toBeVisible({ timeout: 10000 });

    const submitButton = page.getByRole("button", { name: /Submit Application/i });
    await expect(submitButton).toBeEnabled();

    await switchOffline(page);

    await expect(page.getByText("Offline mode is active. Changes are disabled.")).toBeVisible();
    await expect(submitButton).toBeDisabled();
    await expect(page.getByText("Upload Documents")).toHaveCount(0);
  });

  test("clears citizen cache namespaces on logout", async ({ page }) => {
    await seedCitizenCacheEntries(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    const seededCacheKeys = await page.evaluate(() =>
      Object.keys(localStorage).filter((key) =>
        key.startsWith("puda_citizen_cache_") ||
        key.startsWith("puda_citizen_dashboard_cache_") ||
        key.startsWith("puda_citizen_resume_") ||
        key.startsWith("puda_citizen_last_sync_")
      )
    );
    expect(seededCacheKeys.length).toBeGreaterThan(0);

    await page.getByRole("button", { name: "Logout" }).click();
    await expect(page.locator("#login-form")).toBeVisible();

    const storageSnapshot = await page.evaluate(() => ({
      auth: localStorage.getItem("puda_citizen_auth"),
      token: localStorage.getItem("puda_citizen_token"),
      remainingCitizenCacheKeys: Object.keys(localStorage).filter((key) =>
        key.startsWith("puda_citizen_cache_") ||
        key.startsWith("puda_citizen_dashboard_cache_") ||
        key.startsWith("puda_citizen_resume_") ||
        key.startsWith("puda_citizen_last_sync_")
      ),
      nonCitizenKey: localStorage.getItem("non_citizen_key_should_remain")
    }));

    expect(storageSnapshot.auth).toBeNull();
    expect(storageSnapshot.token).toBeNull();
    expect(storageSnapshot.remainingCitizenCacheKeys).toEqual([]);
    expect(storageSnapshot.nonCitizenKey).toBe("keep-me");
  });

  test("propagates logout to other open tabs", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    const secondPage = await page.context().newPage();
    await installCitizenApiMocks(secondPage);
    await secondPage.goto("/");
    await expect(secondPage.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    await page.getByRole("button", { name: "Logout" }).click();
    await expect(page.locator("#login-form")).toBeVisible();
    await expect(secondPage.locator("#login-form")).toBeVisible();

    await secondPage.close();
  });
});
