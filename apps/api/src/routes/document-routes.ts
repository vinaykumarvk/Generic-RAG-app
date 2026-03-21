/**
 * Document management routes — /api/v1/workspaces/:wid/documents
 */

import { FastifyInstance } from "fastify";
import { send400, send404 } from "@puda/api-core";
import type { QueryFn, GetClientFn, LlmProvider } from "@puda/api-core";
import type { StorageProvider } from "../storage";
import { sanitizeFilename } from "../util/sanitize-filename";
import { invalidateCache, invalidateCacheForDocument } from "../retrieval/cache";
import crypto from "node:crypto";
import path from "node:path";

export interface DocumentRouteDeps {
  queryFn: QueryFn;
  getClient: GetClientFn;
  llmProvider: LlmProvider;
  storageProvider: StorageProvider;
}

interface ExistingDocumentRow {
  document_id: string;
  status: string;
  title?: string | null;
  file_name?: string | null;
  mime_type?: string | null;
  file_size_bytes?: number | null;
  file_path?: string | null;
  sha256?: string | null;
  category?: string | null;
  subcategory?: string | null;
  source_path?: string | null;
  metadata?: Record<string, unknown> | string | null;
  custom_tags?: string[] | null;
  gcs_uri?: string | null;
  uploaded_by?: string | null;
  sensitivity_level?: string | null;
  case_reference?: string | null;
  fir_number?: string | null;
  station_code?: string | null;
  org_unit_id?: string | null;
  language?: string | null;
}

function asJsonString(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value ?? {});
}

function getRequestUserId(authUser: { userId?: string; user_id?: string } | undefined): string | undefined {
  if (typeof authUser?.userId === "string") return authUser.userId;
  if (typeof authUser?.user_id === "string") return authUser.user_id;
  return undefined;
}

async function clearRetryDerivedState(
  client: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  documentId: string
) {
  await client.query("DELETE FROM citation WHERE document_id = $1", [documentId]);
  await client.query("DELETE FROM chunk WHERE document_id = $1", [documentId]);
  await client.query("DELETE FROM extraction_result WHERE document_id = $1", [documentId]);
}

