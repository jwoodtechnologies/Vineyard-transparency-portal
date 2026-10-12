/**
 * GET /api/documents/:id/trail : follow the paper trail of one record (src/types/models.ts DocumentTrail).
 *
 * - A record filed with a meeting: that meeting, the other files on its agenda item, and the meeting's other
 *   records in agenda order (src/lib/meetingOrder.ts).
 * - A numbered ordinance or resolution with no meeting (the municipal code site's copy): the copy of the same
 *   measure filed with a meeting ("Ordinance 2026-08 (City Council, 2026-06-23, item 5.1)"), else the meeting
 *   whose minutes adopted it, else the meeting held that day by the same body. Its agenda item is the one whose
 *   files name the measure's number, else the one whose name shares the most words with the measure's title.
 *
 * Read only and edge-cached like the other record routes.
 */
import type { Env } from '../env';
import type { DocumentSummary, DocumentTrail } from '../../src/types/models';
import { jsonWithEtag, CACHE } from '../lib/http';
import { toDocumentSummary, type Row } from '../lib/mappers';
import { applyAdoptions } from './records';
import { agendaItems, getDocumentRow } from './documents';
import { displayTitle, numberedKindOf, recordNumberOf } from '../../src/lib/recordTitle';
import { itemKeyOf, itemNumberOf, orderMeetingDocs, type OrderDoc } from '../../src/lib/meetingOrder';

type Doc = DocumentSummary & OrderDoc & { agendaItemId: string | null };

const STOP = new Set(
  'ordinance resolution amending amend amendment approve approving adopt adopting adoption public hearing city vineyard council utah for the and with from that this item consider discussion action regarding'.split(' '),
);

/** The words of a title worth matching on (four letters or more, or a year range like 2026-2027), number removed. */
export function titleWords(text: string, number: string | null): Set<string> {
  let t = text.toLowerCase();
  if (number) t = t.replace(new RegExp(`${number.slice(0, 4)}\\s*-\\s*0*${Number(number.slice(5, 8))}[a-z]?\\b`, 'g'), ' ');
  const words = t.match(/\d{4}-\d{2,4}|[a-z]{4,}/g) ?? [];
  return new Set(words.filter((w) => !STOP.has(w)));
}

/** True when the text names the measure's number ("2026-08", "2026-8", "Ord 2026-08"). */
export function namesNumber(text: string, number: string): boolean {
  const year = number.slice(0, 4);
  const n = Number(number.slice(5).replace(/\D+$/, ''));
  return new RegExp(`(?<![\\d-])${year}\\s*-\\s*0*${n}(?![\\d]|-\\d)`, 'i').test(text);
}

function toDoc(row: Row): Doc {
  return { ...toDocumentSummary(row), agendaItemId: row.agenda_item_id == null ? null : String(row.agenda_item_id) };
}

/** The agenda item (by key) in a meeting that stands for a measure: files naming its number, else the closest name. */
export function itemForMeasure(docs: Doc[], number: string, title: string): string | null {
  const groups = new Map<string, Doc[]>();
  for (const d of docs) {
    const k = itemKeyOf(d);
    if (k) groups.set(k, [...(groups.get(k) ?? []), d]);
  }
  for (const [k, list] of groups) if (list.some((d) => namesNumber(`${d.title} ${d.description ?? ''}`, number))) return k;
  const want = titleWords(title, number);
  if (want.size < 2) return null;
  let best: { key: string; score: number } | null = null;
  let tie = false;
  for (const [k, list] of groups) {
    const have = new Set<string>();
    for (const d of list) for (const w of titleWords(`${d.description ?? ''} ${d.title}`, null)) have.add(w);
    const score = [...want].filter((w) => have.has(w)).length;
    if (!best || score > best.score) {
      best = { key: k, score };
      tie = false;
    } else if (score === best.score) tie = true;
  }
  return best && best.score >= 2 && !tie ? best.key : null;
}

export async function getTrail(env: Env, request: Request, id: string): Promise<Response> {
  return jsonWithEtag(request, await computeTrail(env, await getDocumentRow(env, id)), CACHE.detail);
}

