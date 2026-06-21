/**
 * Reranker — weighted merge of vector, lexical, graph, and metadata results.
 */

export interface RankedChunk {
  chunk_id: string;
  document_id: string;
  content: string;
  document_title: string;
  page_start: number | null;
  heading_path: string | null;
  case_reference?: string | null;
  fir_number?: string | null;
  station_code?: string | null;
  matched_case_scopes?: string[];
  scope_status?: "MATCH" | "UNKNOWN";
  chunk_metadata?: Record<string, unknown> | null;
  chunk_legal_metadata?: Record<string, unknown> | null;
  score: number;
  sources: string[];
  score_breakdown?: {
    vector: number;
    lexical: number;
    graph: number;
    metadata: number;
    wiki?: number;
    graph_path?: number;
  };
}

interface RerankerWeights {
  vectorWeight: number;
  lexicalWeight: number;
  graphWeight: number;
  metadataWeight: number;
}

export interface RerankerFusionOptions {
  wikiChunkIds?: Set<string>;
  graphPathChunkIds?: Set<string>;
  queryProfile?: string;
}

type SearchMetadataFields = {
  chunk_metadata?: Record<string, unknown> | null;
  chunk_legal_metadata?: Record<string, unknown> | null;
};

export function rerank(
  vectorResults: Array<{ chunk_id: string; document_id: string; content: string; similarity: number; document_title: string; page_start: number | null; heading_path: string | null; case_reference?: string | null; fir_number?: string | null; station_code?: string | null } & SearchMetadataFields>,
  lexicalResults: Array<{ chunk_id: string; document_id: string; content: string; rank: number; document_title: string; page_start: number | null; case_reference?: string | null; fir_number?: string | null; station_code?: string | null } & SearchMetadataFields>,
  graphChunkIds: Set<string>,
  weights: RerankerWeights,
  maxChunks: number,
  fusionOptions: RerankerFusionOptions = {},
): RankedChunk[] {
  const chunkMap = new Map<string, RankedChunk>();

  // Normalize vector scores (already 0-1 cosine similarity)
  for (const r of vectorResults) {
    const existing = chunkMap.get(r.chunk_id);
    const vectorScore = r.similarity * weights.vectorWeight;
    if (existing) {
      existing.score += vectorScore;
      existing.sources.push("vector");
      existing.chunk_metadata = existing.chunk_metadata ?? r.chunk_metadata ?? null;
      existing.chunk_legal_metadata = existing.chunk_legal_metadata ?? r.chunk_legal_metadata ?? null;
      existing.score_breakdown = existing.score_breakdown || { vector: 0, lexical: 0, graph: 0, metadata: 0 };
      existing.score_breakdown.vector += vectorScore;
    } else {
        chunkMap.set(r.chunk_id, {
          chunk_id: r.chunk_id,
          document_id: r.document_id,
          content: r.content,
        document_title: r.document_title,
        page_start: r.page_start,
        heading_path: r.heading_path,
        case_reference: r.case_reference ?? null,
        fir_number: r.fir_number ?? null,
          station_code: r.station_code ?? null,
          chunk_metadata: r.chunk_metadata ?? null,
          chunk_legal_metadata: r.chunk_legal_metadata ?? null,
          score: vectorScore,
          sources: ["vector"],
          score_breakdown: {
            vector: vectorScore,
            lexical: 0,
            graph: 0,
            metadata: 0,
            wiki: 0,
            graph_path: 0,
          },
        });
      }
    }

  // Normalize lexical scores (ts_rank can be >1, normalize to 0-1)
  const maxLexicalRank = Math.max(...lexicalResults.map((r) => r.rank), 0.001);
  for (const r of lexicalResults) {
    const normalizedRank = r.rank / maxLexicalRank;
    const lexicalScore = normalizedRank * weights.lexicalWeight;
    const existing = chunkMap.get(r.chunk_id);
    if (existing) {
      existing.score += lexicalScore;
      existing.sources.push("lexical");
      existing.chunk_metadata = existing.chunk_metadata ?? r.chunk_metadata ?? null;
      existing.chunk_legal_metadata = existing.chunk_legal_metadata ?? r.chunk_legal_metadata ?? null;
      existing.score_breakdown = existing.score_breakdown || { vector: 0, lexical: 0, graph: 0, metadata: 0 };
      existing.score_breakdown.lexical += lexicalScore;
    } else {
      chunkMap.set(r.chunk_id, {
        chunk_id: r.chunk_id,
        document_id: r.document_id,
        content: r.content,
        document_title: r.document_title,
        page_start: r.page_start,
        heading_path: null,
        case_reference: r.case_reference ?? null,
        fir_number: r.fir_number ?? null,
        station_code: r.station_code ?? null,
        chunk_metadata: r.chunk_metadata ?? null,
        chunk_legal_metadata: r.chunk_legal_metadata ?? null,
        score: lexicalScore,
        sources: ["lexical"],
        score_breakdown: {
          vector: 0,
          lexical: lexicalScore,
          graph: 0,
          metadata: 0,
          wiki: 0,
          graph_path: 0,
        },
      });
    }
  }

  // Graph boost: chunks referenced by graph entities get a boost
  const profileBoost = getProfileBoosts(fusionOptions.queryProfile);
  for (const [chunkId, chunk] of chunkMap) {
    if (graphChunkIds.has(chunkId)) {
      chunk.score += weights.graphWeight;
      chunk.sources.push("graph");
      chunk.score_breakdown = chunk.score_breakdown || { vector: 0, lexical: 0, graph: 0, metadata: 0 };
      chunk.score_breakdown.graph += weights.graphWeight;
    }
    if (fusionOptions.graphPathChunkIds?.has(chunkId)) {
      chunk.score += profileBoost.graphPath;
      chunk.sources.push("graph_path");
      chunk.score_breakdown = chunk.score_breakdown || { vector: 0, lexical: 0, graph: 0, metadata: 0 };
      chunk.score_breakdown.graph_path = (chunk.score_breakdown.graph_path || 0) + profileBoost.graphPath;
    }
    if (fusionOptions.wikiChunkIds?.has(chunkId)) {
      chunk.score += profileBoost.wiki;
      chunk.sources.push("wiki");
      chunk.score_breakdown = chunk.score_breakdown || { vector: 0, lexical: 0, graph: 0, metadata: 0 };
      chunk.score_breakdown.wiki = (chunk.score_breakdown.wiki || 0) + profileBoost.wiki;
    }
  }

  // Sort by score descending and take top N
  return Array.from(chunkMap.values())
    .map((chunk) => ({
      ...chunk,
      sources: Array.from(new Set(chunk.sources)),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxChunks);
}

function getProfileBoosts(queryProfile?: string): { wiki: number; graphPath: number } {
  switch (queryProfile) {
    case "doctrine":
      return { wiki: 0.18, graphPath: 0.12 };
    case "officer_lesson":
      return { wiki: 0.22, graphPath: 0.12 };
    case "precedent_trace":
      return { wiki: 0.12, graphPath: 0.2 };
    case "pattern_analysis":
      return { wiki: 0.12, graphPath: 0.16 };
    case "comparison":
      return { wiki: 0.1, graphPath: 0.14 };
    case "case_specific":
    default:
      return { wiki: 0.08, graphPath: 0.08 };
  }
}
