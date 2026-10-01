/**
 * Smarter retrieval for Ask: the model plans the search, the archive is searched several ways, and a
 * cross-encoder reranker reads every candidate passage against the question so the answer is written
 * from the passages that actually answer it, not from whatever shares a common word.
 *
 * Cost (Workers AI, free daily allowance): the plan is about 3 Neurons and the rerank about 5 per
 * question. Both fail soft: on any problem the keyword ranking is used as before.
 */
import type { DocumentType } from '../../src/types/models';
import type { ChunkHit } from '../search/types';
import { aiText } from './answer';

type AiRunner = { run: (model: string, input: Record<string, unknown>) => Promise<unknown> };
/** Only the AI binding is used here (kept free of Worker types so tests typecheck anywhere). */
type Env = { AI?: unknown };

export const PLAN_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8';
export const RERANK_MODEL = '@cf/baai/bge-reranker-base';

export interface SearchPlan {
  queries: string[];
  types: DocumentType[];
  dateFrom?: string;
  dateTo?: string;
}

const PLAN_TYPES: DocumentType[] = ['minutes', 'agenda', 'agenda_packet', 'resolution', 'ordinance', 'municipal_code', 'budget', 'plan', 'staff_report', 'contract', 'development_agreement', 'interlocal_agreement', 'financial_report', 'audit', 'public_notice', 'study'];

const PLAN_PROMPT = [
  'You plan a search of the Vineyard, Utah public records archive for a resident\'s question.',
  'The archive holds City Council, Planning Commission and Redevelopment Agency agendas, agenda packets and minutes from 1989 to today, resolutions, ordinances, the municipal code (zoning, land use, parking, animals, business licenses, utilities and more), budgets, plans, staff reports, agreements, the current city staff directory and the current mayor and city council list.',
  'Return only JSON, no other text: {"queries": ["..."], "types": ["..."], "from": null, "to": null}',
  'queries: 2 to 4 different keyword searches of 2 to 8 words that would find the exact passage that answers the question. Use the words the records themselves would use, for example "certified tax rate" for a property tax question, "appoint" for who was hired or named to a position, "short term rental" for Airbnb, "motion carried" for how someone voted. Keep every name, place, road, project, number and year exactly as written. Make the queries differ from each other.',
  `types: up to 3 record types most likely to hold the answer, from: ${PLAN_TYPES.join(', ')}. Use [] when unsure.`,
  'from and to: four-digit years, only when the question itself names a year or a range of years; otherwise null. Put the year in the queries when the question says this year, next year or last year (using today\'s date).',
].join('\n');

