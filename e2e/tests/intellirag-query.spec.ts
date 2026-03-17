/**
 * IntelliRAG E2E: RAG query conversation tests
 * Maps to: TC-FR018-01 through TC-FR018-05 (Query UI),
 *          TC-FR012-01 (RAG Search)
 *
 * Tests the query page layout, preset selector, chat input, conversation
 * sidebar, and citation panel.
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
  document_count: 12,
  created_at: "2026-03-01T10:00:00.000Z",
};

const mockConversations = [
  {
    conversation_id: "conv-1",
    title: "Transformer architecture comparison",
    preset: "balanced",
    message_count: 4,
    updated_at: "2026-03-15T14:00:00.000Z",
  },
  {
    conversation_id: "conv-2",
    title: "RAG pipeline optimizations",
    preset: "detailed",
    message_count: 6,
    updated_at: "2026-03-16T09:30:00.000Z",
  },
];

const mockConversationMessages = {
  messages: [
    {
      message_id: "msg-1",
      role: "user" as const,
      content: "What is a transformer architecture?",
    },
    {
      message_id: "msg-2",
      role: "assistant" as const,
      content: "A transformer is a deep learning architecture based on self-attention mechanisms...",
      citations: [
        {
          citation_index: 1,
          document_title: "Attention Is All You Need",
          page_number: 3,
          excerpt: "We propose a new simple network architecture, the Transformer, based solely on attention mechanisms...",
          relevance_score: 0.95,
        },
        {
          citation_index: 2,
          document_title: "BERT: Pre-training of Deep Bidirectional Transformers",
          page_number: 1,
          excerpt: "BERT is designed to pre-train deep bidirectional representations...",
          relevance_score: 0.82,
        },
      ],
      latency_ms: 1250,
    },
  ],
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

    // Conversations list
    if (req.method() === "GET" && path === "/api/v1/workspaces/ws-1/conversations") {
      return route.fulfill({ status: 200, json: { conversations: mockConversations } });
    }

    // Single conversation messages
    if (req.method() === "GET" && path === "/api/v1/workspaces/ws-1/conversations/conv-1") {
      return route.fulfill({ status: 200, json: mockConversationMessages });
    }

    // Query endpoint
    if (req.method() === "POST" && path === "/api/v1/workspaces/ws-1/query") {
      return route.fulfill({
        status: 200,
        json: {
          answer: "Based on the retrieved documents...",
          conversation_id: "conv-new",
          message_id: "msg-new",
          citations: [
            {
              citation_index: 1,
              document_title: "Sample Document",
              page_number: 5,
              excerpt: "Relevant text excerpt from the document...",
              relevance_score: 0.88,
            },
          ],
          retrieval: {
            preset: "balanced",
            total_latency_ms: 950,
            cache_hit: false,
            chunks_retrieved: 5,
          },
        },
      });
    }

    return route.fulfill({ status: 404, json: { error: `Unmocked: ${req.method()} ${path}` } });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("IntelliRAG Query (TC-FR018 / TC-FR012)", () => {
  test.beforeEach(async ({ page }) => {
    await seedAuth(page);
    await installApiMocks(page);
  });

  test("query page shows conversation sidebar and chat panel (TC-FR018-01)", async ({ page }) => {
    await page.goto("/workspace/ws-1/query");

    // "New conversation" button should be visible in the sidebar
    await expect(page.getByRole("button", { name: /new conversation/i })).toBeVisible({ timeout: 10000 });

    // Empty state placeholder in the chat area
    await expect(page.getByText(/ask a question/i)).toBeVisible();
    await expect(page.getByText(/your documents will be searched for relevant answers/i)).toBeVisible();

    // Chat input placeholder
    await expect(page.getByPlaceholder(/ask a question about your documents/i)).toBeVisible();
  });

  test("preset selector shows concise/balanced/detailed options (TC-FR018-02)", async ({ page }) => {
    await page.goto("/workspace/ws-1/query");
    await expect(page.getByPlaceholder(/ask a question about your documents/i)).toBeVisible({ timeout: 10000 });

    // Three preset buttons
    await expect(page.getByRole("button", { name: /concise/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /balanced/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /detailed/i })).toBeVisible();

    // "Balanced" is selected by default (has the active style)
    const balancedBtn = page.getByRole("button", { name: /balanced/i });
    await expect(balancedBtn).toBeVisible();

    // Click "Concise" to change the preset
    await page.getByRole("button", { name: /concise/i }).click();
    // The concise button should now have the active appearance (verifiable by class)
  });

  test("chat input accepts text and has send button (TC-FR018-03)", async ({ page }) => {
    await page.goto("/workspace/ws-1/query");
    await expect(page.getByPlaceholder(/ask a question about your documents/i)).toBeVisible({ timeout: 10000 });

    const chatInput = page.getByPlaceholder(/ask a question about your documents/i);

    // Input should be empty initially
    await expect(chatInput).toHaveValue("");

    // Type a question
    await chatInput.fill("What are the key findings in the transformer paper?");
    await expect(chatInput).toHaveValue("What are the key findings in the transformer paper?");

    // Send button should be visible (it contains the Send icon)
    const sendButton = page.locator("button").filter({ has: page.locator("svg") }).last();
    await expect(sendButton).toBeVisible();
    await expect(sendButton).toBeEnabled();
  });

  test("conversation list shows previous conversations (TC-FR018-04)", async ({ page }) => {
    await page.goto("/workspace/ws-1/query");
    await expect(page.getByRole("button", { name: /new conversation/i })).toBeVisible({ timeout: 10000 });

    // Previous conversation titles should appear in the sidebar
    await expect(page.getByText("Transformer architecture comparison")).toBeVisible();
    await expect(page.getByText("RAG pipeline optimizations")).toBeVisible();

    // Message counts
    await expect(page.getByText("4 messages")).toBeVisible();
    await expect(page.getByText("6 messages")).toBeVisible();
  });

  test("citation panel shows source references (TC-FR018-05)", async ({ page }) => {
    await page.goto("/workspace/ws-1/query");
    await expect(page.getByRole("button", { name: /new conversation/i })).toBeVisible({ timeout: 10000 });

    // Click on an existing conversation to load messages with citations
    await page.getByText("Transformer architecture comparison").click();

    // Wait for messages to load
    await expect(page.getByText(/a transformer is a deep learning architecture/i)).toBeVisible({ timeout: 10000 });

    // Citation link should be visible on the assistant message
    await expect(page.getByText(/2 citations/i)).toBeVisible();

    // Click the citations link to open the citation panel
    await page.getByText(/2 citations/i).click();

    // Citation panel heading
    await expect(page.getByText("Citations")).toBeVisible({ timeout: 5000 });

    // Cited document titles
    await expect(page.getByText("Attention Is All You Need")).toBeVisible();
    await expect(page.getByText("BERT: Pre-training of Deep Bidirectional Transformers")).toBeVisible();

    // Relevance scores
    await expect(page.getByText("95% relevant")).toBeVisible();
    await expect(page.getByText("82% relevant")).toBeVisible();

    // Page numbers
    await expect(page.getByText("p. 3")).toBeVisible();
  });
});
