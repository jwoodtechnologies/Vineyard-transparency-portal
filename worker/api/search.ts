import type { Env } from '../env';
import type { FacetBucket, MatchExplanation, SearchFacets, SearchFilters, SearchMatchMode, SearchResponse, SearchResult, SearchSort, SourceExcerpt, DocumentType } from '../../src/types/models';
import { CACHE, HttpError, json, badRequest } from '../lib/http';
import { DOCUMENT_TYPE_LABELS, DOCUMENT_TYPES, CATEGORY_DEFS, categoriesForType, normalizeType } from '../lib/taxonomy';
import { clampInt, isIsoDate, parseJsonArray } from '../lib/util';
import { parseQuery } from '../search/query';
import { SearchRepository, type ChunkHit } from '../search/SearchRepository';
import { summariesByIds, catalogFilterSql, ORDER_BY } from './documents';
import { toDocumentSummary, type Row } from '../lib/mappers';

/** Reads the shared filter vocabulary (type, category, year, from, to, body, source, meeting, currency). */
export function filtersFromUrl(url: URL): SearchFilters {
  const p = url.searchParams;
  const types = p.getAll('type').filter((t) => (DOCUMENT_TYPES as string[]).includes(t)) as DocumentType[];
  const cats = p.getAll('category').filter((c) => CATEGORY_DEFS.some((d) => d.id === c));
  const years = p.getAll('year').map(Number).filter((y) => Number.isInteger(y) && y > 1800 && y < 2200);
  const from = p.get('from');
  const to = p.get('to');
  if (from && !isIsoDate(from)) throw badRequest('`from` must be a YYYY-MM-DD date.');
  if (to && !isIsoDate(to)) throw badRequest('`to` must be a YYYY-MM-DD date.');
  const ids = (key: string) => p.getAll(key).filter((v) => /^[A-Za-z0-9_.:-]{1,128}$/.test(v));
  const currency = p.getAll('currency').filter((c) => ['current', 'historical', 'superseded', 'amended', 'unknown'].includes(c)) as SearchFilters['currency'];
  const meeting = p.get('meeting');
  return {
    ...(types.length ? { documentTypes: types } : {}),
    ...(cats.length ? { categories: cats as SearchFilters['categories'] } : {}),
    ...(years.length ? { years } : {}),
    ...(from ? { dateFrom: from } : {}),
    ...(to ? { dateTo: to } : {}),
    ...(ids('body').length ? { governmentBodyIds: ids('body') } : {}),
    ...(ids('source').length ? { sourceIds: ids('source') } : {}),
    ...(meeting && /^[A-Za-z0-9_.:-]{1,128}$/.test(meeting) ? { meetingId: meeting } : {}),
    ...(currency?.length ? { currency } : {}),
  };
}

const emptyFacets = (): SearchFacets => ({ documentTypes: [], years: [], governmentBodies: [], sources: [], categories: [] });

