import type { ConnectorItem } from "./types";

export type QueryFn = (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;

export interface DeadLetterConfig {
  queryFn: QueryFn;
  tableName?: string;
}

export function createDeadLetterQueue(config: DeadLetterConfig) {
  const { queryFn, tableName = "connector_dead_letter" } = config;

  async function enqueue(item: ConnectorItem, error: string, connectorName: string): Promise<void> {
    await queryFn(
      `INSERT INTO ${tableName} (external_id, source, connector_name, raw_data, error_message, failed_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (external_id, source) DO UPDATE SET
         error_message = EXCLUDED.error_message,
         retry_count = ${tableName}.retry_count + 1,
         failed_at = NOW()`,
      [item.externalId, item.source, connectorName, JSON.stringify(item.rawData), error],
    );
  }

  async function listFailed(limit = 50, offset = 0): Promise<{ items: any[]; total: number }> {
    const countResult = await queryFn(`SELECT COUNT(*)::int AS total FROM ${tableName}`);
    const total = countResult.rows[0]?.total || 0;
    const result = await queryFn(
      `SELECT * FROM ${tableName} ORDER BY failed_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return { items: result.rows, total };
  }

  async function retry(id: string): Promise<boolean> {
    const result = await queryFn(
      `DELETE FROM ${tableName} WHERE id = $1 RETURNING *`,
      [id],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async function purgeOlderThan(days: number): Promise<number> {
    const result = await queryFn(
      `DELETE FROM ${tableName} WHERE failed_at < NOW() - INTERVAL '1 day' * $1`,
      [days],
    );
    return result.rowCount ?? 0;
  }

  return { enqueue, listFailed, retry, purgeOlderThan };
}
