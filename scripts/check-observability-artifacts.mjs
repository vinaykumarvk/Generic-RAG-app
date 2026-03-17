import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function readText(relativePath) {
  const absolutePath = path.resolve(ROOT, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Missing required artifact: ${relativePath}`);
  }
  return fs.readFileSync(absolutePath, "utf8");
}

function ensure(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function validateAlerts() {
  const alertsPath = "ops/observability/prometheus-alerts.yml";
  const alertsYaml = readText(alertsPath);

  const expectedAlerts = [
    "PudaApiHighErrorRate",
    "PudaApiSloErrorBudgetBurnFast",
    "PudaApiSloErrorBudgetBurnSlow",
    "PudaApiHighLatencyP95",
    "PudaApiDbPoolSaturation",
    "PudaApiWorkflowOverdueBacklog",
    "PudaApiAuthLoginFailuresSpike",
  ];

  for (const alertName of expectedAlerts) {
    ensure(
      alertsYaml.includes(`alert: ${alertName}`),
      `Missing required alert rule: ${alertName}`
    );
  }

  const runbookRegex = /runbook:\s*"([^"]+)"/g;
  const runbooks = [];
  let match;
  while ((match = runbookRegex.exec(alertsYaml)) !== null) {
    runbooks.push(match[1]);
  }
  ensure(runbooks.length >= expectedAlerts.length, "Alert rules are missing runbook annotations");
  for (const runbookPath of runbooks) {
    const absoluteRunbookPath = path.resolve(ROOT, runbookPath);
    ensure(fs.existsSync(absoluteRunbookPath), `Runbook file not found: ${runbookPath}`);
  }
}

function validateSloSpec() {
  const sloPath = "ops/observability/SLOs.md";
  const markdown = readText(sloPath);
  const requiredSections = [
    "Availability SLO",
    "Latency SLO",
    "DB Saturation SLO",
    "Workflow backlog SLO",
    "Alert-to-Runbook Mapping",
  ];
  for (const section of requiredSections) {
    ensure(markdown.includes(section), `SLO doc missing section: ${section}`);
  }
}

function collectPanelTitles(panel, titles) {
  if (panel && typeof panel.title === "string" && panel.title.trim().length > 0) {
    titles.add(panel.title.trim());
  }
  if (Array.isArray(panel?.panels)) {
    for (const child of panel.panels) {
      collectPanelTitles(child, titles);
    }
  }
}

function validateDashboard() {
  const dashboardPath = "ops/observability/grafana-dashboard.puda-api.json";
  const raw = readText(dashboardPath);
  const dashboard = JSON.parse(raw);
  ensure(Array.isArray(dashboard.panels), "Grafana dashboard must define panels[]");

  const titles = new Set();
  for (const panel of dashboard.panels) {
    collectPanelTitles(panel, titles);
  }

  const expectedPanelTitles = [
    "Request Rate (RPS)",
    "HTTP Error Rate",
    "HTTP Latency Quantiles",
    "DB Pool Saturation",
    "Workflow Backlog",
    "Auth Login Failure Rate",
  ];
  for (const title of expectedPanelTitles) {
    ensure(titles.has(title), `Grafana dashboard missing panel: ${title}`);
  }
}

function main() {
  validateAlerts();
  validateSloSpec();
  validateDashboard();
  console.log("[OBSERVABILITY_ARTIFACTS_OK] SLO, alert, dashboard, and runbook links are valid.");
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[OBSERVABILITY_ARTIFACTS_FAILED] ${message}`);
  process.exit(1);
}
