/**
 * Semantic index hook. No embedding provider is configured by default: the archive is fully
 * searchable with FTS5 alone, and the portal must work with zero paid services.
 *
 * Self-hostable options (see docs/INDEXING_ARCHITECTURE.md):
 *  - A sentence-transformers model (e.g. a small all-MiniLM / bge / e5 / nomic-embed class model)
 *    served locally (text-embeddings-inference, Ollama, llama.cpp server) behind an HTTP endpoint.
 *  - Vectors stored in sqlite-vec (same data/index.sqlite), pgvector (PostgreSQL), or LanceDB.
 * Each DocumentChunk.embeddingReference then stores "<provider>:<model>:<vector-row-id>".
 */

export interface EmbeddingProvider {
  readonly id: string;
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<Float32Array[]>;
}

/** Returns the configured provider, or null (semantic index disabled). */
export function getEmbeddingProvider(env: NodeJS.ProcessEnv = process.env): EmbeddingProvider | null {
  const configured = env.EMBEDDING_PROVIDER?.trim();
  if (!configured || configured === 'none') return null;
  throw new Error(
    `EMBEDDING_PROVIDER="${configured}" is not implemented yet. Implement EmbeddingProvider in scripts/lib/embeddings.ts ` +
      '(see docs/INDEXING_ARCHITECTURE.md) or unset EMBEDDING_PROVIDER to build the full-text index only.',
  );
}
