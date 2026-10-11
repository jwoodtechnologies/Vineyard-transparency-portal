/**
 * The code-written answers of lookups.ts and quotes.ts, read from the catalog: numbered records,
 * a meeting's documents, the last meeting with recorded votes, the fee schedule page for a fee, and
 * the closest records quoted when the model cannot answer. Every value comes from a record; every
 * answer cites the record at its page and opens a page inside the portal.
 */
import type { Env } from '../env';
import type { AnswerClarify, AnswerParagraph, AskResponse, Citation, DocumentSummary, DocumentType } from '../../src/types/models';
import type { ChunkHit } from '../search/types';
import { SearchRepository } from '../search/SearchRepository';
import { normalizeType } from '../lib/taxonomy';
import { recordIndex } from '../api/records';
import { citationLabel } from './submissions';
import { BODY_LABEL, longDay, type MeetingBody } from './meetingVotes';
import { DOC_LABEL, latestMinutesDate, minutesOf, recordLookupText, suggestFollowUps, type DocLookup, type IndexRow, type RecordLookup } from './lookups';
import { pickQuotes, plainRecordText, QUOTES_LEAD, quoteLine, routeFor, sentenceScore, recordSentences, type Quote } from './quotes';
import { officialRoster, titleOfficials } from './officials';
import type { StaffPerson } from './contacts';

export type Base = { id: string; question: string; relatedDocuments: DocumentSummary[]; suggestedFollowUps: string[]; generatedAt: string };

type DocRow = { id: string; title: string | null; document_type: string | null; document_number: string | null; document_date: string | null; government_body_name: string | null; meeting_id: string | null; original_url: string | null; archive_status: string | null; archive_key: string | null; meeting_title?: string | null };

async function docRows(env: Env, ids: string[]): Promise<Map<string, DocRow>> {
  if (!ids.length) return new Map();
  const r = await env.CATALOG_DB.prepare(
    `SELECT d.id, d.title, d.document_type, d.document_number, d.document_date, d.government_body_name, d.meeting_id, d.original_url, d.archive_status, d.archive_key, m.title AS meeting_title
     FROM documents d LEFT JOIN meetings m ON m.id = d.meeting_id WHERE d.id IN (SELECT value FROM json_each(?))`,
  )
    .bind(JSON.stringify([...new Set(ids)]))
    .all<DocRow>()
    .catch(() => ({ results: [] as DocRow[] }));
  return new Map((r.results ?? []).map((x) => [String(x.id), x]));
}

/** A citation that opens the record at that page, from its catalog row (or what the caller knows of it). */
export function citationOf(index: number, id: string, page: number | null, row: DocRow | undefined, fallback: { title: string; type?: string; date?: string | null; body?: string | null } = { title: 'Record' }, quote = ''): Citation {
  return {
    index,
    documentId: id,
    documentTitle: row?.title ?? fallback.title,
    documentType: normalizeType((row?.document_type ?? fallback.type ?? 'other') as DocumentType),
    documentNumber: row?.document_number ?? null,
    date: row?.document_date ?? fallback.date ?? null,
    governmentBodyName: row?.government_body_name ?? fallback.body ?? null,
    meetingId: row?.meeting_id ?? null,
    meetingTitle: row?.meeting_title ?? null,
    agendaItem: null,
    page,
    sectionTitle: null,
    excerpt: { documentId: id, chunkId: null, page, sectionTitle: null, text: quote, highlights: [] },
    archiveUrl: row?.archive_status === 'archived' && row.archive_key ? `/api/documents/${id}/file` : null,
    originalUrl: row?.original_url ?? null,
  };
}

const plain = (paragraphs: AnswerParagraph[]) => paragraphs.map((p) => p.segments.map((s) => `${s.text}${s.citations.length ? ` ${s.citations.map((c) => `[${c}]`).join('')}` : ''}`).join(' ')).join('\n\n');

/** A response written by code: grounded, with the text built from its paragraphs. */
export function codeResponse(base: Base, engine: string, paragraphs: AnswerParagraph[], extra: Partial<AskResponse> & Record<string, unknown> = {}): AskResponse {
  return { ...base, retrievalStatus: 'grounded', answer: plain(paragraphs), paragraphs, citations: [], notice: null, engine, ...extra } as AskResponse;
}

/* ---------------------------------------------------------------------------------------------- */
/* Quoted records and routes                                                                      */
/* ---------------------------------------------------------------------------------------------- */

