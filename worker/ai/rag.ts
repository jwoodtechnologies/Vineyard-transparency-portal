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
import { ensurePeopleTable } from '../api/people';
import { DEFAULT_AI_MODEL, FALLBACK_AI_MODEL, aiText, attributeCitations, groundParagraphs, NO_RESULTS_ANSWER, RAG_SYSTEM_PROMPT, SEARCH_ONLY_NOTICE, SMALL_TALK_REPLIES, MAX_ANSWER_SENTENCES, briefAnswer, buildUserMessage, finishedSentences, segmentAnswer, selectEvidence, smallTalkKind } from './answer';
import { badRequest, HttpError, readJson } from '../lib/http';
import { nowIso, randomId, utcDay } from '../lib/util';
import { parseQuery } from '../search/query';
import { SearchRepository } from '../search/SearchRepository';
import type { ChunkHit } from '../search/types';
import { summariesByIds } from '../api/documents';
import { normalizeType } from '../lib/taxonomy';
import { readAiStream } from './sse';
import { interleave, planSearch, recencyWeighted, relevant, rerank, type SearchPlan } from './retrieval';
import { countAnswer, countQuestion, isRemainingQuestion, isScheduleQuestion, remainingAnswer, scheduleAnswer } from './schedule';

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
  return { question, conversation, ...(filters ? { filters: sanitizeFilters(filters) } : {}), ...(b.debug === true ? { debug: true } : {}) } as AskRequest;
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

/** Answers used today, or null when the daily allowance is spent. */
async function aiBudgetLeft(env: Env): Promise<number | null> {
  const row = await env.CATALOG_DB.prepare('SELECT ai_requests FROM quota_usage WHERE day = ?').bind(utcDay()).first<{ ai_requests: number }>();
  const used = Number(row?.ai_requests ?? 0);
  return used < intVar(env.AI_MAX_REQUESTS_PER_DAY, 120) ? used : null;
}

type Msg = { role: string; content: string };
type AiRunner = { run: (model: string, input: unknown) => Promise<unknown> };
const MAX_TOKENS = 400;
const AI_TIMEOUT_MS = 25_000;
/**
 * The larger model costs about 200 Neurons an answer, so it answers the first 35 questions of the
 * day (about 7,000 of the 10,000 free daily Neurons) and the small model answers the rest.
 */
const BIG_MODEL_PER_DAY = 35;

async function runOnce(env: Env, model: string, messages: Msg[], maxTokens: number, temperature: number): Promise<string> {
  const big = model.includes('gpt-oss');
  const qwen = model.includes('qwen');
  // Qwen 3 thinks out loud unless told not to; answers here need no visible reasoning.
  const msgs = qwen ? messages.map((m, i) => (i === 0 && m.role === 'system' ? { ...m, content: `${m.content}\n/no_think` } : m)) : messages;
  const input = big ? { messages, max_tokens: 1800, reasoning: { effort: 'low' } } : qwen ? { messages: msgs, max_tokens: 900, temperature: 0.2 } : { messages, max_tokens: maxTokens, temperature };
  const run = (env.AI as unknown as AiRunner).run(model, input);
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('AI timeout')), AI_TIMEOUT_MS));
  const text = aiText(await Promise.race([run, timeout]))
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<think>[\s\S]*$/, '')
    .trim();
  if (!text) throw new Error('Empty AI response');
  return text;
}

