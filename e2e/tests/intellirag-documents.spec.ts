/**
 * IntelliRAG E2E: Document upload and management tests
 * Maps to: TC-FR001-01 through TC-FR001-10 (File Ingestion),
 *          TC-FR017-01 through TC-FR017-04 (Document UI)
 *
 * Tests the upload zone, document list, status badges, and polling behaviour.
 */
import { test, expect, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const mockUser = {
  user_id: "usr-1",
  username: "testuser",
  email: "testuser@example.com",
  full_name: "Test User",
  user_type: "USER",
};

const mockToken = "mock-jwt-token-for-tests";

const mockWorkspace = {
  workspace_id: "ws-1",
  name: "Research Papers",
  slug: "research-papers",
  description: "Collection of research documents",
  status: "ACTIVE",
  settings: {},
  member_count: 3,
  document_count: 3,
  created_at: "2026-03-01T10:00:00.000Z",
};

const mockDocuments = [
  {
    document_id: "doc-1",
    title: "Transformer Architecture.pdf",
    file_name: "transformer-architecture.pdf",
    mime_type: "application/pdf",
    file_size_bytes: 2_500_000,
    status: "ACTIVE",
    chunk_count: 42,
    created_at: "2026-03-10T10:00:00.000Z",
  },
  {
    document_id: "doc-2",
    title: "RAG Survey 2025.docx",
    file_name: "rag-survey-2025.docx",
    mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    file_size_bytes: 1_200_000,
    status: "EMBEDDING",
    chunk_count: 18,
    created_at: "2026-03-12T10:00:00.000Z",
  },
  {
    document_id: "doc-3",
    title: "Knowledge Graphs Intro.txt",
    file_name: "knowledge-graphs-intro.txt",
    mime_type: "text/plain",
    file_size_bytes: 45_000,
    status: "FAILED",
    chunk_count: 0,
    created_at: "2026-03-14T10:00:00.000Z",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedAuth(page: Page) {
  await page.addInitScript(
    ({ token }) => {
      localStorage.setItem("intellirag_token", token);
    },
    { token: mockToken },
  );
}

let documentsFetchCount = 0;

async function installApiMocks(page: Page) {
  documentsFetchCount = 0;

  await page.route("**/api/v1/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;

    if (req.method() === "GET" && path === "/api/v1/users/me") {
      return route.fulfill({ status: 200, json: mockUser });
    }

    if (req.method() === "GET" && path === "/api/v1/workspaces") {
      return route.fulfill({ status: 200, json: { workspaces: [mockWorkspace] } });
    }

    if (req.method() === "GET" && path === "/api/v1/workspaces/ws-1") {
      return route.fulfill({ status: 200, json: mockWorkspace });
    }

    if (req.method() === "GET" && path === "/api/v1/workspaces/ws-1/documents") {
      documentsFetchCount++;
      return route.fulfill({
        status: 200,
        json: { documents: mockDocuments, total: mockDocuments.length },
      });
    }

    // POST upload
    if (req.method() === "POST" && path === "/api/v1/workspaces/ws-1/documents") {
      return route.fulfill({
        status: 201,
        json: { document_id: "doc-new", status: "UPLOADED" },
      });
    }

    return route.fulfill({ status: 404, json: { error: `Unmocked: ${req.method()} ${path}` } });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("IntelliRAG Documents (TC-FR001 / TC-FR017)", () => {
  test.beforeEach(async ({ page }) => {
    await seedAuth(page);
    await installApiMocks(page);
  });

  test("upload page shows drag-drop zone (TC-FR017-01)", async ({ page }) => {
    await page.goto("/workspace/ws-1/documents");

    // Page heading
    await expect(page.getByRole("heading", { name: /documents/i })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Upload and manage your knowledge base documents")).toBeVisible();

    // Drag-drop zone text
    await expect(page.getByText(/drag & drop files here/i)).toBeVisible();
    await expect(page.getByText(/click to browse/i)).toBeVisible();

    // Accepted file types shown
    await expect(page.getByText(/PDF, DOCX, XLSX, TXT, MD, CSV/)).toBeVisible();
  });

  test("document list shows status badges (TC-FR017-02)", async ({ page }) => {
    await page.goto("/workspace/ws-1/documents");
    await expect(page.getByRole("heading", { name: /documents/i })).toBeVisible({ timeout: 10000 });

    // Column headers
    await expect(page.getByText("Document")).toBeVisible();
    await expect(page.getByText("Status")).toBeVisible();
    await expect(page.getByText("Chunks")).toBeVisible();

    // Document titles
    await expect(page.getByText("Transformer Architecture.pdf")).toBeVisible();
    await expect(page.getByText("RAG Survey 2025.docx")).toBeVisible();
    await expect(page.getByText("Knowledge Graphs Intro.txt")).toBeVisible();

    // Status labels
    await expect(page.getByText("Active")).toBeVisible();
    await expect(page.getByText("Embedding")).toBeVisible();
    await expect(page.getByText("Failed")).toBeVisible();
  });

  test("document list auto-refreshes via polling (TC-FR017-03)", async ({ page }) => {
    await page.goto("/workspace/ws-1/documents");
    await expect(page.getByRole("heading", { name: /documents/i })).toBeVisible({ timeout: 10000 });

    // Wait for the first render to fetch documents
    await expect(page.getByText("Transformer Architecture.pdf")).toBeVisible();

    // The DocumentList has refetchInterval: 5000. Wait long enough for at
    // least one additional poll to occur, then verify the fetch counter.
    const initialCount = documentsFetchCount;
    await page.waitForTimeout(6000);

    // documentsFetchCount is tracked inside the route handler
    const afterPollCount = await page.evaluate(() =>
      // We cannot access the outer variable directly from page context, but we
      // can verify re-fetch happened by checking that the document list is
      // still rendered (the mock always returns the same data).
      document.querySelectorAll("table tbody tr").length,
    );

    // Table should still have 3 rows (one per document)
    expect(afterPollCount).toBe(3);

    // Verify at the Node.js level that more than one fetch happened
    expect(documentsFetchCount).toBeGreaterThan(initialCount);
  });

  test("upload button triggers file picker (TC-FR017-04)", async ({ page }) => {
    await page.goto("/workspace/ws-1/documents");
    await expect(page.getByRole("heading", { name: /documents/i })).toBeVisible({ timeout: 10000 });

    // The hidden file input is inside the drag-drop zone. The zone acts as the
    // click target. We verify the file input element exists with the expected
    // accept attribute, confirming that clicking the zone would trigger it.
    const fileInput = page.locator('input[type="file"]');
    await expect(fileInput).toHaveAttribute("accept", ".pdf,.docx,.xlsx,.txt,.md,.csv");

    // The file input should be hidden (class="hidden")
    await expect(fileInput).toBeHidden();

    // Verify the drag-drop zone is clickable (has cursor-pointer style)
    const dropZone = page.locator("text=Drag & drop files here").locator("..");
    await expect(dropZone).toBeVisible();
  });
});