/**
 * The closest records quoted, as the answer: a short lead, then for each of the top records its title,
 * date, body and page with the matching sentences in its own words, each citing (and opening) that page.
 * Null when no record holds a sentence that matches the question.
 */
export async function quotesResponse(env: Env, base: Base, question: string, hits: ChunkHit[], staff: StaffPerson[], engine: string, lead = QUOTES_LEAD, boost?: Set<string>): Promise<AskResponse | null> {
  const quotes = pickQuotes(question, hits, { boost });
  if (!quotes.length) return null;
  const rows = await docRows(env, quotes.map((q) => q.hit.documentId));
  const roster = officialRoster(staff);
  const citations = quotes.map((q, i) => {
    const c = citationOf(i + 1, q.hit.documentId, q.hit.pageStart, rows.get(q.hit.documentId), { title: q.hit.title, type: q.hit.documentType, date: q.hit.documentDate }, q.sentences.join(' '));
    return { ...c, excerpt: { ...c.excerpt, chunkId: q.hit.chunkId }, sourceLabel: citationLabel(q.hit.sourceId) };
  });
  const items = quotes.map((q: Quote<ChunkHit>, i) => ({ text: titleOfficials(quoteLine(q), roster, [q.hit.documentDate]), citations: [i + 1] }));
  const paragraphs: AnswerParagraph[] = [{ segments: [{ text: lead, citations: [] }] }, { segments: items, list: true }];
  const shown = new Set(quotes.map((q) => q.hit.documentId));
  const related = await closest(env, hits.filter((h) => !shown.has(h.documentId)));
  return codeResponse(base, engine, paragraphs, { citations, relatedDocuments: related });
}

async function closest(env: Env, hits: ChunkHit[]): Promise<DocumentSummary[]> {
  const ids = [...new Set(hits.map((h) => h.documentId))].slice(0, 4);
  if (!ids.length) return [];
  const { summariesByIds } = await import('../api/documents');
  const found = await summariesByIds(env, ids).catch(() => new Map<string, DocumentSummary>());
  return ids.map((id) => found.get(id)).filter((d): d is DocumentSummary => Boolean(d));
}

/** The portal page that holds what was asked, as the answer, with the closest records under it. */
export async function routeResponse(env: Env, base: Base, question: string, engine: string, hits: ChunkHit[] = []): Promise<AskResponse> {
  const r = routeFor(question);
  return codeResponse(base, engine, [{ segments: [{ text: r.text, citations: [] }] }], { section: r.section, relatedDocuments: await closest(env, hits) });
}

/** Quotes when a record holds a matching sentence, else the route: never a dead end. */
export async function recordsAnswer(env: Env, base: Base, question: string, hits: ChunkHit[], staff: StaffPerson[], why: string, context = ''): Promise<AskResponse> {
  // A follow-up's own words are few ("is there a cap?"): the earlier question's words are matched too.
  return (await quotesResponse(env, base, `${question} ${context}`.trim(), hits, staff, `record-quotes (${why})`).catch(() => null)) ?? routeResponse(env, base, question, `route (${why})`, hits);
}

/* ---------------------------------------------------------------------------------------------- */
/* Numbered records                                                                               */
/* ---------------------------------------------------------------------------------------------- */

const INDEX_PATH: Record<RecordLookup['kind'], string> = { ordinance: 'ordinances', resolution: 'resolutions', 'rda-resolution': 'rda-resolutions' };

