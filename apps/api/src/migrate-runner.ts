/**
 * SQL migration runner.
 * Reads migration files from the migrations directory,
 * tracks applied versions in schema_migration table.
 */

import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";

const MIGRATIONS_DIR = path.join(__dirname, "migrations");

export async function runMigrations(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    // Ensure schema_migration table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migration (
        version     INTEGER PRIMARY KEY,
        name        TEXT NOT NULL,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // Get already-applied versions
    const applied = await client.query("SELECT version FROM schema_migration ORDER BY version");
    const appliedVersions = new Set(applied.rows.map((r: { version: number }) => r.version));

    // Read and sort migration files
    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const match = file.match(/^(\d+)/);
      if (!match) continue;
      const version = parseInt(match[1], 10);
      if (appliedVersions.has(version)) continue;

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");
      console.log(`Applying migration ${file}...`);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migration (version, name) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING",
          [version, file]
        );
        await client.query("COMMIT");
        console.log(`Migration ${file} applied successfully`);
      } catch (err) {
        await client.query("ROLLBACK");
        console.error(`Migration ${file} failed:`, err);
        throw err;
      }
    }
  } finally {
    client.release();
  }
}
