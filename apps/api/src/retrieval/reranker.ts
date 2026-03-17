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
  score: number;
  sources: string[];
}

interface RerankerWeights {
  vectorWeight: number;
  lexicalWeight: number;
  graphWeight: number;
  metadataWeight: number;
}

export function rerank(
  vectorResults: Array<{ chunk_id: string; document_id: string; content: string; similarity: number; document_title: string; page_start: number | null; heading_path: string | null }>,
  lexicalResults: Array<{ chunk_id: string; document_id: string; content: string; rank: number; document_title: string; page_start: number | null }>,
  graphChunkIds: Set<string>,
  weights: RerankerWeights,
  maxChunks: number,
): RankedChunk[] {
  const chunkMap = new Map<string, RankedChunk>();

  // Normalize vector scores (already 0-1 cosine similarity)
  for (const r of vectorResults) {
    const existing = chunkMap.get(r.chunk_id);
    const vectorScore = r.similarity * weights.vectorWeight;
    if (existing) {
      existing.score += vectorScore;
      existing.sources.push("vector");
    } else {
      chunkMap.set(r.chunk_id, {
        chunk_id: r.chunk_id,
        document_id: r.document_id,
        content: r.content,
        document_title: r.document_title,
        page_start: r.page_start,
        heading_path: r.heading_path,
        score: vectorScore,
        sources: ["vector"],
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
    } else {
      chunkMap.set(r.chunk_id, {
        chunk_id: r.chunk_id,
        document_id: r.document_id,
        content: r.content,
        document_title: r.document_title,
        page_start: r.page_start,
        heading_path: null,
        score: lexicalScore,
        sources: ["lexical"],
      });
    }
  }

  // Graph boost: chunks referenced by graph entities get a boost
  for (const [chunkId, chunk] of chunkMap) {
    if (graphChunkIds.has(chunkId)) {
      chunk.score += weights.graphWeight;
      chunk.sources.push("graph");
    }
  }

  // Sort by score descending and take top N
  return Array.from(chunkMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, maxChunks);
}
