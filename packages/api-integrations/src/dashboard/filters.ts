export interface DashboardFilters {
  dateFrom?: string;
  dateTo?: string;
  dateColumn?: string;
  district?: string;
  districtColumn?: string;
  unit?: string;
  unitColumn?: string;
  category?: string;
  categoryColumn?: string;
  priority?: string;
  priorityColumn?: string;
  status?: string;
  statusColumn?: string;
}

export interface FilterResult {
  whereClause: string;
  params: any[];
  paramOffset: number;
}

const VALID_COLUMN_NAME = /^[a-z_][a-z0-9_]*$/i;

function safeColumn(col: string, fallback: string): string {
  return VALID_COLUMN_NAME.test(col) ? col : fallback;
}

/**
 * Builds parameterized SQL WHERE clauses from dashboard filter inputs.
 * Returns empty string if no filters are active.
 *
 * @param filters Filter values from query parameters
 * @param startParamIndex Starting $N index for parameterized queries (default: 1)
 */
export function buildFilterClauses(
  filters: DashboardFilters,
  startParamIndex = 1,
): FilterResult {
  const conditions: string[] = [];
  const params: any[] = [];
  let paramIdx = startParamIndex;

  if (filters.dateFrom) {
    const col = safeColumn(filters.dateColumn || "created_at", "created_at");
    conditions.push(`${col} >= $${paramIdx}`);
    params.push(filters.dateFrom);
    paramIdx++;
  }

  if (filters.dateTo) {
    const col = safeColumn(filters.dateColumn || "created_at", "created_at");
    conditions.push(`${col} < $${paramIdx}::date + interval '1 day'`);
    params.push(filters.dateTo);
    paramIdx++;
  }

  if (filters.district) {
    const col = safeColumn(filters.districtColumn || "district", "district");
    conditions.push(`${col} = $${paramIdx}`);
    params.push(filters.district);
    paramIdx++;
  }

  if (filters.unit) {
    const col = safeColumn(filters.unitColumn || "unit_id", "unit_id");
    conditions.push(`(${col} = $${paramIdx} OR ${col} IN (SELECT unit_id FROM organization_unit WHERE parent_unit_id = $${paramIdx}::uuid))`);
    params.push(filters.unit);
    paramIdx++;
  }

  if (filters.category) {
    const col = safeColumn(filters.categoryColumn || "category", "category");
    conditions.push(`${col} = $${paramIdx}`);
    params.push(filters.category);
    paramIdx++;
  }

  if (filters.priority) {
    const col = safeColumn(filters.priorityColumn || "priority", "priority");
    conditions.push(`${col} = $${paramIdx}`);
    params.push(filters.priority);
    paramIdx++;
  }

  if (filters.status) {
    const col = safeColumn(filters.statusColumn || "status", "status");
    conditions.push(`${col} = $${paramIdx}`);
    params.push(filters.status);
    paramIdx++;
  }

  const whereClause = conditions.length > 0
    ? "WHERE " + conditions.join(" AND ")
    : "";

  return { whereClause, params, paramOffset: paramIdx };
}
