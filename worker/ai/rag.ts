/**
 * POST /api/ask: retrieval-augmented answers over the archive.
 *
 * The archive is the authority: the model only sees the top retrieved chunks, must cite them with
 * [n] markers, and every sentence it returns is checked. Sentences without a valid citation are
 * dropped (status becomes "partial"); an answer with no valid citations is not shown at all.
 * If Workers AI is missing, disabled, over the daily budget, or failing, the response is a
 * search-only result with the fixed notice below and the site keeps working.
 */
import { meteredRun } from './meter';
import type { Env } from '../env';
import { boolVar, intVar } from '../env';
import type { AskRequest, AskResponse, Citation, DocumentSummary, DocumentType, SearchFilters } from '../../src/types/models';
import { ensurePeopleTable } from '../api/people';
import { DEFAULT_AI_MODEL, FALLBACK_AI_MODEL, aiText, tidyOpeners, attributeCitations, groundParagraphs, NO_RESULTS_ANSWER, RAG_SYSTEM_PROMPT, SEARCH_ONLY_NOTICE, SMALL_TALK_REPLIES, MAX_ANSWER_SENTENCES, briefAnswer, buildUserMessage, dropRestatement, finishedSentences, segmentAnswer, selectEvidence, smallTalkKind } from './answer';
import { badRequest, HttpError, readJson } from '../lib/http';
import { nowIso, randomId, utcDay } from '../lib/util';
import { parseQuery } from '../search/query';
import { SearchRepository } from '../search/SearchRepository';
import type { ChunkHit } from '../search/types';
import { summariesByIds } from '../api/documents';
import { normalizeType } from '../lib/taxonomy';
import { readAiStream } from './sse';
import { asksCurrentValue, interleave, planSearch, recencyWeighted, relevant, rerank, type SearchPlan } from './retrieval';
import { AGENDA_NOT_POSTED, AGENDA_TYPES, PLACE_TIME_Q, meetingPlaceText, countAnswer, countKind, isMeetingCountQuestion, isNextAgendaQuestion, isScheduleQuestion, meetingsInFrame, nextAgenda, scheduleAnswer, type ScheduleAnswer } from './schedule';
import { bodyOf } from './scheduleIntent';
import { resolveTime, timeNote, utahToday } from './timeframe';
import { topicsFor } from './topics';
import { isJobsQuestion, jobsText, openJobs } from './jobs';
import { isConstructionNowQuestion, serviceAnswer } from './serviceAnswers';
import { constructionAnswer } from './constructionAnswer';
import { citationLabel, withoutResidentFor } from './submissions';
import { seriesFor } from './series';
import { ROAD_STATUS, roadsIn } from './roads';
import { factsLine, rewriteQuestion } from './rewrite';
import { carryOver, ellipticalFollowUp, keepsTopic, priorPassageScore } from './followup';
import { BUDGET_DOC_TITLES, budgetAnswer, budgetIntent, type BudgetDocKey } from './budgetAnswer';
import { isTaxRateQuestion, isTaxRateRecord, newerRateRecord, taxRateIntent, taxRateResponse, taxRateSentences } from './taxRateAnswer';
import { citedMotions } from './voteMatch';
import { placeAnswer, placeIntent, resolvePlace } from './place';
import { LATEST_ACTION_Q, SCOPE_FROM, councilName, currentCouncil, motionDates, motionEvidence, queryMotions, votesFor, type MotionOut } from '../api/votes';
import { sectionFor } from './sections';
import { contactFor, contactLine, isIdentityQuestion, isPersonFollowUp, namedIn, PERSON_PRONOUN, personFromTurns, titleIn, whoIsAnswer, type StaffPerson } from './contacts';
import { fixSpelling } from './spelling';
import { BODY_LABEL, longDay, meetingBodyIn, meetingDateIn, meetingFollowUp, meetingVotesIntent, meetingVotesText, memberTitle, motionLine, MOVER_Q, type MeetingBody, type MeetingVotesIntent } from './meetingVotes';
import { decidingMotion, itemVoteIn, measureRefIn, measureVotesIntent, measureVotesText, motionIsAbout, type MeasureVotesIntent } from './measureVotes';
import { officialRoster, TERM_FROM, titleOfficials } from './officials';
import { isOffTopic, OFF_TOPIC_REPLY } from './offTopic';
import { bodyClarify, CONTACT_Q, docLookupIntent, feeIntent, lastMeetingIntent, monthClarify, itemWords, monthVotesIntent, motionSearchWords, personClarify, recordLookupIntent, resolveFollowUp, suggestFollowUps } from './lookups';
import { routeFor } from './quotes';
import { bodiesOnDate, clarifyResponse, codeResponse, docLookupResponse, feeResponse, lastVotesDate, quotesResponse, recordLookupResponse, recordsAnswer, routeResponse } from './lookupAnswers';
import { BUDGET_AMENDED } from '../lib/budgetData';

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
        .filter((t): t is { role: 'user' | 'assistant'; content: string; sources?: unknown } => !!t && typeof t === 'object' && ['user', 'assistant'].includes((t as { role?: string }).role ?? '') && typeof (t as { content?: unknown }).content === 'string')
        .slice(-6)
        .map((t) => {
          const sources = Array.isArray(t.sources) ? t.sources.filter((x): x is string => typeof x === 'string').map((x) => stripControl(x).slice(0, 200)).slice(0, 6) : [];
          return { role: t.role, content: t.content.slice(0, 2000), ...(t.role === 'assistant' && sources.length ? { sources } : {}) };
        })
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

/** A record card from a search hit, for a record the catalog read did not return. */
function hitSummary(h: ChunkHit): DocumentSummary {
  let categories: unknown;
  try {
    categories = JSON.parse(h.categoriesJson || '[]');
  } catch {
    categories = [];
  }
  return {
    id: h.documentId,
    slug: h.documentId,
    title: h.title,
    description: null,
    documentType: normalizeType(h.documentType),
    documentNumber: h.documentNumber,
    date: h.documentDate,
    year: h.year,
    governmentBodyId: h.governmentBodyId,
    governmentBodyName: null,
    meetingId: null,
    sourceId: h.sourceId,
    pageCount: null,
    mimeType: 'application/pdf',
    fileSize: null,
    categories: Array.isArray(categories) ? categories : [],
    currency: 'unknown',
  } as DocumentSummary;
}

/**
 * A follow-up reads the records the previous answer cited (their titles come with the conversation):
 * each one's passages that hold that answer's figures or the follow-up's subject words, best first.
 */
