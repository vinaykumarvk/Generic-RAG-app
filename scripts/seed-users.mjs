#!/usr/bin/env node
// One-off user reset/seed utility for IntelliRAG.
//
// Modes:
//   node scripts/seed-users.mjs inspect   -> read-only: prints workspaces, user_account columns,
//                                            FKs referencing user_account, and the proposed user mapping.
//   node scripts/seed-users.mjs apply     -> DESTRUCTIVE: in one transaction, reassigns/nulls data owned
//                                            by existing users, deletes all existing users, then creates
//                                            the admin + one user per workspace. All passwords = password123.
//
// DATABASE_URL is read from the repo-root .env.
//
// User mapping: admin (ADMIN, all workspaces) + one MEMBER per workspace (OWNER of that workspace).
// Per-workspace usernames default to `<slug>123`; override specific ones below.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

// ---- config -----------------------------------------------------------------
const PASSWORD = "password123";
const ADMIN = { username: "admin", email: "admin@intellirag.local", fullName: "System Admin" };
const WORKSPACE_ROLE = "OWNER"; // per-workspace user's role inside its workspace (full access)

// Explicit username overrides, matched (case-insensitive) against workspace slug OR name substring.
// Everything else defaults to `<slug>123`.
// First match wins; matched (case-insensitive) against "<slug> <name>".
const USERNAME_OVERRIDES = [
  { match: "puda", username: "puda123" },
  { match: "judgement", username: "justice123" }, // police_kb: "Judgement Workspace"
  { match: "judicial", username: "justice123" },
  { match: "justice", username: "justice123" },
  { match: "case histoty", username: "police123" }, // police_kb: "Case histoty" (slug test-workspace)
  { match: "test-workspace", username: "police123" },
  { match: "police", username: "police123" },
];

// ---- deps (resolved from workspace node_modules) ----------------------------
const pg = (await import("pg")).default;
const argon2 = (await import("argon2")).default;

async function hashPassword(password) {
  return argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
}

function readDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = path.join(repoRoot, ".env");
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*DATABASE_URL\s*=\s*(.+?)\s*$/);
    if (m && !line.trimStart().startsWith("#")) return m[1].replace(/^["']|["']$/g, "");
  }
  throw new Error("DATABASE_URL not found in .env");
}

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function proposeUsername(ws) {
  const hay = `${ws.slug} ${ws.name}`.toLowerCase();
  for (const o of USERNAME_OVERRIDES) if (hay.includes(o.match)) return o.username;
  return `${slugify(ws.slug || ws.name)}123`;
}

async function getWorkspaces(client) {
  const { rows } = await client.query(
    `SELECT workspace_id, name, slug, status FROM workspace ORDER BY created_at`,
  );
  return rows;
}

// Discover every FK column that references user_account(user_id), with its delete rule + nullability.
async function getUserFks(client) {
  const { rows } = await client.query(`
    SELECT tc.table_name, kcu.column_name, rc.delete_rule,
           c.is_nullable
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
    JOIN information_schema.referential_constraints rc
      ON tc.constraint_name = rc.constraint_name AND tc.table_schema = rc.constraint_schema
    JOIN information_schema.columns c
      ON c.table_schema = tc.table_schema AND c.table_name = tc.table_name AND c.column_name = kcu.column_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_name = 'user_account' AND ccu.column_name = 'user_id'
      AND tc.table_schema = 'public'
    ORDER BY tc.table_name, kcu.column_name`);
  return rows;
}

