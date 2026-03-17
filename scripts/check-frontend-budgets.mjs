#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const ROOT = process.cwd();

function readPositiveBudgetKb(envName, fallbackKb) {
  const raw = process.env[envName];
  const parsed = Number.parseFloat(raw ?? "");
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackKb;
  return parsed;
}

function bytesToKb(value) {
  return value / 1024;
}

function gzipSizeBytes(filePath) {
  const content = fs.readFileSync(filePath);
  return zlib.gzipSync(content).length;
}

function collectAssetSizesBytes(assetDir, extension) {
  const files = fs
    .readdirSync(assetDir)
    .filter((entry) => entry.endsWith(extension) && !entry.endsWith(".map"));
  const sizes = files.map((file) => {
    const fullPath = path.join(assetDir, file);
    return {
      file,
      gzipBytes: gzipSizeBytes(fullPath),
    };
  });
  const totalBytes = sizes.reduce((sum, item) => sum + item.gzipBytes, 0);
  const maxBytes = sizes.reduce((max, item) => Math.max(max, item.gzipBytes), 0);
  return { files: sizes, totalBytes, maxBytes };
}

function assertBudgets(appKey, budget, measured, failures) {
  if (measured.jsTotalKb > budget.jsTotalKb) {
    failures.push(
      `${appKey}: total JS gzip ${measured.jsTotalKb.toFixed(1)}KB > ${budget.jsTotalKb.toFixed(1)}KB`
    );
  }
  if (measured.jsMaxKb > budget.jsChunkKb) {
    failures.push(
      `${appKey}: largest JS chunk gzip ${measured.jsMaxKb.toFixed(1)}KB > ${budget.jsChunkKb.toFixed(1)}KB`
    );
  }
  if (measured.cssTotalKb > budget.cssTotalKb) {
    failures.push(
      `${appKey}: total CSS gzip ${measured.cssTotalKb.toFixed(1)}KB > ${budget.cssTotalKb.toFixed(1)}KB`
    );
  }
}

function readBudgets() {
  return {
    citizen: {
      jsTotalKb: readPositiveBudgetKb("CITIZEN_JS_GZIP_BUDGET_KB", 130),
      jsChunkKb: readPositiveBudgetKb("CITIZEN_JS_CHUNK_GZIP_BUDGET_KB", 120),
      cssTotalKb: readPositiveBudgetKb("CITIZEN_CSS_GZIP_BUDGET_KB", 12),
    },
    officer: {
      jsTotalKb: readPositiveBudgetKb("OFFICER_JS_GZIP_BUDGET_KB", 100),
      jsChunkKb: readPositiveBudgetKb("OFFICER_JS_CHUNK_GZIP_BUDGET_KB", 95),
      cssTotalKb: readPositiveBudgetKb("OFFICER_CSS_GZIP_BUDGET_KB", 10),
    },
  };
}

function analyzeApp(appName) {
  const assetDir = path.join(ROOT, "apps", appName, "dist", "assets");
  if (!fs.existsSync(assetDir)) {
    throw new Error(`Build assets not found for ${appName}: ${assetDir}`);
  }
  const js = collectAssetSizesBytes(assetDir, ".js");
  const css = collectAssetSizesBytes(assetDir, ".css");
  return {
    jsTotalKb: bytesToKb(js.totalBytes),
    jsMaxKb: bytesToKb(js.maxBytes),
    cssTotalKb: bytesToKb(css.totalBytes),
    jsFiles: js.files.length,
    cssFiles: css.files.length,
  };
}

function main() {
  const budgets = readBudgets();
  const measured = {
    citizen: analyzeApp("citizen"),
    officer: analyzeApp("officer"),
  };

  const failures = [];
  assertBudgets("citizen", budgets.citizen, measured.citizen, failures);
  assertBudgets("officer", budgets.officer, measured.officer, failures);

  const report = { timestamp: new Date().toISOString(), budgets, measured };
  console.log(JSON.stringify(report, null, 2));

  const reportPath = path.join(ROOT, "frontend-bundle-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  const baselinePath = path.join(ROOT, "frontend-bundle-baseline.json");
  if (fs.existsSync(baselinePath)) {
    try {
      const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf-8"));
      const regressions = [];
      for (const app of ["citizen", "officer"]) {
        const bm = baseline.measured?.[app];
        const cm = measured[app];
        if (!bm || !cm) continue;
        const jsDelta = cm.jsTotalKb - bm.jsTotalKb;
        const cssDelta = cm.cssTotalKb - bm.cssTotalKb;
        const threshold = 5;
        if (jsDelta > threshold) {
          regressions.push(`${app}: JS grew by +${jsDelta.toFixed(1)}KB gzip (>${threshold}KB threshold)`);
        }
        if (cssDelta > threshold) {
          regressions.push(`${app}: CSS grew by +${cssDelta.toFixed(1)}KB gzip (>${threshold}KB threshold)`);
        }
        console.log(`[${app}] JS: ${cm.jsTotalKb.toFixed(1)}KB (${jsDelta >= 0 ? "+" : ""}${jsDelta.toFixed(1)}KB) | CSS: ${cm.cssTotalKb.toFixed(1)}KB (${cssDelta >= 0 ? "+" : ""}${cssDelta.toFixed(1)}KB)`);
      }
      if (regressions.length > 0) {
        console.error("[PERFORMANCE_REGRESSION_DETECTED]");
        for (const r of regressions) console.error(`- ${r}`);
        console.error("Update frontend-bundle-baseline.json if this growth is intentional.");
      }
    } catch {
      console.log("[BASELINE_COMPARE_SKIPPED] Could not parse baseline file");
    }
  }

  if (failures.length > 0) {
    console.error("[FRONTEND_BUDGET_FAILED]");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log("[FRONTEND_BUDGET_OK] All frontend bundle budgets satisfied");
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[FRONTEND_BUDGET_ERROR] ${message}`);
  process.exit(1);
}
