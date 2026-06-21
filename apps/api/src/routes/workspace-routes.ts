/**
 * Workspace CRUD routes — /api/v1/workspaces
 */

import { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { send400, send404, sendError, logError } from "@puda/api-core";
import type { QueryFn, GetClientFn, LlmProvider } from "@puda/api-core";
import { UpdateWorkspaceSchema } from "@puda/shared";

export interface WorkspaceRouteDeps {
  queryFn: QueryFn;
  getClient: GetClientFn;
  llmProvider: LlmProvider;
}

const JUDGMENT_ONTOLOGY_VERSION = "judgment-legal-ontology-v1";

const JUDGMENT_SOURCE_IDENTIFIERS = [
  "judgment_id",
  "document_id",
  "chunk_id",
  "paragraph_number",
  "page_start",
  "court_code",
  "decision_date",
];

const JUDGMENT_RETRIEVAL_PROFILES = {
  case_specific: {
    label: "Case specific",
    description: "Prioritize exact judgment chunks, paragraph anchors, and per-accused/per-charge outcomes.",
    weights: { raw_chunk: 0.55, lexical: 0.2, graph: 0.2, wiki: 0.05 },
    requiresSourceCitations: true,
  },
  doctrine: {
    label: "Doctrine",
    description: "Use reviewed wiki synthesis and graph paths, backed by raw judgment citations.",
    weights: { wiki: 0.35, graph: 0.25, raw_chunk: 0.3, lexical: 0.1 },
    requiresSourceCitations: true,
  },
  pattern_analysis: {
    label: "Pattern analysis",
    description: "Use metadata facets and graph aggregates with representative raw judgment evidence.",
    weights: { metadata: 0.3, graph: 0.3, raw_chunk: 0.25, wiki: 0.15 },
    requiresCorpusCard: true,
    requiresSourceCitations: true,
  },
  officer_lesson: {
    label: "Officer lesson",
    description: "Return lawful investigation-quality lessons only from reviewed wiki or reviewed graph assertions.",
    weights: { wiki: 0.4, graph: 0.25, raw_chunk: 0.25, lexical: 0.1 },
    requiresReviewedWiki: true,
    requiresSourceCitations: true,
  },
  precedent_trace: {
    label: "Precedent trace",
    description: "Prioritize citation relationships, authority status, later treatment, and source paragraphs.",
    weights: { graph: 0.4, lexical: 0.2, raw_chunk: 0.25, wiki: 0.15 },
    requiresSourceCitations: true,
  },
  comparison: {
    label: "Comparison",
    description: "Compare courts, years, issue labels, outcomes, and reasoning with a disclosed corpus scope.",
    weights: { graph: 0.3, metadata: 0.25, raw_chunk: 0.3, wiki: 0.15 },
    requiresCorpusCard: true,
    requiresSourceCitations: true,
  },
};

async function loadJudgmentOntology(): Promise<Record<string, unknown>> {
  const relativePath = path.join("docs", "ontology", "judgment-legal-ontology-v1.json");
  const candidates = [
    path.resolve(process.cwd(), relativePath),
    path.resolve(process.cwd(), "..", "..", relativePath),
    path.resolve(__dirname, "..", "..", "..", "..", relativePath),
  ];

  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return JSON.parse(await readFile(candidate, "utf8")) as Record<string, unknown>;
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error(`Unable to load ${relativePath}: ${String(lastError)}`);
}

export function createWorkspaceRoutes(app: FastifyInstance, deps: WorkspaceRouteDeps) {
  const { queryFn } = deps;

  // List workspaces (filtered by user membership)
  app.get("/api/v1/workspaces", async (request) => {
    const user = request.authUser;
    const isAdmin = user?.userType === "ADMIN";

    let result;
    if (isAdmin) {
      result = await queryFn(
        `SELECT w.*, (SELECT count(*) FROM workspace_member wm WHERE wm.workspace_id = w.workspace_id) as member_count
         FROM workspace w WHERE w.status != 'SUSPENDED' ORDER BY w.created_at DESC`
      );
    } else {
      result = await queryFn(
        `SELECT w.*, wm.role as member_role
         FROM workspace w
         JOIN workspace_member wm ON wm.workspace_id = w.workspace_id
         WHERE wm.user_id = $1 AND w.status != 'SUSPENDED'
         ORDER BY w.created_at DESC`,
        [user?.userId]
      );
    }

    return { workspaces: result.rows };
  });

  // Get workspace by ID
  app.get<{ Params: { wid: string } }>("/api/v1/workspaces/:wid", async (request, reply) => {
    const { wid } = request.params;
    const result = await queryFn(
      `SELECT w.*,
         (SELECT count(*) FROM workspace_member wm WHERE wm.workspace_id = w.workspace_id) as member_count,
         (SELECT count(*) FROM document d WHERE d.workspace_id = w.workspace_id AND d.status != 'DELETED') as document_count
       FROM workspace w WHERE w.workspace_id = $1`,
      [wid]
    );
    if (result.rows.length === 0) return send404(reply, "Workspace not found");
    return result.rows[0];
  });

  // Create workspace
  app.post("/api/v1/workspaces", async (request, reply) => {
    const { name, slug, description, settings } = request.body as {
      name: string; slug: string; description?: string; settings?: Record<string, unknown>;
    };

    if (!name || !slug) return send400(reply, "name and slug are required");
    if (!/^[a-z0-9-]+$/.test(slug)) return send400(reply, "slug must be lowercase alphanumeric with hyphens");

    const existing = await queryFn("SELECT 1 FROM workspace WHERE slug = $1", [slug]);
    if (existing.rows.length > 0) return send400(reply, "Workspace slug already exists");

    const userId = request.authUser?.userId;
    const result = await queryFn(
      `INSERT INTO workspace (name, slug, description, settings, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, slug, description || null, JSON.stringify(settings || {}), userId]
    );

    // Add creator as owner
    await queryFn(
      `INSERT INTO workspace_member (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
      [result.rows[0].workspace_id, userId]
    );

    reply.code(201);
    return result.rows[0];
  });

  // Update workspace
  app.patch<{ Params: { wid: string } }>("/api/v1/workspaces/:wid", async (request, reply) => {
    const { wid } = request.params;

    const parsed = UpdateWorkspaceSchema.safeParse(request.body);
    if (!parsed.success) {
      return send400(reply, parsed.error.issues.map((i) => i.message).join("; "));
    }
    const { name, description, settings, status } = parsed.data;

    try {
      const fields: string[] = [];
      const values: unknown[] = [];
      let idx = 1;

      if (name !== undefined) { fields.push(`name = $${idx++}`); values.push(name); }
      if (description !== undefined) { fields.push(`description = $${idx++}`); values.push(description); }
      if (settings !== undefined) {
        fields.push(`settings = COALESCE(settings, '{}'::jsonb) || $${idx++}::jsonb`);
        values.push(JSON.stringify(settings));
      }
      if (status !== undefined) { fields.push(`status = $${idx++}`); values.push(status); }

      if (fields.length === 0) return send400(reply, "No fields to update");

      fields.push(`updated_at = now()`);
      values.push(wid);

      const result = await queryFn(
        `UPDATE workspace SET ${fields.join(", ")} WHERE workspace_id = $${idx} RETURNING *`,
        values
      );
      if (result.rows.length === 0) return send404(reply, "Workspace not found");
      return result.rows[0];
    } catch (err) {
      logError("Failed to update workspace", { workspaceId: wid, error: String(err) });
      return sendError(reply, 500, "UPDATE_FAILED", "Failed to update workspace");
    }
  });

  // Apply the judgment workspace convention and legal ontology.
  app.post<{ Params: { wid: string } }>("/api/v1/workspaces/:wid/judgment-ontology", async (request, reply) => {
    const { wid } = request.params;

    try {
      const ontology = await loadJudgmentOntology();
      const ontologyVersion = String(ontology.version || JUDGMENT_ONTOLOGY_VERSION);
      const phase0Contract = ontology.phase0EvidenceContract ?? {};

      const settings = {
        workspaceKind: "judgments",
        kgOntologyVersion: ontologyVersion,
        defaultRetrievalProfile: "case_specific",
        retrievalProfiles: JUDGMENT_RETRIEVAL_PROFILES,
        sourceIdentifiers: JUDGMENT_SOURCE_IDENTIFIERS,
        judgmentEvidenceContract: phase0Contract,
        kgOntology: ontology,
      };

      const result = await queryFn(
        `UPDATE workspace
         SET settings = COALESCE(settings, '{}'::jsonb) || $1::jsonb,
             updated_at = now()
         WHERE workspace_id = $2
         RETURNING *`,
        [JSON.stringify(settings), wid]
      );

      if (result.rows.length === 0) return send404(reply, "Workspace not found");

      return {
        workspace: result.rows[0],
        applied: {
          workspaceKind: "judgments",
          kgOntologyVersion: ontologyVersion,
          retrievalProfiles: Object.keys(JUDGMENT_RETRIEVAL_PROFILES),
          sourceIdentifiers: JUDGMENT_SOURCE_IDENTIFIERS,
        },
      };
    } catch (err) {
      logError("Failed to apply judgment ontology", { workspaceId: wid, error: String(err) });
      return sendError(reply, 500, "JUDGMENT_ONTOLOGY_LOAD_FAILED", "Failed to apply judgment ontology");
    }
  });

  // Delete workspace (soft — sets status to ARCHIVED)
  app.delete<{ Params: { wid: string } }>("/api/v1/workspaces/:wid", async (request, reply) => {
    const { wid } = request.params;
    const result = await queryFn(
      `UPDATE workspace SET status = 'ARCHIVED', updated_at = now() WHERE workspace_id = $1 RETURNING workspace_id`,
      [wid]
    );
    if (result.rows.length === 0) return send404(reply, "Workspace not found");
    return { deleted: true, workspace_id: wid };
  });

  // Workspace members
  app.get<{ Params: { wid: string } }>("/api/v1/workspaces/:wid/members", async (request) => {
    const { wid } = request.params;
    const result = await queryFn(
      `SELECT u.user_id, u.username, u.email, u.full_name, u.user_type, wm.role, wm.joined_at
       FROM workspace_member wm
       JOIN user_account u ON u.user_id = wm.user_id
       WHERE wm.workspace_id = $1
       ORDER BY wm.joined_at`,
      [wid]
    );
    return { members: result.rows };
  });

  // Add member to workspace
  app.post<{ Params: { wid: string } }>("/api/v1/workspaces/:wid/members", async (request, reply) => {
    const { wid } = request.params;
    const { user_id, role } = request.body as { user_id: string; role?: string };

    if (!user_id) return send400(reply, "user_id is required");

    await queryFn(
      `INSERT INTO workspace_member (workspace_id, user_id, role)
       VALUES ($1, $2, $3) ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = $3`,
      [wid, user_id, role || "VIEWER"]
    );

    reply.code(201);
    return { added: true };
  });
}