export function createDocumentRoutes(app: FastifyInstance, deps: DocumentRouteDeps) {
  const { queryFn, storageProvider, getClient } = deps;

  async function documentExists(wid: string, id: string): Promise<boolean> {
    const result = await queryFn(
      "SELECT document_id FROM document WHERE document_id = $1 AND workspace_id = $2 AND status != 'DELETED'",
      [id, wid]
    );
    return result.rows.length > 0;
  }

  // List documents
  app.get<{ Params: { wid: string }; Querystring: { status?: string; page?: string; limit?: string } }>(
    "/api/v1/workspaces/:wid/documents",
    async (request) => {
      const { wid } = request.params;
      const status = request.query.status;
      const page = Math.max(1, parseInt(request.query.page || "1", 10));
      const limit = Math.min(100, Math.max(1, parseInt(request.query.limit || "20", 10)));
      const offset = (page - 1) * limit;

      let whereClause = "workspace_id = $1 AND status != 'DELETED'";
      const params: unknown[] = [wid];

      if (status) {
        params.push(status);
        whereClause += ` AND status = $${params.length}`;
      }

      const [countResult, result] = await Promise.all([
        queryFn(`SELECT count(*) FROM document WHERE ${whereClause}`, params),
        queryFn(
          `SELECT document_id, title, file_name, mime_type, file_size_bytes, status, category, subcategory, source_path, chunk_count, page_count, created_at, updated_at
           FROM document WHERE ${whereClause} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
          [...params, limit, offset]
        ),
      ]);

      return {
        documents: result.rows,
        total: parseInt(countResult.rows[0].count, 10),
        page,
        limit,
      };
    }
  );

  // Get document detail
  app.get<{ Params: { wid: string; id: string } }>(
    "/api/v1/workspaces/:wid/documents/:id",
    async (request, reply) => {
      const { wid, id } = request.params;
      const result = await queryFn(
        `SELECT d.*,
                (SELECT count(*) FROM chunk c WHERE c.document_id = d.document_id) as actual_chunk_count,
                (SELECT json_agg(json_build_object('step', j.step, 'status', j.status, 'progress', j.progress)
                                 ORDER BY j.created_at, j.job_id)
                 FROM ingestion_job j
                 WHERE j.document_id = d.document_id) as jobs
         FROM document d WHERE d.document_id = $1 AND d.workspace_id = $2`,
        [id, wid]
      );
      if (result.rows.length === 0) return send404(reply, "Document not found");
      return result.rows[0];
    }
  );

  app.get<{ Params: { wid: string; id: string } }>(
    "/api/v1/workspaces/:wid/documents/:id/extracted-text",
    async (request, reply) => {
      const { wid, id } = request.params;
      if (!await documentExists(wid, id)) return send404(reply, "Document not found");

      const result = await queryFn(
        `SELECT extraction_id, extraction_type, content, page_number, confidence, metadata, created_at
         FROM extraction_result
         WHERE document_id = $1 AND extraction_type = 'TEXT'
         ORDER BY created_at DESC
         LIMIT 1`,
        [id]
      );

      return { extracted_text: result.rows[0] ?? null };
    }
  );

  app.get<{ Params: { wid: string; id: string } }>(
    "/api/v1/workspaces/:wid/documents/:id/chunks",
    async (request, reply) => {
      const { wid, id } = request.params;
      if (!await documentExists(wid, id)) return send404(reply, "Document not found");

      const result = await queryFn(
        `SELECT chunk_id, chunk_index, chunk_type, token_count, page_start, page_end, heading_path, metadata, content, created_at
         FROM chunk
         WHERE document_id = $1 AND workspace_id = $2
         ORDER BY chunk_index`,
        [id, wid]
      );

      return { chunks: result.rows };
    }
  );

  app.get<{ Params: { wid: string; id: string } }>(
    "/api/v1/workspaces/:wid/documents/:id/graph",
    async (request, reply) => {
      const { wid, id } = request.params;
      if (!await documentExists(wid, id)) return send404(reply, "Document not found");

      const [nodesResult, edgesResult] = await Promise.all([
        queryFn(
          `SELECT n.node_id,
                  n.name,
                  n.normalized_name,
                  n.node_type,
                  n.subtype,
                  n.description,
                  n.confidence,
                  count(*)::int AS mention_count,
                  COALESCE(array_remove(array_agg(DISTINCT p.source_chunk_id::text), NULL), ARRAY[]::text[]) AS chunk_ids
           FROM kg_provenance p
           JOIN graph_node n ON n.node_id = p.entity_id
           WHERE p.workspace_id = $1
             AND p.document_id = $2
             AND p.entity_type = 'NODE'
           GROUP BY n.node_id, n.name, n.normalized_name, n.node_type, n.subtype, n.description, n.confidence
           ORDER BY mention_count DESC, n.name`,
          [wid, id]
        ),
        queryFn(
          `SELECT e.edge_id,
                  e.edge_type,
                  e.label,
                  e.weight,
                  s.node_id AS source_node_id,
                  s.name AS source_name,
                  s.node_type AS source_type,
                  t.node_id AS target_node_id,
                  t.name AS target_name,
                  t.node_type AS target_type,
                  count(*)::int AS evidence_count,
                  COALESCE(array_remove(array_agg(DISTINCT p.source_chunk_id::text), NULL), ARRAY[]::text[]) AS chunk_ids
           FROM kg_provenance p
           JOIN graph_edge e ON e.edge_id = p.entity_id
           JOIN graph_node s ON s.node_id = e.source_node_id
           JOIN graph_node t ON t.node_id = e.target_node_id
           WHERE p.workspace_id = $1
             AND p.document_id = $2
             AND p.entity_type = 'EDGE'
           GROUP BY e.edge_id, e.edge_type, e.label, e.weight,
                    s.node_id, s.name, s.node_type,
                    t.node_id, t.name, t.node_type
           ORDER BY evidence_count DESC, e.weight DESC, source_name, target_name`,
          [wid, id]
        ),
      ]);

      return { nodes: nodesResult.rows, edges: edgesResult.rows };
    }
  );

  // Upload document (multipart)
  app.post<{ Params: { wid: string } }>(
    "/api/v1/workspaces/:wid/documents",
    {},
    async (request, reply) => {
      const { wid } = request.params;
      const parts = request.parts();
      let fileData: Buffer | null = null;
      let fileName = "";
      let mimeType = "";
      let title = "";
      let category = "";
      let subcategory = "";
      let sourcePath = "";
      let metadataStr = "";
      let tagsStr = "";
      // FR-002/FR-003: New scoping fields
      let sensitivityLevel = "";
      let caseReference = "";
      let firNumber = "";
      let stationCode = "";
      let orgUnitId = "";
      let language = "";
      const queryParams = request.query as Record<string, string>;
      const forceUpload = queryParams.force === "true";
      const chunkingStrategy = queryParams.strategy;
      const authUserId = getRequestUserId(request.authUser as { userId?: string; user_id?: string } | undefined);

      for await (const part of parts) {
        if (part.type === "file") {
          fileName = part.filename;
          mimeType = part.mimetype;
          const chunks: Buffer[] = [];
          for await (const chunk of part.file) {
            chunks.push(chunk);
          }
          fileData = Buffer.concat(chunks);
        } else {
          const val = part.value as string;
          if (part.fieldname === "title") title = val;
          if (part.fieldname === "category") category = val;
          if (part.fieldname === "subcategory") subcategory = val;
          if (part.fieldname === "source_path") sourcePath = val;
          if (part.fieldname === "metadata") metadataStr = val;
          if (part.fieldname === "tags") tagsStr = val;
          if (part.fieldname === "sensitivity_level") sensitivityLevel = val;
          if (part.fieldname === "case_reference") caseReference = val;
          if (part.fieldname === "fir_number") firNumber = val;
          if (part.fieldname === "station_code") stationCode = val;
          if (part.fieldname === "org_unit_id") orgUnitId = val;
          if (part.fieldname === "language") language = val;
        }
      }

      // Parse metadata JSON safely
      let metadata: Record<string, unknown> = {};
      if (metadataStr) {
        try { metadata = JSON.parse(metadataStr); } catch { /* default to {} */ }
      }

      // Parse tags
      let tags: string[] = [];
      if (tagsStr) {
        try {
          tags = JSON.parse(tagsStr);
          if (!Array.isArray(tags)) tags = [];
        } catch { tags = []; }
      }
      // Validate tags: max 20 tags, each <=50 chars
      if (tags.length > 20) {
        reply.code(422);
        return { error: "Maximum 20 tags allowed" };
      }
      if (tags.some((t: string) => t.length > 50)) {
        reply.code(422);
        return { error: "Each tag must be 50 characters or less" };
      }

      if (!fileData || !fileName) {
        reply.code(422);
        return { error: "File is required" };
      }

      // FR-004: Zero-byte file check
      if (fileData.length === 0) {
        reply.code(422);
        return { error: "File is empty (zero bytes)", error_code: "ZERO_BYTE_FILE" };
      }

      // FR-001/AC-01: Server-side MIME type validation
      const ALLOWED_MIME_TYPES = new Set([
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel",
        "text/plain",
        "text/markdown",
        "text/csv",
        "image/jpeg",
        "image/png",
        "image/tiff",
        "image/bmp",
        "image/gif",
        "image/webp",
      ]);
      if (!ALLOWED_MIME_TYPES.has(mimeType)) {
        return send400(reply, `Unsupported file type: ${mimeType}. Supported: PDF, DOCX, XLSX, TXT, MD, CSV, images`);
      }

      // Sanitize filename
      fileName = sanitizeFilename(fileName);

      const sha256 = crypto.createHash("sha256").update(fileData).digest("hex");
      const validSensitivity = ["PUBLIC", "INTERNAL", "RESTRICTED", "SEALED"].includes(sensitivityLevel)
        ? sensitivityLevel : "INTERNAL";

      // Dedup check
      const existing = await queryFn(
        `SELECT document_id, status, title, file_name, mime_type, file_size_bytes, file_path, sha256,
                category, subcategory, source_path, metadata, custom_tags, gcs_uri, uploaded_by,
                sensitivity_level, case_reference, fir_number, station_code, org_unit_id, language
         FROM document
         WHERE workspace_id = $1 AND sha256 = $2 AND status != 'DELETED'
         ORDER BY updated_at DESC`,
        [wid, sha256]
      );

      const blockingExisting = existing.rows.find((row) => row.status !== "FAILED") as ExistingDocumentRow | undefined;
      const recoverableExisting = existing.rows.find((row) => row.status === "FAILED") as ExistingDocumentRow | undefined;

      if (blockingExisting && !forceUpload) {
        reply.code(409);
        return { error: "Duplicate document detected", existing_document_id: blockingExisting.document_id };
      }

      if (recoverableExisting && !forceUpload) {
        const recoveredDocId = recoverableExisting.document_id;
        const stored = await storageProvider.upload(wid, recoveredDocId, fileName, fileData);

        const resolvedMetadata = metadataStr ? metadata : (recoverableExisting.metadata ?? {});
        const resolvedTags = tagsStr ? (tags.length > 0 ? tags : null) : (recoverableExisting.custom_tags ?? null);
        const resolvedCategory = category || recoverableExisting.category || null;
        const resolvedSubcategory = subcategory || recoverableExisting.subcategory || null;
        const resolvedSourcePath = sourcePath || recoverableExisting.source_path || null;
        const resolvedSensitivity = sensitivityLevel ? validSensitivity : (recoverableExisting.sensitivity_level || "INTERNAL");
        const resolvedCaseReference = caseReference || recoverableExisting.case_reference || null;
        const resolvedFirNumber = firNumber || recoverableExisting.fir_number || null;
        const resolvedStationCode = stationCode || recoverableExisting.station_code || null;
        const resolvedOrgUnitId = orgUnitId || recoverableExisting.org_unit_id || null;
        const resolvedLanguage = language || recoverableExisting.language || null;
        const resolvedUploadedBy = authUserId ?? recoverableExisting.uploaded_by ?? null;

        const jobMetadata: Record<string, string> = {};
        if (chunkingStrategy && (chunkingStrategy === "semantic" || chunkingStrategy === "fixed")) {
          jobMetadata.chunking_strategy = chunkingStrategy;
        }

        const client = await getClient();
        try {
          await client.query("BEGIN");
          await clearRetryDerivedState(client, recoveredDocId);

          const recoveredResult = await client.query(
            `UPDATE document
             SET title = $1,
                 file_name = $2,
                 mime_type = $3,
                 file_size_bytes = $4,
                 file_path = $5,
                 sha256 = $6,
                 status = 'UPLOADED',
                 category = $7,
                 subcategory = $8,
                 source_path = $9,
                 metadata = $10,
                 custom_tags = $11,
                 gcs_uri = $12,
                 uploaded_by = $13,
                 sensitivity_level = $14,
                 case_reference = $15,
                 fir_number = $16,
                 station_code = $17,
                 org_unit_id = $18,
                 language = $19,
                 page_count = NULL,
                 chunk_count = 0,
                 error_message = NULL,
                 ocr_applied = false,
                 ocr_confidence = NULL,
                 extracted_metadata = '{}'::jsonb,
                 review_required = false,
                 metadata_confidence = NULL,
                 updated_at = now()
             WHERE document_id = $20 AND workspace_id = $21
             RETURNING *`,
            [
              title || fileName,
              fileName,
              mimeType,
              fileData.length,
              stored.filePath,
              sha256,
              resolvedCategory,
              resolvedSubcategory,
              resolvedSourcePath,
              asJsonString(resolvedMetadata),
              resolvedTags,
              stored.gcsUri || null,
              resolvedUploadedBy,
              resolvedSensitivity,
              resolvedCaseReference,
              resolvedFirNumber,
              resolvedStationCode,
              resolvedOrgUnitId,
              resolvedLanguage,
              recoveredDocId,
              wid,
            ]
          );

          await client.query(
            `UPDATE ingestion_job
             SET status = 'FAILED',
                 error_message = COALESCE(error_message, 'Superseded by upload retry'),
                 completed_at = COALESCE(completed_at, now()),
                 updated_at = now()
             WHERE document_id = $1 AND status IN ('PENDING', 'RETRYING', 'PROCESSING')`,
            [recoveredDocId]
          );

          await client.query(
            `INSERT INTO ingestion_job (document_id, workspace_id, step, status, metadata)
             VALUES ($1, $2, 'VALIDATE', 'PENDING', $3)`,
            [recoveredDocId, wid, JSON.stringify(jobMetadata)]
          );

          await client.query(
            `INSERT INTO audit_log (user_id, action, resource_type, resource_id, workspace_id, details)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              authUserId,
              "document.upload.retry_failed",
              "document",
              recoveredDocId,
              wid,
              JSON.stringify({ file_name: fileName, mime_type: mimeType, file_size: fileData.length }),
            ]
          );

          await client.query("COMMIT");

          await invalidateCache({ queryFn }, wid);

          reply.code(200);
          return { ...recoveredResult.rows[0], recovered_existing_document: true };
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }
      }

      // Store file via storage provider
      const docId = crypto.randomUUID();
      const stored = await storageProvider.upload(wid, docId, fileName, fileData);

      // Insert document record with scoping fields
      const result = await queryFn(
        `INSERT INTO document (document_id, workspace_id, title, file_name, mime_type, file_size_bytes, file_path, sha256,
         category, subcategory, source_path, metadata, custom_tags, gcs_uri, uploaded_by,
         sensitivity_level, case_reference, fir_number, station_code, org_unit_id, language)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21) RETURNING *`,
        [docId, wid, title || fileName, fileName, mimeType, fileData.length, stored.filePath, sha256,
         category || null, subcategory || null, sourcePath || null, JSON.stringify(metadata),
         tags.length > 0 ? tags : null, stored.gcsUri || null, authUserId,
         validSensitivity, caseReference || null, firNumber || null, stationCode || null,
         orgUnitId || null, language || null]
      );

      // Create initial ingestion job (FR-006/AC-05: propagate chunking_strategy in metadata)
      const jobMetadata: Record<string, string> = {};
      if (chunkingStrategy && (chunkingStrategy === "semantic" || chunkingStrategy === "fixed")) {
        jobMetadata.chunking_strategy = chunkingStrategy;
      }
      await queryFn(
        `INSERT INTO ingestion_job (document_id, workspace_id, step, status, metadata) VALUES ($1, $2, 'VALIDATE', 'PENDING', $3)`,
        [docId, wid, JSON.stringify(jobMetadata)]
      );

      // Audit log
      await queryFn(
        `INSERT INTO audit_log (user_id, action, resource_type, resource_id, workspace_id, details)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [authUserId, "document.upload", "document", docId, wid,
         JSON.stringify({ file_name: fileName, mime_type: mimeType, file_size: fileData.length })]
      );

      // Invalidate answer cache for this workspace (FR-020/AC-03)
      await invalidateCache({ queryFn }, wid);

      reply.code(201);
      return result.rows[0];
    }
  );

  // Document status SSE
  app.get<{ Params: { wid: string; id: string } }>(
    "/api/v1/workspaces/:wid/documents/:id/status",
    async (request, reply) => {
      const { id, wid } = request.params;

      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const sendStatus = async () => {
        const result = await queryFn(
          `SELECT d.status, d.chunk_count, d.error_message,
                  (SELECT json_agg(json_build_object('step', j.step, 'status', j.status, 'progress', j.progress))
                   FROM ingestion_job j WHERE j.document_id = d.document_id) as jobs
           FROM document d WHERE d.document_id = $1 AND d.workspace_id = $2`,
          [id, wid]
        );
        if (result.rows.length > 0) {
          reply.raw.write(`data: ${JSON.stringify(result.rows[0])}\n\n`);
        }
      };

      await sendStatus();
      const interval = setInterval(sendStatus, 2000);

      request.raw.on("close", () => {
        clearInterval(interval);
        reply.raw.end();
      });
    }
  );

  // Reprocess failed document
  app.post<{ Params: { wid: string; id: string } }>(
    "/api/v1/workspaces/:wid/documents/:id/reprocess",
    async (request, reply) => {
      const { id, wid } = request.params;

      const docResult = await queryFn(
        "SELECT document_id, status FROM document WHERE document_id = $1 AND workspace_id = $2 AND status != 'DELETED'",
        [id, wid]
      );
      if (docResult.rows.length === 0) return send404(reply, "Document not found");
      if (docResult.rows[0].status !== "FAILED") {
        return send400(reply, "Only failed documents can be reprocessed");
      }

      const client = await deps.getClient();
      try {
        await client.query("BEGIN");
        await clearRetryDerivedState(client, id);
        await client.query(
          "UPDATE document SET status = 'UPLOADED', error_message = NULL, updated_at = now() WHERE document_id = $1",
          [id]
        );
        await client.query(
          "UPDATE ingestion_job SET status = 'FAILED' WHERE document_id = $1 AND status IN ('PENDING', 'RETRYING')",
          [id]
        );
        await client.query(
          "INSERT INTO ingestion_job (document_id, workspace_id, step, status) VALUES ($1, $2, 'VALIDATE', 'PENDING')",
          [id, wid]
        );
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }

      return { document_id: id, status: "UPLOADED" };
    }
  );

  // Download document (FR-016/AC-06)
  app.get<{ Params: { wid: string; id: string } }>(
    "/api/v1/workspaces/:wid/documents/:id/download",
    async (request, reply) => {
      const { id, wid } = request.params;
      const result = await queryFn(
        "SELECT file_path, file_name, mime_type FROM document WHERE document_id = $1 AND workspace_id = $2 AND status != 'DELETED'",
        [id, wid]
      );
      if (result.rows.length === 0) return send404(reply, "Document not found");

      const { file_path, file_name, mime_type } = result.rows[0];
      const fileData = await storageProvider.download(file_path);

      reply.header("Content-Type", mime_type);
      reply.header("Content-Disposition", `attachment; filename="${file_name}"`);
      return reply.send(fileData);
    }
  );

  // PATCH document metadata (FR-006)
  app.patch<{ Params: { wid: string; id: string } }>(
    "/api/v1/workspaces/:wid/documents/:id",
    async (request, reply) => {
      const { id, wid } = request.params;
      const body = request.body as Record<string, unknown>;

      const fields: string[] = [];
      const values: unknown[] = [];
      let idx = 1;

      const allowedFields = ["title", "category", "subcategory", "sensitivity_level", "case_reference",
        "fir_number", "station_code", "org_unit_id", "language", "review_required", "extracted_metadata"];

      for (const key of allowedFields) {
        if (body[key] !== undefined) {
          fields.push(`${key} = $${idx++}`);
          values.push(key === "extracted_metadata" ? JSON.stringify(body[key]) : body[key]);
        }
      }

      if (fields.length === 0) return send400(reply, "No fields to update");

      fields.push("updated_at = now()");
      values.push(id, wid);

      const result = await queryFn(
        `UPDATE document SET ${fields.join(", ")}
         WHERE document_id = $${idx++} AND workspace_id = $${idx} AND status != 'DELETED'
         RETURNING *`,
        values
      );

      if (result.rows.length === 0) return send404(reply, "Document not found");

      // FR-017: Targeted cache invalidation for this document
      await invalidateCacheForDocument({ queryFn }, wid, id);

      return result.rows[0];
    }
  );

  // Document versions (FR-008)
  app.get<{ Params: { wid: string; id: string } }>(
    "/api/v1/workspaces/:wid/documents/:id/versions",
    async (request, reply) => {
      const { id, wid } = request.params;

      const docCheck = await queryFn(
        "SELECT document_id FROM document WHERE document_id = $1 AND workspace_id = $2",
        [id, wid]
      );
      if (docCheck.rows.length === 0) return send404(reply, "Document not found");

      const result = await queryFn(
        `SELECT version_id, version_number, sha256, file_size_bytes, is_current, created_by, created_at
         FROM document_version WHERE document_id = $1 ORDER BY version_number DESC`,
        [id]
      );

      return { versions: result.rows };
    }
  );

  // Delete document (soft)
  app.delete<{ Params: { wid: string; id: string } }>(
    "/api/v1/workspaces/:wid/documents/:id",
    async (request, reply) => {
      const { id, wid } = request.params;
      const result = await queryFn(
        `UPDATE document SET status = 'DELETED', deleted_at = now(), updated_at = now()
         WHERE document_id = $1 AND workspace_id = $2 AND status != 'DELETED' RETURNING document_id`,
        [id, wid]
      );
      if (result.rows.length === 0) return send404(reply, "Document not found");
      return { deleted: true, document_id: id };
    }
  );
}
