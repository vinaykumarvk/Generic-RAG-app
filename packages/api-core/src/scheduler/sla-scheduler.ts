import type { QueryFn, GetClientFn } from "../types";
import { logInfo, logError } from "../logging/logger";

export interface SlaSchedulerConfig {
  lockId: number;
  taskTableName?: string;
  queryFn: QueryFn;
  getClientFn: GetClientFn;
  executeTransition: (
    entityId: string, entityType: string, action: string,
    actorId: string, actorType: string, roles: string[], remarks?: string
  ) => Promise<{ success: boolean; error?: string; newStateId?: string }>;
}

export function createSlaScheduler(config: SlaSchedulerConfig) {
  const {
    lockId,
    taskTableName = "task",
    queryFn,
    getClientFn,
    executeTransition,
  } = config;

  const AUTH_CLEANUP_INTERVAL = 100;
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let tickCount = 0;

  async function checkOverdueTasks(): Promise<void> {
    let client;
    try {
      client = await getClientFn();
    } catch (err) {
      logError("SLA check failed — cannot acquire DB client", { error: String(err) });
      return;
    }
    try {
      const lockResult = await client.query("SELECT pg_try_advisory_lock($1) AS acquired", [lockId]);
      if (!lockResult.rows[0]?.acquired) {
        return;
      }

      try {
        const result = await client.query(
          `SELECT t.task_id, t.entity_type, t.entity_id, t.state_id, t.sla_due_at
           FROM ${taskTableName} t
           WHERE t.status IN ('PENDING', 'IN_PROGRESS')
             AND t.sla_due_at IS NOT NULL
             AND t.sla_due_at < NOW()
           ORDER BY t.sla_due_at ASC
           LIMIT 50`
        );
        for (const task of result.rows) {
          try {
            const transResult = await executeTransition(
              task.entity_id, task.entity_type, "AUTO_ESCALATE",
              "SYSTEM", "SYSTEM", ["SYSTEM"],
              "SLA breached – auto-escalated"
            );
            if (transResult.success) {
              logInfo("SLA auto-escalation executed", { entityId: task.entity_id, entityType: task.entity_type });
            }
          } catch (_err) {
            // AUTO_ESCALATE transition may not exist for all entity types — skip silently
          }
        }
      } finally {
        await client.query("SELECT pg_advisory_unlock($1)", [lockId]);
      }
    } catch (err) {
      logError("SLA check failed", { error: String(err) });
    } finally {
      client.release();
    }
  }

  async function cleanupExpiredAuthData(): Promise<void> {
    try {
      const denylistResult = await queryFn("DELETE FROM auth_token_denylist WHERE expires_at < NOW()");
      const sessionResult = await queryFn("DELETE FROM auth_session_activity WHERE last_activity_at < NOW() - INTERVAL '1 hour'");
      const denylistCount = denylistResult.rowCount ?? 0;
      const sessionCount = sessionResult.rowCount ?? 0;
      if (denylistCount > 0 || sessionCount > 0) {
        logInfo("Auth cleanup completed", { expiredTokens: denylistCount, staleSessions: sessionCount });
      }
    } catch (err) {
      logError("Auth cleanup failed", { error: String(err) });
    }
  }

  function start(intervalMs = 60000): void {
    if (intervalId) return;
    logInfo("SLA scheduler started", { intervalMs });
    intervalId = setInterval(() => {
      checkOverdueTasks().catch((err) => logError("SLA scheduler tick failed", { error: String(err) }));
      tickCount++;
      if (tickCount % AUTH_CLEANUP_INTERVAL === 0) {
        cleanupExpiredAuthData().catch((err) => logError("Auth cleanup tick failed", { error: String(err) }));
      }
    }, intervalMs);
    checkOverdueTasks().catch((err) => logError("SLA scheduler initial check failed", { error: String(err) }));
  }

  function stop(): void {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
      logInfo("SLA scheduler stopped");
    }
  }

  return { start, stop };
}

export type SlaScheduler = ReturnType<typeof createSlaScheduler>;
