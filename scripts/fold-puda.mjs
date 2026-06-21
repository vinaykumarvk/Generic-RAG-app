#!/usr/bin/env node
// One-off: fold the PUDA workspace from puda_rag into police_kb (both 1536-dim).
// Idempotent (ON CONFLICT DO NOTHING). PKs/workspace_id preserved (UUIDs, no collision).
//
//   SRC_URL   puda_rag conn (proxy 15436)
//   TGT_URL   police_kb conn (proxy 15435)
//
//   node scripts/fold-puda.mjs

import pg from "pg";

const WS = "55a8ed83-ad88-420b-b4b5-07f231159345"; // PUDA workspace
const EXCLUDE = new Set(["fts_vector", "search_tsv", "entity_name_tsv", "custom_tags_tsv"]); // generated cols
const NULLCOLS = { document: ["uploaded_by", "org_unit_id"] }; // FK refs not present in police_kb
const BATCH = 200;

const src = new pg.Client({ connectionString: process.env.SRC_URL });
const tgt = new pg.Client({ connectionString: process.env.TGT_URL });

async function commonCols(table) {
  const q = `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`;
  const s = new Set((await src.query(q, [table])).rows.map((r) => r.column_name));
  const t = new Set((await tgt.query(q, [table])).rows.map((r) => r.column_name));
  return [...s].filter((c) => t.has(c) && !EXCLUDE.has(c));
}

function lit(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (v instanceof Date) return `'${v.toISOString()}'`;
  if (Array.isArray(v)) return `'{${v.map((x) => `"${String(x).replace(/"/g, '\\"')}"`).join(",")}}'`;
  if (typeof v === "object") return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

async function copyTable(table, idCol) {
  const cols = await commonCols(table);
  const nulls = new Set(NULLCOLS[table] || []);
  const { rows } = await src.query(`SELECT ${cols.map((c) => `"${c}"`).join(",")} FROM ${table} WHERE workspace_id = $1`, [WS]);
  let n = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const values = batch.map((row) =>
      "(" + cols.map((c) => (nulls.has(c) ? "NULL" : lit(row[c]))).join(",") + ")").join(",");
    await tgt.query(
      `INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(",")}) VALUES ${values}
       ON CONFLICT (${idCol}) DO NOTHING`);
    n += batch.length;
  }
  console.log(`  ${table}: ${n} rows copied`);
}

async function main() {
  await src.connect();
  await tgt.connect();
  try {
    await tgt.query("BEGIN");

    // 1. workspace
    const ws = (await src.query(`SELECT * FROM workspace WHERE workspace_id=$1`, [WS])).rows[0];
    const wsCols = (await commonCols("workspace")).filter((c) => c !== "created_by"); // created_by FK -> null
    await tgt.query(
      `INSERT INTO workspace (${wsCols.map((c) => `"${c}"`).join(",")}) VALUES (${wsCols.map((c) => lit(ws[c])).join(",")})
       ON CONFLICT (workspace_id) DO NOTHING`);
    console.log(`  workspace: ${ws.name} (${ws.slug})`);

    // 2-5. data
    await copyTable("document", "document_id");
    await copyTable("chunk", "chunk_id");
    await copyTable("graph_node", "node_id");
    await copyTable("graph_edge", "edge_id");

    // 6. puda123 user + membership
    const u = (await src.query(`SELECT * FROM user_account WHERE username='puda123'`)).rows[0];
    if (u) {
      const uCols = (await commonCols("user_account")).filter((c) => !["unit_id", "org_unit_id", "archived_by"].includes(c));
      await tgt.query(
        `INSERT INTO user_account (${uCols.map((c) => `"${c}"`).join(",")}) VALUES (${uCols.map((c) => lit(u[c])).join(",")})
         ON CONFLICT (username) DO NOTHING`);
      await tgt.query(
        `INSERT INTO workspace_member (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')
         ON CONFLICT (workspace_id, user_id) DO NOTHING`, [WS, u.user_id]);
      console.log(`  user puda123 + OWNER membership`);
    }

    await tgt.query("COMMIT");
    console.log("\n=== DONE: PUDA folded into police_kb ===");
  } catch (e) {
    await tgt.query("ROLLBACK");
    throw e;
  } finally {
    await src.end();
    await tgt.end();
  }
}
main().catch((e) => { console.error("\nERROR:", e.message); process.exit(1); });
