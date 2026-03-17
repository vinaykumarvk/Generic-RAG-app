/**
 * IntelliRAG E2E: Workspace management tests
 * Maps to: Module E (UI), TC-FR016-01 through TC-FR016-03
 *
 * Tests workspace listing, creation, overview cards, and settings panel.
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

const mockWorkspaces = [
  {
    workspace_id: "ws-1",
    name: "Research Papers",
    slug: "research-papers",
    description: "Collection of research documents",
    status: "ACTIVE",
    settings: {},
    member_count: 3,
    document_count: 12,
    created_at: "2026-03-01T10:00:00.000Z",
  },
  {
    workspace_id: "ws-2",
    name: "Legal Docs",
    slug: "legal-docs",
    description: "Legal document repository",
    status: "ACTIVE",
    settings: {},
    member_count: 2,
    document_count: 8,
    created_at: "2026-03-05T10:00:00.000Z",
  },
];

const mockWorkspaceDetail = {
  ...mockWorkspaces[0],
  settings: {
    kgOntology: {
      nodeTypes: [
        { type: "person", label: "Person", color: "#3b82f6" },
        { type: "concept", label: "Concept", color: "#06b6d4" },
      ],
      edgeTypes: [
        { type: "related_to", label: "Related To", directed: true },
      ],
    },
  },
};

const newWorkspace = {
  workspace_id: "ws-3",
  name: "New Knowledge Base",
  slug: "new-knowledge-base",
  description: "A brand new workspace",
  status: "ACTIVE",
  settings: {},
  member_count: 1,
  document_count: 0,
  created_at: "2026-03-17T10:00:00.000Z",
};

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

async function installApiMocks(page: Page) {
  let workspacesList = [...mockWorkspaces];

  await page.route("**/api/v1/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;

    if (req.method() === "GET" && path === "/api/v1/users/me") {
      return route.fulfill({ status: 200, json: mockUser });
    }

    if (req.method() === "GET" && path === "/api/v1/workspaces") {
      return route.fulfill({ status: 200, json: { workspaces: workspacesList } });
    }

    // GET single workspace
    const wsMatch = path.match(/^\/api\/v1\/workspaces\/([\w-]+)$/);
    if (req.method() === "GET" && wsMatch) {
      const id = wsMatch[1];
      if (id === "ws-1") {
        return route.fulfill({ status: 200, json: mockWorkspaceDetail });
      }
      if (id === "ws-3") {
        return route.fulfill({ status: 200, json: newWorkspace });
      }
      const found = workspacesList.find((w) => w.workspace_id === id);
      if (found) return route.fulfill({ status: 200, json: found });
      return route.fulfill({ status: 404, json: { message: "Workspace not found" } });
    }

    // POST create workspace
    if (req.method() === "POST" && path === "/api/v1/workspaces") {
      workspacesList = [...workspacesList, newWorkspace];
      return route.fulfill({ status: 201, json: newWorkspace });
    }

    return route.fulfill({ status: 404, json: { error: `Unmocked: ${req.method()} ${path}` } });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("IntelliRAG Workspace Management (TC-FR016)", () => {
  test.beforeEach(async ({ page }) => {
    await seedAuth(page);
    await installApiMocks(page);
  });

  test("dashboard shows workspace list (TC-FR016-01)", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /workspaces/i })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Select or create a workspace to get started")).toBeVisible();

    // Both workspaces should appear
    await expect(page.getByText("Research Papers")).toBeVisible();
    await expect(page.getByText("Legal Docs")).toBeVisible();

    // Document counts rendered inside workspace cards
    await expect(page.getByText("12 docs")).toBeVisible();
    await expect(page.getByText("8 docs")).toBeVisible();
  });

  test("create new workspace appears in list (TC-FR016-02)", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /workspaces/i })).toBeVisible({ timeout: 10000 });

    // Click the "New Workspace" button
    await page.getByRole("button", { name: /new workspace/i }).click();

    // Create workspace form should appear
    await expect(page.getByText("Create Workspace")).toBeVisible();

    // Fill the form
    await page.getByPlaceholder("My Knowledge Base").fill("New Knowledge Base");
    await page.getByPlaceholder("my-knowledge-base").fill("new-knowledge-base");

    // Click create
    await page.getByRole("button", { name: /^create$/i }).click();

    // Should navigate to the new workspace overview (mocked as ws-3)
    await expect(page.getByText("New Knowledge Base")).toBeVisible({ timeout: 10000 });
  });

  test("navigate to workspace shows overview cards (TC-FR016-03)", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /workspaces/i })).toBeVisible({ timeout: 10000 });

    // Click on the first workspace
    await page.getByText("Research Papers").click();

    // Should show workspace overview with four cards
    await expect(page.getByRole("heading", { name: "Research Papers" })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Documents")).toBeVisible();
    await expect(page.getByText("Query")).toBeVisible();
    await expect(page.getByText("Knowledge Graph")).toBeVisible();
    await expect(page.getByText("Analytics")).toBeVisible();

    // Card descriptions
    await expect(page.getByText("Upload and manage documents")).toBeVisible();
    await expect(page.getByText("Ask questions about your documents")).toBeVisible();
    await expect(page.getByText("Explore entities and relationships")).toBeVisible();
  });

  test("workspace settings panel opens and shows ontology config", async ({ page }) => {
    await page.goto("/workspace/ws-1");
    await expect(page.getByRole("heading", { name: "Research Papers" })).toBeVisible({ timeout: 10000 });

    // Click the settings (gear) button
    const settingsButton = page.locator("button").filter({ has: page.locator("svg") }).last();
    await settingsButton.click();

    // Settings panel should appear with ontology config
    await expect(page.getByRole("heading", { name: /knowledge graph ontology/i })).toBeVisible({ timeout: 5000 });

    // Preset buttons should be available
    await expect(page.getByText("Load Preset Ontology")).toBeVisible();
    await expect(page.getByRole("button", { name: /generic/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /medical/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /legal/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /engineering/i })).toBeVisible();

    // Entity and Relationship types sections
    await expect(page.getByText(/Entity Types/)).toBeVisible();
    await expect(page.getByText(/Relationship Types/)).toBeVisible();

    // Save button
    await expect(page.getByRole("button", { name: /save ontology/i })).toBeVisible();
  });
});
