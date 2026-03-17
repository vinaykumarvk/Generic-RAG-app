import fs from "node:fs";
import path from "node:path";

const reportPath = process.argv[2] || "outputs/dast/zap-report.json";
const maxHigh = Number.parseInt(process.env.ZAP_MAX_HIGH || "0", 10);
const maxMedium = Number.parseInt(process.env.ZAP_MAX_MEDIUM || "0", 10);

function readReport(filePath) {
  const absolutePath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`ZAP report not found: ${filePath}`);
  }
  const raw = fs.readFileSync(absolutePath, "utf8");
  return JSON.parse(raw);
}

function collectAlerts(report) {
  const sites = Array.isArray(report?.site) ? report.site : [];
  const alerts = [];
  for (const site of sites) {
    for (const alert of Array.isArray(site?.alerts) ? site.alerts : []) {
      alerts.push(alert);
    }
  }
  return alerts;
}

function asRiskCode(alert) {
  const raw = String(alert?.riskcode ?? "");
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : -1;
}

function main() {
  const report = readReport(reportPath);
  const alerts = collectAlerts(report);

  let high = 0;
  let medium = 0;
  let low = 0;
  let informational = 0;

  for (const alert of alerts) {
    const risk = asRiskCode(alert);
    if (risk >= 3) {
      high += 1;
    } else if (risk === 2) {
      medium += 1;
    } else if (risk === 1) {
      low += 1;
    } else {
      informational += 1;
    }
  }

  console.log(
    `[DAST_SUMMARY] total=${alerts.length} high=${high} medium=${medium} low=${low} informational=${informational}`
  );
  console.log(`[DAST_THRESHOLDS] max_high=${maxHigh} max_medium=${maxMedium}`);

  const failures = [];
  if (high > maxHigh) {
    failures.push(`High-risk alerts ${high} exceed threshold ${maxHigh}`);
  }
  if (medium > maxMedium) {
    failures.push(`Medium-risk alerts ${medium} exceed threshold ${maxMedium}`);
  }

  if (failures.length > 0) {
    console.error("[DAST_GATE_FAILED]");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log("[DAST_GATE_OK] ZAP baseline findings within configured thresholds.");
}

try {
  main();
} catch (error) {
  console.error(`[DAST_GATE_ERROR] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
