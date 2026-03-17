/**
 * Document management routes — /api/v1/workspaces/:wid/documents
 */

import { FastifyInstance } from "fastify";
import { send400, send404 } from "@puda/api-core";
import type { QueryFn, GetClientFn, LlmProvider } from "@puda/api-core";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";

export interface DocumentRouteDeps {
  queryFn: QueryFn;
  getClient: GetClientFn;
  llmProvider: LlmProvider;
}

export function createDocumentRoutes(app: FastifyInstance, deps: DocumentRouteDeps) {
  const { queryFn } = deps;
  const storageDir = process.env.STORAGE_BASE_DIR || "./uploads";

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
          `SELECT document_id, title, file_name, mime_type, file_size_bytes, status, category, chunk_count, page_count, created_at, updated_at
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
        `SELECT d.*, (SELECT count(*) FROM chunk c WHERE c.document_id = d.document_id) as actual_chunk_count
         FROM document d WHERE d.document_id = $1 AND d.workspace_id = $2`,
        [id, wid]
      );
      if (result.rows.length === 0) return send404(reply, "Document not found");
      return result.rows[0];
    }
  );

  // Upload document (multipart)
  app.post<{ Params: { wid: string } }>(
    "/api/v1/workspaces/:wid/documents",
    async (request, reply) => {
      const { wid } = request.params;
      const parts = request.parts();
      let fileData: Buffer | null = null;
      let fileName = "";
      let mimeType = "";
      let title = "";
      let category = "";
      let subcategory = "";

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
        }
      }

      if (!fileData || !fileName) return send400(reply, "File is required");

      const sha256 = crypto.createHash("sha256").update(fileData).digest("hex");

      // Dedup check
      const existing = await queryFn(
        "SELECT document_id, status FROM document WHERE workspace_id = $1 AND sha256 = $2 AND status != 'DELETED'",
        [wid, sha256]
      );
      if (existing.rows.length > 0) {
        return send400(reply, `Duplicate document detected (${existing.rows[0].document_id})`);
      }

      // Store file
      const wsDir = path.join(storageDir, wid);
      if (!fs.existsSync(wsDir)) fs.mkdirSync(wsDir, { recursive: true });
      const docId = crypto.randomUUID();
      const ext = path.extname(fileName);
      const filePath = path.join(wsDir, `${docId}${ext}`);
      fs.writeFileSync(filePath, fileData);

      // Insert document record
      const result = await queryFn(
        `INSERT INTO document (document_id, workspace_id, title, file_name, mime_type, file_size_bytes, file_path, sha256, category, subcategory, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
        [docId, wid, title || fileName, fileName, mimeType, fileData.length, filePath, sha256, category || null, subcategory || null, request.authUser?.userId]
      );

      // Create initial ingestion job
      await queryFn(
        `INSERT INTO ingestion_job (document_id, workspace_id, step, status) VALUES ($1, $2, 'VALIDATE', 'PENDING')`,
        [docId, wid]
      );

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
