/**
 * POST /api/ask: retrieval-augmented answers over the archive.
 *
 * The archive is the authority: the model only sees the top retrieved chunks, must cite them with
 * [n] markers, and every sentence it returns is checked. Sentences without a valid citation are
 * dropped (status becomes "partial"); an answer with no valid citations is not shown at all.
 * If Workers AI is missing, disabled, over the daily budget, or failing, the response is a
 * search-only result with the fixed notice below and the site keeps working.
 */
import type { Env } from '../env';
import { boolVar, intVar } from '../env';
import type { AskRequest, AskResponse, Citation, DocumentSummary, SearchFilters } from '../../src/types/models';
import { DEFAULT_AI_MODEL, NO_RESULTS_ANSWER, RAG_SYSTEM_PROMPT, SEARCH_ONLY_NOTICE, buildUserMessage, segmentAnswer, selectEvidence } from './answer';
import { badRequest, HttpError, readJson } from '../lib/http';
import { nowIso, randomId, utcDay } from '../lib/util';
import { parseQuery } from '../search/query';
import { SearchRepository } from '../search/SearchRepository';
import type { ChunkHit } from '../search/types';
import { runSearch } from '../api/search';
import { summariesByIds } from '../api/documents';
import { normalizeType } from '../lib/taxonomy';

// Per-isolate protection. Nothing here identifies a person or persists anywhere.
let breakerUntil = 0;
const buckets = new Map<string, { tokens: number; at: number }>();

function rateLimit(key: string, perMinute = 10): number | null {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: perMinute, at: now };
  b.tokens = Math.min(perMinute, b.tokens + ((now - b.at) / 60000) * perMinute);
  b.at = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    return Math.ceil(((1 - b.tokens) / perMinute) * 60);
  }
  b.tokens -= 1;
  buckets.set(key, b);
  if (buckets.size > 5000) buckets.clear();
  return null;
}

export function aiConfigured(env: Env): boolean {
  return Boolean(env.AI) && boolVar(env.AI_ENABLED, true);
}

export function aiBreakerOpen(): boolean {
  return Date.now() < breakerUntil;
}

function stripControl(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    out += (c < 32 && c !== 9 && c !== 10) || c === 127 ? ' ' : ch;
  }
  return out;
}

function validate(body: unknown): AskRequest {
  if (!body || typeof body !== 'object') throw badRequest('Request body must be an object.');
  const b = body as Record<string, unknown>;
  const question = typeof b.question === 'string' ? stripControl(b.question).trim() : '';
  if (question.length < 1 || question.length > 1000) throw badRequest('`question` must be 1 to 1000 characters.');
  const conversation = Array.isArray(b.conversation)
    ? b.conversation
        .filter((t): t is { role: 'user' | 'assistant'; content: string } => !!t && typeof t === 'object' && ['user', 'assistant'].includes((t as { role?: string }).role ?? '') && typeof (t as { content?: unknown }).content === 'string')
        .slice(-6)
        .map((t) => ({ role: t.role, content: t.content.slice(0, 2000) }))
    : [];
  const filters = b.filters && typeof b.filters === 'object' ? (b.filters as SearchFilters) : undefined;
  return { question, conversation, ...(filters ? { filters: sanitizeFilters(filters) } : {}) };
}

function sanitizeFilters(f: SearchFilters): SearchFilters {
  const ids = (xs: unknown) => (Array.isArray(xs) ? xs.filter((x): x is string => typeof x === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(x)).slice(0, 20) : undefined);
  const date = (d: unknown) => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined);
  return {
    documentTypes: ids(f.documentTypes)?.map(normalizeType),
    categories: ids(f.categories) as SearchFilters['categories'],
    years: Array.isArray(f.years) ? f.years.map(Number).filter((y) => Number.isInteger(y)).slice(0, 20) : undefined,
    dateFrom: date(f.dateFrom),
    dateTo: date(f.dateTo),
    governmentBodyIds: ids(f.governmentBodyIds),
    sourceIds: ids(f.sourceIds),
    meetingId: typeof f.meetingId === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(f.meetingId) ? f.meetingId : undefined,
  };
}

