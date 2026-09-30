/**
 * In-memory hybrid-style search over the DEMO database.
 *
 * Mirrors the production design at small scale: exact identifier matching, phrase matching,
 * BM25 full-text scoring over page chunks, metadata boosts (title/tags/entities), metadata
 * filtering, disjunctive facets, and per-result match explanations. In production this runs
 * server-side (SQLite FTS5 / PostgreSQL + a self-hosted vector index) — the browser never
 * downloads the archive.
 */
import type {
  DocumentChunk,
  Document,
  DocumentSummary,
  FacetBucket,
  MatchExplanation,
  SearchFacets,
  SearchFilters,
  SearchRequest,
  SearchResponse,
  SearchResult,
  SourceExcerpt,
} from '@/types/models';
import { CATEGORY_LABELS, DOCUMENT_TYPE_LABELS } from '@/lib/labels';
import { findHighlights, makeSnippet, normalizeIdentifier, parseQuery, tokenize, type ParsedQuery } from '@/lib/text';
import type { MockDatabase } from './db';

interface ChunkIndex {
  chunk: DocumentChunk;
  tf: Map<string, number>;
  length: number;
  lower: string;
}

interface DocIndex {
  doc: Document;
  titleStems: Set<string>;
  metaStems: Set<string>;
  allStems: Set<string>;
  identifier: string;
  titleLower: string;
  chunks: ChunkIndex[];
}

interface Index {
  docs: DocIndex[];
  df: Map<string, number>;
  chunkCount: number;
  avgLength: number;
}

const indexCache = new WeakMap<MockDatabase, Index>();

function buildIndex(db: MockDatabase): Index {
  const cached = indexCache.get(db);
  if (cached) return cached;
  const df = new Map<string, number>();
  let totalLength = 0;
  let chunkCount = 0;
  const chunksByDoc = new Map<string, DocumentChunk[]>();
  for (const c of db.chunks) {
    const list = chunksByDoc.get(c.documentId) ?? [];
    list.push(c);
    chunksByDoc.set(c.documentId, list);
  }
  const docs: DocIndex[] = db.documents.map((doc) => {
    const chunks: ChunkIndex[] = (chunksByDoc.get(doc.id) ?? []).map((chunk) => {
      const tf = new Map<string, number>();
      const tokens = tokenize(chunk.text);
      for (const t of tokens) tf.set(t.stem, (tf.get(t.stem) ?? 0) + 1);
      for (const s of tf.keys()) df.set(s, (df.get(s) ?? 0) + 1);
      totalLength += tokens.length;
      chunkCount++;
      return { chunk, tf, length: tokens.length, lower: chunk.text.toLowerCase() };
    });
    const titleStems = new Set(tokenize(doc.title).map((t) => t.stem));
    const metaText = [...doc.tags, ...doc.entities.map((e) => e.name), doc.governmentBodyName ?? '', DOCUMENT_TYPE_LABELS[doc.documentType]].join(' ');
    const metaStems = new Set(tokenize(metaText).map((t) => t.stem));
    const allStems = new Set<string>([...titleStems, ...metaStems]);
    for (const c of chunks) for (const s of c.tf.keys()) allStems.add(s);
    return {
      doc,
      titleStems,
      metaStems,
      allStems,
      identifier: doc.documentNumber ? normalizeIdentifier(doc.documentNumber) : '',
      titleLower: doc.title.toLowerCase(),
      chunks,
    };
  });
  const index = { docs, df, chunkCount, avgLength: chunkCount ? totalLength / chunkCount : 1 };
  indexCache.set(db, index);
  return index;
}

export function toSummary(doc: Document): DocumentSummary {
  return {
    id: doc.id,
    slug: doc.slug,
    title: doc.title,
    description: doc.description,
    documentType: doc.documentType,
    documentNumber: doc.documentNumber,
    date: doc.date,
    year: doc.year,
    governmentBodyId: doc.governmentBodyId,
    governmentBodyName: doc.governmentBodyName,
    meetingId: doc.meetingId,
    sourceId: doc.sourceId,
    pageCount: doc.pageCount,
    mimeType: doc.mimeType,
    fileSize: doc.fileSize,
    categories: doc.categories,
    currency: doc.currency,
    isDemo: doc.isDemo,
  };
}