async function getUserColumns(client) {
  const { rows } = await client.query(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns
     WHERE table_schema='public' AND table_name='user_account' ORDER BY ordinal_position`,
  );
  return rows;
}

async function inspect(client) {
  const [workspaces, fks, cols, users] = await Promise.all([
    getWorkspaces(client),
    getUserFks(client),
    getUserColumns(client),
    client.query(`SELECT username, email, user_type, status FROM user_account ORDER BY user_type, username`),
  ]);

  console.log("\n=== EXISTING USERS (will be removed) ===");
  console.table(users.rows);

  console.log("\n=== WORKSPACES ===");
  console.table(workspaces.map((w) => ({ name: w.name, slug: w.slug, status: w.status })));

  console.log("\n=== user_account COLUMNS ===");
  console.table(cols);

  console.log("\n=== FOREIGN KEYS -> user_account (how each is handled on delete) ===");
  console.table(
    fks.map((f) => ({
      table: f.table_name,
      column: f.column_name,
      delete_rule: f.delete_rule,
      nullable: f.is_nullable,
      action:
        f.delete_rule === "CASCADE" || f.delete_rule === "SET NULL"
          ? `auto (${f.delete_rule})`
          : f.is_nullable === "YES"
            ? "SET NULL (manual)"
            : "REASSIGN -> admin (manual)",
    })),
  );

  console.log("\n=== PROPOSED USERS TO CREATE ===");
  console.table([
    { username: ADMIN.username, email: ADMIN.email, user_type: "ADMIN", scope: "ALL workspaces" },
    ...workspaces.map((w) => {
      const u = proposeUsername(w);
      return { username: u, email: `${u}@intellirag.local`, user_type: "MEMBER", scope: `${w.name} (${WORKSPACE_ROLE})` };
    }),
  ]);

  console.log("\nAll passwords will be:", PASSWORD);
  console.log("\nReview the mapping above. Run with `apply` to execute.\n");
}

async function apply(client) {
  const workspaces = await getWorkspaces(client);
  if (workspaces.length === 0) throw new Error("No workspaces found — nothing to map users to. Aborting.");

  const fks = await getUserFks(client);
  const adminHash = await hashPassword(PASSWORD);

  await client.query("BEGIN");
  try {
    // 1. Upsert the admin first so it can receive reassigned rows.
    const adminRes = await client.query(
      `INSERT INTO user_account (username, email, full_name, user_type, password_hash, status)
       VALUES ($1, $2, $3, 'ADMIN', $4, 'ACTIVE')
       ON CONFLICT (username) DO UPDATE
         SET user_type = 'ADMIN', password_hash = EXCLUDED.password_hash, status = 'ACTIVE'
       RETURNING user_id`,
      [ADMIN.username, ADMIN.email, ADMIN.fullName, adminHash],
    );
    const adminId = adminRes.rows[0].user_id;

    // 2. Handle every FK that won't be cleared automatically on delete.
    for (const f of fks) {
      if (f.delete_rule === "CASCADE" || f.delete_rule === "SET NULL") continue; // auto-handled
      const tgt = `"${f.table_name}"."${f.column_name}"`;
      if (f.is_nullable === "YES") {
        const r = await client.query(
          `UPDATE "${f.table_name}" SET "${f.column_name}" = NULL WHERE "${f.column_name}" <> $1`,
          [adminId],
        );
        console.log(`SET NULL  ${tgt.padEnd(40)} rows=${r.rowCount}`);
      } else {
        const r = await client.query(
          `UPDATE "${f.table_name}" SET "${f.column_name}" = $1 WHERE "${f.column_name}" <> $1`,
          [adminId],
        );
        console.log(`REASSIGN  ${tgt.padEnd(40)} rows=${r.rowCount}`);
      }
    }

    // 3. Delete all users except the admin (cascades clear sessions, workspace_member, user_role, ...).
    const del = await client.query(`DELETE FROM user_account WHERE user_id <> $1`, [adminId]);
    console.log(`\nDeleted ${del.rowCount} existing user(s).`);

    // 4. Create one MEMBER per workspace + membership.
    const created = [];
    for (const ws of workspaces) {
      const username = proposeUsername(ws);
      const email = `${username}@intellirag.local`;
      const fullName = `${ws.name} User`;
      const hash = await hashPassword(PASSWORD);
      const ures = await client.query(
        `INSERT INTO user_account (username, email, full_name, user_type, password_hash, status)
         VALUES ($1, $2, $3, 'MEMBER', $4, 'ACTIVE') RETURNING user_id`,
        [username, email, fullName, hash],
      );
      const uid = ures.rows[0].user_id;
      await client.query(
        `INSERT INTO workspace_member (workspace_id, user_id, role) VALUES ($1, $2, $3)
         ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
        [ws.workspace_id, uid, WORKSPACE_ROLE],
      );
      created.push({ username, email, workspace: ws.name, role: WORKSPACE_ROLE });
    }

    await client.query("COMMIT");
    console.log("\n=== DONE — created users ===");
    console.table([{ username: ADMIN.username, email: ADMIN.email, scope: "ALL (ADMIN)" }, ...created]);
    console.log("\nAll passwords:", PASSWORD);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

async function main() {
  const mode = process.argv[2];
  if (mode !== "inspect" && mode !== "apply") {
    console.error("Usage: node scripts/seed-users.mjs <inspect|apply>");
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: readDatabaseUrl() });
  await client.connect();
  try {
    if (mode === "inspect") await inspect(client);
    else await apply(client);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("\nERROR:", err.message);
  process.exit(1);
});