function excerptFor(h: ChunkHit, words: string[]): Citation['excerpt'] {
  const text = h.text ?? h.excerpt;
  const lower = text.toLowerCase();
  let at = -1;
  for (const w of words) {
    if (w.length < 3) continue;
    const i = lower.indexOf(w);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  const start = Math.max(0, at < 0 ? 0 : at - 160);
  let snippet = text.slice(start, start + 480);
  if (start > 0) snippet = `…${snippet}`;
  if (start + 480 < text.length) snippet = `${snippet}…`;
  const highlights: Array<[number, number]> = [];
  const sl = snippet.toLowerCase();
  for (const w of words) {
    if (w.length < 3) continue;
    let i = sl.indexOf(w);
    while (i >= 0 && highlights.length < 20) {
      highlights.push([i, i + w.length]);
      i = sl.indexOf(w, i + w.length);
    }
  }
  highlights.sort((a, b) => a[0] - b[0]);
  return { documentId: h.documentId, chunkId: h.chunkId, page: h.pageStart, sectionTitle: h.sectionTitle, text: snippet, highlights };
}

async function bumpQuota(env: Env, field: 'ai_requests' | 'ai_failures'): Promise<void> {
  await env.CATALOG_DB.prepare(
    `INSERT INTO quota_usage (day, ${field}, updated_at) VALUES (?, 1, ?) ON CONFLICT(day) DO UPDATE SET ${field} = ${field} + 1, updated_at = excluded.updated_at`,
  )
    .bind(utcDay(), nowIso())
    .run();
}

async function aiBudgetLeft(env: Env): Promise<boolean> {
  const row = await env.CATALOG_DB.prepare('SELECT ai_requests FROM quota_usage WHERE day = ?').bind(utcDay()).first<{ ai_requests: number }>();
  return Number(row?.ai_requests ?? 0) < intVar(env.AI_MAX_REQUESTS_PER_DAY, 250);
}

async function callModel(env: Env, messages: Array<{ role: string; content: string }>): Promise<string> {
  const model = env.AI_MODEL || DEFAULT_AI_MODEL;
  const run = (env.AI as unknown as { run: (m: string, i: unknown) => Promise<unknown> }).run(model, { messages, max_tokens: 600, temperature: 0.1 });
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('AI timeout')), 25000));
  const out = (await Promise.race([run, timeout])) as { response?: unknown } | string;
  const text = typeof out === 'string' ? out : typeof out?.response === 'string' ? out.response : '';
  if (!text.trim()) throw new Error('Empty AI response');
  return text;
}