/** "Show Ordinance 2026-09": the index row (title, adoption, tally, minutes page) and the record itself. */
export async function recordLookupResponse(env: Env, base: Base, r: RecordLookup): Promise<AskResponse | null> {
  const which = INDEX_PATH[r.kind];
  const res = await recordIndex(env, which, new URL(`https://portal.local/api/records/${which}?year=${r.year}`)).catch(() => null);
  if (!res || !res.ok) return null;
  const data = (await res.json().catch(() => null)) as { rows?: IndexRow[] } | null;
  const row = (data?.rows ?? []).find((x) => x.number === r.number) ?? null;
  const { sentences } = recordLookupText(r, row);
  const rows = await docRows(env, [row?.document?.id, row?.minutes?.documentId].filter((x): x is string => Boolean(x)));
  const citations: Citation[] = [];
  const cite = (kind: 'document' | 'minutes' | null): number[] => {
    if (!kind || !row) return [];
    const id = kind === 'document' ? row.document?.id : row.minutes?.documentId;
    if (!id) return [];
    const page = kind === 'document' ? 1 : (row.minutes?.page ?? null);
    const at = citations.findIndex((c) => c.documentId === id);
    if (at >= 0) return [at + 1];
    citations.push(citationOf(citations.length + 1, id, page, rows.get(id), { title: kind === 'document' ? (row.document?.title ?? r.label) : 'Minutes', type: kind === 'document' ? r.kind.replace('rda-', '') : 'minutes', date: kind === 'minutes' ? row.adoptedOn : null }));
    return [citations.length];
  };
  const segments = sentences.map((s) => ({ text: s.text, citations: cite(s.cite) }));
  const body: MeetingBody = r.kind === 'rda-resolution' ? 'redevelopment-agency' : 'city-council';
  const meeting = row?.adoptedOn && row.minutes ? { date: row.adoptedOn, body } : null;
  const section = row?.document ? { path: `/documents/${row.document.id}`, label: `Open ${r.label}`, hint: 'The full text, page by page' } : { path: `/records/${which}?year=${r.year}`, label: `Open the ${r.kind === 'ordinance' ? 'ordinance' : 'resolution'} index`, hint: `Every number for ${r.year}` };
  return codeResponse(base, 'record-lookup', [{ segments }], {
    citations,
    section,
    suggestedFollowUps: suggestFollowUps({ engine: 'record-lookup', meeting, measure: r.kind === 'rda-resolution' ? null : r.label }),
  });
}

/* ---------------------------------------------------------------------------------------------- */
/* A meeting's documents                                                                          */
/* ---------------------------------------------------------------------------------------------- */

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const BODY_IDS: MeetingBody[] = ['city-council', 'redevelopment-agency', 'planning-commission'];

/** The bodies (of the three with voting records) that met, or recorded motions, on a date. */
export async function bodiesOnDate(env: Env, date: string): Promise<MeetingBody[]> {
  const r = await env.CATALOG_DB.prepare(
    `SELECT DISTINCT government_body_id AS b FROM meetings WHERE substr(meeting_date, 1, 10) = ? AND lower(coalesce(status, '')) NOT LIKE '%cancel%'
     UNION SELECT DISTINCT body_id AS b FROM motions WHERE meeting_date = ?`,
  )
    .bind(date, date)
    .all<{ b: string }>()
    .catch(() => ({ results: [] as Array<{ b: string }> }));
  const got = new Set((r.results ?? []).map((x) => String(x.b)));
  return BODY_IDS.filter((b) => got.has(b));
}

