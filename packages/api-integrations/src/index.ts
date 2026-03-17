// Reports (Phase 4)
export { createPdfGenerator } from "./reports/pdf-generator";
export type { PdfGeneratorConfig, ReportTemplate, ReportSection } from "./reports/pdf-generator";
export { createDocxGenerator } from "./reports/docx-generator";

// Connectors (Phase 6)
export type { ExternalConnector, ConnectorResult, ConnectorItem } from "./connectors/types";
export { createConnectorScheduler } from "./connectors/connector-scheduler";
export { createRetryHandler } from "./connectors/retry";
export { createDeadLetterQueue } from "./connectors/dead-letter";

// Evidence (Phase 7)
export { createEvidencePackager } from "./evidence/evidence-packager";

// Dashboard (Phase 5)
export { buildFilterClauses } from "./dashboard/filters";
export type { DashboardFilters, FilterResult } from "./dashboard/filters";
