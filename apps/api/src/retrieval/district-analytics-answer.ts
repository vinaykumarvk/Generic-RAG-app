import type { QueryFn } from "@puda/api-core";
import type { JudgmentSearchFilters } from "./judgment-filters";
import type { JudgmentQueryPlan } from "./query-planner";

export interface DistrictAnalyticsAnswer {
  answer: string;
  totals: Record<string, number | null>;
  detailRows: Array<Record<string, unknown>>;
  intent: NonNullable<JudgmentQueryPlan["analyticsIntent"]>;
  filters: Record<string, unknown>;
  latencyMs: number;
}

interface SqlFilters {
  whereClause: string;
  params: unknown[];
  echo: Record<string, unknown>;
}

export async function answerDistrictAnalyticsQuestion(
  queryFn: QueryFn,
  workspaceId: string,
  question: string,
  filters: JudgmentSearchFilters | undefined,
  intent: JudgmentQueryPlan["analyticsIntent"] = "coverage",
): Promise<DistrictAnalyticsAnswer> {
  const start = Date.now();
  const sqlFilters = buildDistrictFactFilters(workspaceId, filters);
  const summary = await queryFn(
    `SELECT
       COALESCE(sum(metadata_case_count), 0)::int AS total_cases,
       COALESCE(sum(criminal_target_count), 0)::int AS criminal_targets,
       COALESCE(sum(text_available_count), 0)::int AS text_available,
       COALESCE(sum(ocr_required_count), 0)::int AS ocr_required,
       COALESCE(sum(translated_count), 0)::int AS translated,
       COALESCE(sum(redacted_count), 0)::int AS redacted,
       COALESCE(sum(rag_active_count), 0)::int AS rag_active,
       COALESCE(sum(fetch_failed_count), 0)::int AS fetch_failed,
       round(avg(avg_days_registration_to_decision))::int AS avg_delay_days,
       round(max(p95_days_registration_to_decision))::int AS p95_delay_days
     FROM district_case_fact_daily
     WHERE ${sqlFilters.whereClause}`,
    sqlFilters.params,
  );

  const normalizedIntent = intent || "coverage";
  const detailRows = await fetchDetailRows(queryFn, sqlFilters, normalizedIntent);
  const totals = normalizeTotals(summary.rows[0] || {});

  return {
    answer: buildAnswer(question, normalizedIntent, totals, detailRows, sqlFilters.echo),
    totals,
    detailRows,
    intent: normalizedIntent,
    filters: sqlFilters.echo,
    latencyMs: Date.now() - start,
  };
}

async function fetchDetailRows(
  queryFn: QueryFn,
  filters: SqlFilters,
  intent: NonNullable<JudgmentQueryPlan["analyticsIntent"]>,
): Promise<Array<Record<string, unknown>>> {
  if (intent === "source_performance") {
    const result = await queryFn(
      `SELECT
         COALESCE(NULLIF(source_name, ''), 'unknown') AS source_name,
         COALESCE(NULLIF(license_classification, ''), 'unknown') AS license_classification,
         commercial_safe,
         COALESCE(sum(metadata_case_count), 0)::int AS total_cases,
         COALESCE(sum(text_available_count), 0)::int AS text_available,
         COALESCE(sum(translated_count), 0)::int AS translated,
         COALESCE(sum(fetch_failed_count), 0)::int AS fetch_failed
       FROM district_case_fact_daily
       WHERE ${filters.whereClause}
       GROUP BY source_name, license_classification, commercial_safe
       ORDER BY total_cases DESC
       LIMIT 10`,
      filters.params,
    );
    return result.rows;
  }

  if (intent === "outcomes") {
    const result = await queryFn(
      `SELECT
         COALESCE(NULLIF(disposition, ''), 'unknown') AS disposition,
         COALESCE(sum(metadata_case_count), 0)::int AS total_cases,
         COALESCE(sum(criminal_target_count), 0)::int AS criminal_targets,
         COALESCE(sum(text_available_count), 0)::int AS text_available,
         round(avg(avg_days_registration_to_decision))::int AS avg_delay_days
       FROM district_case_fact_daily
       WHERE ${filters.whereClause}
       GROUP BY COALESCE(NULLIF(disposition, ''), 'unknown')
       ORDER BY total_cases DESC
       LIMIT 10`,
      filters.params,
    );
    return result.rows;
  }

  if (intent === "volume") {
    const result = await queryFn(
      `SELECT
         date_trunc('year', fact_date)::date AS year,
         state_code,
         district_code,
         court_level,
         COALESCE(sum(metadata_case_count), 0)::int AS total_cases,
         COALESCE(sum(criminal_target_count), 0)::int AS criminal_targets,
         COALESCE(sum(text_available_count), 0)::int AS text_available
       FROM district_case_fact_daily
       WHERE ${filters.whereClause}
       GROUP BY year, state_code, district_code, court_level
       ORDER BY year DESC, total_cases DESC
       LIMIT 12`,
      filters.params,
    );
    return result.rows;
  }

  const result = await queryFn(
    `SELECT
       state_code,
       district_code,
       court_level,
       language,
       source_name,
       COALESCE(sum(metadata_case_count), 0)::int AS total_cases,
       COALESCE(sum(criminal_target_count), 0)::int AS criminal_targets,
       COALESCE(sum(text_available_count), 0)::int AS text_available,
       COALESCE(sum(translated_count), 0)::int AS translated,
       COALESCE(sum(redacted_count), 0)::int AS redacted,
       COALESCE(sum(rag_active_count), 0)::int AS rag_active
     FROM district_case_fact_daily
     WHERE ${filters.whereClause}
     GROUP BY state_code, district_code, court_level, language, source_name
     ORDER BY total_cases DESC
     LIMIT 10`,
    filters.params,
  );
  return result.rows;
}