/** "Find the minutes for the September 8 meeting": that meeting's document, opened at page 1, or what is posted instead. */
export async function docLookupResponse(env: Env, base: Base, d: DocLookup, today: string): Promise<AskResponse | null> {
  const body = d.body ?? 'city-council';
  const types = d.kind === 'agenda_packet' ? ['agenda_packet'] : d.kind === 'agenda' ? ['agenda', 'agenda_packet'] : ['minutes'];
  let date = d.date;
  if (!date && d.kind === 'minutes') {
    // The newest meeting with minutes is the newest date a minutes title carries (a draft is filed under the next meeting's packet).
    const recent = await env.CATALOG_DB.prepare(`SELECT title FROM documents WHERE government_body_id = ? AND document_type = 'minutes' AND document_date <= ? ORDER BY document_date DESC LIMIT 30`)
      .bind(body, addDays(today, 150))
      .all<{ title: string }>()
      .catch(() => ({ results: [] as Array<{ title: string }> }));
    date = latestMinutesDate((recent.results ?? []).map((x) => String(x.title ?? '')), today);
  }
  if (!date) {
    const row = await env.CATALOG_DB.prepare(
      `SELECT max(document_date) AS d FROM documents WHERE government_body_id = ? AND document_type IN (SELECT value FROM json_each(?)) AND document_date <= ?`,
    )
      .bind(body, JSON.stringify(types), today)
      .first<{ d: string | null }>()
      .catch(() => null);
    date = row?.d ?? null;
    if (!date) return null;
  }
  const meetings = await env.CATALOG_DB.prepare(`SELECT id FROM meetings WHERE substr(meeting_date, 1, 10) = ? AND government_body_id = ? ORDER BY CASE WHEN id LIKE 'mtg_cc_%' THEN 0 ELSE 1 END, id LIMIT 3`)
    .bind(date, body)
    .all<{ id: string }>()
    .catch(() => ({ results: [] as Array<{ id: string }> }));
  const meetingIds = (meetings.results ?? []).map((m) => String(m.id));
  const docs = await env.CATALOG_DB.prepare(
    `SELECT id, document_type, title FROM documents
     WHERE (meeting_id IN (SELECT value FROM json_each(?)) OR (document_date = ? AND government_body_id = ?))
       AND document_type IN ('minutes', 'agenda', 'agenda_packet')
     ORDER BY CASE document_type WHEN 'minutes' THEN 0 WHEN 'agenda' THEN 1 ELSE 2 END, title LIMIT 40`,
  )
    .bind(JSON.stringify(meetingIds), date, body)
    .all<{ id: string; document_type: string; title: string }>()
    .catch(() => ({ results: [] as Array<{ id: string; document_type: string; title: string }> }));
  // The minutes of a meeting are titled with its date and are often filed under a later meeting, where they were approved;
  // minutes filed under this meeting but titled with an earlier date are that earlier meeting's.
  const later = await env.CATALOG_DB.prepare(
    `SELECT id, document_type, title, meeting_id FROM documents
     WHERE document_type = 'minutes' AND government_body_id = ? AND document_date > ? AND document_date <= ? LIMIT 60`,
  )
    .bind(body, date, addDays(date, 150))
    .all<{ id: string; document_type: string; title: string; meeting_id: string | null }>()
    .catch(() => ({ results: [] as Array<{ id: string; document_type: string; title: string; meeting_id: string | null }> }));
  const inMeeting = (docs.results ?? []).map((x) => ({ ...x, inMeeting: true }));
  const minutes = minutesOf(date, [...inMeeting.filter((x) => x.document_type === 'minutes'), ...(later.results ?? []).filter((x) => !inMeeting.some((y) => y.id === x.id)).map((x) => ({ ...x, inMeeting: Boolean(x.meeting_id && meetingIds.includes(x.meeting_id)) }))]);
  const list = [...inMeeting.filter((x) => x.document_type !== 'minutes'), ...(minutes ? [minutes] : [])];
  if (!meetingIds.length && !list.length) return null;
  const name = `${longDay(date)} ${BODY_LABEL[body]} meeting`;
  const wanted = list.filter((x) => types.includes(x.document_type));
  const pick = wanted.find((x) => x.document_type === d.kind) ?? wanted[0] ?? null;
  const rows = await docRows(env, pick ? [pick.id] : []);
  const section = meetingIds[0] ? { path: `/meetings/${meetingIds[0]}`, label: `Open the ${name}`, hint: 'Agenda, packet, minutes and video' } : undefined;
  const meeting = { date, body };
  const hasMinutes = Boolean(minutes);
  if (pick) {
    const what = pick.document_type === d.kind ? DOC_LABEL[d.kind] : DOC_LABEL[pick.document_type as keyof typeof DOC_LABEL];
    const verb = pick.document_type === 'minutes' ? 'are' : 'is';
    const text = `The ${what} of the ${name} ${verb} posted: ${plainRecordText(rows.get(pick.id)?.title ?? pick.title)}.`;
    const c = citationOf(1, pick.id, 1, rows.get(pick.id), { title: pick.title, type: pick.document_type, date });
    return codeResponse(base, 'meeting-docs', [{ segments: [{ text, citations: [1] }] }], {
      citations: [c],
      ...(section ? { section } : {}),
      suggestedFollowUps: suggestFollowUps({ engine: 'meeting-docs', meeting, hasMinutes }),
    });
  }
  const posted = [...new Set(list.map((x) => DOC_LABEL[x.document_type as keyof typeof DOC_LABEL]).filter(Boolean))];
  const text = `The ${DOC_LABEL[d.kind]} of the ${name} ${d.kind === 'minutes' ? 'are' : 'is'} not posted yet.${posted.length ? ` Its ${posted.join(' and ')} ${posted.length > 1 ? 'are' : 'is'} on the meeting page.` : ' The meeting page has what is posted.'}`;
  return codeResponse(base, 'meeting-docs', [{ segments: [{ text, citations: [] }] }], { ...(section ? { section } : { section: routeFor(`${BODY_LABEL[body]} meeting`).section }) });
}

/* ---------------------------------------------------------------------------------------------- */
/* The last meeting with recorded votes                                                           */
/* ---------------------------------------------------------------------------------------------- */

