import type { LlmProvider, QueryFn } from "@puda/api-core";

export interface WikiSelectorDeps {
  queryFn: QueryFn;
  llmProvider?: LlmProvider;
}

export interface WikiSelectorFilters {
  court_code?: string;
  court_codes?: string[];
  court_level?: string;
  court_levels?: string[];
  statute?: string;
  statutes?: string[];
  section?: string;
  sections?: string[];
  issue_tags?: string[];
  outcome?: string;
  outcomes?: string[];
  policing_stage?: string;
  review_status?: "draft" | "pending_legal_review" | "approved" | "rejected" | "deprecated";
  include_unapproved?: boolean;
}

export interface WikiArticleResult {
  article_id: string;
  slug: string;
  title: string;
  summary: string | null;
  body: string;
  frontmatter: Record<string, unknown>;
  court_scope: string[];
  statutes: string[];
  sections: string[];
  issue_tags: string[];
  outcome_focus: string[];
  policing_stage: string | null;
  source_judgments: string[];
  source_chunk_ids: string[];
  corpus_scope: Record<string, unknown>;
  legal_validity_window: Record<string, unknown>;
  confidence: number;
  review_status: string;
  material_claim_count: number;
  cited_material_claim_count: number;
  citation_coverage: number;
  score: number;
}

function textArray(...values: Array<string | string[] | undefined>): string[] {
  return values.flatMap((value) => {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
  }).map((value) => value.trim()).filter(Boolean);
}

function lowerArray(...values: Array<string | string[] | undefined>): string[] {
  return textArray(...values).map((value) => value.toLowerCase());
}

function buildTsQuery(query: string): string {
  return query
    .split(/\s+/)
    .filter((word) => word.length > 1)
    .map((word) => word.replace(/[^\w]/g, ""))
    .filter(Boolean)
    .join(" | ");
}

function appendWikiFilters(filters: WikiSelectorFilters | undefined, params: unknown[]): string {
  let clause = "";
  const reviewStatus = filters?.review_status || (filters?.include_unapproved ? undefined : "approved");
  if (reviewStatus) {
    params.push(reviewStatus);
    clause += ` AND lwa.review_status = $${params.length}`;
  }

  const courts = lowerArray(filters?.court_code, filters?.court_codes);
  if (courts.length) {
    params.push(courts);
    clause += ` AND EXISTS (
      SELECT 1 FROM unnest(lwa.court_scope) court_scope
      WHERE LOWER(court_scope) = ANY($${params.length})
    )`;
  }

  const courtLevels = lowerArray(filters?.court_level, filters?.court_levels);
  if (courtLevels.length) {
    params.push(courtLevels);
    clause += ` AND (
      LOWER(COALESCE(lwa.corpus_scope->>'court_level', lwa.frontmatter->>'court_level', '')) = ANY($${params.length})
      OR EXISTS (
        SELECT 1 FROM unnest(lwa.court_scope) court_scope
        WHERE LOWER(court_scope) = ANY($${params.length})
      )
    )`;
  }

  const statutes = lowerArray(filters?.statute, filters?.statutes);
  if (statutes.length) {
    params.push(statutes);
    clause += ` AND EXISTS (
      SELECT 1 FROM unnest(lwa.statutes) statute
      WHERE LOWER(statute) = ANY($${params.length})
    )`;
  }

  const sections = lowerArray(filters?.section, filters?.sections);
  if (sections.length) {
    params.push(sections);
    clause += ` AND EXISTS (
      SELECT 1 FROM unnest(lwa.sections) section
      WHERE LOWER(section) = ANY($${params.length})
    )`;
  }

  if (filters?.issue_tags?.length) {
    params.push(filters.issue_tags.map((tag) => tag.toLowerCase()));
    clause += ` AND EXISTS (
      SELECT 1 FROM unnest(lwa.issue_tags) issue_tag
      WHERE LOWER(issue_tag) = ANY($${params.length})
    )`;
  }

  const outcomes = lowerArray(filters?.outcome, filters?.outcomes);
  if (outcomes.length) {
    params.push(outcomes);
    clause += ` AND EXISTS (
      SELECT 1 FROM unnest(lwa.outcome_focus) outcome_focus
      WHERE LOWER(outcome_focus) = ANY($${params.length})
    )`;
  }

  if (filters?.policing_stage) {
    params.push(filters.policing_stage.toLowerCase());
    clause += ` AND LOWER(COALESCE(lwa.policing_stage, '')) = $${params.length}`;
  }

  return clause;
}