/* ------------------------------------------------------------------ filters */

type FacetDim = 'documentTypes' | 'years' | 'governmentBodyIds' | 'sourceIds' | 'categories';

export function matchesFilters(doc: Document, f: SearchFilters | undefined, skip?: FacetDim): boolean {
  if (!f) return true;
  if (skip !== 'documentTypes' && f.documentTypes?.length && !f.documentTypes.includes(doc.documentType)) return false;
  if (skip !== 'categories' && f.categories?.length && !doc.categories.some((c) => f.categories!.includes(c))) return false;
  if (skip !== 'years' && f.years?.length && (doc.year == null || !f.years.includes(doc.year))) return false;
  if (skip !== 'governmentBodyIds' && f.governmentBodyIds?.length && (!doc.governmentBodyId || !f.governmentBodyIds.includes(doc.governmentBodyId)))
    return false;
  if (skip !== 'sourceIds' && f.sourceIds?.length && !f.sourceIds.includes(doc.sourceId)) return false;
  if (f.meetingId && doc.meetingId !== f.meetingId) return false;
  if (f.currency?.length && !f.currency.includes(doc.currency)) return false;
  if (f.dateFrom && (!doc.date || doc.date < f.dateFrom)) return false;
  if (f.dateTo && (!doc.date || doc.date > f.dateTo)) return false;
  return true;
}

/* ------------------------------------------------------------------ scoring */

export interface ChunkHit {
  doc: Document;
  chunk: DocumentChunk;
  score: number;
  matchedStems: string[];
}

interface DocScore {
  entry: DocIndex;
  score: number;
  chunkHits: Array<{ c: ChunkIndex; score: number; matched: string[] }>;
  matches: MatchExplanation[];
}

function bm25(index: Index, c: ChunkIndex, stems: string[]): { score: number; matched: string[] } {
  const k1 = 1.2;
  const b = 0.75;
  let score = 0;
  const matched: string[] = [];
  for (const s of stems) {
    const tf = c.tf.get(s);
    if (!tf) continue;
    matched.push(s);
    const df = index.df.get(s) ?? 0;
    const idf = Math.log(1 + (index.chunkCount - df + 0.5) / (df + 0.5));
    score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * c.length) / index.avgLength)));
  }
  return { score, matched };
}

