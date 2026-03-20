import { test, expect } from "@playwright/test";

const workspaceId = process.env.E2E_WORKSPACE_ID;
const documentId = process.env.E2E_DOCUMENT_ID;
const username = process.env.E2E_USERNAME;
const password = process.env.E2E_PASSWORD;

test.use({
  baseURL: process.env.E2E_BASE_URL || "http://localhost:5173",
});

test.describe("IntelliRAG document inspector live smoke", () => {
  test.skip(!workspaceId || !documentId || !username || !password, "Live E2E env vars are required");

  test("shows extracted text, chunks, nodes, and edges for a real document", async ({ page }) => {
    await page.goto("/login");

    await page.getByRole("textbox", { name: "Username" }).fill(username!);
    await page.getByLabel("Password", { exact: true }).fill(password!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).not.toHaveURL(/\/login$/, { timeout: 10000 });

    await page.goto(`/workspace/${workspaceId}/documents/${documentId}`);

    const skipTourButton = page.getByRole("button", { name: /skip tour/i });
    await skipTourButton.click({ timeout: 10000 }).catch(async () => {
      await page.getByRole("button", { name: /close tour/i }).click({ timeout: 2000 }).catch(() => {});
    });

    await expect(page.getByTestId("document-tab-overview")).toBeVisible();
    await expect(page.getByTestId("document-tab-extracted-text")).toBeVisible();
    await expect(page.getByTestId("document-tab-chunks")).toBeVisible();
    await expect(page.getByTestId("document-tab-nodes-and-edges")).toBeVisible();

    await page.getByTestId("document-tab-extracted-text").click();
    await expect(page.getByTestId("document-extracted-text")).toBeVisible({ timeout: 10000 });
    const extractedText = page.getByTestId("document-extracted-text").locator("pre").first();
    await expect(extractedText).toBeVisible({ timeout: 10000 });
    const extractedContent = (await extractedText.textContent())?.trim() || "";
    expect(extractedContent.length).toBeGreaterThan(50);

    await page.getByTestId("document-tab-chunks").click();
    await expect(page.getByTestId("document-chunks")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("chunk-card").first()).toBeVisible({ timeout: 10000 });
    expect(await page.getByTestId("chunk-card").count()).toBeGreaterThan(0);

    await page.getByTestId("document-tab-nodes-and-edges").click();
    await expect(page.getByTestId("document-nodes")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("document-edges")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("node-card").first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("edge-card").first()).toBeVisible({ timeout: 10000 });
    expect(await page.getByTestId("node-card").count()).toBeGreaterThan(0);
    expect(await page.getByTestId("edge-card").count()).toBeGreaterThan(0);
  });
});
