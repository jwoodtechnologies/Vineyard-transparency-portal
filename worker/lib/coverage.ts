/**
 * Coverage check: what the archive is missing, from the catalog alone.
 *
 * 1. Gaps in the yearly number sequences of ordinances, resolutions and RDA resolutions. A number
 *    counts as seen when a catalog record carries it (type, document number or title) or a recorded
 *    motion names it. Every number from 1 up to the highest seen that year that is never seen is a gap.
 * 2. Meetings already held (date before today in Utah, not canceled) with no agenda, packet or
 *    minutes. Rows for the same body and day (two sources) count as one meeting.
 * 3. Records with no date (no document date; the year alone, when known, is shown).
 * 4. Records with no readable text (text not extracted, no search chunks, or OCR still needed).
 *
 * The report is computed once a day by the hourly cron (or on the owner's request) and stored as one
 * row, so the panel and the public summary never scan the catalog on a page view.
 */
import type { Env } from '../env';

export type Series = 'ordinance' | 'resolution' | 'rda_resolution';
export const SERIES_LABEL: Record<Series, string> = { ordinance: 'Ordinances', resolution: 'Resolutions', rda_resolution: 'RDA resolutions' };

export interface SeriesNumber {
  series: Series;
  year: number;
  seq: number;
}

const RDA_BODY = 'redevelopment-agency';
/**
 * "Ordinance 2026-05", "ORD 2026-10", "Res. No. 2026-5", "RESOLUTION RDA-2026-03", "RDA Resolution U2026-04",
 * "RES U-2026-04", "RDA - 2026-02", "Ord_2025-18". A date (2024-06-20) is never a number: no digit or dash may follow.
 */
