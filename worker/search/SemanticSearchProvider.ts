/**
 * SemanticSearchProvider: extension point for vector retrieval.
 *
 * Disabled in this phase on purpose: a chunk-level vector index for 20,000+ documents does not
 * fit the zero-cost constraint (see docs/SEARCH.md). Retrieval today is D1 FTS5 + metadata.
 * A future provider (e.g. Vectorize over document-level summaries) implements this interface and
 * its results are fused with full-text results by reciprocal rank fusion, without API changes.
 */
export interface SemanticHit {
  documentId: string;
  chunkId: string | null;
  score: number;
}

export interface SemanticSearchProvider {
  readonly enabled: boolean;
  search(query: string, limit: number): Promise<SemanticHit[]>;
}

export class DisabledSemanticSearchProvider implements SemanticSearchProvider {
  readonly enabled = false;
  async search(): Promise<SemanticHit[]> {
    return [];
  }
}

/** Reciprocal rank fusion, used when more than one retriever contributes. */
export function reciprocalRankFusion(lists: string[][], k = 60): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of lists) list.forEach((id, rank) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1)));
  return scores;
}