function bucket(counts: Map<string, number>, label: (v: string) => string, sortByValueDesc = false): FacetBucket[] {
  const list = [...counts.entries()].map(([value, count]) => ({ value, label: label(value), count }));
  return sortByValueDesc ? list.sort((a, b) => b.value.localeCompare(a.value)) : list.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

// Body and source names change only when ingestion adds one; keep them per isolate for 5 minutes.
let namesCache: { at: number; value: Promise<{ bodies: Map<string, string>; sources: Map<string, string> }> } | null = null;
function namesFor(env: Env): Promise<{ bodies: Map<string, string>; sources: Map<string, string> }> {
  if (namesCache && Date.now() - namesCache.at < 300_000) return namesCache.value;
  const value = loadNames(env);
  namesCache = { at: Date.now(), value };
  value.catch(() => (namesCache = null));
  return value;
}

async function loadNames(env: Env): Promise<{ bodies: Map<string, string>; sources: Map<string, string> }> {
  const [b, s] = await Promise.all([
    env.CATALOG_DB.prepare('SELECT id, name FROM government_bodies').all<{ id: string; name: string }>(),
    env.CATALOG_DB.prepare('SELECT id, name FROM sources').all<{ id: string; name: string }>(),
  ]);
  return { bodies: new Map((b.results ?? []).map((r) => [r.id, r.name])), sources: new Map((s.results ?? []).map((r) => [r.id, r.name])) };
}

export interface DocGroup {
  documentId: string;
  score: number;
  hits: ChunkHit[];
}

export function groupHits(hits: ChunkHit[], documentNumber: string | null): DocGroup[] {
  const groups = new Map<string, DocGroup>();
  const wantedNumber = documentNumber?.toLowerCase().replace(/\s+/g, ' ');
  for (const h of hits) {
    let g = groups.get(h.documentId);
    if (!g) {
      g = { documentId: h.documentId, score: h.score, hits: [] };
      if (wantedNumber && h.documentNumber && h.documentNumber.toLowerCase().replace(/\s+/g, ' ') === wantedNumber) g.score += 1000;
      groups.set(h.documentId, g);
    }
    // A few more matching chunks nudge a document up, with diminishing returns.
    if (g.hits.length) g.score += h.score * 0.1;
    g.hits.push(h);
  }
  return [...groups.values()].sort((a, b) => b.score - a.score);
}

const CANDIDATE_CHUNKS = 400;

export async function runSearch(
  env: Env,
  params: { q: string; filters: SearchFilters; match: SearchMatchMode; titleOnly: boolean; sort: SearchSort; page: number; pageSize: number },
): Promise<SearchResponse> {
  const started = Date.now();
  const parsed = parseQuery(params.q, { match: params.match, titleOnly: params.titleOnly });
  const repo = new SearchRepository(env);

  if (!parsed.fts) {
    // Empty query with filters: a filtered listing from the catalog.
    const { sql, params: p } = catalogFilterSql(params.filters);
    const order = ORDER_BY[params.sort === 'relevance' ? 'date_desc' : params.sort] ?? ORDER_BY.date_desc;
    const [rows, count] = await Promise.all([
      env.CATALOG_DB.prepare(`SELECT * FROM documents doc${sql} ORDER BY ${order} LIMIT ? OFFSET ?`).bind(...p, params.pageSize, (params.page - 1) * params.pageSize).all<Row>(),
      env.CATALOG_DB.prepare(`SELECT count(*) AS n FROM documents doc${sql}`).bind(...p).first<{ n: number }>(),
    ]);
    return {
      items: (rows.results ?? []).map((r) => ({ document: toDocumentSummary(r), score: 0, excerpts: [], matches: [{ field: 'metadata', terms: [], page: null }], meetingTitle: null })),
      page: params.page,
      pageSize: params.pageSize,
      total: Number(count?.n ?? 0),
      query: params.q,
      facets: emptyFacets(),
      tookMs: Date.now() - started,
      retrieval: ['metadata'],
      interpretation: parsed.interpretation,
    };
  }

  if (!repo.available) throw new HttpError(503, 'search_unavailable', 'The full-text index is not available right now.');

  // Candidates without snippets (cheap), then one parallel round for everything the page needs.
  const hits = await repo.searchChunks(parsed.fts, params.filters, CANDIDATE_CHUNKS, false, false);
  let groups = groupHits(hits, parsed.interpretation.documentNumber ?? null);

  if (params.sort !== 'relevance') {
    const cmp: Record<string, (a: ChunkHit, b: ChunkHit) => number> = {
      date_desc: (a, b) => (b.documentDate ?? '').localeCompare(a.documentDate ?? ''),
      date_asc: (a, b) => (a.documentDate ?? '9999').localeCompare(b.documentDate ?? '9999'),
      title: (a, b) => a.title.localeCompare(b.title),
    };
    const f = cmp[params.sort];
    if (f) groups = [...groups].sort((a, b) => f(a.hits[0], b.hits[0]));
  }

  const pageGroups = groups.slice((params.page - 1) * params.pageSize, params.page * params.pageSize);
  const pageIds = pageGroups.map((g) => g.documentId);
  const snippetRefs = pageGroups.flatMap((g) => g.hits.slice(0, 4).map((h) => ({ shard: h.shard, chunkId: h.chunkId })));
  const [snips, summaries, meetingRows, names, exact] = await Promise.all([
    repo.snippets(parsed.fts, snippetRefs),
    summariesByIds(env, pageIds),
    pageIds.length
      ? env.CATALOG_DB.prepare('SELECT d.id AS document_id, m.title, m.meeting_date FROM documents d JOIN meetings m ON m.id = d.meeting_id WHERE d.id IN (SELECT value FROM json_each(?))')
          .bind(JSON.stringify(pageIds))
          .all<{ document_id: string; title: string; meeting_date: string }>()
      : Promise.resolve({ results: [] as Array<{ document_id: string; title: string; meeting_date: string }> }),
    namesFor(env),
    hits.length >= CANDIDATE_CHUNKS ? repo.countDocuments(parsed.fts, params.filters) : Promise.resolve(groups.length),
  ]);
  for (const g of pageGroups)
    for (const h of g.hits) {
      const sn = snips.get(h.chunkId);
      if (sn) {
        h.excerpt = sn.text;
        h.highlights = sn.highlights;
      }
    }
  const total = groups.length;
  const totalIsEstimate = exact > groups.length;
  const meetingTitle = new Map((meetingRows.results ?? []).map((m) => [m.document_id, m.meeting_date ? `${m.title} (${m.meeting_date})` : m.title]));

  const items: SearchResult[] = [];
  for (const g of pageGroups) {
    const document = summaries.get(g.documentId);
    if (!document) continue; // shard row without catalog row (mid-ingest); skip rather than show a broken result
    const seenPages = new Set<string>();
    const excerpts: SourceExcerpt[] = [];
    for (const h of g.hits) {
      const k = `${h.pageStart}`;
      if (!h.excerpt || seenPages.has(k)) continue;
      seenPages.add(k);
      excerpts.push({ documentId: g.documentId, chunkId: h.chunkId, page: h.pageStart, sectionTitle: h.sectionTitle, text: h.excerpt, highlights: h.highlights });
      if (excerpts.length >= 3) break;
    }
    const titleLower = document.title.toLowerCase();
    const titleTerms = parsed.words.filter((w) => w.length > 1 && titleLower.includes(w));
    const matches: MatchExplanation[] = [];
    if (parsed.interpretation.documentNumber && document.documentNumber?.toLowerCase() === parsed.interpretation.documentNumber.toLowerCase())
      matches.push({ field: 'document_number', terms: [parsed.interpretation.documentNumber], page: null });
    if (titleTerms.length) matches.push({ field: 'title', terms: titleTerms, page: null });
    if (excerpts.some((e) => e.highlights.length)) matches.push({ field: 'full_text', terms: parsed.words, page: excerpts[0]?.page ?? null });
    if (!matches.length) matches.push({ field: 'full_text', terms: parsed.words, page: excerpts[0]?.page ?? null });
    items.push({ document, score: Math.round(g.score * 100) / 100, excerpts, matches, meetingTitle: meetingTitle.get(g.documentId) ?? null });
  }

  // Facets over the candidate set (exact unless totalIsEstimate).
  const types = new Map<string, number>();
  const years = new Map<string, number>();
  const bodies = new Map<string, number>();
  const sources = new Map<string, number>();
  const cats = new Map<string, number>();
  for (const g of groups) {
    const h = g.hits[0];
    const inc = (m: Map<string, number>, k: string | null) => k != null && k !== '' && m.set(k, (m.get(k) ?? 0) + 1);
    inc(types, h.documentType);
    inc(years, h.year == null ? null : String(h.year));
    inc(bodies, h.governmentBodyId);
    inc(sources, h.sourceId);
    const c = parseJsonArray<string>(h.categoriesJson);
    (c.length ? c : categoriesForType(normalizeType(h.documentType))).forEach((x) => inc(cats, x));
  }
  const catLabel = new Map(CATEGORY_DEFS.map((c) => [c.id as string, c.label]));

  return {
    items,
    page: params.page,
    pageSize: params.pageSize,
    total,
    ...(totalIsEstimate ? { totalIsEstimate: true } : {}),
    query: params.q,
    facets: {
      documentTypes: bucket(types, (v) => DOCUMENT_TYPE_LABELS[normalizeType(v)]),
      years: bucket(years, (v) => v, true),
      governmentBodies: bucket(bodies, (v) => names.bodies.get(v) ?? v),
      sources: bucket(sources, (v) => names.sources.get(v) ?? v),
      categories: bucket(cats, (v) => catLabel.get(v) ?? v),
    },
    tookMs: Date.now() - started,
    retrieval: ['full_text'],
    interpretation: parsed.interpretation,
  };
}

export async function handleSearch(env: Env, url: URL): Promise<Response> {
  const p = url.searchParams;
  const q = (p.get('q') ?? '').trim();
  if (q.length > 500) throw badRequest('Search text is limited to 500 characters.');
  const match = (['all', 'any', 'phrase'].includes(p.get('match') ?? '') ? p.get('match') : 'all') as SearchMatchMode;
  const sort = (['relevance', 'date_desc', 'date_asc', 'title'].includes(p.get('sort') ?? '') ? p.get('sort') : q ? 'relevance' : 'date_desc') as SearchSort;
  const body = await runSearch(env, {
    q,
    filters: filtersFromUrl(url),
    match,
    titleOnly: p.get('title') === '1',
    sort,
    page: clampInt(p.get('page'), 1, 1, 500),
    pageSize: clampInt(p.get('pageSize'), 20, 1, 100),
  });
  return json(body, { cache: CACHE.list });
}
