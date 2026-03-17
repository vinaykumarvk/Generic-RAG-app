import type { FastifyRequest, FastifyReply } from "fastify";
import { send403 } from "../errors";

/**
 * Creates a role guard that checks if the authenticated user has at least one of the allowed roles.
 * Returns a function that can be called at the top of a route handler.
 *
 * Usage:
 *   const requireSupervisor = createRoleGuard(["SUPERVISOR", "ADMINISTRATOR"]);
 *   app.post("/api/v1/some-route", async (request, reply) => {
 *     if (!requireSupervisor(request, reply)) return;
 *     // ... route logic
 *   });
 */
export function createRoleGuard(allowedRoles: string[]) {
  return (request: FastifyRequest, reply: FastifyReply): boolean => {
    const userRoles = request.authUser?.roles ?? [];
    if (allowedRoles.some((role) => userRoles.includes(role))) {
      return true;
    }
    send403(reply, "FORBIDDEN", "Insufficient permissions");
    return false;
  };
}
