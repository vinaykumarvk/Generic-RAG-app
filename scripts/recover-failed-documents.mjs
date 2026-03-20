#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { Client } from "pg";

function parseArgs(argv) {
  const args = {
    execute: false,
    limit: null,
    workspaceId: null,
    documentId: null,
    sourceRoots: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--execute") {
      args.execute = true;
    } else if (arg === "--limit") {
      args.limit = Number(argv[++i]);
    } else if (arg === "--workspace-id") {
      args.workspaceId = argv[++i];
    } else if (arg === "--document-id") {
      args.documentId = argv[++i];
    } else if (arg === "--source-root") {
      args.sourceRoots.push(argv[++i]);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function discoverDownloadRoots() {
  const downloadsDir = path.join(os.homedir(), "Downloads");
  if (!fs.existsSync(downloadsDir)) {
    return [];
  }

  return fs.readdirSync(downloadsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("drive-download-"))
    .map((entry) => path.join(downloadsDir, entry.name))
    .sort();
}

function buildSourceRoots(cliRoots) {
  const envRoots = (process.env.FAILED_DOC_SOURCE_ROOTS || "")
    .split(path.delimiter)
    .map((value) => value.trim())
    .filter(Boolean);

  const roots = [...cliRoots, ...envRoots, ...discoverDownloadRoots()];
  return [...new Set(roots.map((value) => path.resolve(value)))];
}

function resolveLocalSource(sourcePath, sourceRoots) {
  if (!sourcePath) {
    return null;
  }

  const normalizedSourcePath = sourcePath.split(/[\\/]+/).join(path.sep);

  if (path.isAbsolute(sourcePath) && fs.existsSync(sourcePath)) {
    return sourcePath;
  }

  for (const root of sourceRoots) {
    const candidates = [path.join(root, normalizedSourcePath)];

    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        candidates.push(path.join(root, entry.name, normalizedSourcePath));
      }
    }

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest("hex");
}

async function login(apiBaseUrl, username, password) {
  const response = await fetch(`${apiBaseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Login failed: ${response.status} ${body}`);
  }

  const setCookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);

  const cookieHeader = setCookies
    .map((value) => value.split(";")[0])
    .filter(Boolean)
    .join("; ");

  if (!cookieHeader) {
    throw new Error("Login succeeded but no session cookie was returned");
  }

  return cookieHeader;
}

async function uploadRecovery(apiBaseUrl, cookieHeader, row, localPath) {
  const form = new FormData();
  const buffer = fs.readFileSync(localPath);
  form.append(
    "file",
    new Blob([buffer], { type: row.mime_type || "application/octet-stream" }),
    row.file_name,
  );

  const response = await fetch(
    `${apiBaseUrl}/api/v1/workspaces/${row.workspace_id}/documents`,
    {
      method: "POST",
      headers: { Cookie: cookieHeader },
      body: form,
    },
  );

  const bodyText = await response.text();
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    body = { raw: bodyText };
  }

  return {
    status: response.status,
    ok: response.ok,
    body,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const databaseUrl = process.env.DATABASE_URL;
  const apiBaseUrl = (process.env.API_BASE_URL || "https://police-cases-kb-api-809677427844.asia-southeast1.run.app").replace(/\/$/, "");
  const username = process.env.API_USERNAME || "admin";
  const password = process.env.API_PASSWORD || "Admin123!";
  const sourceRoots = buildSourceRoots(args.sourceRoots);

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  if (sourceRoots.length === 0) {
    throw new Error("No source roots found. Pass --source-root or set FAILED_DOC_SOURCE_ROOTS.");
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  const filters = ["d.status = 'FAILED'"];
  const params = [];
  if (args.workspaceId) {
    params.push(args.workspaceId);
    filters.push(`d.workspace_id = $${params.length}`);
  }
  if (args.documentId) {
    params.push(args.documentId);
    filters.push(`d.document_id = $${params.length}`);
  }

  const limitClause = args.limit ? `LIMIT ${Number(args.limit)}` : "";
  const query = `
    WITH ranked AS (
      SELECT
        d.document_id,
        d.workspace_id,
        d.file_name,
        d.mime_type,
        d.sha256,
        d.source_path,
        d.created_at,
        d.updated_at,
        COALESCE(j.error_message, d.error_message) AS latest_error,
        ROW_NUMBER() OVER (
          PARTITION BY d.document_id
          ORDER BY COALESCE(j.updated_at, j.created_at) DESC NULLS LAST
        ) AS rn
      FROM document d
      LEFT JOIN ingestion_job j ON j.document_id = d.document_id
      WHERE ${filters.join(" AND ")}
    )
    SELECT
      document_id,
      workspace_id,
      file_name,
      mime_type,
      sha256,
      source_path,
      latest_error
    FROM ranked
    WHERE rn = 1
    ORDER BY created_at, document_id
    ${limitClause}
  `;

  const result = await client.query(query, params);
  await client.end();

  console.log(`Found ${result.rows.length} failed documents`);
  console.log(`Source roots: ${sourceRoots.join(", ")}`);

  const prepared = [];
  const summary = {
    missingSourcePath: 0,
    missingLocalFile: 0,
    shaMismatch: 0,
    ready: 0,
    uploaded: 0,
    uploadFailed: 0,
  };

  for (const row of result.rows) {
    if (!row.source_path) {
      summary.missingSourcePath += 1;
      console.log(`SKIP ${row.document_id} ${row.file_name}: no source_path`);
      continue;
    }

    const localPath = resolveLocalSource(row.source_path, sourceRoots);
    if (!localPath) {
      summary.missingLocalFile += 1;
      console.log(`SKIP ${row.document_id} ${row.file_name}: local source missing for ${row.source_path}`);
      continue;
    }

    const localSha = sha256File(localPath);
    if (localSha !== row.sha256) {
      summary.shaMismatch += 1;
      console.log(`SKIP ${row.document_id} ${row.file_name}: sha256 mismatch`);
      continue;
    }

    prepared.push({ ...row, localPath });
    summary.ready += 1;
    console.log(`READY ${row.document_id} ${row.file_name}: ${row.latest_error || "<no error>"}`);
  }

  console.log("");
  console.log(
    `Prepared ${summary.ready}/${result.rows.length} documents ` +
    `(missing source_path=${summary.missingSourcePath}, missing local file=${summary.missingLocalFile}, sha mismatch=${summary.shaMismatch})`,
  );

  if (!args.execute) {
    console.log("Dry run only. Re-run with --execute to upload matching files.");
    return;
  }

  if (prepared.length === 0) {
    console.log("Nothing to upload.");
    return;
  }

  const cookieHeader = await login(apiBaseUrl, username, password);

  for (const row of prepared) {
    const upload = await uploadRecovery(apiBaseUrl, cookieHeader, row, row.localPath);
    if (upload.ok && (upload.status === 200 || upload.status === 201)) {
      summary.uploaded += 1;
      const recovered = upload.body?.recovered_existing_document ? "recovered" : "created";
      console.log(`OK ${row.document_id} ${row.file_name}: ${upload.status} ${recovered}`);
    } else {
      summary.uploadFailed += 1;
      console.log(`FAIL ${row.document_id} ${row.file_name}: ${upload.status} ${JSON.stringify(upload.body)}`);
    }
  }

  console.log("");
  console.log(`Upload summary: uploaded=${summary.uploaded}, failed=${summary.uploadFailed}`);
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
