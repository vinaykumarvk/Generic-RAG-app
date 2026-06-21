#!/usr/bin/env node
// One-off: re-embed police_kb from 768 (text-embedding-3-small) to 1536 (text-embedding-3-large).
// Idempotent / resumable: only ALTERs columns still at 768, only embeds rows with NULL embedding.
//
//   DATABASE_URL  postgres conn (police_kb via cloud-sql-proxy)
//   OPENAI_API_KEY  for text-embedding-3-large
//
//   node scripts/reembed-1536.mjs

import pg from "pg";

const MODEL = "text-embedding-3-large";
const DIM = 1536;
const BATCH = 100;

// Each target: table, text column (re-embed source), vector column, hnsw ef_construction, and
// whether to re-embed all rows-with-text (chunk) or only rows that previously had an embedding (graph_node).
const TARGETS = [
  { table: "chunk", textCol: "content", vecCol: "embedding",
    index: "idx_chunk_embedding", ef: 200, scope: "all" },
  { table: "graph_node", textCol: "description", vecCol: "description_embedding",
    index: "idx_graph_node_desc_embedding", ef: 128, scope: "previously_embedded" },
  { table: "legal_wiki_article", textCol: "content", vecCol: "embedding",
    index: "idx_legal_wiki_embedding", ef: 128, scope: "all" },
];

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

async function colDim(table, col) {
  const { rows } = await client.query(
    `SELECT format_type(a.atttypid,a.atttypmod) AS t
     FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname=$1 AND a.attname=$2`, [table, col]);
  const m = rows[0]?.t?.match(/vector\((\d+)\)/);
  return m ? Number(m[1]) : null;
}

async function embed(texts) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, input: texts, dimensions: DIM }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()).data;
  return data.map((d) => d.embedding);
}

async function migrateTarget(t) {
  const { table, textCol, vecCol, index, ef, scope } = t;
  const idCol = table === "chunk" ? "chunk_id" : table === "graph_node" ? "node_id" : "article_id";
  const cur = await colDim(table, vecCol);
  console.log(`\n[${table}.${vecCol}] current dim=${cur}`);

  // Snapshot which rows to re-embed BEFORE altering (resumable via a real table).
  const snap = `_reembed_${table}`;
  if (scope === "previously_embedded") {
    await client.query(
      `CREATE TABLE IF NOT EXISTS ${snap} AS SELECT ${idCol} FROM ${table} WHERE ${vecCol} IS NOT NULL`);
    const { rows } = await client.query(`SELECT count(*)::int n FROM ${snap}`);
    console.log(`  snapshot ${snap}: ${rows[0].n} rows`);
  }

  if (cur !== DIM) {
    console.log(`  dropping index + ALTER ${vecCol} -> vector(${DIM})`);
    await client.query(`DROP INDEX IF EXISTS ${index}`);
    await client.query(`ALTER TABLE ${table} ALTER COLUMN ${vecCol} TYPE vector(${DIM}) USING NULL`);
  } else {
    console.log(`  already ${DIM}-dim, resuming embed of NULLs`);
  }

  // Build the set of rows to embed.
  const whereScope = scope === "previously_embedded"
    ? `${idCol} IN (SELECT ${idCol} FROM ${snap})`
    : `${textCol} IS NOT NULL AND ${textCol} <> ''`;
  let done = 0;
  for (;;) {
    const { rows } = await client.query(
      `SELECT ${idCol} AS id, ${textCol} AS txt FROM ${table}
       WHERE ${vecCol} IS NULL AND ${whereScope} AND ${textCol} IS NOT NULL AND ${textCol} <> ''
       LIMIT ${BATCH}`);
    if (rows.length === 0) break;
    const vecs = await embed(rows.map((r) => r.txt));
    const values = rows.map((r, i) => `('${r.id}'::uuid, '[${vecs[i].join(",")}]'::vector)`).join(",");
    await client.query(
      `UPDATE ${table} AS t SET ${vecCol} = v.vec
       FROM (VALUES ${values}) AS v(id, vec) WHERE t.${idCol} = v.id`);
    done += rows.length;
    process.stdout.write(`  embedded ${done}\r`);
  }
  console.log(`  embedded ${done} total`);

  await client.query(
    `CREATE INDEX IF NOT EXISTS ${index} ON ${table} USING hnsw (${vecCol} vector_cosine_ops) WITH (m='16', ef_construction='${ef}')`);
  console.log(`  index ${index} recreated`);
  if (scope === "previously_embedded") await client.query(`DROP TABLE IF EXISTS ${snap}`);
}

async function main() {
  await client.connect();
  try {
    // answer_cache: it's a cache — clear it and convert the column (no re-embed needed).
    const acDim = await colDim("answer_cache", "query_embedding");
    if (acDim !== DIM) {
      console.log(`\n[answer_cache] clearing cache + ALTER query_embedding -> vector(${DIM})`);
      await client.query(`DROP INDEX IF EXISTS idx_answer_cache_embedding`);
      await client.query(`DELETE FROM answer_cache`);
      await client.query(`ALTER TABLE answer_cache ALTER COLUMN query_embedding TYPE vector(${DIM}) USING NULL`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_answer_cache_embedding ON answer_cache USING hnsw (query_embedding vector_cosine_ops) WITH (m='16', ef_construction='64')`);
    }
    for (const t of TARGETS) await migrateTarget(t);
    console.log("\n=== DONE: police_kb re-embedded to 1536 ===");
  } finally {
    await client.end();
  }
}
main().catch((e) => { console.error("\nERROR:", e.message); process.exit(1); });