function scoreDocument(index: Index, entry: DocIndex, q: ParsedQuery, req: SearchRequest): DocScore | null {
  const mode = req.match ?? 'all';
  const matches: MatchExplanation[] = [];
  let score = 0;

  // Exact identifier (document number) matching — critical for ordinance/resolution numbers.
  if (entry.identifier) {
    for (const id of q.identifiers) {
      const norm = normalizeIdentifier(id);
      if (norm.length < 4) continue;
      if (entry.identifier === norm) {
        score += 60;
        matches.push({ field: 'document_number', terms: [id], page: null, detail: 'Exact document number' });
      } else if (entry.identifier.endsWith(norm) || entry.identifier.includes(norm)) {
        score += 25;
        matches.push({ field: 'document_number', terms: [id], page: null, detail: 'Partial document number' });
      }
    }
  }

  // Phrases must be present (title or text).
  for (const phrase of q.phrases) {
    const lower = phrase.toLowerCase();
    const inTitle = entry.titleLower.includes(lower);
    const hitChunk = req.titleOnly ? undefined : entry.chunks.find((c) => c.lower.includes(lower));
    if (!inTitle && !hitChunk) return null;
    score += inTitle ? 8 : 5;
    matches.push({
      field: inTitle ? 'title' : 'full_text',
      terms: [phrase],
      page: hitChunk?.chunk.pageStart ?? null,
      detail: 'Exact phrase',
    });
  }

  const stems = q.stems;
  const identifierMatched = matches.some((m) => m.field === 'document_number');
  if (stems.length) {
    const present = stems.filter((s) => (req.titleOnly ? entry.titleStems.has(s) : entry.allStems.has(s)));
    if (mode === 'all' && present.length < stems.length && !identifierMatched) return null;
    if (present.length === 0 && !identifierMatched && q.phrases.length === 0) return null;

    const titleHits = q.terms.filter((_, i) => entry.titleStems.has(stems[i]));
    if (titleHits.length) {
      score += 3 * titleHits.length;
      matches.push({ field: 'title', terms: titleHits, page: null });
    }
    if (!req.titleOnly) {
      const metaHits = q.terms.filter((_, i) => entry.metaStems.has(stems[i]) && !entry.titleStems.has(stems[i]));
      if (metaHits.length) {
        score += 1.5 * metaHits.length;
        matches.push({ field: 'entity', terms: metaHits, page: null, detail: 'Tags, subjects, or organizations' });
      }
    }
  }

  const chunkHits: DocScore['chunkHits'] = [];
  if (!req.titleOnly && (stems.length || q.phrases.length)) {
    for (const c of entry.chunks) {
      const { score: s, matched } = bm25(index, c, stems);
      const phraseBonus = q.phrases.some((p) => c.lower.includes(p.toLowerCase())) ? 3 : 0;
      if (s + phraseBonus > 0) chunkHits.push({ c, score: s + phraseBonus, matched });
    }
    chunkHits.sort((a, b) => b.score - a.score);
    if (chunkHits.length) {
      score += chunkHits[0].score + 0.25 * chunkHits.slice(1, 4).reduce((sum, h) => sum + h.score, 0);
      const best = chunkHits[0];
      const termsMatched = q.terms.filter((_, i) => best.matched.includes(stems[i]));
      if (termsMatched.length)
        matches.push({ field: 'full_text', terms: termsMatched, page: best.c.chunk.pageStart, detail: best.c.chunk.sectionTitle ?? undefined });
    }
  }

  if (score <= 0) return null;
  return { entry, score, chunkHits, matches };
}

function excerptsFor(ds: DocScore, q: ParsedQuery, db: MockDatabase): SourceExcerpt[] {
  const picks = ds.chunkHits.slice(0, 2).map((h) => h.c.chunk);
  if (!picks.length) {
    const first = db.chunks.find((c) => c.documentId === ds.entry.doc.id);
    if (first) picks.push(first);
  }
  return picks.map((chunk) => {
    const hl = findHighlights(chunk.text, q.stems, q.phrases);
    const snip = makeSnippet(chunk.text, hl);
    return {
      documentId: chunk.documentId,
      chunkId: chunk.id,
      page: chunk.pageStart,
      sectionTitle: chunk.sectionTitle,
      text: snip.text,
      highlights: snip.highlights,
    };
  });
}

function bucket(counts: Map<string, number>, label: (v: string) => string, sortBy: 'count' | 'valueDesc' = 'count'): FacetBucket[] {
  const list = [...counts.entries()].map(([value, count]) => ({ value, label: label(value), count }));
  return sortBy === 'count'
    ? list.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    : list.sort((a, b) => b.value.localeCompare(a.value));
}