const NUMBER_RE = /\b(rda\s*[-\u2013]?\s*)?(?:(ordinance|ord|resolution|res)(?![a-z])\.?[\s_]*(?:no(?![a-z])\.?|number|#)?[\s_]*)?(rda\s*[-\u2013]?\s*|u\s*[-\u2013]?\s*)?((?:19|20)\d{2})\s*[-\u2013]\s*(\d{1,3})(?![\d\-\u2013])/gi;

/**
 * Every ordinance or resolution number named in a text. `bodyId` marks a Redevelopment Agency record
 * or motion. `typeHint` (the record's own type) lets a bare "2026-09" at the very start count.
 */
export function parseSeriesNumbers(text: string | null | undefined, bodyId?: string | null, typeHint?: string | null): SeriesNumber[] {
  if (!text) return [];
  const out: SeriesNumber[] = [];
  const seen = new Set<string>();
  const rdaBody = bodyId === RDA_BODY;
  for (const m of text.matchAll(NUMBER_RE)) {
    const word = (m[2] ?? '').toLowerCase();
    const marker = (m[3] ?? '').toLowerCase();
    const rdaMark = Boolean(m[1]) || marker.startsWith('rda');
    const uMark = marker.startsWith('u');
    const hinted = !word && !m[1] && !marker && m.index === 0 && (typeHint === 'ordinance' || typeHint === 'resolution');
    if (!word && !rdaMark && !(uMark && rdaBody) && !hinted) continue;
    const kind = word ? (word.startsWith('ord') ? 'ordinance' : 'resolution') : hinted ? (typeHint as 'ordinance' | 'resolution') : 'resolution';
    const rda = rdaMark || rdaBody || (uMark && kind === 'resolution');
    // The RDA adopts resolutions only; an "RDA ordinance" is not a series.
    const series: Series = kind === 'ordinance' ? 'ordinance' : rda ? 'rda_resolution' : 'resolution';
    const year = Number(m[4]);
    const seq = Number(m[5]);
    if (!seq || seq > 400) continue;
    const k = `${series}|${year}|${seq}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ series, year, seq });
  }
  return out;
}

/** The numbers from 1 to the highest seen that are not seen. */
export function missingNumbers(seen: Iterable<number>): number[] {
  const set = new Set([...seen].filter((n) => Number.isInteger(n) && n > 0));
  if (!set.size) return [];
  const max = Math.max(...set);
  const out: number[] = [];
  for (let i = 1; i < max; i++) if (!set.has(i)) out.push(i);
  return out;
}

/** 1, 2, 3, 5, 7, 8 → "1-3, 5, 7-8" (a plain hyphen, never a dash). */
export function compactRanges(nums: number[]): string {
  const s = [...new Set(nums)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < s.length; i++) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    parts.push(j > i ? `${s[i]}-${s[j]}` : String(s[i]));
    i = j;
  }
  return parts.join(', ');
}

export const pad2 = (n: number) => String(n).padStart(2, '0');

export interface SequenceGap {
  series: Series;
  year: number;
  /** Highest number seen that year. */
  highest: number;
  /** Count of distinct numbers seen. */
  seen: number;
  missing: number[];
  /** Numbers a motion names that have no record of their own in the catalog. */
  motionOnly: number[];
}

export interface NumberSighting {
  text: string | null;
  bodyId: string | null;
  /** The record's own type (ordinance or resolution), for a bare number. */
  type?: string | null;
  /** True for a catalog record of that number; false for a motion that names it. */
  record: boolean;
}

/** Gaps per series and year, newest year first. */
export function sequenceGaps(sightings: NumberSighting[]): SequenceGap[] {
  const rec = new Map<string, Set<number>>();
  const mot = new Map<string, Set<number>>();
  for (const s of sightings) {
    for (const n of parseSeriesNumbers(s.text, s.bodyId, s.type)) {
      const k = `${n.series}|${n.year}`;
      const map = s.record ? rec : mot;
      (map.get(k) ?? map.set(k, new Set()).get(k)!).add(n.seq);
    }
  }
  const keys = new Set([...rec.keys(), ...mot.keys()]);
  const order: Series[] = ['ordinance', 'resolution', 'rda_resolution'];
  return [...keys]
    .map((k) => {
      const [series, year] = k.split('|') as [Series, string];
      const r = rec.get(k) ?? new Set<number>();
      const m = mot.get(k) ?? new Set<number>();
      const all = new Set([...r, ...m]);
      return {
        series,
        year: Number(year),
        highest: Math.max(...all),
        seen: all.size,
        missing: missingNumbers(all),
        motionOnly: [...m].filter((n) => !r.has(n)).sort((a, b) => a - b),
      };
    })
    .sort((a, b) => b.year - a.year || order.indexOf(a.series) - order.indexOf(b.series));
}

export type MeetingDoc = 'agenda' | 'packet' | 'minutes';

export interface MeetingRow {
  id: string;
  title: string;
  bodyId: string | null;
  bodyName: string | null;
  date: string;
  status: string;
  has: Record<MeetingDoc, boolean>;
}

export interface MissingMeeting {
  id: string;
  title: string;
  bodyId: string | null;
  bodyName: string | null;
  date: string;
  missing: MeetingDoc[];
}

/** Calendar rows that are notices (a hearing notice, the yearly schedule), not a meeting of a body. */
const NOT_A_BODY = new Set(['public-notices', 'general']);
const NOTICE_TITLE = /^(public notice|public hearing|notice of)\b/i;

/** Held, not canceled, and missing at least one of agenda, packet and minutes. Same body and day merge. */
export function meetingsMissingDocs(rows: MeetingRow[], today: string): MissingMeeting[] {
  const merged = new Map<string, MeetingRow>();
  for (const r of rows) {
    const day = r.date.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day >= today) continue;
    if (/cancel|postpon|unconfirmed/i.test(r.status) || /\bcancel/i.test(r.title)) continue;
    if ((r.bodyId && NOT_A_BODY.has(r.bodyId)) || NOTICE_TITLE.test(r.title.trim())) continue;
    const k = `${r.bodyId ?? r.bodyName ?? r.title}|${day}`;
    const prev = merged.get(k);
    if (!prev) merged.set(k, { ...r, date: day, has: { ...r.has } });
    else for (const d of ['agenda', 'packet', 'minutes'] as MeetingDoc[]) prev.has[d] = prev.has[d] || r.has[d];
  }
  return [...merged.values()]
    .map((r) => ({ id: r.id, title: r.title, bodyId: r.bodyId, bodyName: r.bodyName, date: r.date, missing: (['agenda', 'packet', 'minutes'] as MeetingDoc[]).filter((d) => !r.has[d]) }))
    .filter((r) => r.missing.length > 0)
    .sort((a, b) => b.date.localeCompare(a.date) || String(a.bodyName).localeCompare(String(b.bodyName)));
}

export interface CoverageRecord {
  id: string;
  title: string;
  type: string;
  year: number | null;
  body: string | null;
  /** For records with no text: why. */
  reason?: string;
}

export interface CoverageReport {
  computedAt: string;
  today: string;
  counts: { sequenceGaps: number; motionOnly: number; meetingsMissing: number; undated: number; noText: number };
  gaps: SequenceGap[];
  meetings: MissingMeeting[];
  undated: CoverageRecord[];
  noText: CoverageRecord[];
  /** Lists longer than this are cut (the counts stay exact). */
  listLimit: number;
}

const LIST_LIMIT = 2500;
/** Portal-made entries that carry no date or file by design. */
const NOT_RECORDS = "('web_link', 'note', 'project', 'resident_submission', 'recording')";

/** Today in Utah (six hours behind UTC is close enough for a day boundary). */
export const utahToday = (now = Date.now()) => new Date(now - 6 * 3600_000).toISOString().slice(0, 10);

export function textReason(r: { text_status?: unknown; chunk_count?: unknown; ocr_status?: unknown }): string {
  if (r.ocr_status === 'needed') return 'OCR needed';
  if (r.ocr_status === 'failed') return 'OCR failed';
  const t = String(r.text_status ?? '');
  if (t && t !== 'extracted') return `Text ${t}`;
  return 'Not indexed';
}

export async function computeCoverage(env: Env, now = Date.now()): Promise<CoverageReport> {
  const db = env.CATALOG_DB;
  const today = utahToday(now);
  type R = Record<string, unknown>;
  const [numbered, motions, meetings, linked, voteDocs, undatedN, undated, noTextN, noText] = await Promise.all([
    db
      .prepare(
        `SELECT title, document_number, document_type, government_body_id FROM documents
         WHERE document_type IN ('ordinance', 'resolution') OR document_number IS NOT NULL
            OR (government_body_id = ? AND lower(title) LIKE '%resolution%')`,
      )
      .bind(RDA_BODY)
      .all<R>(),
    db.prepare("SELECT body_id, refs, motion, item FROM motions WHERE refs IS NOT NULL OR lower(coalesce(item, '') || ' ' || coalesce(motion, '')) LIKE '%ordinance%' OR lower(coalesce(item, '') || ' ' || coalesce(motion, '')) LIKE '%resolution%' OR lower(coalesce(item, '') || ' ' || coalesce(motion, '')) LIKE '%res %' OR lower(coalesce(item, '') || ' ' || coalesce(motion, '')) LIKE '%ord %'").all<R>().catch(() => ({ results: [] as R[] })),
    db.prepare('SELECT id, title, government_body_id, government_body_name, substr(meeting_date, 1, 10) AS day, status, agenda_document_id, packet_document_id, minutes_document_id FROM meetings WHERE meeting_date IS NOT NULL AND substr(meeting_date, 1, 10) < ?').bind(today).all<R>(),
    db.prepare("SELECT meeting_id, group_concat(DISTINCT document_type) AS types FROM documents WHERE meeting_id IS NOT NULL AND document_type IN ('agenda', 'agenda_packet', 'minutes') GROUP BY meeting_id").all<R>(),
    db.prepare("SELECT v.body_id, v.meeting_date FROM vote_docs v JOIN documents d ON d.id = v.document_id WHERE v.meeting_date IS NOT NULL AND (v.motions > 0 OR lower(d.title) LIKE '%minute%')").all<R>().catch(() => ({ results: [] as R[] })),
    db.prepare(`SELECT count(*) AS n FROM documents WHERE document_date IS NULL AND document_type NOT IN ${NOT_RECORDS}`).first<{ n: number }>(),
    db.prepare(`SELECT id, title, document_type, year, government_body_name FROM documents WHERE document_date IS NULL AND document_type NOT IN ${NOT_RECORDS} ORDER BY year DESC, title LIMIT ?`).bind(LIST_LIMIT).all<R>(),
    db.prepare(`SELECT count(*) AS n FROM documents WHERE (text_status != 'extracted' OR chunk_count = 0 OR ocr_status = 'needed') AND document_type NOT IN ${NOT_RECORDS}`).first<{ n: number }>(),
    db
      .prepare(`SELECT id, title, document_type, year, government_body_name, text_status, chunk_count, ocr_status FROM documents WHERE (text_status != 'extracted' OR chunk_count = 0 OR ocr_status = 'needed') AND document_type NOT IN ${NOT_RECORDS} ORDER BY year DESC, title LIMIT ?`)
      .bind(LIST_LIMIT)
      .all<R>(),
  ]);

  const sightings: NumberSighting[] = [];
  for (const d of numbered.results ?? []) {
    const body = (d.government_body_id as string | null) ?? null;
    const type = (d.document_type as string | null) ?? null;
    // The document number and the title both name the record's number (a packet file may carry only the title).
    if (d.document_number) sightings.push({ text: String(d.document_number), bodyId: body, type, record: true });
    sightings.push({ text: String(d.title ?? ''), bodyId: body, type, record: true });
  }
  for (const m of motions.results ?? []) {
    let refs: string[];
    try {
      refs = m.refs ? (JSON.parse(String(m.refs)) as string[]) : [];
    } catch {
      refs = [];
    }
    const body = (m.body_id as string | null) ?? null;
    for (const r of refs) sightings.push({ text: r, bodyId: body, record: false });
    // The agenda item and the motion's wording can name a number the parsed references leave out ("Discuss Resolution 2026-33").
    sightings.push({ text: `${String(m.item ?? '')} ${String(m.motion ?? '')}`, bodyId: body, record: false });
  }
  const gaps = sequenceGaps(sightings);

  const types = new Map<string, string>();
  for (const l of linked.results ?? []) types.set(String(l.meeting_id), String(l.types ?? ''));
  const minutesByDay = new Set((voteDocs.results ?? []).map((v) => `${v.body_id}|${String(v.meeting_date).slice(0, 10)}`));
  const rows: MeetingRow[] = (meetings.results ?? []).map((m) => {
    const t = types.get(String(m.id)) ?? '';
    return {
      id: String(m.id),
      title: String(m.title ?? ''),
      bodyId: (m.government_body_id as string | null) ?? null,
      bodyName: (m.government_body_name as string | null) ?? null,
      date: String(m.day ?? ''),
      status: String(m.status ?? ''),
      has: {
        agenda: Boolean(m.agenda_document_id) || /\bagenda\b/.test(t.replace(/agenda_packet/g, '')),
        packet: Boolean(m.packet_document_id) || t.includes('agenda_packet'),
        minutes: Boolean(m.minutes_document_id) || t.includes('minutes') || minutesByDay.has(`${m.government_body_id}|${m.day}`),
      },
    };
  });
  const missing = meetingsMissingDocs(rows, today);

  const rec = (r: R, reason?: string): CoverageRecord => ({
    id: String(r.id),
    title: String(r.title ?? ''),
    type: String(r.document_type ?? 'other'),
    year: r.year == null ? null : Number(r.year),
    body: (r.government_body_name as string | null) ?? null,
    ...(reason ? { reason } : {}),
  });
  return {
    computedAt: new Date(now).toISOString(),
    today,
    counts: {
      sequenceGaps: gaps.reduce((n, g) => n + g.missing.length, 0),
      motionOnly: gaps.reduce((n, g) => n + g.motionOnly.length, 0),
      meetingsMissing: missing.length,
      undated: Number(undatedN?.n ?? 0),
      noText: Number(noTextN?.n ?? 0),
    },
    gaps,
    meetings: missing,
    undated: (undated.results ?? []).map((r) => rec(r)),
    noText: (noText.results ?? []).map((r) => rec(r, textReason(r))),
    listLimit: LIST_LIMIT,
  };
}

const TABLE = 'CREATE TABLE IF NOT EXISTS coverage_report (id INTEGER PRIMARY KEY CHECK (id = 1), computed_at TEXT NOT NULL, body TEXT NOT NULL)';
const DAY_MS = 86_400_000;

export async function storedCoverage(env: Env): Promise<CoverageReport | null> {
  await env.CATALOG_DB.prepare(TABLE).run();
  const row = await env.CATALOG_DB.prepare('SELECT body FROM coverage_report WHERE id = 1').first<{ body: string }>();
  if (!row) return null;
  try {
    return JSON.parse(row.body) as CoverageReport;
  } catch {
    return null;
  }
}

export async function refreshCoverage(env: Env): Promise<CoverageReport> {
  const report = await computeCoverage(env);
  await env.CATALOG_DB.prepare(TABLE).run();
  await env.CATALOG_DB.prepare('INSERT INTO coverage_report (id, computed_at, body) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET computed_at = excluded.computed_at, body = excluded.body')
    .bind(report.computedAt, JSON.stringify(report))
    .run();
  return report;
}

/** The stored report, recomputed when it is missing or a day old. */
export async function coverage(env: Env, maxAgeMs = DAY_MS): Promise<CoverageReport> {
  const r = await storedCoverage(env);
  if (r && Date.now() - Date.parse(r.computedAt) < maxAgeMs) return r;
  return refreshCoverage(env);
}

/** For the hourly cron: recompute once a day, else do nothing (one cheap read). */
export async function refreshCoverageIfStale(env: Env): Promise<Record<string, unknown>> {
  const r = await storedCoverage(env);
  if (r && Date.now() - Date.parse(r.computedAt) < DAY_MS) return { skipped: true };
  const fresh = await refreshCoverage(env);
  return fresh.counts;
}

/** The public part for one year: sequence gaps and held meetings missing documents. */
export function publicSummary(r: CoverageReport, year: number) {
  const y = String(year);
  return {
    year,
    computedAt: r.computedAt,
    sequences: r.gaps
      .filter((g) => g.year === year)
      .map((g) => ({ series: g.series, label: SERIES_LABEL[g.series], highest: g.highest, missing: g.missing.map((n) => `${year}-${pad2(n)}`), namedInMotionsOnly: g.motionOnly.map((n) => `${year}-${pad2(n)}`) })),
    meetings: r.meetings.filter((m) => m.date.startsWith(y)).map((m) => ({ date: m.date, body: m.bodyName, title: m.title, meetingId: m.id, missing: m.missing })),
  };
}