/** The newest meeting date (before `before`, when given) with recorded motions for a body. */
export async function lastVotesDate(env: Env, body: MeetingBody, before: string | null, today: string): Promise<string | null> {
  const r = await env.CATALOG_DB.prepare(`SELECT max(meeting_date) AS d FROM motions WHERE body_id = ? AND meeting_date < ? AND meeting_date >= '2026-01-01'`)
    .bind(body, before ?? `${today}~`)
    .first<{ d: string | null }>()
    .catch(() => null);
  return r?.d ?? null;
}

/* ---------------------------------------------------------------------------------------------- */
/* Fees                                                                                           */
/* ---------------------------------------------------------------------------------------------- */

/**
 * "How much is the pavilion rental fee?": the page of the newest consolidated fee schedule that lists
 * it, opened at that page, with the schedule's own lines quoted where they read as a sentence. The
 * figure is never paired with a label by code (the schedule is a table): the reader sees the page.
 */
export async function feeResponse(env: Env, base: Base, words: string[]): Promise<AskResponse | null> {
  const repo = new SearchRepository(env);
  if (!repo.available) return null;
  const docs = await env.CATALOG_DB.prepare(
    `SELECT id, title, document_date, search_shard FROM documents
     WHERE lower(title) LIKE '%fee schedule%' AND lower(title) NOT LIKE '%red%line%' AND lower(title) NOT LIKE '%redline%' AND lower(title) NOT LIKE '%draft%'
       AND document_date IS NOT NULL AND search_shard IS NOT NULL
     ORDER BY document_date DESC LIMIT 4`,
  )
    .all<{ id: string; title: string; document_date: string; search_shard: number }>()
    .catch(() => ({ results: [] as Array<{ id: string; title: string; document_date: string; search_shard: number }> }));
  for (const d of docs.results ?? []) {
    const chunks = await repo.documentChunks(Number(d.search_shard), d.id).catch(() => []);
    const scored = chunks
      // A table of contents names every fee and lists none.
      .filter((c) => (c.text.match(/\.{5,}|…{2,}/g) ?? []).length < 3 && !/table of contents/i.test(c.text.slice(0, 200)))
      .map((c) => {
        const lower = c.text.toLowerCase();
        const score = words.filter((w) => lower.includes(w) || (w.length >= 5 && lower.includes(w.slice(0, -1)))).length;
        return { c, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || (a.c.pageStart ?? 0) - (b.c.pageStart ?? 0));
    const best = scored[0];
    if (!best || best.score < Math.min(2, words.length)) continue;
    const page = best.c.pageStart;
    const rows = await docRows(env, [d.id]);
    const title = plainRecordText(rows.get(d.id)?.title ?? d.title);
    const quote = recordSentences(best.c.text)
      .map((s) => ({ s, score: sentenceScore(s, words) }))
      .filter((x) => x.score >= 1)
      .sort((a, b) => b.score - a.score)[0]?.s;
    const subject = words.slice(0, 3).join(' ');
    const segments = [{ text: `Fees for ${subject} are listed on page ${page ?? 1} of the newest consolidated fee schedule in the archive, ${title} (${longDay(d.document_date)}).`, citations: [1] }];
    if (quote) segments.push({ text: `That page reads: "${quote.replace(/"/g, "'")}"`, citations: [1] });
    segments.push({ text: 'Open the source to see each fee with its amount, as the city printed it.', citations: [] });
    const c = citationOf(1, d.id, page, rows.get(d.id), { title: d.title, type: 'other', date: d.document_date }, quote ?? '');
    return codeResponse(base, 'fee-schedule', [{ segments }], {
      citations: [c],
      section: { path: `/documents/${d.id}${page ? `?page=${page}` : ''}`, label: 'Open the fee schedule', hint: `${title}, page ${page ?? 1}` },
      asOf: d.document_date,
      asOfLabel: 'Fee schedule',
    });
  }
  return null;
}

/* ---------------------------------------------------------------------------------------------- */
/* Clarifying questions                                                                           */
/* ---------------------------------------------------------------------------------------------- */

/** A clarifying question as a response: one line, tappable choices, and the page that holds the answer either way. */
export function clarifyResponse(base: Base, c: AnswerClarify, section: { path: string; label: string; hint: string }): AskResponse {
  return codeResponse(base, 'clarify', [{ segments: [{ text: c.prompt, citations: [] }] }], { clarify: c, section, suggestedFollowUps: c.choices.map((x) => x.question) });
}
