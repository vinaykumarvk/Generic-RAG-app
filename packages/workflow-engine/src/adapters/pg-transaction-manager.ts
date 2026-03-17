import type { Pool, PoolClient } from "pg";
import type { PgTransactionHandle, TransactionHandle, TransactionManager } from "../types";

export class PgTransactionManager implements TransactionManager {
  constructor(private pool: Pool) {}

  async runInTransaction<T>(
    fn: (txn: TransactionHandle) => Promise<T>,
    existingTxn?: TransactionHandle
  ): Promise<T> {
    // Join existing transaction — caller owns BEGIN/COMMIT/ROLLBACK
    if (existingTxn) {
      return fn(existingTxn);
    }

    // Own the transaction lifecycle
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '5s'");

      const txn: PgTransactionHandle = { client };
      const result = await fn(txn);

      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}
