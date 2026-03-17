import { resolve } from "node:path";
import { FastifyReply } from "fastify";
import type { ApiError } from "./types";

export function sendError(reply: FastifyReply, statusCode: number, error: string, message?: string): void {
  const body: ApiError = { error, message: message || error, statusCode };
  reply.code(statusCode).send(body);
}

export function send400(reply: FastifyReply, error: string, message?: string) {
  return sendError(reply, 400, error, message);
}
export function send401(reply: FastifyReply, error: string, message?: string) {
  return sendError(reply, 401, error, message);
}
export function send403(reply: FastifyReply, error: string, message?: string) {
  return sendError(reply, 403, error, message);
}
export function send404(reply: FastifyReply, error: string, message?: string) {
  return sendError(reply, 404, error, message);
}

/**
 * Validates that a file path resolves within an allowed base directory.
 * Prevents path traversal attacks (e.g., "../../etc/passwd").
 */
export function validateFilePath(filePath: string, allowedBaseDir: string): string | null {
  const resolved = resolve(filePath);
  const base = resolve(allowedBaseDir);
  if (!resolved.startsWith(base + "/") && resolved !== base) {
    return null;
  }
  return resolved;
}
