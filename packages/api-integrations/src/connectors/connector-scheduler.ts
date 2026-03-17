import type { ExternalConnector, ConnectorItem } from "./types";
import { createRetryHandler, type RetryConfig } from "./retry";

export type QueryFn = (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
export type GetClientFn = () => Promise<{
  query(text: string, params?: any[]): Promise<{ rows: any[]; rowCount: number | null }>;
  release(): void;
}>;

export interface ConnectorSchedulerConfig {
  connectors: ExternalConnector[];
  queryFn: QueryFn;
  getClientFn: GetClientFn;
  advisoryLockId: number;
  intervalMs?: number;
  onItems?: (items: ConnectorItem[], connectorName: string) => Promise<void>;
  onError?: (error: Error, connectorName: string) => void;
  retryConfig?: RetryConfig;
}

export function createConnectorScheduler(config: ConnectorSchedulerConfig) {
  const {
    connectors,
    getClientFn,
    advisoryLockId,
    intervalMs = 300_000,
    onItems,
    onError,
    retryConfig,
  } = config;

  const retryHandler = createRetryHandler(retryConfig);
  let intervalId: ReturnType<typeof setInterval> | null = null;

  async function runOnce(): Promise<void> {
    const client = await getClientFn();
    try {
      const lockResult = await client.query("SELECT pg_try_advisory_lock($1) AS acquired", [advisoryLockId]);
      if (!lockResult.rows[0]?.acquired) return;

      try {
        for (const connector of connectors) {
          try {
            const enabled = await connector.isEnabled();
            if (!enabled) continue;

            const result = await retryHandler.execute(
              () => connector.fetch(),
              `connector:${connector.name}`,
            );

            if (result.items.length > 0 && onItems) {
              await onItems(result.items, connector.name);
            }
          } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            if (onError) onError(error, connector.name);
          }
        }
      } finally {
        await client.query("SELECT pg_advisory_unlock($1)", [advisoryLockId]);
      }
    } finally {
      client.release();
    }
  }

  function start(): void {
    if (intervalId) return;
    intervalId = setInterval(() => { runOnce().catch(() => {}); }, intervalMs);
    runOnce().catch(() => {});
  }

  function stop(): void {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  return { start, stop, runOnce };
}
