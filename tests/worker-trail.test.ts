import { describe, expect, it } from 'vitest';
import { testEnv } from './helpers/d1';
import { getTrail, itemForMeasure, namesNumber } from '../worker/api/trail';
import { pickBudgetBook } from '../worker/api/budget';
import { compareOutline, orderMeetingDocs } from '../src/lib/meetingOrder';
import type { DocumentTrail } from '../src/types/models';

const now = '2026-10-12T00:00:00Z';
const M = 'City Council Regular Meeting';

function seed() {
  const env = testEnv();
  const db = env.CATALOG_DB.db;
  db.exec(`CREATE TABLE IF NOT EXISTS motions (id TEXT PRIMARY KEY, document_id TEXT NOT NULL, meeting_id TEXT, body_id TEXT, meeting_date TEXT, seq INTEGER, item TEXT, motion TEXT, mover TEXT, seconder TEXT, result TEXT, tally TEXT, tie_break INTEGER NOT NULL DEFAULT 0, unanimous INTEGER NOT NULL DEFAULT 0, inferred INTEGER NOT NULL DEFAULT 0, refs TEXT, page INTEGER, items TEXT)`);
  db.prepare(`INSERT INTO meetings (id, slug, title, government_body_id, meeting_date, source_id, created_at, updated_at) VALUES ('mtg_1', 'mtg-1', ?, 'city-council', '2026-06-23T18:00:00', 's', ?, ?)`).run(M, now, now);
  const doc = db.prepare(
    `INSERT INTO documents (id, slug, title, description, document_type, document_number, document_date, government_body_id, government_body_name, meeting_id, source_id, mime_type, page_count, created_at, updated_at, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, '2026-06-23', 'city-council', 'City Council', ?, ?, 'application/pdf', ?, ?, ?, ?, ?)`,
  );
  const add = (id: string, title: string, type: string, opts: { desc?: string; meeting?: string | null; source?: string; number?: string; pages?: number } = {}) =>
    doc.run(id, id, title, opts.desc ?? null, type, opts.number ?? null, opts.meeting === undefined ? 'mtg_1' : opts.meeting, opts.source ?? 'vineyard-civicclerk-meetings', opts.pages ?? 3, now, now, now, now);
  const item = (n: string) => `(${M}, 2026-06-23, item ${n})`;
  add('minutes', '6.23.26 Approved CC Minutes', 'minutes');
  add('agenda', '6.23.26 CC Agenda', 'agenda');
  add('packet', '6.23.26 CC Packet', 'agenda_packet');
  add('splash', `Splash Pad Staff Report ${item('4.1')}`, 'staff_report', { desc: 'Splash pad contract' });
  add('rda', `RDA Budget Resolution ${item('10')}`, 'resolution', { desc: 'RDA budget' });
  add('slides', `FY27 Budget Slides ${item('5.1')}`, 'presentation', { desc: 'Public hearing and adoption of the FY 2026-2027 Final Budget' });
  add('book', `FY 27 Final Budget ${item('5.1')}`, 'budget', { desc: 'Public hearing and adoption of the FY 2026-2027 Final Budget', pages: 120 });
  add('ord', `Ordinance 2026-08 Final Budget ${item('5.1')}`, 'ordinance', { desc: 'Public hearing and adoption of the FY 2026-2027 Final Budget' });
  add('tax', `Certified Tax Rate ${item('5.2')}`, 'other', { desc: 'Certified tax rate' });
  add('code', '2026-08 Final Budget For FY 2026-2027', 'ordinance', { meeting: null, source: 'vineyard-municipal-code', number: '2026-08' });
  return env;
}

const trailOf = async (env: ReturnType<typeof seed>, id: string) => (await (await getTrail(env, new Request(`https://x/api/documents/${id}/trail`), id)).json()) as DocumentTrail;

describe('paper trail', () => {
  it('lists the files on the same agenda item and the rest of the meeting in agenda order', async () => {
    const env = seed();
    const t = await trailOf(env, 'ord');
    expect(t.meeting).toEqual({ id: 'mtg_1', title: M, date: '2026-06-23' });
    expect(t.item?.number).toBe('5.1');
    expect(t.attachments.map((d) => d.id)).toEqual(['book', 'slides']);
    expect(t.meeting_docs.map((d) => d.id)).toEqual(['agenda', 'packet', 'minutes', 'splash', 'tax', 'rda']);
    expect(t.sequence).toEqual(['agenda', 'packet', 'minutes', 'splash', 'ord', 'book', 'slides', 'tax', 'rda']);
  });

  it('finds the meeting copy of a municipal code ordinance by its number', async () => {
    const env = seed();
    const t = await trailOf(env, 'code');
    expect(t.via).toBe('copy');
    expect(t.twinId).toBe('ord');
    expect(t.attachments.map((d) => d.id)).toEqual(['ord', 'book', 'slides']);
    expect(pickBudgetBook(t.attachments)?.id).toBe('book');
  });

  it('falls back to the meeting held that day and the item with the closest name', async () => {
    const env = seed();
    env.CATALOG_DB.db.prepare(`DELETE FROM documents WHERE id = 'ord'`).run();
    const t = await trailOf(env, 'code');
    expect(t.via).toBe('date');
    expect(t.attachments.map((d) => d.id)).toEqual(['book', 'slides']);
  });

  it('gives an empty trail for a record with no meeting', async () => {
    const env = seed();
    env.CATALOG_DB.db.prepare(`INSERT INTO documents (id, slug, title, document_type, source_id, created_at, updated_at, first_seen_at, last_seen_at) VALUES ('news', 'news', 'Newsletter', 'other', 's', ?, ?, ?, ?)`).run(now, now, now, now);
    const t = await trailOf(env, 'news');
    expect(t.meeting).toBeNull();
    expect(t.sequence).toEqual([]);
  });
});

describe('agenda order helpers', () => {
  it('orders item numbers as an agenda does', () => {
    expect(['10', '4.1', '5', '4', '8.b', '8.a'].sort(compareOutline)).toEqual(['4', '4.1', '5', '8.a', '8.b', '10']);
  });
  it('names a measure number only exactly', () => {
    expect(namesNumber('Ordinance 2026-08 Final Budget', '2026-08')).toBe(true);
    expect(namesNumber('Ord 2026-8', '2026-08')).toBe(true);
    expect(namesNumber('Ordinance 2026-080', '2026-08')).toBe(false);
    expect(namesNumber('FY 2026-2027 budget', '2026-08')).toBe(false);
    expect(namesNumber('Report (City Council, 2026-08-11, item 4)', '2026-08')).toBe(false);
  });
  it('picks no item when two are equally close', () => {
    const d = (id: string, item: string, desc: string) => ({ id, title: `X (M, 2026-01-01, item ${item})`, description: desc, documentType: 'other', agendaItemId: null }) as never;
    expect(itemForMeasure([d('a', '1', 'park budget'), d('b', '2', 'park budget')], '2026-01', 'Park Budget')).toBeNull();
  });
  it('keeps the agenda, packet and minutes first', () => {
    const docs = [
      { id: 'x', title: 'Report (M, 2026-01-01, item 2)', documentType: 'staff_report' },
      { id: 'm', title: 'Minutes', documentType: 'minutes' },
      { id: 'a', title: 'Agenda', documentType: 'agenda' },
    ];
    expect(orderMeetingDocs(docs).map((d) => d.id)).toEqual(['a', 'm', 'x']);
  });
});