const clean = (s: string) => s.replace(/[^\p{L}\p{N}\s'-]/gu, ' ').replace(/\s+/g, ' ').trim();

/** Parses and checks the model's plan. Years the question does not name are ignored. */
export function parsePlan(out: string, question: string): SearchPlan | null {
  const body = out.replace(/<think>[\s\S]*?<\/think>/g, '');
  const m = body.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j: { queries?: unknown; types?: unknown; from?: unknown; to?: unknown };
  try {
    j = JSON.parse(m[0]);
  } catch {
    return null;
  }
  const queries = (Array.isArray(j.queries) ? j.queries : [])
    .filter((q): q is string => typeof q === 'string')
    .map(clean)
    .filter((q) => q.split(' ').length >= 1 && q.length >= 3 && q.length <= 120);
  const uniq = [...new Map(queries.map((q) => [q.toLowerCase(), q])).values()].slice(0, 4);
  if (!uniq.length) return null;
  const types = (Array.isArray(j.types) ? j.types : []).filter((t): t is DocumentType => typeof t === 'string' && (PLAN_TYPES as string[]).includes(t)).slice(0, 3);
  const named = (question.match(/\b(19[89]\d|20\d{2})\b/g) ?? []).map(Number);
  const year = (v: unknown) => (typeof v === 'number' || (typeof v === 'string' && /^\d{4}$/.test(v)) ? Number(v) : null);
  let from = year(j.from);
  let to = year(j.to);
  // A date filter only for a year the resident actually wrote.
  if (from != null && !named.includes(from)) from = null;
  if (to != null && !named.includes(to)) to = null;
  if (from != null && to == null && named.length === 1) to = from;
  if (from == null && to != null && named.length === 1) from = to;
  return {
    queries: uniq,
    types,
    ...(from != null ? { dateFrom: `${Math.min(from, to ?? from)}-01-01` } : {}),
    ...(to != null ? { dateTo: `${Math.max(to, from ?? to)}-12-31` } : {}),
  };
}

export async function planSearch(env: Env, question: string, previous: string | null): Promise<SearchPlan | null> {
  try {
    const run = (env.AI as unknown as AiRunner).run(PLAN_MODEL, {
      messages: [
        { role: 'system', content: `${PLAN_PROMPT}\n/no_think` },
        { role: 'user', content: `Today is ${new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10)} (this year ${new Date(Date.now() - 6 * 3600_000).getUTCFullYear()}).\n${previous ? `Earlier question (context only): ${previous}\n` : ''}Question: ${question}` },
      ],
      max_tokens: 220,
      temperature: 0,
    });
    const out = aiText(await Promise.race([run, new Promise<never>((_, r) => setTimeout(() => r(new Error('timeout')), 5000))]));
    return parsePlan(out, question);
  } catch {
    return null;
  }
}

/** Round-robin merge: each list's best results make the pool before any list's tail does. */
export function interleave(lists: ChunkHit[][], max: number): ChunkHit[] {
  const seen = new Set<string>();
  const out: ChunkHit[] = [];
  for (let i = 0; out.length < max; i++) {
    let any = false;
    for (const l of lists) {
      if (i >= l.length) continue;
      any = true;
      const h = l[i];
      if (seen.has(h.chunkId)) continue;
      seen.add(h.chunkId);
      out.push(h);
      if (out.length >= max) break;
    }
    if (!any) break;
  }
  return out;
}

const passage = (h: ChunkHit) => `${h.title} (${h.documentType.replace(/_/g, ' ')}${h.documentDate ? `, ${h.documentDate}` : h.year ? `, ${h.year}` : ''}). ${(h.text ?? h.excerpt ?? '').replace(/\s+/g, ' ').slice(0, 1400)}`;

/**
 * Reranks candidate passages by how well each answers the question (cross-encoder). Returns the
 * hits best-first with `rel` scores, or null when the reranker is unavailable.
 */
export async function rerank(env: Env, question: string, hits: ChunkHit[]): Promise<Array<ChunkHit & { rel: number }> | null> {
  if (hits.length < 2) return hits.map((h) => ({ ...h, rel: 1 }));
  try {
    const BATCH = 40;
    const batches: ChunkHit[][] = [];
    for (let i = 0; i < hits.length; i += BATCH) batches.push(hits.slice(i, i + BATCH));
    const scored = await Promise.all(
      batches.map(async (b, bi) => {
        const run = (env.AI as unknown as AiRunner).run(RERANK_MODEL, { query: question.slice(0, 500), contexts: b.map((h) => ({ text: passage(h) })), top_k: b.length });
        const out = (await Promise.race([run, new Promise<never>((_, r) => setTimeout(() => r(new Error('rerank timeout')), 6000))])) as { response?: Array<{ id?: number; score?: number }> };
        const list = out?.response;
        if (!Array.isArray(list) || !list.length) throw new Error('rerank: empty');
        return list.filter((x) => typeof x.id === 'number' && typeof x.score === 'number' && b[x.id]).map((x) => ({ ...b[x.id as number], rel: Number(x.score), order: bi * BATCH + (x.id as number) }));
      }),
    );
    const all = scored.flat();
    if (all.length < Math.min(hits.length, 4)) return null;
    all.sort((a, b) => b.rel - a.rel || a.order - b.order);
    return all.map((h) => {
      const { order, ...rest } = h;
      void order;
      return rest;
    });
  } catch {
    return null;
  }
}

/**
 * The passages worth showing the model: drops those far below the best match (when scores are
 * probabilities), but always keeps a few so a hard question still gets an answer.
 */
export function relevant<T extends { rel: number }>(ranked: T[], min = 4): T[] {
  if (!ranked.length) return ranked;
  const top = ranked[0].rel;
  const probs = ranked.every((h) => h.rel >= 0 && h.rel <= 1);
  if (!probs) return ranked;
  const floor = Math.max(0.02, top * 0.15);
  const keep = ranked.filter((h) => h.rel >= floor);
  return keep.length >= min ? keep : ranked.slice(0, Math.max(min, keep.length));
}

const HISTORICAL = /\b(19[89]\d|20[0-2]\d|history|historically|first|earliest|oldest|originally|original|in the past|over the years|back in|used to|ever|since|timeline)\b/i;
const PRESENT = /\b(now|current|currently|today|this year|latest|recent|recently|right now|going on|happening|doing|working on|plans?|planned|planning|upcoming|status|still|new|update)\b/i;

/**
 * Newer records count for more unless the question is about the past: "what are they doing about
 * X" is answered from this year's minutes, not 2022's. Code sections and records marked current
 * are today's law and lists, so they never age.
 */
export function recencyWeighted<T extends ChunkHit & { rel: number }>(ranked: T[], question: string, todayYear: number, currentIds: Set<string> = new Set(), rules = false): T[] {
  if (!ranked.every((h) => h.rel >= 0 && h.rel <= 1)) return ranked;
  // Code sections lead only when the question is about rules; otherwise they never crowd out records.
  const codeWeight = rules ? 1 : 0.6;
  if (HISTORICAL.test(question)) return ranked.map((h, i) => ({ h, i, s: h.documentType === 'municipal_code' ? h.rel * codeWeight : h.rel })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.h);
  const strength = PRESENT.test(question) ? 0.6 : 0.25;
  const weight = (h: T) => {
    if (h.documentType === 'municipal_code') return codeWeight;
    if (currentIds.has(h.chunkId)) return 1;
    const y = h.documentDate ? Number(h.documentDate.slice(0, 4)) : h.year;
    if (!y) return 0.8;
    const age = Math.max(0, todayYear - y);
    return 1 / (1 + strength * age);
  };
  return ranked
    .map((h, i) => ({ h, i, s: h.rel * weight(h) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.h);
}