/** Tries the larger model first (while today's share lasts), then the small one. */
async function callModel(env: Env, messages: Msg[], opts: { maxTokens?: number; temperature?: number; useBig?: boolean } = {}): Promise<{ text: string; engine: string }> {
  const primary = env.AI_MODEL && env.AI_MODEL !== FALLBACK_AI_MODEL ? env.AI_MODEL : DEFAULT_AI_MODEL;
  const models = opts.useBig === false ? [FALLBACK_AI_MODEL] : [primary, FALLBACK_AI_MODEL];
  let last: unknown = null;
  for (const [i, model] of models.entries()) {
    try {
      const text = await runOnce(env, model, messages, opts.maxTokens ?? MAX_TOKENS, opts.temperature ?? 0.1);
      const note = i > 0 && last ? ` (after ${String(last instanceof Error ? last.message : last).slice(0, 120)})` : '';
      return { text, engine: model + note };
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

/** Small-model streaming (server-sent events: `data: {"response":"..."}` ... `data: [DONE]`). */
async function streamSmall(env: Env, messages: Msg[], onDelta: (text: string) => Promise<void>): Promise<string> {
  const out = await (env.AI as unknown as AiRunner).run(FALLBACK_AI_MODEL, { messages, max_tokens: MAX_TOKENS, temperature: 0.1, stream: true });
  let sofar = '';
  const forward = async (piece: string) => {
    sofar += piece;
    await onDelta(piece);
    // Stop once the answer is long enough; the final answer is trimmed to the same length.
    return finishedSentences(sofar) < MAX_ANSWER_SENTENCES;
  };
  if (out instanceof ReadableStream) return readAiStream(out as ReadableStream<Uint8Array>, forward, Date.now() + AI_TIMEOUT_MS);
  const text = aiText(out);
  if (text) await onDelta(text);
  return text;
}

const RECENT = /\b(most recent|latest|last|recent|previous|past|upcoming|next|this week'?s|tonight'?s|today'?s)\b/i;
const MEETINGISH = /\b(meetings?|council|commission|agenda|minutes|session|hearing)\b/i;
const FILLER = /\b(most recent|latest|last|recent|previous|past|upcoming|next|this week'?s|tonight'?s|today'?s|what|whats|what's|happened|happen|happening|at|the|in|on|was|were|did|do|does|will|be|discussed|discuss|meetings?|city|council|commission|planning|agenda|minutes|session|vineyard|of|about|is|are|for|tell|me|summarize|summary|a|an)\b/gi;

/** The meeting a "last / next meeting" question is about, with the search terms left over. */
async function meetingFocus(env: Env, q: string): Promise<{ id: string; title: string; date: string | null; terms: string; minutesOnly: boolean } | null> {
  if (!RECENT.test(q) || !MEETINGISH.test(q)) return null;
  const next = /\b(upcoming|next|tonight|today|this week)\b/i.test(q);
  // What happened / was decided comes from minutes; packets reprint the previous meeting's minutes.
  const outcome = !next && /\b(happen|happened|decide|decided|decision|vote|voted|votes|approve|approved|adopt|adopted|pass|passed|deny|denied|action|actions|outcome|result)\w*\b/i.test(q);
  const body = /planning commission/i.test(q) ? '%Planning%' : /\bRDA\b|redevelopment/i.test(q) ? '%Redevelopment%' : /\barch|architect/i.test(q) ? '%ARCH%' : '%Council%';
  const today = new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10); // Utah
  const row = await env.CATALOG_DB.prepare(
    `SELECT m.id, m.title, m.meeting_date FROM meetings m
     WHERE coalesce(m.government_body_name, m.title) LIKE ? AND m.meeting_date ${next ? '>=' : '<='} ?
       AND EXISTS (SELECT 1 FROM documents d WHERE d.meeting_id = m.id${outcome ? " AND d.document_type = 'minutes'" : ''})
     ORDER BY m.meeting_date ${next ? 'ASC' : 'DESC'} LIMIT 1`,
  )
    .bind(body, today)
    .first<{ id: string; title: string; meeting_date: string | null }>();
  if (!row) return null;
  const rest = q.replace(/[?.!,]/g, ' ').replace(FILLER, ' ').replace(/\s+/g, ' ').trim();
  return { id: row.id, title: row.title, date: row.meeting_date, minutesOnly: outcome, terms: rest.length >= 3 ? rest : 'approve approved motion ordinance resolution item public hearing presentation' };
}

const CURRENT = /\b(who is|who's|who are|current|currently|now|today|as of|latest|presently|still|this year|right now)\b/i;
const ROLE = /\b(mayor|deputy mayor|council ?(member|man|woman)s?|city council|city manager|recorder|city attorney|director|department head|staff|employees?|who works|chief|official|commissioners?)\b/i;
const RULE = /\b(can i|can we|can you|am i allowed|is it (legal|allowed|permitted)|allowed|permitted|prohibited|illegal|rules?|regulations?|required|requirements?|do i need|need a permit|code says|setbacks?|how (many|tall|high|far))\b/i;
const VOTE = /\b(vote[sd]?|voting|motion|moved|second(ed)?|position|stance|support(ed)?|oppose[sd]?|against|for or against|aye|nay)\b/i;

let peopleCache: { at: number; list: Array<{ name: string; last: string; role: string }> } | null = null;
/** A current official or staff member named in the question (full name, or title + last name). */
async function personIn(env: Env, q: string): Promise<{ name: string; last: string; role: string } | null> {
  if (!peopleCache || Date.now() - peopleCache.at > 10 * 60_000) {
    await ensurePeopleTable(env);
    const res = await env.CATALOG_DB.prepare("SELECT name, role FROM people WHERE current = 1 ORDER BY CASE kind WHEN 'elected' THEN 0 ELSE 1 END").all<{ name: string; role: string }>();
    peopleCache = { at: Date.now(), list: (res.results ?? []).map((r) => ({ name: r.name, role: r.role, last: r.name.split(/\s+/).pop() ?? r.name })) };
  }
  const text = ` ${q.toLowerCase()} `;
  return (
    peopleCache.list.find((p) => text.includes(` ${p.name.toLowerCase()} `) || text.includes(` ${p.name.toLowerCase()}'`)) ??
    peopleCache.list.find((p) => new RegExp(`\\b(mayor|council ?(member|man|woman)|councilor)\\s+${p.last.toLowerCase()}\\b`).test(text)) ??
    null
  );
}

const PRONOUN = /\b(it|its|that|this|those|these|they|them|their|he|she|his|her|there|same|more|else)\b/i;

/** "What about that one?" refers back; "Is David Kyle Herring the deputy mayor?" does not. */
export function isFollowUp(q: string): boolean {
  const words = q.trim().split(/\s+/);
  if (words.length > 9) return false;
  if (/[A-Z][a-z]+\s+[A-Z][a-z]+/.test(q) || /\b\d{3,4}\b/.test(q)) return false;
  return PRONOUN.test(q) || /^(and|also|what about|how about)\b/i.test(q.trim());
}

type Prepared =
  | { kind: 'final'; response: AskResponse }
  | { kind: 'model'; messages: Msg[]; useBig: boolean; finish: (raw: string, engine?: string) => Promise<AskResponse>; fail: (e: unknown) => Promise<AskResponse> };

/**
 * Everything up to the model call, with independent reads run in parallel. Returns either a final
 * response (small talk, no results, AI unavailable) or what is needed to call the model and finish.
 */
async function prepare(env: Env, body: AskRequest): Promise<Prepared> {
  const repo = new SearchRepository(env);
  const id = randomId('ask');
  const base = { id, question: body.question, relatedDocuments: [] as DocumentSummary[], suggestedFollowUps: [] as string[], generatedAt: nowIso() };
  const filters = body.filters ?? {};

  const history = (body.conversation ?? []).filter((t) => t.role === 'user').map((t) => t.content).slice(-2);
  // Only a real follow-up ("what about that one?") borrows the previous question; a short question
  // that names someone or something stands on its own.
  const retrievalText = isFollowUp(body.question) && history.length ? `${body.question} ${history[history.length - 1]}` : body.question;

  const fallback = async (status: 'search_only' | 'no_results', notice: string | null): Promise<AskResponse> => ({
    ...base,
    retrievalStatus: status,
    answer: status === 'no_results' ? NO_RESULTS_ANSWER : SEARCH_ONLY_NOTICE,
    paragraphs: status === 'no_results' ? [{ segments: [{ text: NO_RESULTS_ANSWER, citations: [] }] }] : [],
    citations: [],
    // The client runs its own record search alongside every question, so no second search here.
    searchResults: [],
    notice,
    engine: 'search-fallback',
  });

  // Conversation, not a records question: an instant, friendly reply that never states facts.
  const kind = smallTalkKind(body.question);
  if (kind) {
    const text = SMALL_TALK_REPLIES[kind];
    // A short, natural pause so a greeting does not snap back before the question is even read.
    await new Promise((r) => setTimeout(r, 650));
    return { kind: 'final', response: { ...base, retrievalStatus: 'grounded', answer: text, paragraphs: [{ segments: [{ text, citations: [] }] }], citations: [], notice: null, engine: 'assistant', mode: 'conversation' } as AskResponse };
  }

  // Knowledge-base questions answered straight from the calendar and the catalog: exact and free.
  const quick = (text: string, event?: unknown, followUps: string[] = []) =>
    ({
      kind: 'final',
      response: { ...base, retrievalStatus: 'grounded', answer: text, paragraphs: [{ segments: [{ text, citations: [] }] }], citations: [], suggestedFollowUps: followUps, notice: null, engine: 'catalog', mode: 'conversation', ...(event ? { event } : {}) } as AskResponse,
    }) as Prepared;
  if (isRemainingQuestion(body.question)) {
    const r = await remainingAnswer(body.question).catch(() => null);
    if (r) return quick(r.text, r.event, ["What's on the agenda for the next City Council meeting?"]);
  }
  const count = countQuestion(body.question);
  if (count) {
    const t = await countAnswer(env, count, body.question).catch(() => null);
    if (t) return quick(t);
  }
  // "When is the next council meeting?": the official calendar answers, never old minutes.
  if (isScheduleQuestion(body.question)) {
    const s = await scheduleAnswer(env, body.question).catch(() => null);
    if (s) {
      return {
        kind: 'final',
        response: {
          ...base,
          retrievalStatus: 'grounded',
          answer: s.text,
          paragraphs: [{ segments: [{ text: s.text, citations: [] }] }],
          citations: [],
          suggestedFollowUps: ["What's on the agenda for the next City Council meeting?"],
          notice: null,
          engine: 'schedule',
          mode: 'conversation',
          event: s.event,
        } as AskResponse,
      };
    }
  }

  if (!repo.available) throw new HttpError(503, 'search_unavailable', 'The full-text index is not available right now.');

  const aiReady = aiConfigured(env) && !aiBreakerOpen();
  const budgetP = aiReady ? aiBudgetLeft(env) : Promise.resolve(null);
  const retrieve = async (text: string, f: SearchFilters): Promise<ChunkHit[]> => {
    const strict = parseQuery(text, { match: 'all' });
    const loose = parseQuery(text, { match: 'any' });
    if (!loose.fts) return [];
    const [strictHits, looseHits] = await Promise.all([
      strict.fts && strict.fts !== loose.fts ? repo.searchChunks(strict.fts, f, 40, true, false) : Promise.resolve([] as ChunkHit[]),
      repo.searchChunks(loose.fts, f, 40, true, false),
    ]);
    const seen = new Set(strictHits.map((h) => h.chunkId));
    return [...strictHits, ...looseHits.filter((h) => !seen.has(h.chunkId))];
  };

  // "What happened at the last council meeting?" is answered from that meeting's own records.
  const focus = await meetingFocus(env, body.question).catch(() => null);
  let hits: ChunkHit[] = [];
  let question = body.question;
  if (focus) {
    hits = await retrieve(focus.terms, { ...filters, meetingId: focus.id, ...(focus.minutesOnly ? { documentTypes: ['minutes'] } : {}) });
    const when = `${focus.title}${focus.date ? ` held ${focus.date}` : ''}`;
    if (hits.length)
      question = focus.minutesOnly
        ? `${body.question}\n(Answer from the minutes of the ${when}, the most recent meeting with minutes in the archive. Start by naming that meeting and its date.)`
        : `${body.question}\n(This refers to the ${when}. Every source below is from that meeting's agenda or packet, so describe items as scheduled or recommended, not as decided. Minutes reprinted inside a packet are from an earlier meeting; do not present those actions as happening at this meeting.)`;
  }
  let plan: SearchPlan | null = null;
  if (!hits.length) {
    // The question as asked, plus the model's search plan: several phrasings in the records' own
    // words, the likely record types and any year the question names. Each is searched, and the
    // best of every list goes into one candidate pool, so phrasing never decides what is found.
    const [p, direct] = await Promise.all([aiReady ? planSearch(env, body.question, retrievalText !== body.question ? history[history.length - 1] : null) : Promise.resolve(null), retrieve(retrievalText, filters)]);
    plan = p;
    if (plan) {
      const q0 = plan.queries[0];
      const planned = await Promise.all([
        ...plan.queries.map((q) => retrieve(q, filters).catch(() => [] as ChunkHit[])),
        plan.types.length ? retrieve(q0, { ...filters, documentTypes: plan.types }).catch(() => [] as ChunkHit[]) : Promise.resolve([] as ChunkHit[]),
        plan.types.length ? retrieve(retrievalText, { ...filters, documentTypes: plan.types }).catch(() => [] as ChunkHit[]) : Promise.resolve([] as ChunkHit[]),
        plan.dateFrom ? retrieve(q0, { ...filters, dateFrom: plan.dateFrom, dateTo: plan.dateTo }).catch(() => [] as ChunkHit[]) : Promise.resolve([] as ChunkHit[]),
      ]);
      hits = interleave([...planned, direct], 90);
    } else hits = direct;
  }
  // A question about a named official's votes or positions reads the minutes for their recorded
  // motions and votes (minutes list votes by last name).
  const pinnedVotes = new Set<string>();
  const person = await personIn(env, body.question).catch(() => null);
  if (person && VOTE.test(body.question)) {
    const rest = body.question.replace(new RegExp(person.name.split(' ').join('\\s+'), 'ig'), ' ').replace(new RegExp(VOTE.source, 'gi'), ' ');
    const votes = await retrieve(`${person.last} ${rest} motion`, { ...filters, documentTypes: ['minutes'] }).catch(() => [] as ChunkHit[]);
    votes.slice(0, 12).forEach((h) => pinnedVotes.add(h.chunkId));
    const seenV = new Set<string>();
    hits = [...votes.slice(0, 12), ...hits].filter((h) => (seenV.has(h.chunkId) ? false : (seenV.add(h.chunkId), true)));
    const mayorNote = /\bmayor\b/i.test(person.role) && !/deputy/i.test(person.role) ? ` Since January 1, 2026 (six-member council form) the mayor is not a voting member of the council and votes only to break a tie or on the city manager appointment: say that first, citing the source on the form of government, then give any vote a source shows.` : '';
    question = `${question}\n(${person.name} is ${person.role}. Minutes record votes by last name, for example "motion carried 4-0 (Holdaway, Lauret, McCumber, Wood)" or "${person.last} voted nay". Report how ${person.name} voted or moved only where a source shows it, with the meeting date.${mayorNote})`;
  }
  // "Who is ...", "current", "now": today's records (the staff directory, the mayor and council
  // list, current map data) lead, then the newest dated records, so the answer reflects today.
  // "Can I keep chickens?": the municipal code (current law) is searched on its own as well.
  const codeIds = new Set<string>();
  if (RULE.test(body.question) && !focus) {
    const code = await retrieve(plan?.queries[0] ?? retrievalText, { ...filters, documentTypes: ['municipal_code'] }).catch(() => [] as ChunkHit[]);
    code.slice(0, 8).forEach((h) => codeIds.add(h.chunkId));
    const seenR = new Set<string>();
    hits = [...hits.slice(0, 30), ...code.slice(0, 8), ...hits.slice(30)].filter((h) => (seenR.has(h.chunkId) ? false : (seenR.add(h.chunkId), true)));
  }
  // Questions about the mayor, voting or the form of government also read the records that set
  // Vineyard's form of government (six-member council since January 1, 2026: the mayor does not vote).
  const govIds = new Set<string>();
  if (/\b(mayor|vot(e|es|ed|ing)|form of government|six-member|five-member|tie|council members?|who decides|city manager)\b/i.test(body.question)) {
    const [a, b] = await Promise.all([
      retrieve('"six-member council" "took effect" January 2026', { ...filters, dateFrom: '2025-06-01' }).catch(() => [] as ChunkHit[]),
      retrieve('"six-member" mayor vote tie', { ...filters, dateFrom: '2024-01-01' }).catch(() => [] as ChunkHit[]),
    ]);
    const gov = interleave([a, b], 4);
    gov.forEach((h) => govIds.add(h.chunkId));
    const seenG = new Set<string>();
    hits = [...hits.slice(0, 30), ...gov.slice(0, 4), ...hits.slice(30)].filter((h) => (seenG.has(h.chunkId) ? false : (seenG.add(h.chunkId), true)));
  }
  const currentIds = new Set<string>();
  if (CURRENT.test(body.question) || ROLE.test(body.question)) {
    const current = await retrieve(retrievalText, { ...filters, currency: ['current'] }).catch(() => [] as ChunkHit[]);
    // Today's directory and lists, not code sections (also marked current): they say who holds a role.
    current.filter((h) => !['municipal_code', 'plan'].includes(h.documentType)).slice(0, 6).forEach((h) => currentIds.add(h.chunkId));
    const top = hits.slice(0, 30).sort((a, b) => String(b.documentDate ?? '').localeCompare(String(a.documentDate ?? '')));
    const seenC = new Set<string>();
    hits = [...current.slice(0, 6), ...top, ...hits.slice(30)].filter((h) => (seenC.has(h.chunkId) ? false : (seenC.add(h.chunkId), true)));
  }
  const today = new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
  question = `${question}\n(Today is ${today}.${CURRENT.test(body.question) || ROLE.test(body.question) ? ' Answer with the current information: a record marked current outranks older records. Say what date your source is from.' : ''})`;
  const loose = parseQuery(retrievalText, { match: 'any' });
  const budgetOk = await budgetP;
  if (!hits.length) return { kind: 'final', response: await fallback('no_results', null) };
  if (!aiReady || budgetOk == null) {
    const why = !aiConfigured(env) ? 'AI not configured' : aiBreakerOpen() ? 'paused after a quota error' : 'daily answer limit reached';
    const r = await fallback('search_only', SEARCH_ONLY_NOTICE);
    return { kind: 'final', response: { ...r, engine: `search-fallback (${why})` } };
  }

  // Every candidate passage is read against the question by a reranker; the answer is written from
  // the passages that answer it. A record marked current stays first for "who is / now" questions.
  const ranked = await rerank(env, retrievalText, hits.slice(0, 90));
  if (ranked) {
    let best = recencyWeighted(relevant(ranked), retrievalText, Number(new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 4)), currentIds, RULE.test(body.question));
    // Records that must lead for some questions, in the reranker's own order: the current
    // directory for "who is", the person's recorded votes for "how did X vote", the code for rules.
    const lead = (ids: Set<string>, n: number) => {
      if (!ids.size) return;
      const first = ranked.filter((h) => ids.has(h.chunkId)).slice(0, n);
      best = [...first, ...best.filter((h) => !first.includes(h))];
    };
    lead(govIds, 1);
    lead(codeIds, 2);
    lead(pinnedVotes, 4);
    if (person && /\bmayor\b/i.test(person.role) && !/deputy/i.test(person.role)) lead(govIds, 2);
    lead(currentIds, 2);
    // "The first meeting", "the earliest ordinance": among the passages that answer, oldest first.
    if (/\b(first|earliest|oldest|original)\b(?!\s+responders?)/i.test(body.question)) {
      const top = best.slice(0, 8).sort((a, b) => String(a.documentDate ?? `${a.year ?? 9999}-12-31`).localeCompare(String(b.documentDate ?? `${b.year ?? 9999}-12-31`)));
      best = [...top, ...best.slice(8)];
    }
    hits = best;
  }
  const evidence = selectEvidence(hits);
  // Start the catalog reads the final answer needs now, so they finish while the model writes.
  const docsP = summariesByIds(env, [...new Set(hits.map((h) => h.documentId))].slice(0, 30));
  const extraP = env.CATALOG_DB.prepare(
    `SELECT d.id, d.original_url, d.archive_status, d.archive_key, m.title AS meeting_title, a.number AS agenda_number FROM documents d
     LEFT JOIN meetings m ON m.id = d.meeting_id LEFT JOIN agenda_items a ON a.id = d.agenda_item_id WHERE d.id IN (SELECT value FROM json_each(?))`,
  )
    .bind(JSON.stringify([...new Set(evidence.map((c) => c.documentId))]))
    .all<Record<string, unknown>>();
  docsP.catch(() => undefined);
  extraP.catch(() => undefined);
  const quotaP = bumpQuota(env, 'ai_requests').catch(() => undefined);

  const prior = (body.conversation ?? []).slice(-4).map((t) => ({ role: t.role, content: t.content.slice(0, 600) }));
  const messages: Msg[] = [{ role: 'system', content: RAG_SYSTEM_PROMPT }, ...prior, { role: 'user', content: buildUserMessage(question, evidence, history) }];

  const fail = async (e: unknown): Promise<AskResponse> => {
    const msg = e instanceof Error ? e.message : String(e);
    // Quota / capacity / auth errors open the breaker so we stop spending requests for a while.
    // Only a spent daily allowance pauses AI answers (until it resets); any other error affects
    // just this one answer, and both models were already tried.
    if (/4006|daily free allocation|neuron|quota/i.test(msg)) breakerUntil = Date.now() + 30 * 60_000;
    await bumpQuota(env, 'ai_failures').catch(() => undefined);
    const r = await fallback('search_only', SEARCH_ONLY_NOTICE);
    return { ...r, engine: `search-fallback (${msg.replace(/\s+/g, ' ').slice(0, 160)})` };
  };

  const finish = async (raw: string, engine?: string): Promise<AskResponse> => {
    await quotaP;
    const first = segmentAnswer(briefAnswer(attributeCitations(raw, evidence)), evidence.length);
    // Every figure must be in the source it cites; unsupported sentences are removed.
    const grounded = groundParagraphs(first.paragraphs, evidence);
    const seg = { ...first, paragraphs: grounded.paragraphs, used: new Set(grounded.paragraphs.flatMap((p) => p.segments.flatMap((x) => x.citations))) };
    if (!seg.used.size) {
      // Nothing the model wrote could be tied to a source: show the records, never an unchecked answer.
      const r = await fallback('search_only', null);
      return { ...r, engine: `search-fallback (no sentence passed the source check: ${raw.replace(/\s+/g, ' ').slice(0, 220)})` };
    }

    // Renumber cited sources 1..k in order of first use.
    const order = [...seg.used].sort((a, b) => a - b);
    const renumber = new Map(order.map((old, i) => [old, i + 1]));
    const paragraphs = seg.paragraphs.map((p) => ({ segments: p.segments.map((s) => ({ text: s.text, citations: s.citations.map((c) => renumber.get(c) ?? c) })) }));
    // Unverified sentences are simply left out; the answer never adds a disclaimer about them.

    const cited = order.map((old) => evidence[old - 1]);
    const [docs, rows] = await Promise.all([docsP, extraP]);
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
    const partial = seg.dropped > 0 || seg.insufficient || grounded.removed > 0;
    const answer = paragraphs.map((p) => p.segments.map((s) => `${s.text}${s.citations.length ? ` ${s.citations.map((c) => `[${c}]`).join('')}` : ''}`).join(' ')).join('\n\n');

    return {
      ...base,
      retrievalStatus: partial ? 'partial' : 'grounded',
      answer,
      paragraphs,
      citations,
      relatedDocuments,
      notice: null,
      engine: `${engine ?? env.AI_MODEL ?? DEFAULT_AI_MODEL}${ranked ? ' + rerank' : ''}${plan ? ' + plan' : ''}`,
      ...((body as { debug?: boolean }).debug ? { draft: raw, plan, evidence: evidence.map((h, i) => `[${i + 1}] ${h.title} | ${h.documentDate ?? h.year ?? ''} | p${h.pageStart ?? ''}`) } : {}),
    };
  };

  return { kind: 'model', messages, useBig: budgetOk < intVar(env.AI_BIG_PER_DAY, BIG_MODEL_PER_DAY), finish, fail };
}

const SSE_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'x-accel-buffering': 'no',
};

/**
 * Streaming variant: `event: delta` carries raw model text as it is written (for display only),
 * then `event: done` carries the final, citation-checked AskResponse that replaces it.
 */
function streamAnswer(env: Env, ctx: ExecutionContext | undefined, prep: Extract<Prepared, { kind: 'model' }>, done: (r: AskResponse) => AskResponse): Response {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  let open = true;
  const send = async (event: string, data: unknown) => {
    if (!open) return;
    try {
      await writer.write(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    } catch {
      open = false; // the reader went away
    }
  };
  const work = (async () => {
    let final: AskResponse;
    try {
      await send('status', { phase: 'writing' });
      let raw: string;
      let engine = FALLBACK_AI_MODEL;
      if (prep.useBig) {
        // The larger model reasons before it writes, so its answer is sent whole once ready.
        const r = await callModel(env, prep.messages, { useBig: true });
        raw = r.text;
        engine = r.engine;
        await send('delta', { t: raw });
      } else {
        raw = await streamSmall(env, prep.messages, (t) => send('delta', { t }));
      }
      if (!raw.trim()) throw new Error('Empty AI response');
      final = await prep.finish(raw, engine);
    } catch (e) {
      final = await prep.fail(e);
    }
    await send('done', done(final));
    if (open) await writer.close().catch(() => undefined);
  })();
  ctx?.waitUntil(work);
  return new Response(readable, { status: 200, headers: SSE_HEADERS });
}

export type AskLogger = (response: AskResponse, latencyMs: number) => void;

export async function handleAsk(env: Env, request: Request, ctx?: ExecutionContext, onDone?: AskLogger): Promise<Response> {
  const started = Date.now();
  const done = (r: AskResponse) => {
    try {
      onDone?.(r, Date.now() - started);
    } catch {
      /* logging never breaks an answer */
    }
    return r;
  };
  const raw = await readJson<unknown>(request, 32 * 1024);
  const body = validate(raw);
  const wantsStream = Boolean(raw && typeof raw === 'object' && (raw as { stream?: unknown }).stream === true);
  const clientKey = request.headers.get('cf-connecting-ip') ?? 'anon';
  const retry = rateLimit(clientKey);
  if (retry != null) throw new HttpError(429, 'rate_limited', 'Too many questions. Try again shortly.', retry);

  const prep = await prepare(env, body);
  if (prep.kind === 'final') return respond(done(prep.response));
  if (wantsStream) return streamAnswer(env, ctx, prep, done);
  let out: { text: string; engine: string };
  try {
    out = await callModel(env, prep.messages, { useBig: prep.useBig });
  } catch (e) {
    return respond(done(await prep.fail(e)));
  }
  return respond(done(await prep.finish(out.text, out.engine)));
}

function respond(body: AskResponse): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
}

export { SEARCH_ONLY_NOTICE, NO_RESULTS_ANSWER, DEFAULT_AI_MODEL, RAG_SYSTEM_PROMPT };