async function getQueryVector(deps: WikiSelectorDeps, query: string): Promise<string | null> {
  if (!deps.llmProvider) return null;
  try {
    const embeddingResult = await deps.llmProvider.llmEmbed({ input: query });
    const embedding = embeddingResult?.embeddings?.[0];
    return embedding?.length ? `[${embedding.join(",")}]` : null;
  } catch {
    return null;
  }
}

export async function selectWikiArticles(
  deps: WikiSelectorDeps,
  workspaceId: string,
  query: string,
  maxResults = 5,
  filters?: WikiSelectorFilters,
): Promise<{ results: WikiArticleResult[]; latencyMs: number }> {
  const start = Date.now();
  const tsQuery = buildTsQuery(query);
  const queryVector = await getQueryVector(deps, query);

  const params: unknown[] = [workspaceId, maxResults];
  let searchClause = "";
  let scoreExpr = "0";

  if (queryVector) {
    params.push(queryVector);
    scoreExpr = "COALESCE(1 - (lwa.embedding <=> $" + params.length + "::vector), 0)";
    searchClause = " AND lwa.embedding IS NOT NULL";
  }

  if (tsQuery) {
    params.push(tsQuery);
    const tsParam = params.length;
    const lexicalScore = `ts_rank(lwa.fts_vector, to_tsquery('english', $${tsParam}))`;
    scoreExpr = queryVector ? `(${scoreExpr} * 0.65 + ${lexicalScore} * 0.35)` : lexicalScore;
    searchClause = queryVector
      ? ` AND (lwa.embedding IS NOT NULL OR lwa.fts_vector @@ to_tsquery('english', $${tsParam}))`
      : ` AND lwa.fts_vector @@ to_tsquery('english', $${tsParam})`;
  }

  const filterClause = appendWikiFilters(filters, params);

  const result = await deps.queryFn(
    `SELECT
       lwa.article_id,
       lwa.slug,
       lwa.title,
       lwa.summary,
       lwa.body,
       lwa.frontmatter,
       lwa.court_scope,
       lwa.statutes,
       lwa.sections,
       lwa.issue_tags,
       lwa.outcome_focus,
       lwa.policing_stage,
       lwa.source_judgments,
       lwa.source_chunk_ids,
       lwa.corpus_scope,
       lwa.legal_validity_window,
       lwa.confidence,
       lwa.review_status,
       (SELECT count(*)::int FROM legal_wiki_claim lwc
        WHERE lwc.article_id = lwa.article_id AND lwc.material = true) as material_claim_count,
       (SELECT count(*)::int FROM legal_wiki_claim lwc
        WHERE lwc.article_id = lwa.article_id
          AND lwc.material = true
          AND lwc.citation_status IN ('cited','verified')
          AND (lwc.source_chunk_id IS NOT NULL OR lwc.source_span != '{}'::jsonb)) as cited_material_claim_count,
       ${scoreExpr} as score
     FROM legal_wiki_article lwa
     WHERE lwa.workspace_id = $1
       ${searchClause}
       ${filterClause}
     ORDER BY score DESC, lwa.confidence DESC, lwa.updated_at DESC
     LIMIT $2`,
    params,
  );

  const results = (result.rows as Array<WikiArticleResult & {
    material_claim_count: number;
    cited_material_claim_count: number;
  }>).map((row) => {
    const material = Number(row.material_claim_count || 0);
    const cited = Number(row.cited_material_claim_count || 0);
    return {
      ...row,
      citation_coverage: material > 0 ? cited / material : 0,
    };
  });

  return { results, latencyMs: Date.now() - start };
}

export async function logWikiCoverageGap(
  queryFn: QueryFn,
  workspaceId: string,
  data: {
    queryText: string;
    queryProfile?: string;
    filters?: Record<string, unknown>;
    courtCode?: string;
    statute?: string;
    section?: string;
    issueTags?: string[];
    outcomeFocus?: string[];
    courtLevel?: string;
    rawEvidenceCount: number;
    approvedArticleCount: number;
  },
): Promise<void> {
  if (data.approvedArticleCount > 0 || data.rawEvidenceCount === 0) return;

  await queryFn(
    `INSERT INTO legal_wiki_coverage_gap (
       workspace_id, query_text, query_profile, filters, court_code, court_level, statute, section,
       issue_tags, outcome_focus, raw_evidence_count, approved_article_count
     )
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      workspaceId,
      data.queryText,
      data.queryProfile || null,
      JSON.stringify(data.filters || {}),
      data.courtCode || null,
      data.courtLevel || null,
      data.statute || null,
      data.section || null,
      data.issueTags || [],
      data.outcomeFocus || [],
      data.rawEvidenceCount,
      data.approvedArticleCount,
    ],
  );
}