function buildDistrictFactFilters(workspaceId: string, filters?: JudgmentSearchFilters): SqlFilters {
  const params: unknown[] = [workspaceId];
  const where = ["workspace_id = $1"];
  const echo: Record<string, unknown> = {};

  appendDateFilter(where, params, echo, "date_from", filters?.decision_date_from || filters?.date_from, ">=");
  appendDateFilter(where, params, echo, "date_to", filters?.decision_date_to || filters?.date_to, "<=");
  appendNumberFilter(where, params, echo, "state_code", filters?.state_code);
  appendNumberFilter(where, params, echo, "district_code", filters?.district_code);
  appendTextFilter(where, params, echo, "court_level", filters?.court_level);
  appendTextFilter(where, params, echo, "statute", filters?.statute);
  appendTextFilter(where, params, echo, "section", filters?.section);
  appendTextFilter(where, params, echo, "offence_category", filters?.offence_category);
  appendTextFilter(where, params, echo, "disposition", filters?.disposition || filters?.outcome);
  appendTextFilter(where, params, echo, "language", filters?.language || filters?.source_language);
  appendTextFilter(where, params, echo, "source_name", filters?.source_name);

  if (String(filters?.commercial_safe).toLowerCase() !== "false") {
    where.push("commercial_safe = true");
    echo.commercial_safe = true;
  } else {
    echo.commercial_safe = false;
  }

  return { whereClause: where.join(" AND "), params, echo };
}

function appendDateFilter(
  where: string[],
  params: unknown[],
  echo: Record<string, unknown>,
  key: string,
  value: unknown,
  operator: ">=" | "<=",
) {
  if (!value) return;
  params.push(String(value));
  where.push(`fact_date ${operator} $${params.length}::date`);
  echo[key] = value;
}

function appendNumberFilter(
  where: string[],
  params: unknown[],
  echo: Record<string, unknown>,
  column: "state_code" | "district_code",
  value: unknown,
) {
  if (value === undefined || value === null || value === "") return;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return;
  params.push(parsed);
  where.push(`${column} = $${params.length}`);
  echo[column] = parsed;
}

function appendTextFilter(
  where: string[],
  params: unknown[],
  echo: Record<string, unknown>,
  column: string,
  value: unknown,
) {
  if (!value) return;
  params.push(String(value).toLowerCase());
  where.push(`LOWER(COALESCE(${column}, '')) = $${params.length}`);
  echo[column] = value;
}

function normalizeTotals(row: Record<string, unknown>): Record<string, number | null> {
  return {
    total_cases: numberValue(row.total_cases),
    criminal_targets: numberValue(row.criminal_targets),
    text_available: numberValue(row.text_available),
    ocr_required: numberValue(row.ocr_required),
    translated: numberValue(row.translated),
    redacted: numberValue(row.redacted),
    rag_active: numberValue(row.rag_active),
    fetch_failed: numberValue(row.fetch_failed),
    avg_delay_days: nullableNumber(row.avg_delay_days),
    p95_delay_days: nullableNumber(row.p95_delay_days),
  };
}

function numberValue(value: unknown): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildAnswer(
  question: string,
  intent: NonNullable<JudgmentQueryPlan["analyticsIntent"]>,
  totals: Record<string, number | null>,
  detailRows: Array<Record<string, unknown>>,
  filters: Record<string, unknown>,
): string {
  const heading = intentLabel(intent);
  const filterText = Object.keys(filters).length
    ? ` Filters applied: ${Object.entries(filters).map(([key, value]) => `${key}=${value}`).join(", ")}.`
    : "";
  const totalCases = Number(totals.total_cases || 0);
  const base = [
    `${heading}: ${totalCases.toLocaleString("en-IN")} district-court metadata cases match the current analytics slice.`,
    `Criminal targets: ${Number(totals.criminal_targets || 0).toLocaleString("en-IN")}. Text available: ${Number(totals.text_available || 0).toLocaleString("en-IN")}. Translated: ${Number(totals.translated || 0).toLocaleString("en-IN")}. RAG active: ${Number(totals.rag_active || 0).toLocaleString("en-IN")}.`,
  ];

  if (totalCases === 0) {
    base.push("No matching district metadata has been aggregated yet. Load DDL/eCourts metadata and run the district analytics refresh before using this answer for production counts.");
  } else if (detailRows.length > 0) {
    base.push(`Top breakdown: ${detailRows.slice(0, 5).map(formatDetailRow).join("; ")}.`);
  }

  base.push(`This answer was routed to district analytics because the question asks for metadata aggregates rather than source-text legal reasoning.${filterText}`);
  if (question.trim()) {
    base.push("For doctrinal or case-specific reasoning, ask a text question and the system will use the judgment retrieval path with citations.");
  }
  return base.join("\n\n");
}

function intentLabel(intent: NonNullable<JudgmentQueryPlan["analyticsIntent"]>): string {
  if (intent === "source_performance") return "District source performance";
  if (intent === "outcomes") return "District outcome analytics";
  if (intent === "volume") return "District case volume";
  return "District coverage analytics";
}

function formatDetailRow(row: Record<string, unknown>): string {
  const count = Number(row.total_cases || 0).toLocaleString("en-IN");
  if (row.source_name) return `${row.source_name} ${count}`;
  if (row.disposition) return `${row.disposition} ${count}`;
  if (row.year) return `${row.year} ${count}`;
  const parts = [row.state_code, row.district_code, row.court_level, row.language].filter((value) => value !== null && value !== undefined && value !== "");
  return `${parts.join("/") || "unknown"} ${count}`;
}
