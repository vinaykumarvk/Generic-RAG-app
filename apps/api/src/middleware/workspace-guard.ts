/**
 * Workspace membership guard — verifies the authenticated user
 * is a member of the workspace specified in the URL (:wid param).
 * Admins bypass the check.
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import type { QueryFn } from "@puda/api-core";

const WORKSPACE_ROUTE_RE = /^\/api\/v1\/workspaces\/([^/]+)\//;

export function createWorkspaceMemberGuard(queryFn: QueryFn) {
  return async function workspaceMemberGuard(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    const match = request.url.match(WORKSPACE_ROUTE_RE);
    if (!match) return; // Not a workspace-scoped route

    const wid = match[1];
    const user = request.authUser;
    if (!user) return; // Auth middleware will handle this

    // Admins bypass workspace membership check
    if (user.userType === "ADMIN") return;

    const result = await queryFn(
      `SELECT 1 FROM workspace_member WHERE workspace_id = $1 AND user_id = $2 LIMIT 1`,
      [wid, user.userId],
    );

    if (result.rows.length === 0) {
      reply.code(403).send({ error: "FORBIDDEN", message: "Not a member of this workspace" });
    }
  };
}