export function computeFacets(docs: Document[], filters: SearchFilters | undefined, db: MockDatabase): SearchFacets {
  const count = (dim: FacetDim, keys: (d: Document) => string[]) => {
    const m = new Map<string, number>();
    for (const d of docs) {
      if (!matchesFilters(d, filters, dim)) continue;
      for (const k of keys(d)) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };
  const bodyName = (id: string) => db.bodies.find((b) => b.id === id)?.name ?? id;
  const sourceName = (id: string) => db.registry.find((s) => s.id === id)?.name ?? id;
  return {
    documentTypes: bucket(count('documentTypes', (d) => [d.documentType]), (v) => DOCUMENT_TYPE_LABELS[v as Document['documentType']] ?? v),
    years: bucket(count('years', (d) => (d.year ? [String(d.year)] : [])), (v) => v, 'valueDesc'),
    governmentBodies: bucket(count('governmentBodyIds', (d) => (d.governmentBodyId ? [d.governmentBodyId] : [])), bodyName),
    sources: bucket(count('sourceIds', (d) => [d.sourceId]), sourceName),
    categories: bucket(count('categories', (d) => d.categories), (v) => CATEGORY_LABELS[v as keyof typeof CATEGORY_LABELS] ?? v),
  };
}

function compareDate(a: Document, b: Document): number {
  return (b.date ?? '').localeCompare(a.date ?? '');
}

export function runSearch(db: MockDatabase, req: SearchRequest): SearchResponse {
  const started = performance.now();
  const index = buildIndex(db);
  const q = parseQuery(req.query ?? '');
  const hasQuery = q.stems.length > 0 || q.phrases.length > 0 || q.identifiers.length > 0;
  const page = Math.max(1, req.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, req.pageSize ?? 10));

  let scored: DocScore[];
  if (hasQuery) {
    scored = index.docs.map((e) => scoreDocument(index, e, q, req)).filter((x): x is DocScore => x !== null);
  } else {
    scored = index.docs.map((entry) => ({ entry, score: 0, chunkHits: [], matches: [] }));
  }

  const facets = computeFacets(
    scored.map((s) => s.entry.doc),
    req.filters,
    db,
  );
  const filtered = scored.filter((s) => matchesFilters(s.entry.doc, req.filters));

  const sort = req.sort ?? (hasQuery ? 'relevance' : 'date_desc');
  filtered.sort((a, b) => {
    if (sort === 'date_desc') return compareDate(a.entry.doc, b.entry.doc);
    if (sort === 'date_asc') return -compareDate(a.entry.doc, b.entry.doc);
    if (sort === 'title') return a.entry.doc.title.localeCompare(b.entry.doc.title);
    return b.score - a.score || compareDate(a.entry.doc, b.entry.doc);
  });

  const slice = filtered.slice((page - 1) * pageSize, page * pageSize);
  const items: SearchResult[] = slice.map((s) => {
    const meeting = s.entry.doc.meetingId ? db.meetingsById.get(s.entry.doc.meetingId) : undefined;
    return {
      document: toSummary(s.entry.doc),
      score: Math.round(s.score * 100) / 100,
      excerpts: hasQuery ? excerptsFor(s, q, db) : [],
      matches: s.matches,
      meetingTitle: meeting ? `${meeting.title}` : null,
    };
  });

  const yearMatch = /\b(19|20)\d{2}\b/.exec(req.query ?? '');
  return {
    query: req.query,
    items,
    page,
    pageSize,
    total: filtered.length,
    facets,
    tookMs: Math.round(performance.now() - started),
    retrieval: hasQuery ? ['full_text', 'metadata'] : ['metadata'],
    interpretation: {
      documentNumber: q.identifiers[0] ?? null,
      phrases: q.phrases,
      terms: q.terms,
      detectedYear: yearMatch ? Number(yearMatch[0]) : null,
      detectedDocumentType: null,
    },
  };
}

/** Chunk-level ranking used by the demo Ask engine. */
export function rankChunks(db: MockDatabase, stems: string[], filters: SearchFilters | undefined, limit = 12): ChunkHit[] {
  const index = buildIndex(db);
  const hits: ChunkHit[] = [];
  for (const entry of index.docs) {
    if (!matchesFilters(entry.doc, filters)) continue;
    const titleBoost = stems.filter((s) => entry.titleStems.has(s) || entry.metaStems.has(s)).length * 0.6;
    for (const c of entry.chunks) {
      const { score, matched } = bm25(index, c, stems);
      if (score <= 0) continue;
      // Prefer authored source records over generated packets that repeat the same text.
      const packetPenalty = entry.doc.documentType === 'agenda_packet' ? 0.85 : 1;
      hits.push({ doc: entry.doc, chunk: c.chunk, score: (score + titleBoost) * packetPenalty, matchedStems: matched });
    }
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

export function documentFrequency(db: MockDatabase, stem: string): number {
  return buildIndex(db).df.get(stem) ?? 0;
}
