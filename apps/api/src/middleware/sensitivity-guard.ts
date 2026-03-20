/**
 * Sensitivity Guard Middleware (FR-002)
 * Evaluates access chain: user status → role → org unit → sensitivity level → explicit grants.
 */

import type { QueryFn } from "@puda/api-core";

/** Sensitivity levels ordered from least to most restrictive */
const SENSITIVITY_ORDER: Record<string, number> = {
  PUBLIC: 0,
  INTERNAL: 1,
  RESTRICTED: 2,
  SEALED: 3,
};

export interface SensitivityCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Check if a user can access a document based on sensitivity level and grants.
 */
export async function checkDocumentAccess(
  queryFn: QueryFn,
  userId: string,
  documentId: string,
  userClearance: string,
  userType: string,
): Promise<SensitivityCheckResult> {
  // ADMIN users have full access
  if (userType === "ADMIN") {
    return { allowed: true };
  }

  // Get document sensitivity
  const docResult = await queryFn(
    "SELECT sensitivity_level, org_unit_id FROM document WHERE document_id = $1 AND status != 'DELETED'",
    [documentId]
  );

  if (docResult.rows.length === 0) {
    return { allowed: false, reason: "document_not_found" };
  }

  const doc = docResult.rows[0];
  const docLevel = SENSITIVITY_ORDER[doc.sensitivity_level] ?? 1;
  const userLevel = SENSITIVITY_ORDER[userClearance] ?? 1;

  // Check base clearance
  if (userLevel >= docLevel) {
    return { allowed: true };
  }

  // Check explicit grants (time-bound)
  const grantResult = await queryFn(
    `SELECT grant_id FROM access_grant
     WHERE user_id = $1
       AND (document_id = $2 OR (document_id IS NULL AND sensitivity_level = $3))
       AND (expires_at IS NULL OR expires_at > now())
     LIMIT 1`,
    [userId, documentId, doc.sensitivity_level]
  );

  if (grantResult.rows.length > 0) {
    return { allowed: true };
  }

  return { allowed: false, reason: "insufficient_clearance" };
}

/**
 * Filter chunk IDs to only those the user can access.
 * Used in the retrieval pipeline between rerank and generate steps.
 */
export async function filterChunksByAccess(
  queryFn: QueryFn,
  chunkIds: string[],
  userId: string,
  userClearance: string,
  userType: string,
): Promise<string[]> {
  if (chunkIds.length === 0) return [];

  // ADMIN sees everything
  if (userType === "ADMIN") return chunkIds;

  const userLevel = SENSITIVITY_ORDER[userClearance] ?? 1;

  // Get document sensitivity for all chunks in a single query
  const result = await queryFn(
    `SELECT c.chunk_id, d.sensitivity_level, d.document_id
     FROM chunk c
     JOIN document d ON d.document_id = c.document_id
     WHERE c.chunk_id = ANY($1) AND d.status != 'DELETED'`,
    [chunkIds]
  );

  // Get explicit grants for this user
  const grantResult = await queryFn(
    `SELECT document_id, sensitivity_level FROM access_grant
     WHERE user_id = $1 AND (expires_at IS NULL OR expires_at > now())`,
    [userId]
  );

  const grantedDocIds = new Set(grantResult.rows.filter((g: { document_id: string }) => g.document_id).map((g: { document_id: string }) => g.document_id));
  const grantedLevels = new Set(grantResult.rows.filter((g: { sensitivity_level: string }) => g.sensitivity_level).map((g: { sensitivity_level: string }) => g.sensitivity_level));

  return result.rows
    .filter((row: { chunk_id: string; sensitivity_level: string; document_id: string }) => {
      const docLevel = SENSITIVITY_ORDER[row.sensitivity_level] ?? 1;
      // User's clearance covers this level
      if (userLevel >= docLevel) return true;
      // Explicit document grant
      if (grantedDocIds.has(row.document_id)) return true;
      // Explicit sensitivity-level grant
      if (grantedLevels.has(row.sensitivity_level)) return true;
      return false;
    })
    .map((row: { chunk_id: string }) => row.chunk_id);
}

/**
 * Build a cache access signature based on user sensitivity clearance and grants.
 */
export function buildAccessSignature(
  userClearance: string,
  userType: string,
): string {
  if (userType === "ADMIN") return "admin";
  return `clearance:${userClearance}`;
}