/** The trail of one catalog row (also used by the budget page for the budget book on the adopting item). */
export async function computeTrail(env: Env, row: Row): Promise<DocumentTrail> {
  const db = env.CATALOG_DB;
  const self = toDoc(row);
  const empty: DocumentTrail = { meeting: null, item: null, via: null, twinId: null, attachments: [], meeting_docs: [], sequence: [] };

  let meetingId = self.meetingId;
  let via: DocumentTrail['via'] = meetingId ? 'meeting' : null;
  let twin: Doc | null = null;
  let itemKey: string | null = meetingId ? itemKeyOf(self) : null;
  const kind = numberedKindOf(self);
  const number = kind ? recordNumberOf(self) : null;

  if (!meetingId && kind && number) {
    // The same measure filed with a meeting (an agenda item attachment).
    const year = number.slice(0, 4);
    const res = await db
      .prepare(`SELECT * FROM documents WHERE meeting_id IS NOT NULL AND id <> ? AND document_type = ? AND (title LIKE ? OR document_number LIKE ?) LIMIT 400`)
      .bind(self.id, row.document_type, `%${year}%`, `%${year}%`)
      .all<Row>();
    const twins = (res.results ?? [])
      .map(toDoc)
      .filter((d) => numberedKindOf(d) === kind && recordNumberOf(d) === number && (!self.governmentBodyId || !d.governmentBodyId || d.governmentBodyId === self.governmentBodyId));
    twins.sort((a, b) => Number(b.date === self.date) - Number(a.date === self.date) || Number(/\b(ordinance|resolution)\b/i.test(b.title)) - Number(/\b(ordinance|resolution)\b/i.test(a.title)) || String(b.date ?? '').localeCompare(String(a.date ?? '')));
    if (twins[0]) {
      twin = twins[0];
      meetingId = twin.meetingId;
      itemKey = itemKeyOf(twin);
      via = 'copy';
    }
    if (!meetingId) {
      // The meeting whose minutes adopted it, else the meeting the same body held that day.
      const [labelled] = await applyAdoptions(env, [{ ...self }]);
      const minutesId = labelled.adoption?.minutesDocumentId;
      if (minutesId) {
        const m = await db.prepare('SELECT meeting_id FROM documents WHERE id = ?').bind(minutesId).first<{ meeting_id: string | null }>();
        if (m?.meeting_id) meetingId = m.meeting_id;
      }
      if (!meetingId && self.date) {
        const m = await db
          .prepare(
            `SELECT m.id, (SELECT count(*) FROM documents d WHERE d.meeting_id = m.id) AS n FROM meetings m
             WHERE substr(m.meeting_date, 1, 10) = ? AND (? IS NULL OR m.government_body_id = ?) ORDER BY n DESC LIMIT 1`,
          )
          .bind(self.date, self.governmentBodyId, self.governmentBodyId)
          .first<{ id: string; n: number }>();
        if (m && Number(m.n) > 0) meetingId = m.id;
      }
      if (meetingId) via = 'date';
    }
  }
  if (!meetingId) return empty;

  const [meeting, docsRes, itemsRes] = await Promise.all([
    db.prepare('SELECT id, title, meeting_date FROM meetings WHERE id = ?').bind(meetingId).first<Row>(),
    db.prepare('SELECT * FROM documents WHERE meeting_id = ? LIMIT 400').bind(meetingId).all<Row>(),
    db.prepare('SELECT id, number, title, sort FROM agenda_items WHERE meeting_id = ? ORDER BY sort').bind(meetingId).all<Row>().catch(() => ({ results: [] as Row[] })),
  ]);
  const rows = docsRes.results ?? [];
  const docs = rows.map(toDoc);
  await applyAdoptions(env, docs, agendaItems(rows));
  const itemRows = itemsRes.results ?? [];
  const ordered = orderMeetingDocs(docs, new Map(itemRows.map((r) => [String(r.id), Number(r.sort ?? 0)])));

  if (!itemKey && via === 'date' && number) itemKey = itemForMeasure(docs, number, displayTitle(self).title);
  const sameItem = itemKey ? ordered.filter((d) => itemKeyOf(d) === itemKey && d.id !== self.id) : [];
  const attachmentIds = new Set(sameItem.map((d) => d.id));
  const strip = ({ agendaItemId: _a, ...d }: Doc): DocumentSummary => {
    void _a;
    return d;
  };

  let item: DocumentTrail['item'] = null;
  if (itemKey) {
    const first = [twin, via === 'meeting' ? self : null, ...sameItem].find((d): d is Doc => Boolean(d && itemKeyOf(d) === itemKey));
    const agendaRow = itemKey.startsWith('id:') ? itemRows.find((r) => `id:${String(r.id)}` === itemKey) : undefined;
    item = agendaRow
      ? { number: agendaRow.number ? String(agendaRow.number) : null, title: String(agendaRow.title ?? '') || null }
      : { number: first ? itemNumberOf(first) : null, title: first?.description ?? null };
  }

  const trail: DocumentTrail = {
    meeting: meeting ? { id: String(meeting.id), title: String(meeting.title), date: meeting.meeting_date == null ? null : String(meeting.meeting_date).slice(0, 10) } : null,
    item,
    via,
    twinId: twin?.id ?? null,
    attachments: sameItem.map(strip),
    meeting_docs: ordered.filter((d) => d.id !== self.id && !attachmentIds.has(d.id)).map(strip),
    sequence: ordered.map((d) => d.id),
  };
  return trail;
}
