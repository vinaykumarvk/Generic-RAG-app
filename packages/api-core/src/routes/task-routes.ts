import { FastifyInstance } from "fastify";
import type { QueryFn } from "../types";
import { sendError, send403, send404 } from "../errors";

export interface TaskRouteDeps {
  queryFn: QueryFn;
  taskTableName?: string;
  executeTransition: (
    entityId: string, entityType: string, action: string,
    actorId: string, actorType: string, roles: string[], remarks?: string
  ) => Promise<{ success: boolean; error?: string; newStateId?: string }>;
}

export function createTaskRoutes(deps: TaskRouteDeps) {
  const { queryFn, taskTableName = "task", executeTransition } = deps;

  return async function registerTaskRoutes(app: FastifyInstance): Promise<void> {
    app.get("/api/v1/tasks/inbox", {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
            offset: { type: "integer", minimum: 0, default: 0 },
          },
        },
      },
    }, async (request) => {
      const { roles } = request.authUser!;
      const { limit, offset } = request.query as { limit: number; offset: number };

      if (roles.length === 0) return { tasks: [], total: 0 };

      const countResult = await queryFn(
        `SELECT COUNT(*) AS total FROM ${taskTableName} WHERE status IN ('PENDING', 'IN_PROGRESS') AND role_id = ANY($1)`,
        [roles],
      );
      const total = parseInt(countResult.rows[0].total, 10);

      const result = await queryFn(
        `SELECT task_id, entity_type, entity_id, state_id, role_id, status, sla_due_at, created_at,
                CASE
                  WHEN sla_due_at IS NULL THEN 'NO_SLA'
                  WHEN sla_due_at < NOW() THEN 'BREACHED'
                  WHEN sla_due_at < NOW() + INTERVAL '2 hours' THEN 'AT_RISK'
                  ELSE 'ON_TRACK'
                END AS sla_status
         FROM ${taskTableName}
         WHERE status IN ('PENDING', 'IN_PROGRESS') AND role_id = ANY($1)
         ORDER BY sla_due_at ASC NULLS LAST, created_at ASC
         LIMIT $2 OFFSET $3`,
        [roles, limit, offset],
      );

      return { tasks: result.rows, total };
    });

    app.post("/api/v1/tasks/:id/action", {
      schema: {
        params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
        body: { type: "object", additionalProperties: false, required: ["action"], properties: { action: { type: "string" }, remarks: { type: "string" } } },
      },
    }, async (request, reply) => {
      const { id } = request.params as { id: string };
      const { action, remarks } = request.body as { action: string; remarks?: string };
      const { userId, roles } = request.authUser!;

      const taskResult = await queryFn(
        `SELECT task_id, entity_type, entity_id, state_id, role_id, assigned_to FROM ${taskTableName} WHERE task_id = $1 AND status IN ('PENDING', 'IN_PROGRESS')`,
        [id],
      );
      if (taskResult.rows.length === 0) {
        return send404(reply, "TASK_NOT_FOUND", "Task not found or already completed");
      }

      const task = taskResult.rows[0];

      const isAssigned = task.assigned_to === userId;
      const hasTaskRole = task.role_id && roles.includes(task.role_id);
      const isPrivileged = roles.includes("ADMINISTRATOR") || roles.includes("PLATFORM_ADMINISTRATOR");
      if (!isAssigned && !hasTaskRole && !isPrivileged) {
        return send403(reply, "FORBIDDEN", "You do not have permission to act on this task");
      }

      const result = await executeTransition(
        task.entity_id, task.entity_type, action, userId, "OFFICER", roles, remarks,
      );
      if (!result.success) {
        return sendError(reply, 409, result.error || "TRANSITION_FAILED", "Task action failed");
      }
      return { success: true, newStateId: result.newStateId };
    });
  };
}