export async function handleAsk(env: Env, request: Request): Promise<Response> {
  const body = validate(await readJson<unknown>(request, 32 * 1024));
  const clientKey = request.headers.get('cf-connecting-ip') ?? 'anon';
  const retry = rateLimit(clientKey);
  if (retry != null) throw new HttpError(429, 'rate_limited', 'Too many questions. Try again shortly.', retry);

  const repo = new SearchRepository(env);
  const id = randomId('ask');
  const base = { id, question: body.question, relatedDocuments: [] as DocumentSummary[], suggestedFollowUps: [] as string[], generatedAt: nowIso() };
  const filters = body.filters ?? {};

  const history = (body.conversation ?? []).filter((t) => t.role === 'user').map((t) => t.content).slice(-2);
  const retrievalText = body.question.split(/\s+/).length < 6 && history.length ? `${body.question} ${history[history.length - 1]}` : body.question;

  const fallback = async (status: 'search_only' | 'no_results', notice: string | null): Promise<AskResponse> => {
    const search = await runSearch(env, { q: retrievalText, filters, match: 'any', titleOnly: false, sort: 'relevance', page: 1, pageSize: 10 });
    return {
      ...base,
      retrievalStatus: status,
      answer: status === 'no_results' ? NO_RESULTS_ANSWER : SEARCH_ONLY_NOTICE,
      paragraphs: status === 'no_results' ? [{ segments: [{ text: NO_RESULTS_ANSWER, citations: [] }] }] : [],
      citations: [],
      searchResults: search.items,
      notice,
      engine: 'search-fallback',
    };
  };

  if (!repo.available) throw new HttpError(503, 'search_unavailable', 'The full-text index is not available right now.');

  const strict = parseQuery(retrievalText, { match: 'all' });
  const loose = parseQuery(retrievalText, { match: 'any' });
  if (!loose.fts) return respond(await fallback('no_results', null));

  let hits: ChunkHit[] = strict.fts ? await repo.searchChunks(strict.fts, filters, 40, true) : [];
  if (hits.length < 8) {
    const more = await repo.searchChunks(loose.fts, filters, 40, true);
    const seen = new Set(hits.map((h) => h.chunkId));
    hits = [...hits, ...more.filter((h) => !seen.has(h.chunkId))];
  }
  if (!hits.length) return respond(await fallback('no_results', null));

  if (!aiConfigured(env) || aiBreakerOpen() || !(await aiBudgetLeft(env))) return respond(await fallback('search_only', SEARCH_ONLY_NOTICE));

  const evidence = selectEvidence(hits);
  let raw: string;
  try {
    await bumpQuota(env, 'ai_requests');
    raw = await callModel(env, [
      { role: 'system', content: RAG_SYSTEM_PROMPT },
      { role: 'user', content: buildUserMessage(body.question, evidence, history) },
    ]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Quota / capacity / auth errors open the breaker so we stop spending requests for a while.
    breakerUntil = Date.now() + (/4006|quota|limit|429|capacity|403|neuron/i.test(msg) ? 30 * 60_000 : 5 * 60_000);
    await bumpQuota(env, 'ai_failures').catch(() => undefined);
    return respond(await fallback('search_only', SEARCH_ONLY_NOTICE));
  }

  const seg = segmentAnswer(raw, evidence.length);
  if (!seg.used.size) return respond(await fallback('no_results', null));

  // Renumber cited sources 1..k in order of first use.
  const order = [...seg.used].sort((a, b) => a - b);
  const renumber = new Map(order.map((old, i) => [old, i + 1]));
  const paragraphs = seg.paragraphs.map((p) => ({ segments: p.segments.map((s) => ({ text: s.text, citations: s.citations.map((c) => renumber.get(c) ?? c) })) }));
  if (seg.dropped) paragraphs.push({ segments: [{ text: 'Some parts of this question could not be verified from the indexed records.', citations: [] }] });

  const cited = order.map((old) => evidence[old - 1]);
  const docs = await summariesByIds(env, [...new Set(hits.map((h) => h.documentId))].slice(0, 30));
  const rows = await env.CATALOG_DB.prepare(
    `SELECT d.id, d.original_url, d.archive_status, d.archive_key, m.title AS meeting_title, a.number AS agenda_number FROM documents d
     LEFT JOIN meetings m ON m.id = d.meeting_id LEFT JOIN agenda_items a ON a.id = d.agenda_item_id WHERE d.id IN (SELECT value FROM json_each(?))`,
  )
    .bind(JSON.stringify([...new Set(cited.map((c) => c.documentId))]))
    .all<Record<string, unknown>>();
  const extra = new Map((rows.results ?? []).map((r) => [String(r.id), r]));

  const citations: Citation[] = cited.map((h, i) => {
    const d = docs.get(h.documentId);
    const x = extra.get(h.documentId) ?? {};
    return {
      index: i + 1,
      documentId: h.documentId,
      documentTitle: d?.title ?? h.title,
      documentType: normalizeType(d?.documentType ?? h.documentType),
      documentNumber: d?.documentNumber ?? h.documentNumber,
      date: d?.date ?? h.documentDate,
      governmentBodyName: d?.governmentBodyName ?? null,
      meetingId: d?.meetingId ?? null,
      meetingTitle: x.meeting_title == null ? null : String(x.meeting_title),
      agendaItem: x.agenda_number == null ? null : String(x.agenda_number),
      page: h.pageStart,
      sectionTitle: h.sectionTitle,
      excerpt: excerptFor(h, loose.words),
      archiveUrl: x.archive_status === 'archived' && x.archive_key ? `/api/documents/${h.documentId}/file` : null,
      originalUrl: x.original_url == null ? null : String(x.original_url),
    };
  });

  const citedDocs = new Set(cited.map((c) => c.documentId));
  const relatedDocuments = [...docs.values()].filter((d) => !citedDocs.has(d.id)).slice(0, 5);
  const partial = seg.dropped > 0 || seg.insufficient;
  const answer = paragraphs.map((p) => p.segments.map((s) => `${s.text}${s.citations.length ? ` ${s.citations.map((c) => `[${c}]`).join('')}` : ''}`).join(' ')).join('\n\n');

  const response: AskResponse = {
    ...base,
    retrievalStatus: partial ? 'partial' : 'grounded',
    answer,
    paragraphs,
    citations,
    relatedDocuments,
    notice: partial ? 'Parts of this answer could not be verified and were left out.' : null,
    engine: env.AI_MODEL || DEFAULT_AI_MODEL,
  };
  if (partial) response.searchResults = (await runSearch(env, { q: retrievalText, filters, match: 'any', titleOnly: false, sort: 'relevance', page: 1, pageSize: 10 })).items;
  return respond(response);
}

function respond(body: AskResponse): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
}

export { SEARCH_ONLY_NOTICE, NO_RESULTS_ANSWER, DEFAULT_AI_MODEL, RAG_SYSTEM_PROMPT };