async function priorRecordHits(repo: SearchRepository, retrieve: (text: string, f: SearchFilters) => Promise<ChunkHit[]>, sources: string[], previousAnswer: string, question: string, filters: SearchFilters): Promise<ChunkHit[]> {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const lists = await Promise.all(
    [...new Set(sources)].slice(0, 4).map(async (title) => {
      const found = (await retrieve(title, filters).catch(() => [] as ChunkHit[])).find((h) => norm(h.title) === norm(title));
      if (!found) return [] as ChunkHit[];
      const chunks = await repo.documentChunks(found.shard, found.documentId).catch(() => []);
      return chunks
        .map((c) => ({ c, score: priorPassageScore(c.text, previousAnswer, question) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 2)
        .map(({ c }): ChunkHit => ({ ...found, chunkId: c.id, pageStart: c.pageStart, pageEnd: c.pageEnd, sectionTitle: c.sectionTitle, text: c.text, excerpt: '', highlights: [] }));
    }),
  );
  return lists.flat();
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
  const input = big ? { messages, max_tokens: 1800, reasoning: { effort: 'low' } } : qwen ? { messages: msgs, max_tokens: 900, temperature: 0 } : { messages, max_tokens: maxTokens, temperature };
  const run = meteredRun(env, model, input);
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
  // The larger model, then the small one; a small-model answer gets one retry. A retry runs only after an error.
  const models = opts.useBig === false ? [FALLBACK_AI_MODEL, FALLBACK_AI_MODEL] : [primary, FALLBACK_AI_MODEL];
  let last: unknown = null;
  for (const [i, model] of models.entries()) {
    try {
      const text = await runOnce(env, model, messages, opts.maxTokens ?? MAX_TOKENS, opts.temperature ?? 0);
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
  const out = await meteredRun(env, FALLBACK_AI_MODEL, { messages, max_tokens: MAX_TOKENS, temperature: 0, stream: true });
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
const FILLER = /\b(most recent|latest|last|recent|previous|past|upcoming|next|this week'?s|tonight'?s|today'?s|what|whats|what's|happened|happen|happening|at|the|in|on|was|were|did|do|does|will|be|discussed|discuss|meetings?|city|council|commission|planning|agenda|minutes|session|vineyard|of|about|is|are|for|tell|me|summarize|summary|a|an|decide|decided|decision|decisions|vote|voted|votes|approve|approved|adopt|adopted|pass|passed|deny|denied|action|actions|outcome|outcomes|result|results|they|we)\b/gi;

/** The meeting a "last / next meeting" question is about, with the search terms left over. */
async function meetingFocus(env: Env, q: string): Promise<{ id: string; title: string; date: string | null; terms: string; minutesOnly: boolean } | null> {
  if (!RECENT.test(q) || !MEETINGISH.test(q)) return null;
  const next = /\b(upcoming|next|tonight|today|this week)\b/i.test(q);
  // What happened / was decided comes from minutes; packets reprint the previous meeting's minutes.
  const outcome = !next && /\b(happen|happened|decide|decided|decision|vote|voted|votes|approve|approved|adopt|adopted|pass|passed|deny|denied|action|actions|outcome|result)\w*\b/i.test(q);
  const body = bodyOf(q).like;
  const today = new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10); // Utah
  const row = await env.CATALOG_DB.prepare(
    `SELECT m.id, m.title, m.meeting_date FROM meetings m
     WHERE coalesce(m.government_body_name, m.title) LIKE ? AND m.meeting_date ${next ? '>=' : '<='} ?
       ${next ? "AND lower(coalesce(m.status, '')) NOT LIKE '%cancel%'" : `AND EXISTS (SELECT 1 FROM documents d WHERE d.meeting_id = m.id${outcome ? " AND d.document_type = 'minutes'" : ''})`}
     ORDER BY m.meeting_date ${next ? 'ASC' : 'DESC'} LIMIT 1`,
  )
    .bind(body, today)
    .first<{ id: string; title: string; meeting_date: string | null }>();
  if (!row) return null;
  const rest = q.replace(/[?.!,]/g, ' ').replace(FILLER, ' ').replace(/\s+/g, ' ').trim();
  return { id: row.id, title: row.title, date: row.meeting_date, minutesOnly: outcome, terms: rest.length >= 3 ? rest : 'approve approved motion ordinance resolution item public hearing presentation' };
}

/** One meeting named by its date (and body): the records that belong to it, nothing else. */
export interface DatedMeeting {
  date: string;
  body: MeetingBody;
  /** "September 8, 2026 City Council meeting". */
  name: string;
  meetingId: string | null;
  meetingIds: string[];
  docIds: Set<string>;
  minutesIds: Set<string>;
  /** What happened there (spoke, decided, discussed): read from the minutes when the archive has them. */
  outcome: boolean;
}

const MEETING_OUTCOME = /\b(happen\w*|decid\w*|decisions?|vot\w*|approv\w*|adopt\w*|pass(?:ed|es)?|den(?:y|ied)|actions?|outcomes?|results?|spoke|speak\w*|said|says?|comments?|commented|discuss\w*|presented|presentations?|testif\w*|attend\w*|absent|motions?|moved|asked|raised|concerns?)\b/i;
const MONTH_WORDS = /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?(?=\s|$)/gi;

/**
 * "Who spoke during public comment at the September 8, 2026 City Council meeting?": a question tied
 * to one meeting by its date and body (or date and the word meeting). Its records are the documents
 * filed under that meeting and the minutes, agenda and packet of that body dated that day. Null when
 * the question names no meeting date, or the archive holds no meeting or record for it.
 */
export async function datedMeeting(env: Env, q: string, today = utahToday()): Promise<DatedMeeting | null> {
  const date = meetingDateIn(q, today);
  if (!date) return null;
  const named = meetingBodyIn(q);
  if (!named && !/\b(meeting|session)\b/i.test(q)) return null;
  const body = named ?? 'city-council';
  const meetings = await env.CATALOG_DB.prepare(
    `SELECT id FROM meetings WHERE substr(meeting_date, 1, 10) = ? AND government_body_id = ? ORDER BY CASE WHEN id LIKE 'mtg_cc_%' THEN 0 ELSE 1 END, id LIMIT 5`,
  )
    .bind(date, body)
    .all<{ id: string }>();
  const meetingIds = (meetings.results ?? []).map((r) => String(r.id));
  const docs = await env.CATALOG_DB.prepare(
    `SELECT id, document_type FROM documents
     WHERE meeting_id IN (SELECT value FROM json_each(?))
        OR (document_date = ? AND government_body_id = ? AND document_type IN ('minutes', 'agenda', 'agenda_packet'))
     LIMIT 300`,
  )
    .bind(JSON.stringify(meetingIds), date, body)
    .all<{ id: string; document_type: string }>();
  const rows = docs.results ?? [];
  if (!meetingIds.length && !rows.length) return null;
  return {
    date,
    body,
    name: `${longDay(date)} ${BODY_LABEL[body]} meeting`,
    meetingId: meetingIds[0] ?? null,
    meetingIds,
    docIds: new Set(rows.map((r) => String(r.id))),
    minutesIds: new Set(rows.filter((r) => r.document_type === 'minutes').map((r) => String(r.id))),
    outcome: MEETING_OUTCOME.test(q),
  };
}

const LONG_DATE = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+((?:19|20)\d{2})\b/gi;
const NUM_DATE = /\b(\d{1,2})[./](\d{1,2})[./]((?:19|20)?\d{2})\b/g;

const MONTH_INDEX: Record<string, number> = Object.fromEntries(['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'].map((m, i) => [m, i + 1]));

/** True when the text names that day ("September 8", "Sept. 8, 2026", "9/8/2026"). */
export function namesMeetingDay(text: string, date: string): boolean {
  if (datesIn(text).includes(date)) return true;
  const [, m, d] = date.split('-').map(Number);
  const month = Object.keys(MONTH_INDEX)[m - 1];
  return new RegExp(`\\b(?:${month}|${month.slice(0, 3)}\\.?|${month.slice(0, 4)}\\.?)\\s+${d}(?:st|nd|rd|th)?\\b`, 'i').test(text);
}

/** Every full date a passage names, as ISO. */
function datesIn(text: string): string[] {
  const out: string[] = [];
  const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  for (const m of text.matchAll(LONG_DATE)) out.push(iso(Number(m[3]), MONTH_INDEX[m[1].toLowerCase()], Number(m[2])));
  for (const m of text.matchAll(NUM_DATE)) out.push(iso(Number(m[3].length === 2 ? `20${m[3]}` : m[3]), Number(m[1]), Number(m[2])));
  return out;
}

/**
 * A packet or agenda passage that is another meeting's minutes reprinted for approval ("Minutes of the
 * August 25, 2026 City Council meeting ... Jared Tamez spoke"): it names minutes and another date, and
 * never this meeting's date. Such a passage says what happened at that other meeting, not this one.
 */
export function reprintedMinutes(h: { documentType: string; text?: string | null }, date: string): boolean {
  if (h.documentType === 'minutes' || !h.text || !/\bminutes\b/i.test(h.text)) return false;
  const dates = datesIn(h.text);
  return dates.length > 0 && !dates.includes(date);
}

const CURRENT = /\b(who is|who's|who are|current|currently|now|today|as of|latest|presently|still|this year|right now)\b/i;
const ROLE = /\b(mayor|deputy mayor|council ?(member|man|woman)s?|city council|city manager|recorder|city attorney|director|department head|staff|employees?|who works|chief|official|commissioners?)\b/i;
const PRESENT_Q = /\b(now|current|currently|today|this year|latest|recent|recently|right now|going on|happening|doing|working on|plans?|planned|planning|upcoming|status|still|update|progress)\b/i;
const HOWTO = /\b(how (do|can|should|would) (i|we|you|residents?)|where (do|can) i|how to|sign up|apply for|register for|reserve|reservation|get a (permit|pass|license|meter|card)|request a|schedule an?)\b/i;
const RULE = /\b(can i|can we|can you|am i allowed|is it (legal|allowed|permitted)|allowed|permitted|prohibited|illegal|rules?|regulations?|required|requirements?|do i need|need a permit|code says|setbacks?|how (many|tall|high|far))\b/i;
const VOTE = /\b(vote[sd]?|voting|motion|moved|second(ed)?|position|stance|support(ed)?|oppose[sd]?|against|for or against|aye|nay)\b/i;

let staffCache: { at: number; list: StaffPerson[] } | null = null;
/** Everyone the city website lists today (elected officials first), cached for ten minutes. */
export async function currentStaff(env: Env): Promise<StaffPerson[]> {
  if (!staffCache || Date.now() - staffCache.at > 10 * 60_000) {
    await ensurePeopleTable(env);
    const res = await env.CATALOG_DB.prepare("SELECT slug, name, kind, role, department, email, phone FROM people WHERE current = 1 ORDER BY CASE kind WHEN 'elected' THEN 0 ELSE 1 END, name").all<StaffPerson>();
    staffCache = { at: Date.now(), list: res.results ?? [] };
  }
  return staffCache.list;
}

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

/**
 * A budget answer from budgetData.ts as a final response. The cited documents are the budget book and
 * amendment ids recorded there; their catalog rows (title, date, links) are read when available, and
 * the titles and dates recorded in budgetData.ts are used when not. No excerpt is quoted: the values
 * were keyed from the documents, so the citation opens the document rather than quoting a passage.
 */
export async function budgetResponse(env: Env, base: { id: string; question: string; relatedDocuments: DocumentSummary[]; suggestedFollowUps: string[]; generatedAt: string }, a: ReturnType<typeof budgetAnswer>): Promise<AskResponse> {
  const order: BudgetDocKey[] = [];
  for (const s of a.sentences) for (const d of s.docs) if (!order.includes(d)) order.push(d);
  const ids = order.map((k) => BUDGET_DOC_TITLES[k].id);
  const rows = ids.length
    ? await env.CATALOG_DB.prepare('SELECT id, title, document_date, original_url, archive_status, archive_key FROM documents WHERE id IN (SELECT value FROM json_each(?))')
        .bind(JSON.stringify(ids))
        .all<{ id: string; title: string | null; document_date: string | null; original_url: string | null; archive_status: string | null; archive_key: string | null }>()
        .then((r) => new Map((r.results ?? []).map((x) => [x.id, x])))
        .catch(() => new Map<string, never>())
    : new Map<string, never>();
  const citations: Citation[] = order.map((k, i) => {
    const doc = BUDGET_DOC_TITLES[k];
    const row = rows.get(doc.id) as { title: string | null; document_date: string | null; original_url: string | null; archive_status: string | null; archive_key: string | null } | undefined;
    return {
      index: i + 1,
      documentId: doc.id,
      documentTitle: row?.title ?? doc.title,
      documentType: 'budget',
      documentNumber: null,
      date: row?.document_date ?? doc.date,
      governmentBodyName: null,
      meetingId: null,
      meetingTitle: null,
      agendaItem: null,
      page: null,
      sectionTitle: null,
      excerpt: { documentId: doc.id, chunkId: null, page: null, sectionTitle: null, text: '', highlights: [] },
      archiveUrl: row?.archive_status === 'archived' && row.archive_key ? `/api/documents/${doc.id}/file` : null,
      originalUrl: row?.original_url ?? null,
    };
  });
  const segments = a.sentences.map((s) => ({ text: s.text, citations: s.docs.map((d) => order.indexOf(d) + 1) }));
  const paragraphs = budgetParagraphs(segments);
  const answer = segments.map((s) => `${s.text}${s.citations.length ? ` ${s.citations.map((c) => `[${c}]`).join('')}` : ''}`).join(' ');
  return {
    ...base,
    retrievalStatus: 'grounded',
    answer,
    paragraphs,
    citations,
    notice: null,
    engine: 'budget-data',
    section: { path: '/budget', label: 'Open the budget', hint: 'Every fund, department and project' },
    suggestedFollowUps: suggestFollowUps({ engine: 'budget-data' }).filter((f) => !sameQuestion(f, base.question)),
    asOf: BUDGET_AMENDED,
    asOfLabel: 'Budget as amended',
  } as AskResponse;
}

const sameQuestion = (a: string, b: string) => a.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() === b.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Budget sentences laid out for reading: the lead sentences as a paragraph, the figure lines
 * ("Police: $4,705,075 in ...") as a list, and as a small table too when there are three or more.
 * The segments (and so the plain answer) are unchanged.
 */
export function budgetParagraphs(segments: Array<{ text: string; citations: number[] }>): Array<{ segments: Array<{ text: string; citations: number[] }>; list?: boolean; table?: { columns: string[]; rows: Array<{ cells: string[]; citations: number[] }> } }> {
  const LINE = /^([^:$]{2,60}?)(?: fund)?: (\$[\d,]+)/;
  const first = segments.findIndex((s) => LINE.test(s.text));
  if (first < 0) return [{ segments }];
  let end = first;
  while (end < segments.length && LINE.test(segments[end].text)) end++;
  const lines = segments.slice(first, end);
  const out: ReturnType<typeof budgetParagraphs> = [];
  if (first > 0) out.push({ segments: segments.slice(0, first) });
  const rows = lines.map((s) => {
    const label = s.text.match(LINE)![1].trim();
    const amounts = [...s.text.matchAll(/\$[\d,]+/g)].map((m) => m[0]);
    return { label, amounts, citations: s.citations };
  });
  const two = rows.some((r) => r.amounts.length >= 2 && /after .*amendment/i.test(lines[rows.indexOf(r)].text));
  const table =
    rows.length >= 3
      ? {
          columns: two ? ['', 'Adopted', 'After amendment'] : ['', 'Amount'],
          rows: rows.map((r) => ({ cells: two ? [r.label, r.amounts[0], r.amounts[1] ?? r.amounts[0]] : [r.label, r.amounts[0]], citations: r.citations })),
        }
      : undefined;
  out.push({ segments: lines, list: true, ...(table ? { table } : {}) });
  if (end < segments.length) out.push({ segments: segments.slice(end) });
  return out;
}

/** The minutes a recorded motion was read from, as the answer's citation (opens the document at that page). */
async function minutesCitation(env: Env, docId: string, page: number | null, body: MeetingBody, date: string | null, meetingId: string | null): Promise<Citation> {
  const row = await env.CATALOG_DB.prepare('SELECT d.title, d.document_date, d.document_type, d.original_url, d.archive_status, d.archive_key, d.meeting_id, m.title AS meeting_title FROM documents d LEFT JOIN meetings m ON m.id = d.meeting_id WHERE d.id = ?')
    .bind(docId)
    .first<{ title: string | null; document_date: string | null; document_type: string | null; original_url: string | null; archive_status: string | null; archive_key: string | null; meeting_id: string | null; meeting_title: string | null }>()
    .catch(() => null);
  return {
    index: 1,
    documentId: docId,
    documentTitle: row?.title ?? `${BODY_LABEL[body]} minutes${date ? `, ${longDay(date)}` : ''}`,
    documentType: 'minutes',
    documentNumber: null,
    date: row?.document_date ?? date,
    governmentBodyName: BODY_LABEL[body],
    meetingId: row?.meeting_id ?? meetingId,
    meetingTitle: row?.meeting_title ?? null,
    agendaItem: null,
    page,
    sectionTitle: null,
    excerpt: { documentId: docId, chunkId: null, page, sectionTitle: null, text: '', highlights: [] },
    archiveUrl: row?.archive_status === 'archived' && row.archive_key ? `/api/documents/${docId}/file` : null,
    originalUrl: row?.original_url ?? null,
  };
}

/**
 * "How did the council vote on Ordinance 2026-07?", "how did McCumber vote on it?", "who broke the tie?":
 * the recorded motion on that ordinance or resolution, written by code (result, tally, each member by
 * title and last name, date) and cited to the minutes page. Null when the voting records hold no motion on it.
 */
export async function measureVotesResponse(env: Env, base: { id: string; question: string; relatedDocuments: DocumentSummary[]; suggestedFollowUps: string[]; generatedAt: string }, intent: MeasureVotesIntent, staff: StaffPerson[]): Promise<AskResponse | null> {
  const r = await queryMotions(env, { q: String(intent.ref.year), pageSize: 400 });
  // Oldest first: a first reading or an amendment comes before the final vote.
  const found = r.items.filter((m) => motionIsAbout(m, intent.ref)).reverse();
  if (!found.length) return null;
  // The motion that decided it: the last one with a recorded result and roll call.
  const newestFirst = [...found].reverse();
  const decided = decidingMotion(newestFirst, intent.ref) ?? newestFirst[0];
  return motionVotesResponse(env, base, intent, found, decided, staff);
}

/**
 * "How did the council vote on the First Amendment to the Holdaway Fields development agreement?": the
 * one recorded motion whose agenda item or wording holds every word of the item named, written by code
 * like a numbered measure (tally, each member including abstentions, mover). Null when no single item matches.
 */
export async function itemVotesResponse(env: Env, base: { id: string; question: string; relatedDocuments: DocumentSummary[]; suggestedFollowUps: string[]; generatedAt: string }, item: { label: string; phrase: string }, staff: StaffPerson[]): Promise<AskResponse | null> {
  const words = itemWords(item.phrase).sort((a, b) => b.length - a.length).slice(0, 5);
  if (words.length < 2) return null;
  const r = await queryMotions(env, { q: words.join(' '), pageSize: 12 });
  const recorded = r.items.filter((m) => m.result !== 'unknown');
  const key = (m: MotionOut) => (m.item ?? m.motion).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!recorded.length || new Set(recorded.map(key)).size !== 1) return null;
  const decided = recorded.find((m) => m.votes.length) ?? recorded[0];
  return motionVotesResponse(env, base, { ref: { label: item.label }, focus: 'vote' }, [...recorded].reverse(), decided, staff);
}

async function motionVotesResponse(env: Env, base: { id: string; question: string; relatedDocuments: DocumentSummary[]; suggestedFollowUps: string[]; generatedAt: string }, intent: { ref: { label: string }; focus: MeasureVotesIntent['focus'] }, found: MotionOut[], decided: MotionOut, staff: StaffPerson[]): Promise<AskResponse | null> {
  // The mayor as of that meeting: the minutes' attendance list prints "Mayor <name>"; for a meeting in the
  // current term with no such line, the directory's mayor.
  const att = await env.CATALOG_DB.prepare("SELECT member FROM meeting_attendance WHERE document_id = ? AND member LIKE 'Mayor %' LIMIT 1")
    .bind(decided.documentId)
    .first<{ member: string }>()
    .catch(() => null);
  const dirMayor = staff.find((p) => /\bmayor\b/i.test(p.role) && !/deputy|pro tem/i.test(p.role))?.name ?? null;
  const mayor = att?.member ? att.member.replace(/^Mayor\s+/, '') : decided.date && decided.date >= TERM_FROM ? dirMayor : null;
  // The member the question names, by the name the record uses.
  const words = ` ${base.question.toLowerCase().replace(/[^a-z' -]+/g, ' ')} `;
  const lastOf = (n: string) => (n.trim().split(/\s+/).pop() ?? n).toLowerCase();
  const named = decided.votes.map((v) => v.member).find((n) => lastOf(n).length >= 3 && words.includes(` ${lastOf(n)} `)) ?? null;
  const sentences = measureVotesText(intent, decided, mayor, named);
  const body: MeetingBody = decided.bodyId === 'redevelopment-agency' || decided.bodyId === 'planning-commission' ? decided.bodyId : 'city-council';
  const citation = await minutesCitation(env, decided.documentId, decided.page, body, decided.date, decided.meetingId);
  const segments = sentences.map((text) => ({ text, citations: [1] }));
  const answer = segments.map((x) => `${x.text} [1]`).join(' ');
  return {
    ...base,
    retrievalStatus: 'grounded',
    answer,
    paragraphs: [{ segments }],
    citations: [citation],
    notice: null,
    engine: 'votes-measure',
    section: { path: '/votes', label: 'Open voting records', hint: 'Every recorded vote, meeting by meeting' },
    votes: { member: named, q: intent.ref.label, items: found.slice(-5) },
    suggestedFollowUps: suggestFollowUps({ engine: 'votes-measure', measure: intent.ref.label, meeting: decided.date ? { date: decided.date, body } : null }),
  } as AskResponse;
}

/**
 * "What did the City Council vote on at the September 8 meeting?" / "did anyone vote no that night?":
 * every recorded motion of that meeting (same body, same date) from the voting records, written by
 * code and cited to the minutes they were read from. Null when the voting records do not cover the date.
 */
export async function meetingVotesResponse(env: Env, base: { id: string; question: string; relatedDocuments: DocumentSummary[]; suggestedFollowUps: string[]; generatedAt: string }, intent: MeetingVotesIntent, staff: StaffPerson[]): Promise<AskResponse | null> {
  if (intent.date < SCOPE_FROM) return null;
  const r = await queryMotions(env, { body: intent.body, date: intent.date, pageSize: 100 });
  const final = (text: string, extra: Partial<AskResponse> = {}) =>
    ({ ...base, retrievalStatus: 'grounded', answer: text, paragraphs: [{ segments: [{ text, citations: [] }] }], citations: [], notice: null, engine: 'votes-meeting', section: { path: '/votes', label: 'Open voting records', hint: 'Every recorded vote, meeting by meeting' }, ...extra }) as AskResponse;
  if (!r.items.length) return final(`The portal's voting records have no recorded motions for a ${BODY_LABEL[intent.body]} meeting on ${longDay(intent.date)}. The minutes may not be posted yet.`);
  const mayor = staff.find((p) => /\bmayor\b/i.test(p.role) && !/deputy/i.test(p.role))?.name ?? null;
  const sentences = meetingVotesText(intent, r.items, mayor);
  const page = r.items.map((m) => m.page).find((p) => p != null) ?? null;
  const citation = await minutesCitation(env, r.items[0].documentId, page, intent.body, intent.date, r.items[0].meetingId);
  const segments = sentences.map((text) => ({ text, citations: [1] }));
  const answer = segments.map((x) => `${x.text} [1]`).join(' ');
  const shown = intent.kind === 'no' ? r.items.filter((m) => m.votes.some((v) => v.vote === 'no')) : r.items;
  // A lead sentence, then the motions as a list.
  const paragraphs = segments.length >= 2 ? [{ segments: [segments[0]] }, { segments: segments.slice(1), list: true }] : [{ segments }];
  const hasMinutes = Boolean(citation.documentType === 'minutes');
  return final(answer, {
    paragraphs,
    citations: [citation],
    votes: { member: null, q: '', items: (shown.length ? shown : r.items).slice(0, 12) },
    suggestedFollowUps: suggestFollowUps({ engine: 'votes-meeting', meeting: { date: intent.date, body: intent.body }, hasMinutes }).filter((f) => !(intent.kind === 'mover' && /^Who moved/.test(f))),
    ...(r.items[0]?.meetingId ? { section: { path: `/meetings/${r.items[0].meetingId}`, label: `Open the ${longDay(intent.date)} ${BODY_LABEL[intent.body]} meeting`, hint: 'Agenda, packet, minutes and video' } } : {}),
  } as Partial<AskResponse>);
}

/** Who moved and seconded each of a few recorded motions, with its meeting and result, cited to the minutes. */
async function moversResponse(env: Env, base: { id: string; question: string; relatedDocuments: DocumentSummary[]; suggestedFollowUps: string[]; generatedAt: string }, motions: MotionOut[], staff: StaffPerson[]): Promise<AskResponse | null> {
  const mayor = staff.find((p) => /\bmayor\b/i.test(p.role) && !/deputy/i.test(p.role))?.name ?? null;
  const citations: Citation[] = [];
  const segments: Array<{ text: string; citations: number[] }> = [];
  for (const m of motions) {
    const body: MeetingBody = m.bodyId === 'redevelopment-agency' || m.bodyId === 'planning-commission' ? m.bodyId : 'city-council';
    let at = citations.findIndex((c) => c.documentId === m.documentId);
    if (at < 0) {
      const c = await minutesCitation(env, m.documentId, m.page, body, m.date, m.meetingId);
      citations.push({ ...c, index: citations.length + 1 });
      at = citations.length - 1;
    }
    const who = (n: string | null) => (n ? memberTitle(n, body, mayor) : null);
    const by = [who(m.mover) ? `moved by ${who(m.mover)}` : 'mover not recorded', who(m.seconder) ? `seconded by ${who(m.seconder)}` : 'no second recorded'].join(', ');
    const where = m.date ? ` at the ${longDay(m.date)} ${BODY_LABEL[body]} meeting` : '';
    segments.push({ text: motionLine({ item: m.item, motion: m.motion, result: m.result, tally: m.tally, items: m.items, votes: m.votes }).replace(/\. (Passed|Failed|Result not recorded)/, `; ${by}${where}. $1`), citations: [at + 1] });
  }
  if (!segments.length) return null;
  const paragraphs = segments.length > 1 ? [{ segments: [{ text: `${segments.length} recorded motions match:`, citations: [] }] }, { segments, list: true }] : [{ segments }];
  const first = motions[0];
  const fb: MeetingBody = first.bodyId === 'redevelopment-agency' || first.bodyId === 'planning-commission' ? first.bodyId : 'city-council';
  return {
    ...base,
    retrievalStatus: 'grounded',
    answer: paragraphs.map((p) => p.segments.map((x) => `${x.text}${x.citations.length ? ` ${x.citations.map((c) => `[${c}]`).join('')}` : ''}`).join(' ')).join('\n\n'),
    paragraphs,
    citations,
    notice: null,
    engine: 'votes-mover',
    section: { path: '/votes', label: 'Open voting records', hint: 'Every recorded vote, meeting by meeting' },
    votes: { member: null, q: '', items: motions.slice(0, 3) },
    suggestedFollowUps: first.date ? suggestFollowUps({ engine: 'votes-measure', meeting: { date: first.date, body: fb } }) : [],
  } as AskResponse;
}

/** Sentences that give a rate (0.003796, .003796, 1.5%) with no year in them are removed. */
export function undatedRates<T extends { segments: Array<{ text: string; citations: number[] }> }>(paragraphs: T[]): T[] {
  return paragraphs.map((p) => ({ ...p, segments: p.segments.filter((x) => !(/(?:^|[\s(])0?\.\d{4,6}\b|\b\d+(?:\.\d+)?\s?(?:%|percent)/.test(x.text) && !/\b(?:19|20)\d{2}\b|\bfy\s?'?\d{2}\b/i.test(x.text))) })).filter((p) => p.segments.length);
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
  // Misspellings fixed before anything else reads the question ("grammar request" is GRAMA).
  body = { ...body, question: fixSpelling(body.question) };
  // People: a name, a title, or "he"/"she" meaning the person in the last answer. Who someone is
  // comes straight from the city's own directory; a follow-up about them names them for the search.
  const staff = await currentStaff(env).catch(() => [] as StaffPerson[]);
  const turnsBack = (body.conversation ?? []).slice(-2).reverse().map((t) => t.content);
  const namedNow = namedIn(body.question, staff)[0] ?? null;
  const who = namedNow ?? titleIn(body.question, staff) ?? ((body as { followUp?: boolean }).followUp !== false && isPersonFollowUp(body.question) ? personFromTurns(turnsBack, staff) : null);
  if (who && isIdentityQuestion(body.question, namedNow ?? who)) {
    const text = whoIsAnswer(who);
    return { kind: 'final', response: { ...base, question: body.question, retrievalStatus: 'grounded', answer: text, paragraphs: [{ segments: [{ text, citations: [] }] }], citations: [], suggestedFollowUps: [], notice: null, engine: 'directory', people: [who.slug] } as AskResponse };
  }
  if (who && !namedNow && PERSON_PRONOUN.test(body.question)) body = { ...body, question: body.question.replace(PERSON_PRONOUN, who.name) };
  const filters = body.filters ?? {};

  const history = (body.conversation ?? []).filter((t) => t.role === 'user').map((t) => t.content).slice(-2);
  // Only a real follow-up ("what about that one?") borrows the previous question; a short question
  // that names someone or something stands on its own.
  // The model already decided follow-up or new and wrote a standalone question (see handleAsk);
  // the keyword rule is only the fallback when it could not run.
  const aiFollow = (body as { followUp?: boolean }).followUp;
  const retrievalText = aiFollow !== undefined ? body.question : isFollowUp(body.question) && history.length ? `${body.question} ${history[history.length - 1]}` : body.question;

  // The closest records a search found, as cards that open each record in the portal: an answer that
  // could not be written still shows where to look. Empty only when the search found nothing.
  const closestDocs = async (list: ChunkHit[]): Promise<DocumentSummary[]> => {
    const ids = [...new Set(list.map((h) => h.documentId))].slice(0, 5);
    if (!ids.length) return [];
    const found = await summariesByIds(env, ids).catch(() => new Map<string, DocumentSummary>());
    return ids.map((id) => found.get(id) ?? hitSummary(list.find((h) => h.documentId === id)!));
  };


  // Conversation, not a records question: an instant, friendly reply that never states facts.
  const kind = smallTalkKind(body.question);
  if (kind) {
    const text = SMALL_TALK_REPLIES[kind];
    // A short, natural pause so a greeting does not snap back before the question is even read.
    await new Promise((r) => setTimeout(r, 650));
    return { kind: 'final', response: { ...base, retrievalStatus: 'grounded', answer: text, paragraphs: [{ segments: [{ text, citations: [] }] }], citations: [], notice: null, engine: 'assistant', mode: 'conversation' } as AskResponse };
  }

  // "What's the weather in Paris?", sports scores, trivia: one short line, no records search.
  if (isOffTopic(body.question)) {
    const text = OFF_TOPIC_REPLY;
    return { kind: 'final', response: { ...base, retrievalStatus: 'grounded', answer: text, paragraphs: [{ segments: [{ text, citations: [] }] }], citations: [], notice: null, engine: 'off-topic', mode: 'conversation' } as AskResponse };
  }

  const todayQ = utahToday();
  // "How did Jacob vote on it?" when two officials are named Jacob: ask which one, never guess.
  const officials = officialRoster(staff).filter((o) => /^(Mayor|Council Member)$/.test(o.title) && !o.to);
  const who2 = personClarify(base.question, officials);
  if (who2) return { kind: 'final', response: clarifyResponse(base, who2, { path: '/people', label: 'Open the staff directory', hint: 'Mayor, council and city staff' }) };

  // "Show Ordinance 2026-09", "what is Resolution 2026-34?": the record, its title and adoption, from the records index.
  const rli = recordLookupIntent(body.question);
  if (rli) {
    const r = await recordLookupResponse(env, base, rli).catch(() => null);
    if (r) return { kind: 'final', response: r };
  }

  // "Find the minutes for the September 8 meeting", "show me the agenda for the last RDA meeting".
  const dli = docLookupIntent(body.question, todayQ);
  if (dli) {
    if (dli.date && !dli.body) {
      const bodies = await bodiesOnDate(env, dli.date).catch(() => [] as MeetingBody[]);
      const c = bodyClarify(body.question, dli.date, bodies);
      if (c) return { kind: 'final', response: clarifyResponse(base, c, { path: '/meetings?view=past', label: 'Open past meetings', hint: 'Agendas, packets, minutes and video' }) };
    }
    const r = await docLookupResponse(env, base, dli, todayQ).catch(() => null);
    if (r) return { kind: 'final', response: r };
  }

  // "What passed at the last council meeting?", "and the one before that?": the newest meeting (before a date)
  // with recorded motions, every motion listed by code.
  const lmi = lastMeetingIntent(body.question, todayQ);
  if (lmi) {
    const date = await lastVotesDate(env, lmi.body, lmi.before, todayQ).catch(() => null);
    if (date) {
      const r = await meetingVotesResponse(env, base, { date, body: lmi.body, kind: MOVER_Q.test(body.question) ? 'mover' : lmi.kind }, staff).catch(() => null);
      if (r) return { kind: 'final', response: r };
    }
  }

  // "What did the council vote on in September?": one meeting that month is answered; several are offered as choices.
  const mvm = monthVotesIntent(body.question, todayQ);
  if (mvm) {
    const dates = await motionDates(env, mvm.body, mvm.month).catch(() => [] as string[]);
    const label = BODY_LABEL[mvm.body];
    if (dates.length === 1) {
      const r = await meetingVotesResponse(env, base, { date: dates[0], body: mvm.body, kind: 'all' }, staff).catch(() => null);
      if (r) return { kind: 'final', response: r };
    } else if (dates.length > 1) {
      const month = longDay(`${mvm.month}-01`).replace(/ 1,/, '');
      return { kind: 'final', response: clarifyResponse(base, monthClarify(label, month, dates), { path: '/votes', label: 'Open voting records', hint: 'Every recorded vote, meeting by meeting' }) };
    }
  }

  // "Who made the motion to hire Jared Tamez?": the recorded motion found by the names (or words) it gives.
  if (MOVER_Q.test(body.question) && !meetingDateIn(body.question, todayQ) && !measureRefIn(body.question) && !namedNow) {
    const words = motionSearchWords(base.question);
    const found = words.length ? await queryMotions(env, { q: words.join(' '), pageSize: 6 }).catch(() => null) : null;
    if (found && found.items.length >= 1 && found.items.length <= 4) {
      const r = await moversResponse(env, base, found.items, staff).catch(() => null);
      if (r) return { kind: 'final', response: r };
    }
  }

  // "What did the council vote on at the September 8 meeting?": every recorded motion of that
  // meeting, from the voting records, never a model summary that can leave one out.
  // A question about one member's votes ("how did Wood vote on September 8?") goes on to the member path.
  // "How did the council vote on Ordinance 2026-07?", "who broke the tie on it?": that measure's recorded
  // motion, every member by title and last name, written by code.
  const mvi = measureVotesIntent(body.question);
  if (mvi) {
    const r = await measureVotesResponse(env, base, mvi, staff).catch(() => null);
    if (r) return { kind: 'final', response: r };
  }
  const ivi = namedNow || meetingDateIn(body.question, todayQ) ? null : itemVoteIn(body.question);
  if (ivi) {
    const r = await itemVotesResponse(env, base, ivi, staff).catch(() => null);
    if (r) return { kind: 'final', response: r };
  }
  const mv = namedNow ? null : meetingVotesIntent(body.question, utahToday());
  if (mv && !meetingBodyIn(body.question)) {
    // Two bodies met that day and the question names neither: ask which.
    const bodies = await bodiesOnDate(env, mv.date).catch(() => [] as MeetingBody[]);
    const c = bodyClarify(body.question, mv.date, bodies);
    if (c) return { kind: 'final', response: clarifyResponse(base, c, { path: '/votes', label: 'Open voting records', hint: 'Every recorded vote, meeting by meeting' }) };
  }
  if (mv) {
    const r = await meetingVotesResponse(env, base, mv, staff).catch(() => null);
    if (r) return { kind: 'final', response: r };
  }

  // Budget figures and dates (fund and department totals, revenue lines, the adoption date) come
  // straight from worker/lib/budgetData.ts, written by code and cited to the budget documents, so
  // the same question always gets the same numbers. Never the model's wording of a figure.
  // "What is the property tax rate?": the certified rate, its fiscal year and its date, written by
  // code from worker/lib/taxRates.ts, or from a newer tax rate record when the archive holds one.
  // Checked before the budget figures so "how much is the property tax rate" is never the revenue line.
  const tri = taxRateIntent(body.question);
  if (tri) {
    const newer = await newerRateRecord(env).catch(() => null);
    const sentences = taxRateSentences(tri, utahToday(), newer);
    if (sentences.length) {
      const r = await taxRateResponse(env, base, sentences);
      return { kind: 'final', response: { ...r, suggestedFollowUps: suggestFollowUps({ engine: 'tax-rate-data' }).filter((f) => !sameQuestion(f, body.question)) } };
    }
  }

  const bi = budgetIntent(body.question);
  if (bi) return { kind: 'final', response: await budgetResponse(env, base, budgetAnswer(bi)) };

  // "How much is the pavilion rental fee?": the page of the newest fee schedule that lists it.
  const fi = feeIntent(body.question);
  if (fi) {
    const r = await feeResponse(env, base, fi.words).catch(() => null);
    if (r) return { kind: 'final', response: r };
  }

  // "Who do I contact about a pothole?": the staff member the directory lists for it.
  if (CONTACT_Q.test(body.question)) {
    const p = contactFor(`how do I contact someone about ${body.question}`, staff);
    if (p) {
      const text = contactLine(p);
      return { kind: 'final', response: codeResponse(base, 'directory', [{ segments: [{ text, citations: [] }] }], { contact: p.slug, section: { path: `/people/${p.slug}`, label: `Open ${p.role} ${p.name.split(/\s+/).pop()}`, hint: 'Phone, email and department' } }) };
    }
  }

  // A message that names a part of the portal ("voting record", "staff directory"): what it holds,
  // answered from the data, with a card that opens it here.
  const sec = sectionFor(body.question);
  if (sec) {
    const card = { path: sec.section.path, label: sec.section.label, hint: sec.section.hint };
    const final = (text: string, extra: Record<string, unknown> = {}) =>
      ({ kind: 'final', response: { ...base, retrievalStatus: 'grounded', answer: text, paragraphs: [{ segments: [{ text, citations: [] }] }], citations: [], notice: null, engine: 'catalog', section: card, ...extra } as AskResponse }) as Prepared;
    if (sec.section.id !== 'votes') return final(sec.section.text);
    const council = await currentCouncil(env).catch(() => [] as string[]);
    const member = sec.rest ? (councilName(sec.rest.replace(/\b[a-z]/g, (c) => c.toUpperCase()), council) ?? council.find((n) => n.toLowerCase().split(' ').some((w) => w.length >= 4 && sec.rest.split(' ').includes(w))) ?? null) : null;
    if (!sec.rest || member) {
      const r = await queryMotions(env, { member, pageSize: 400 }).catch(() => ({ items: [] as MotionOut[], total: 0 }));
      if (r.items.length) {
        const nice = (d: string | null) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '');
        const what = (m: MotionOut) => (m.items.length ? `consent items (${m.items.slice(0, 3).map((x) => x.replace(/^\d+(?:\.\d+)*\s+/, '').replace(/^Approv(?:al of|e)\s+(?:the\s+)?/i, '').slice(0, 70)).join(', ')}${m.items.length > 3 ? ', and more' : ''})` : (m.item ?? m.motion).replace(/^\d+(?:\.\d+)*\s+/, '').replace(/\s+/g, ' ').slice(0, 110));
        const newest = r.items.filter((m) => m.date === r.items[0].date);
        const meetings = new Set(r.items.map((m) => `${m.bodyId}|${m.date}`)).size;
        const recent = `The most recent ${newest.length === 1 ? 'was' : 'were'} on ${nice(newest[0].date)}: ${newest.slice(0, 4).map(what).join('; ')}.`;
        let text: string;
        if (member) {
          const last = member.split(' ').pop() ?? member;
          const mine = r.items.map((m) => m.votes.find((v) => v.member === member || v.member === last)?.vote).filter(Boolean) as string[];
          const n = (k: string) => mine.filter((v) => v === k).length;
          const other = mine.length - n('yes') - n('no');
          const mayor = staff.find((p) => /\bmayor\b/i.test(p.role) && !/deputy/i.test(p.role))?.name ?? null;
          text = `${memberTitle(member, 'city-council', mayor)} has ${mine.length} recorded ${mine.length === 1 ? 'vote' : 'votes'} on policy items in the minutes posted since January 2026: ${n('yes')} yes and ${n('no')} no${other ? `, plus ${other} abstained, recused or absent` : ''}. ${recent} Open a vote to see the full roll call.`;
        } else {
          text = `The City Council and RDA board have ${r.total} recorded policy ${r.total === 1 ? 'vote' : 'votes'} across ${meetings} meetings in the minutes posted since January 2026. ${recent} Each card shows how every member voted, and the full record is one tap away.`;
        }
        return final(text, { votes: { member, q: '', items: newest.slice(0, 3) }, suggestedFollowUps: member ? [`What did ${member} vote no on?`] : ['What was the latest thing passed?', 'Which votes were not unanimous?'] });
      }
    }
  }

  // Knowledge-base questions answered straight from the calendar and the catalog: exact and free.
  const quick = (text: string, event?: unknown, followUps: string[] = [], section?: { path: string; label: string; hint: string }) =>
    ({
      kind: 'final',
      // Every answer opens a page inside the portal: the one that holds this subject, when no card is given.
      response: { ...base, retrievalStatus: 'grounded', answer: text, paragraphs: [{ segments: [{ text, citations: [] }] }], citations: [], suggestedFollowUps: followUps, notice: null, engine: 'catalog', mode: 'conversation', ...(event ? { event } : {}), section: section ?? (event ? undefined : routeFor(body.question).section) } as AskResponse,
    }) as Prepared;
  const todayUT = utahToday();
  const frame = resolveTime(body.question, todayUT);
  // A library card or the bookmobile: one right answer from the library's own site, with the button to its page.
  // "What construction is going on right now?": the city's page as last stored, with its date.
  if (isConstructionNowQuestion(body.question)) {
    const c = await constructionAnswer(env).catch(() => null);
    if (c) return quick(c.text, undefined, c.followUps, { path: '/construction', label: 'Open construction', hint: "The city's construction page, by version, with the map" });
  }
  const service = serviceAnswer(body.question);
  if (service) return quick(service.text, undefined, service.followUps);
  // "Is the city hiring?": the official job site, live.
  if (isJobsQuestion(body.question)) {
    const jobs = await openJobs().catch(() => null);
    if (jobs) return quick(jobsText(jobs), undefined, ['How do I apply for a city job?']);
  }
  if (isMeetingCountQuestion(body.question)) {
    const r = await meetingsInFrame(env, body.question, frame).catch(() => null);
    if (r) return quick(r.text, r.event ?? undefined, ["When is the next City Council meeting?"]);
  }
  const kindToCount = countKind(body.question);
  if (kindToCount && frame && !frame.future) {
    const t = await countAnswer(env, kindToCount, frame).catch(() => null);
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
          suggestedFollowUps: suggestFollowUps({ engine: 'schedule', scheduleBody: bodyOf(body.question).label }),
          notice: null,
          engine: 'schedule',
          mode: 'conversation',
          event: s.event,
          asOf: todayUT,
          asOfLabel: s.event.source === 'city-calendar' ? 'City calendar' : 'Meeting portal',
        } as AskResponse,
      };
    }
  }

  // "When is the next Planning Commission meeting and what is on the agenda?": the date, time and
  // place come from the meeting record, and agenda content only from that meeting's own agenda
  // records (same body, same meeting id). With no posted agenda, nothing is said about content.
  let agendaLock: { docIds: Set<string>; meetingId: string; schedule: ScheduleAnswer; question: string } | null = null;
  if (isNextAgendaQuestion(body.question)) {
    const label = bodyOf(body.question).label;
    const na = await nextAgenda(env, body.question).catch(() => undefined);
    const scheduleFinal = (text: string, s: ScheduleAnswer | null): Prepared => ({
      kind: 'final',
      response: { ...base, retrievalStatus: 'grounded', answer: text, paragraphs: [{ segments: [{ text, citations: [] }] }], citations: [], suggestedFollowUps: [], notice: null, engine: 'schedule', mode: 'conversation', ...(s ? { event: s.event } : {}) } as AskResponse,
    });
    if (na === undefined) return { kind: 'final', response: await routeResponse(env, base, `${label} meetings`, 'route (schedule read failed)') };
    if (na === null) {
      const r = await routeResponse(env, base, `${label} meetings`, 'schedule');
      const text = `The city's official calendar and meeting portal do not list an upcoming ${label} meeting yet. Past ${label} meetings are on the Meetings page.`;
      return { kind: 'final', response: { ...r, answer: text, paragraphs: [{ segments: [{ text, citations: [] }] }] } };
    }
    if (!na.meetingId || !na.agendaDocIds.length) return scheduleFinal(`${na.schedule.text} ${AGENDA_NOT_POSTED}`, na.schedule);
    agendaLock = {
      docIds: new Set(na.agendaDocIds),
      meetingId: na.meetingId,
      schedule: na.schedule,
      question: `${body.question}\n(Every source below is from the agenda or packet of this ${label} meeting, ${na.schedule.event.start.slice(0, 10)}. The date, time and place are given separately: describe only the items on this agenda, as scheduled, not as decided. Minutes reprinted inside a packet are from an earlier meeting; leave them out.)`,
    };
  }

  // "Who owns the parcel at Vineyard Connector and Main Street?", "where is Grove Park?": a card that
  // opens the portal map on that spot, from the city's own map layers. Never an owner's name.
  const pi = placeIntent(body.question);
  if (pi && !agendaLock) {
    const land = pi.owner || pi.zoning || pi.parcel || pi.kind === 'intersection' || pi.kind === 'address';
    const spot = await resolvePlace(pi).catch(() => null);
    // A plain "where is X" that is not on the map layers goes on to the records search.
    if (spot || land) {
      const a = placeAnswer(pi, spot);
      return { kind: 'final', response: { ...base, retrievalStatus: 'grounded', answer: a.text, paragraphs: [{ segments: [{ text: a.text, citations: [] }] }], citations: [], suggestedFollowUps: [], notice: null, engine: 'map', mode: 'conversation', map: a.map } as AskResponse };
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
  // "Who spoke during public comment at the September 8, 2026 City Council meeting?": only that meeting's
  // own records (filed under it, or its body's minutes, agenda and packet of that day) reach the model.
  const dated = agendaLock ? null : await datedMeeting(env, body.question, todayUT).catch(() => null);
  if (dated && !meetingBodyIn(body.question)) {
    // "Who spoke at the September 15 meeting?" when the council and the RDA both met: ask which.
    const bodies = await bodiesOnDate(env, dated.date).catch(() => [] as MeetingBody[]);
    const c = bodyClarify(body.question, dated.date, bodies);
    if (c) return { kind: 'final', response: clarifyResponse(base, c, { path: '/meetings?view=past', label: 'Open past meetings', hint: 'Agendas, packets, minutes and video' }) };
  }
  // "Where is the November 17 joint meeting with Orem?": the place and time from the meeting record.
  if (dated && dated.meetingIds.length && !dated.outcome && PLACE_TIME_Q.test(body.question)) {
    const row = await env.CATALOG_DB.prepare('SELECT id, title, start_time, location FROM meetings WHERE id IN (SELECT value FROM json_each(?)) ORDER BY CASE WHEN location IS NULL OR location = \'\' THEN 1 ELSE 0 END LIMIT 1')
      .bind(JSON.stringify(dated.meetingIds))
      .first<{ id: string; title: string | null; start_time: string | null; location: string | null }>()
      .catch(() => null);
    const text = row ? meetingPlaceText(dated.name, row.title, row.start_time, row.location) : null;
    if (row && text) {
      const section = { path: `/meetings/${row.id}`, label: `Open the ${dated.name}`, hint: 'Agenda, packet, minutes and video' };
      return { kind: 'final', response: codeResponse(base, 'meeting-place', [{ segments: [{ text, citations: [] }] }], { section }) };
    }
  }
  const focus = agendaLock || dated ? null : await meetingFocus(env, body.question).catch(() => null);
  let hits: ChunkHit[] = [];
  let question = body.question;
  // Minutes when the question asks what happened and the archive has them; otherwise every record of the meeting.
  const datedIds = dated ? (dated.outcome && dated.minutesIds.size ? dated.minutesIds : dated.docIds) : null;
  const inDated = (h: ChunkHit) => Boolean(dated && datedIds?.has(h.documentId) && !reprintedMinutes(h, dated.date));
  const datedNone = async (searched: ChunkHit[]): Promise<Prepared> => {
    const m = dated!;
    const section = m.meetingId ? { path: `/meetings/${m.meetingId}`, label: `Open the ${m.name}`, hint: 'Agenda, packet, minutes and video' } : routeFor(`${BODY_LABEL[m.body]} meeting`).section;
    // The meeting's own records, quoted where they hold the question's words; else the meeting page.
    const q = await quotesResponse(env, base, body.question, searched, staff, 'record-quotes (meeting records)', `From the records of the ${m.name}:`).catch(() => null);
    if (q) return { kind: 'final', response: { ...q, section } as AskResponse };
    const text = `Nothing in the ${m.minutesIds.size ? 'minutes, agenda or packet' : 'agenda or packet'} of the ${m.name} answers that${m.minutesIds.size ? '' : ', and its minutes are not posted yet'}. Its records and video are on the meeting page.`;
    return { kind: 'final', response: codeResponse(base, 'route (nothing in the meeting records)', [{ segments: [{ text, citations: [] }] }], { section, relatedDocuments: await closestDocs(searched) }) };
  };
  if (dated) {
    const m = dated;
    const rest = body.question.replace(/[?.!,]/g, ' ').replace(MONTH_WORDS, ' ').replace(/\b\d+(?:st|nd|rd|th)?\b/g, ' ').replace(FILLER, ' ').replace(/\b(rda|redevelopment|agency|board|that|this|night|evening|day)\b/gi, ' ').replace(/\s+/g, ' ').trim();
    const terms = rest.length >= 3 ? rest : 'approve approved motion ordinance resolution item public hearing presentation';
    const lists = await Promise.all([
      ...m.meetingIds.map((id) => retrieve(terms, { ...filters, meetingId: id }).catch(() => [] as ChunkHit[])),
      retrieve(terms, { ...filters, dateFrom: m.date, dateTo: m.date, governmentBodyIds: [m.body] }).catch(() => [] as ChunkHit[]),
    ]);
    hits = interleave(lists, 60).filter(inDated);
    if (!hits.length) return datedNone([]);
    const fromMinutes = hits.every((h) => m.minutesIds.has(h.documentId));
    question = fromMinutes
      ? `${body.question}\n(Every source below is from the minutes of the ${m.name}. Start by naming that meeting and its date. Say only what these minutes record; if they do not answer the question, reply NO_RECORD.)`
      : `${body.question}\n(Every source below is from the records of the ${m.name}: its agenda, packet${m.minutesIds.size ? ' and minutes' : ''}. Start by naming that meeting and its date.${m.minutesIds.size ? '' : ' Its minutes are not in the archive, so describe items as scheduled, not as decided.'} Minutes of an earlier meeting reprinted in a packet are from that other meeting; leave them out. If these records do not answer the question, reply NO_RECORD.)`;
  }
  if (agendaLock) {
    const lock = agendaLock;
    const rest = body.question.replace(/[?.!,]/g, ' ').replace(FILLER, ' ').replace(/\s+/g, ' ').trim();
    const f: SearchFilters = { ...filters, meetingId: lock.meetingId, documentTypes: [...AGENDA_TYPES] };
    const lists = await Promise.all([retrieve('agenda item public hearing presentation consider approve discussion action', f), rest.length >= 3 ? retrieve(rest, f) : Promise.resolve([] as ChunkHit[])]);
    hits = interleave(lists, 40).filter((h) => lock.docIds.has(h.documentId));
    if (!hits.length) {
      const text = `${lock.schedule.text} The agenda for this meeting is posted, but its text is not in the archive yet.`;
      return { kind: 'final', response: { ...base, retrievalStatus: 'grounded', answer: text, paragraphs: [{ segments: [{ text, citations: [] }] }], citations: [], suggestedFollowUps: [], notice: null, engine: 'schedule', mode: 'conversation', event: lock.schedule.event } as AskResponse };
    }
  }
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
        // The time the question is about ("last year", "this month", "since 2020"), searched on its own.
        frame && !frame.future ? retrieve(q0, { ...filters, dateFrom: frame.from, dateTo: frame.to }).catch(() => [] as ChunkHit[]) : Promise.resolve([] as ChunkHit[]),
        frame && !frame.future ? retrieve(retrievalText, { ...filters, dateFrom: frame.from, dateTo: frame.to }).catch(() => [] as ChunkHit[]) : Promise.resolve([] as ChunkHit[]),
        // "What is happening with X", "current", "plans": this year's records searched on their own,
        // so the latest minutes and packets are always in the pool.
        !frame && PRESENT_Q.test(body.question) ? retrieve(q0, { ...filters, dateFrom: new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10) }).catch(() => [] as ChunkHit[]) : Promise.resolve([] as ChunkHit[]),
      ]);
      hits = interleave([...planned, direct], 90);
    } else if (frame && !frame.future) {
      const inFrame = await retrieve(retrievalText, { ...filters, dateFrom: frame.from, dateTo: frame.to }).catch(() => [] as ChunkHit[]);
      hits = interleave([inFrame, direct], 90);
    } else hits = direct;
  }
  // "Is there a cap on what it can collect?" after an answer about the Geneva URA: the records that
  // answer cited are read again, the passages holding its figures first, so a figure the follow-up
  // repeats is checked against the record that states it.
  const priorIds = new Set<string>();
  const lastAnswer = !agendaLock && (aiFollow ?? retrievalText !== body.question) ? [...(body.conversation ?? [])].reverse().find((t) => t.role === 'assistant') : undefined;
  if (lastAnswer?.sources?.length) {
    const prior = await priorRecordHits(repo, retrieve, lastAnswer.sources, lastAnswer.content, body.question, filters).catch(() => [] as ChunkHit[]);
    prior.forEach((h) => priorIds.add(h.chunkId));
    const seenPr = new Set<string>();
    hits = [...prior, ...hits].filter((h) => (seenPr.has(h.chunkId) ? false : (seenPr.add(h.chunkId), true)));
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
    // Source: the six-member council form, see the governance note in worker/ai/answer.ts.
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
  // Issues of today (City Hall, the form of government, elections): the records that settle them are
  // searched by name and lead, and the model is told the plain state of things it must cite.
  const govIds = new Set<string>();
  const topicIds = new Set<string>();
  const topics = topicsFor(body.question, todayUT);
  for (const t of topics) {
    const lists = await Promise.all(t.queries.map((x) => retrieve(x.q, { ...filters, ...(x.from ? { dateFrom: x.from } : {}) }).catch(() => [] as ChunkHit[])));
    const found = interleave(lists, 4);
    found.forEach((h) => (t.id === 'form-of-government' ? govIds : topicIds).add(h.chunkId));
    const seenT = new Set<string>();
    hits = [...hits.slice(0, 30), ...found, ...hits.slice(30)].filter((h) => (seenT.has(h.chunkId) ? false : (seenT.add(h.chunkId), true)));
  }
  let topicNotes = topics.map((t) => t.note).filter(Boolean).join(' ');
  // "Is 575 South under construction? When will it reopen?": the newest records about that road
  // (council packets and minutes, construction notices, city email updates) say what is under way
  // now. The capital project list shows planning phases and can lag, so it never settles this alone.
  const roadIds = new Set<string>();
  const roads = roadsIn(retrievalText);
  let roadNote = '';
  if (roads.length && ROAD_STATUS.test(retrievalText)) {
    const since = new Date(Date.parse(`${todayUT}T12:00:00Z`) - 270 * 86_400_000).toISOString().slice(0, 10);
    const qs = roads.slice(0, 2).flatMap((r) => [`"${r}" construction`, `"${r}" closure closed reopen`, `"${r}" road improvements contractor`]);
    const lists = await Promise.all(qs.map((q) => retrieve(q, { ...filters, dateFrom: since }).catch(() => [] as ChunkHit[])));
    const found = interleave(lists, 6);
    found.forEach((h) => roadIds.add(h.chunkId));
    const seenR2 = new Set<string>();
    hits = [...hits.slice(0, 20), ...found, ...hits.slice(20)].filter((h) => (seenR2.has(h.chunkId) ? false : (seenR2.add(h.chunkId), true)));
    if (found.length)
      roadNote = `Road construction: answer from the newest records about ${roads.slice(0, 2).join(' and ')} (council packets and minutes, resolutions, construction notices, city email updates): say what work is under way or approved, any closure, and any completion or reopening date they give, each with its date. The capital project list shows planning phases and can lag behind, so never say a road is not under construction only because that list does not show it. If no record gives a finish date, say so and point to the city's road signs and Public Works.`;
  }
  if (roadNote) topicNotes = `${topicNotes} ${roadNote}`.trim();
  // Where things stand now: this year's recorded motions on the topic (from the minutes), so a
  // present-tense question is answered from what the council actually did this year.
  const voteIds = new Set<string>();
  if ((PRESENT_Q.test(retrievalText) || VOTE.test(retrievalText) || (frame && !frame.future && frame.to >= `${todayUT.slice(0, 4)}-01-01`)) && !isScheduleQuestion(retrievalText)) {
    const from = frame && !frame.future ? frame.from : `${Number(todayUT.slice(0, 4)) - (VOTE.test(retrievalText) ? 3 : 0)}-01-01`;
    const to = frame && !frame.future ? frame.to : todayUT;
    const mh = await motionEvidence(env, retrievalText, from, to).catch(() => [] as ChunkHit[]);
    mh.forEach((h) => voteIds.add(h.chunkId));
    const seenV = new Set<string>();
    hits = [...hits.slice(0, 15), ...mh, ...hits.slice(15)].filter((h) => (seenV.has(h.chunkId) ? false : (seenV.add(h.chunkId), true)));
  }
  // "What's the latest thing that passed?" with no topic: the newest recorded votes answer it, nothing else.
  let latestAction = false;
  let latestHits: ChunkHit[] = [];
  if (LATEST_ACTION_Q.test(retrievalText) && !voteIds.size && !isScheduleQuestion(retrievalText)) {
    const raw = await motionEvidence(env, '', '', todayUT, 8, true).catch(() => [] as ChunkHit[]);
    // One passage per meeting (all its votes together), so every item the newest meeting passed is read.
    const byDoc = new Map<string, ChunkHit[]>();
    for (const h of raw) (byDoc.get(h.documentId) ?? byDoc.set(h.documentId, []).get(h.documentId)!).push(h);
    const mh = [...byDoc.values()].map((g) => (g.length === 1 ? g[0] : { ...g[0], sectionTitle: null, text: g.map((h, i) => `Vote ${i + 1}: ${h.text}`).join(' ') }));
    if (mh.length) {
      latestAction = true;
      latestHits = mh;
      mh.forEach((h) => voteIds.add(h.chunkId));
      const seenV = new Set<string>();
      hits = [...mh, ...hits].filter((h) => (seenV.has(h.chunkId) ? false : (seenV.add(h.chunkId), true)));
      const newest = mh[0].documentDate ?? '';
      const n = raw.filter((h) => h.documentDate === newest).length;
      topicNotes = `${topicNotes} Latest council action: the recorded votes listed first are the newest in the posted minutes, newest first. The most recent meeting with posted minutes is ${newest}, and ${n} policy ${n === 1 ? 'item' : 'items'} passed at it. Answer with what passed at that meeting: each item, the vote count and the date. Never present an older vote as the latest. Add that minutes for any later meeting may not be posted yet.`.trim();
    }
  }
  // "How do I...": the city website's own page for that service says how, so it is read first.
  const pageIds = new Set<string>();
  if (HOWTO.test(body.question)) {
    const q0 = plan?.queries[0] ?? retrievalText;
    const pages = await Promise.all([q0, retrievalText].map((q) => retrieve(q, { ...filters, sourceIds: ['vineyard-city-website'], documentTypes: ['other'] }).catch(() => [] as ChunkHit[])));
    const found = interleave(pages, 4);
    found.forEach((h) => pageIds.add(h.chunkId));
    const seenP = new Set<string>();
    hits = [...hits.slice(0, 20), ...found, ...hits.slice(20)].filter((h) => (seenP.has(h.chunkId) ? false : (seenP.add(h.chunkId), true)));
  }
  // "The first meeting in May 1989", "the earliest minutes": the actual earliest record of that kind
  // in the window is read directly, so "first" means first by date, not best keyword match.
  const firstIds = new Set<string>();
  const FIRST = /\b(first|earliest|oldest)\b(?!\s+responders?)/i;
  if (FIRST.test(body.question)) {
    const type = /\b(minutes|meeting|decide|decided|approved)\b/i.test(body.question) ? 'minutes' : /\bresolution/i.test(body.question) ? 'resolution' : /\bordinance/i.test(body.question) ? 'ordinance' : null;
    if (type) {
      const row = await env.CATALOG_DB.prepare(
        `SELECT min(document_date) AS d FROM documents WHERE document_type = ? AND document_date IS NOT NULL${frame ? ' AND document_date BETWEEN ? AND ?' : ''}${/town council|city council|council/i.test(body.question) ? " AND government_body_id = 'city-council'" : ''}`,
      )
        .bind(...(frame ? [type, frame.from, frame.to] : [type]))
        .first<{ d: string | null }>()
        .catch(() => null);
      if (row?.d) {
        const earliest = await retrieve(retrievalText, { ...filters, documentTypes: [type as DocumentType], dateFrom: row.d, dateTo: row.d }).catch(() => [] as ChunkHit[]);
        earliest.slice(0, 4).forEach((h) => firstIds.add(h.chunkId));
        const seenF = new Set<string>();
        hits = [...earliest.slice(0, 4), ...hits].filter((h) => (seenF.has(h.chunkId) ? false : (seenF.add(h.chunkId), true)));
      }
    }
  }
  // "What is the property tax rate?": a value in effect now. The last two years of records are
  // searched on their own so the newest record that states it is always a candidate.
  const currentValue = asksCurrentValue(body.question) && !focus && !agendaLock;
  if (currentValue) {
    const since = new Date(Date.parse(`${todayUT}T12:00:00Z`) - 730 * 86_400_000).toISOString().slice(0, 10);
    const recent = await Promise.all([...new Set([plan?.queries[0] ?? retrievalText, retrievalText])].map((q) => retrieve(q, { ...filters, dateFrom: since }).catch(() => [] as ChunkHit[])));
    const found = interleave(recent, 12);
    const seenN = new Set<string>();
    hits = [...hits.slice(0, 20), ...found, ...hits.slice(20)].filter((h) => (seenN.has(h.chunkId) ? false : (seenN.add(h.chunkId), true)));
    topicNotes = `${topicNotes} Current value: the question asks for a rate or amount in effect now. Answer from the newest record among the sources that states it, and start with that value's fiscal or tax year and the record's title and date, in the form "<what> for fiscal <year>: <value> (<record title>, <date>)". If no source is from the current fiscal year, say this is the newest figure found in the records and give its date. Never give a rate or amount without its year, and never present an older year's figure as current.`.trim();
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
  if (agendaLock) {
    // Nothing from another body or another meeting reaches the model.
    const lock = agendaLock;
    hits = hits.filter((h) => lock.docIds.has(h.documentId));
    latestHits = [];
    topicNotes = '';
    question = lock.question;
  }
  if (dated) {
    // Nothing from another meeting reaches the model, reprinted minutes included.
    const searched = hits;
    hits = hits.filter(inDated);
    latestHits = [];
    topicNotes = '';
    if (!hits.length) return datedNone(searched.filter((h) => dated.docIds.has(h.documentId)));
  }
  // Resident submissions never inform answers about votes, the budget, meetings or construction.
  hits = withoutResidentFor(hits, retrievalText, Boolean(focus || agendaLock || dated) || voteIds.size > 0 || roadIds.size > 0);
  question = `${question}\n(${timeNote(todayUT, frame)}${topicNotes ? ` ${topicNotes}` : ''}${CURRENT.test(body.question) || ROLE.test(body.question) ? ' Answer with the current information: a record marked current outranks older records. Say what date your source is from.' : ''})`;
  const loose = parseQuery(retrievalText, { match: 'any' });
  const budgetOk = await budgetP;
  // Nothing found: the part of the portal that holds it. The model down or over budget: the records quoted.
  if (!hits.length) return { kind: 'final', response: await routeResponse(env, base, body.question, 'route (no matching records)') };
  if (!aiReady || budgetOk == null) {
    const why = !aiConfigured(env) ? 'AI not configured' : aiBreakerOpen() ? 'paused after a quota error' : 'daily answer limit reached';
    return { kind: 'final', response: await recordsAnswer(env, base, body.question, hits, staff, why) };
  }

  // Every candidate passage is read against the question by a reranker; the answer is written from
  // the passages that answer it. A record marked current stays first for "who is / now" questions.
  const ranked = await rerank(env, retrievalText, hits.slice(0, 90));
  if (ranked) {
    let best = frame ? relevant(ranked) : recencyWeighted(relevant(ranked), retrievalText, Number(new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 4)), currentIds, RULE.test(body.question));
    // Records that must lead for some questions, in the reranker's own order: the current
    // directory for "who is", the person's recorded votes for "how did X vote", the code for rules.
    const lead = (ids: Set<string>, n: number) => {
      if (!ids.size) return;
      const first = ranked.filter((h) => ids.has(h.chunkId)).slice(0, n);
      best = [...first, ...best.filter((h) => !first.includes(h))];
    };
    // A question about a time ("last year", "in March", "since 2020") is answered from records of
    // that time first; code sections and current lists keep their place.
    if (frame && !frame.future) {
      const y0 = Number(frame.from.slice(0, 4));
      const y1 = Number(frame.to.slice(0, 4));
      const inside = (h: ChunkHit) => (h.documentDate ? h.documentDate >= frame.from && h.documentDate <= frame.to : h.year != null && h.year >= y0 && h.year <= y1);
      const ins = best.filter(inside);
      if (ins.length) best = [...ins, ...best.filter((h) => !inside(h))];
    }
    lead(priorIds, 2);
    lead(govIds, 1);
    lead(topicIds, 3);
    lead(roadIds, 4);
    lead(voteIds, latestAction ? 8 : 3);
    lead(pageIds, 2);
    lead(codeIds, 2);
    lead(pinnedVotes, 4);
    if (person && /\bmayor\b/i.test(person.role) && !/deputy/i.test(person.role)) lead(govIds, 2);
    lead(currentIds, 2);
    lead(firstIds, 3);
    // A value in effect now: among the passages that answer, the newest records first.
    if (currentValue) {
      const top = best.slice(0, 10).sort((a, b) => String(b.documentDate ?? `${b.year ?? 0}-00-00`).localeCompare(String(a.documentDate ?? `${a.year ?? 0}-00-00`)));
      best = [...top, ...best.slice(10)];
    }
    // "The first meeting", "the earliest ordinance": among the passages that answer, oldest first.
    if (/\b(first|earliest|oldest|original)\b(?!\s+responders?)/i.test(body.question)) {
      const top = best.slice(0, 8).sort((a, b) => String(a.documentDate ?? `${a.year ?? 9999}-12-31`).localeCompare(String(b.documentDate ?? `${b.year ?? 9999}-12-31`)));
      best = [...top, ...best.slice(8)];
    }
    hits = best;
  }
  // The newest votes stay first, in date order, whatever the ranking made of them.
  if (latestHits.length) hits = [...latestHits, ...hits.filter((h) => !voteIds.has(h.chunkId))];
  // A property tax rate is answered only from tax rate records: never from a project's fiscal analysis
  // or any other record that happens to assume a rate.
  if (isTaxRateQuestion(body.question)) {
    const searched = hits;
    hits = hits.filter((h) => isTaxRateRecord(h));
    if (!hits.length) return { kind: 'final', response: await recordsAnswer(env, base, body.question, searched, staff, 'no tax rate record') };
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

  // A new topic is answered on its own: earlier turns reach the model only for a real follow-up,
  // so a question about utilities is never pulled back to the road asked about before.
  const follow = !agendaLock && !dated && (aiFollow ?? retrievalText !== body.question);
  const prior = follow ? (body.conversation ?? []).slice(-4).map((t) => ({ role: t.role, content: t.content.slice(0, 600) })) : [];
  const messages: Msg[] = [{ role: 'system', content: RAG_SYSTEM_PROMPT }, ...prior, { role: 'user', content: buildUserMessage(question, evidence, follow ? history : []) }];

  const fail = async (e: unknown): Promise<AskResponse> => {
    const msg = e instanceof Error ? e.message : String(e);
    // Quota / capacity / auth errors open the breaker so we stop spending requests for a while.
    // Only a spent daily allowance pauses AI answers (until it resets); any other error affects
    // just this one answer, and both models were already tried.
    if (/4006|daily free allocation|neuron|quota/i.test(msg)) breakerUntil = Date.now() + 30 * 60_000;
    await bumpQuota(env, 'ai_failures').catch(() => undefined);
    return recordsAnswer(env, base, body.question, [...evidence, ...hits], staff, msg.replace(/\s+/g, ' ').slice(0, 160), follow ? (history[history.length - 1] ?? '') : '');
  };

  // A question about one meeting ("at the September 8, 2026 City Council meeting") that finds no answer
  // still opens that meeting: its record holds the agenda, packet, minutes and video.
  const namedMeeting = async (): Promise<{ text: string; section: { path: string; label: string; hint: string } } | null> => {
    const date = meetingDateIn(body.question, utahToday());
    if (!date) return null;
    const mb = meetingBodyIn(body.question) ?? 'city-council';
    const row = await env.CATALOG_DB.prepare(`SELECT id FROM meetings WHERE substr(meeting_date, 1, 10) = ? AND government_body_id = ? ORDER BY CASE WHEN id LIKE 'mtg_cc_%' THEN 0 ELSE 1 END LIMIT 1`)
      .bind(date, mb)
      .first<{ id: string }>()
      .catch(() => null);
    if (!row) return null;
    const name = `${longDay(date)} ${BODY_LABEL[mb]} meeting`;
    return { text: `The ${name} record has its agenda, packet, minutes and video.`, section: { path: `/meetings/${row.id}`, label: `Open the ${name}`, hint: 'Agenda, packet, minutes and video' } };
  };

  /** No checked answer from the model: the closest records quoted, else the meeting or portal page that holds it. */
  const noAnswer = async (why: string): Promise<AskResponse> => {
    const named = await namedMeeting().catch(() => null);
    const pool = [...evidence, ...hits];
    const context = follow ? (history[history.length - 1] ?? '') : '';
    const q = await quotesResponse(env, base, `${body.question} ${context}`.trim(), pool, staff, `record-quotes (${why})`, undefined, priorIds).catch(() => null);
    if (q) return named ? ({ ...q, section: named.section } as AskResponse) : q;
    if (named) return codeResponse(base, `route (${why})`, [{ segments: [{ text: named.text, citations: [] }] }], { section: named.section, relatedDocuments: await closestDocs(pool) });
    return routeResponse(env, base, body.question, `route (${why})`, pool);
  };

  const finish = async (raw: string, engine?: string): Promise<AskResponse> => {
    await quotaP;
    // The model found nothing that answers the question: say so plainly, with the closest records below.
    if (/^\s*NO_RECORD\b/.test(raw) || /^\s*NO_RECORD\s*$/m.test(raw.slice(0, 40))) return noAnswer(`${engine ?? DEFAULT_AI_MODEL}: no record`);
    const first = segmentAnswer(briefAnswer(attributeCitations(raw.replace(/\bNO_RECORD\b/g, ''), evidence)), evidence.length);
    // Every figure must be in the source it cites; unsupported sentences are removed.
    const grounded = groundParagraphs(first.paragraphs, evidence, topicNotes);
    // A closing sentence that only repeats figures already given is dropped.
    grounded.paragraphs = dropRestatement(tidyOpeners(grounded.paragraphs));
    // A current rate never stands without its year: a sentence giving one with no year or date is removed.
    if (currentValue) grounded.paragraphs = undatedRates(grounded.paragraphs);
    const seg = { ...first, paragraphs: grounded.paragraphs, used: new Set(grounded.paragraphs.flatMap((p) => p.segments.flatMap((x) => x.citations))) };
    // Nothing the model wrote could be tied to a source: the records quoted, never an unchecked answer.
    if (!seg.used.size) return noAnswer(`no sentence passed the source check: ${raw.replace(/\s+/g, ' ').slice(0, 200)}`);

    // Renumber cited sources 1..k in order of first use.
    const order = [...seg.used].sort((a, b) => a - b);
    const renumber = new Map(order.map((old, i) => [old, i + 1]));
    const cited = order.map((old) => evidence[old - 1]);
    // Officials by title and last name ("Council Member Nair", "Mayor Stratton"), titles from the roster
    // only, and only for records dated inside the person's seat.
    const roster = officialRoster(staff);
    const paragraphs = seg.paragraphs.map((p) => ({
      segments: p.segments.map((s) => {
        const citations = s.citations.map((c) => renumber.get(c) ?? c);
        return { text: titleOfficials(s.text, roster, citations.map((c) => cited[c - 1]?.documentDate)), citations };
      }),
    }));
    // Unverified sentences are simply left out; the answer never adds a disclaimer about them.

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
        sourceLabel: citationLabel(h.sourceId),
      };
    });

    const citedDocs = new Set(cited.map((c) => c.documentId));
    // Follow-ups only where a code path answers: the votes and minutes of the newest meeting the answer cites.
    const minutesCite = citations.filter((c) => c.documentType === 'minutes' && c.date && c.date >= SCOPE_FROM).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    const citedBody = minutesCite ? (docs.get(minutesCite.documentId)?.governmentBodyId ?? null) : null;
    const followBody: MeetingBody | null = citedBody === 'city-council' || citedBody === 'redevelopment-agency' || citedBody === 'planning-commission' ? citedBody : null;
    const suggested = minutesCite && followBody ? suggestFollowUps({ engine: 'votes-meeting', meeting: { date: String(minutesCite.date).slice(0, 10), body: followBody } }).filter((f) => !/meeting before/.test(f)) : [];
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
      suggestedFollowUps: suggested,
      notice: null,
      engine: `${engine ?? env.AI_MODEL ?? DEFAULT_AI_MODEL}${ranked ? ' + rerank' : ''}${plan ? ' + plan' : ''}`,
      ...((body as { debug?: boolean }).debug ? { draft: raw, plan, evidence: evidence.map((h, i) => `[${i + 1}] ${h.title} | ${h.documentDate ?? h.year ?? ''} | p${h.pageStart ?? ''}`) } : {}),
    };
  };

  // The next meeting's date, time and place lead, from the meeting record, ahead of its agenda items.
  const lock = agendaLock;
  // An answer about one dated meeting always names it.
  const datedFinish = dated
    ? async (raw: string, engine?: string): Promise<AskResponse> => {
        const r = await finish(raw, engine);
        if (!r.citations?.length || namesMeetingDay(r.answer, dated.date)) return r;
        const text = `From the records of the ${dated.name}:`;
        return { ...r, answer: `${text}\n\n${r.answer}`, paragraphs: [{ segments: [{ text, citations: [] }] }, ...(r.paragraphs ?? [])] } as AskResponse;
      }
    : finish;
  const lockFinish = lock
    ? async (raw: string, engine?: string): Promise<AskResponse> => {
        const r = await finish(raw, engine);
        const text = lock.schedule.text;
        return { ...r, answer: `${text}\n\n${r.answer}`, paragraphs: [{ segments: [{ text, citations: [] }] }, ...(r.paragraphs ?? [])], event: lock.schedule.event } as AskResponse;
      }
    : datedFinish;
  return { kind: 'model', messages, useBig: budgetOk < intVar(env.AI_BIG_PER_DAY, BIG_MODEL_PER_DAY), finish: lockFinish, fail };
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
        if (!/NO_RECORD/.test(raw)) await send('delta', { t: raw });
      } else {
        let streamed = false;
        try {
          raw = await streamSmall(env, prep.messages, async (t) => {
            streamed = true;
            await send('delta', { t });
          });
          if (!raw.trim()) throw new Error('Empty AI response');
        } catch (e) {
          // Nothing shown yet: one more try on the small model, whole (about 40 Neurons, only after an error).
          if (streamed) throw e;
          const r = await callModel(env, prep.messages, { useBig: false });
          raw = r.text;
          engine = `${r.engine} (retry after ${String(e instanceof Error ? e.message : e).slice(0, 80)})`;
          if (!/NO_RECORD/.test(raw)) await send('delta', { t: raw });
        }
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

/**
 * A follow-up that names its own subject and has a code path ("When is the next City Council meeting?",
 * "Show me Resolution 2026-34", "What is the property tax rate?", an off-topic question) needs no model
 * rewrite: about 11 Neurons saved on every such turn. Anything that refers back ("that", "they", "there")
 * is not one; "it" is, except in "does it cost" and the like.
 */
export function standsAlone(q: string, today: string): boolean {
  const refers = /\b(that|this|those|these|they|them|their|he|she|his|her|him|there|same|else)\b/i.test(q) || /\b(it|its)\b/i.test(q.replace(/\b(?:does|is|will|would|did) it (?:cost|take|open|close|start|run)\b/gi, ' '));
  if (refers) return false;
  if (isOffTopic(q)) return true;
  const pi = placeIntent(q);
  return Boolean(
    recordLookupIntent(q) ||
      measureRefIn(q) ||
      (meetingDateIn(q, today) && meetingBodyIn(q)) ||
      docLookupIntent(q, today)?.date ||
      monthVotesIntent(q, today) ||
      lastMeetingIntent(q, today) ||
      isScheduleQuestion(q) ||
      CONTACT_Q.test(q) ||
      feeIntent(q) ||
      taxRateIntent(q) ||
      budgetIntent(q) ||
      isConstructionNowQuestion(q) ||
      serviceAnswer(q) ||
      (pi && (pi.kind === 'intersection' || pi.kind === 'address')),
  );
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
  const typed = validate(raw);
  const wantsStream = Boolean(raw && typeof raw === 'object' && (raw as { stream?: unknown }).stream === true);
  const clientKey = request.headers.get('cf-connecting-ip') ?? 'anon';
  const retry = rateLimit(clientKey);
  if (retry != null) throw new HttpError(429, 'rate_limited', 'Too many questions. Try again shortly.', retry);

  // The conversation brain: follow-up or new question, rewritten to stand on its own, and what the
  // resident stated as fact. Everything after this reads the standalone question.
  // "and parks?", "what about the library?", "and for 2026?": the new subject (or time) goes into the
  // previous question's frame, word for word. This is exact, so it wins and the model is not asked.
  // "did anyone vote no that night?": the meeting named earlier (body and date) goes into the question.
  // "what about the RDA?", "and the one before that?", "who seconded it?", "show me the minutes": exact rewrites from the conversation.
  const exactQ = resolveFollowUp(fixSpelling(typed.question), typed.conversation ?? [], utahToday());
  const meetingQ = exactQ ?? meetingFollowUp(fixSpelling(typed.question), typed.conversation ?? [], utahToday());
  const elliptical = meetingQ ?? ellipticalFollowUp(fixSpelling(typed.question), typed.conversation ?? []);
  // A follow-up that names its own subject and has a code path is not sent to the rewrite model.
  const alone = !elliptical && standsAlone(fixSpelling(typed.question), utahToday());
  const rw = !elliptical && !alone && typed.conversation?.length && aiConfigured(env) && !aiBreakerOpen() ? await rewriteQuestion(env, fixSpelling(typed.question), typed.conversation).catch(() => null) : null;
  // A message with no subject of its own ("who voted for it and how much did it cost?") always
  // takes the subject of the previous turns, whatever the model decided: the model's rewrite is
  // used only when it kept that subject.
  const carried = elliptical ? null : carryOver(fixSpelling(typed.question), typed.conversation ?? []);
  const body = elliptical
    ? ({ ...typed, question: elliptical, followUp: true } as AskRequest)
    : carried
    ? ({ ...typed, question: rw?.followUp && keepsTopic(rw.standalone, carried.terms) ? rw.standalone : carried.standalone, followUp: true } as AskRequest)
    : rw
      ? ({ ...typed, question: rw.standalone, followUp: rw.followUp } as AskRequest)
      : typed;
  const shared = factsLine(rw?.facts ?? []);

  // Recurring reports (water quality, audits, budgets): every year's edition goes with the answer.
  const seriesP = seriesFor(env, body.question).catch(() => null);
  const prep = await prepare(env, body);
  const series = await seriesP;
  // Who to contact for what the resident is asking (current staff only), as a card and one line.
  const staff = await currentStaff(env).catch(() => [] as StaffPerson[]);
  const contact = namedIn(body.question, staff).length ? null : contactFor(body.question, staff);
  // "How did X vote on Y?": the recorded motions, straight from the voting records.
  const votes = await votesFor(env, body.question, staff).catch(() => null);
  const withContact = (r: AskResponse): AskResponse => {
    const x = r as AskResponse & { mode?: string; engine?: string; people?: string[] };
    // Only the motions the answer is about: the ones it cites, when it cites any.
    if (x.engine === 'votes-meeting' || x.engine === 'votes-measure') return r;
    if (votes && x.mode !== 'conversation' && !isNextAgendaQuestion(body.question)) r = { ...r, votes: { ...votes, items: citedMotions(votes.items, (r.citations ?? []).map((c) => c.excerpt?.chunkId)) } } as AskResponse;
    // What the resident shared is acknowledged as theirs, after the answer from the records.
    if (shared && x.mode !== 'conversation') r = { ...r, answer: `${r.answer} ${shared}`.trim(), paragraphs: [...(r.paragraphs ?? []), { segments: [{ text: shared, citations: [] }] }] };
    if (!contact || x.mode === 'conversation' || x.engine === 'directory' || x.people?.length) return r;
    const line = contactLine(contact);
    const paragraphs = [...(r.paragraphs ?? []), { segments: [{ text: line, citations: [] }] }];
    return { ...r, answer: `${r.answer} ${line}`.trim(), paragraphs, contact: contact.slug } as AskResponse;
  };
  const attach = (r: AskResponse): AskResponse => done(withContact(series && (r as { mode?: string }).mode !== 'conversation' ? ({ ...r, series } as AskResponse) : r));
  if (prep.kind === 'final') return respond(attach(prep.response));
  if (wantsStream) return streamAnswer(env, ctx, prep, attach);
  let out: { text: string; engine: string };
  try {
    out = await callModel(env, prep.messages, { useBig: prep.useBig });
  } catch (e) {
    return respond(attach(await prep.fail(e)));
  }
  return respond(attach(await prep.finish(out.text, out.engine)));
}

function respond(body: AskResponse): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
}

export { SEARCH_ONLY_NOTICE, NO_RESULTS_ANSWER, DEFAULT_AI_MODEL, RAG_SYSTEM_PROMPT };
