import { beforeEach, describe, expect, it, vi } from 'vitest';
import { staffHarness } from './helpers/staff';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

type H = Awaited<ReturnType<typeof staffHarness>>;
let h: H;
let owner: { cookie: string };
let clerk: { cookie: string };
const KEY = 'a'.repeat(64);
const SHA = 'b'.repeat(64);
const NOW = '2026-10-01T00:00:00Z';

async function seed() {
  const db = h.env.CATALOG_DB as unknown as D1Database;
  await db
    .prepare(
      `INSERT INTO meetings (id, slug, title, government_body_id, government_body_name, meeting_type, meeting_date, start_time, location, status, source_id, media_json, created_at, updated_at, minutes_document_id)
       VALUES ('mtg_cc_1', 'cc-1', 'City Council Meeting', 'city-council', 'City Council', 'regular', '2026-10-14', '18:00', 'City Hall', 'scheduled', 'vineyard-civicclerk-meetings', '[]', ?, ?, 'doc_0000000000000001'),
              ('mtg_cc_2', 'cc-2', 'City Council Meeting', 'city-council', 'City Council', 'regular', '2026-10-28', '18:00', 'City Hall', 'scheduled', 'vineyard-civicclerk-meetings', '[]', ?, ?, NULL)`,
    )
    .bind(NOW, NOW, NOW, NOW)
    .run();
  await db
    .prepare(
      `INSERT INTO documents (id, slug, title, document_type, document_date, year, meeting_id, government_body_id, source_id, sha256, canonical_key, search_shard, chunk_count, created_at, updated_at, first_seen_at, last_seen_at)
       VALUES ('doc_0000000000000001', 'm-1', 'CC Minutes Draft', 'minutes', '2026-10-14', 2026, 'mtg_cc_1', 'city-council', 'vineyard-civicclerk-meetings', ?, ?, 0, 1, ?, ?, ?, ?)`,
    )
    .bind(SHA, KEY, NOW, NOW, NOW, NOW)
    .run();
  await db
    .prepare(
      `INSERT INTO document_sources (id, document_id, source_id, source_url, canonical_key, retrieved_at) VALUES ('src_1', 'doc_0000000000000001', 'vineyard-civicclerk-meetings', 'https://example.org/m.pdf', ?, ?)`,
    )
    .bind(KEY, NOW)
    .run();
  const shard = (h.env as unknown as { SEARCH_DB_0: D1Database }).SEARCH_DB_0;
  await shard
    .prepare(
      `INSERT INTO shard_documents (document_id, title, document_type, document_date, year, source_id, meeting_id, categories_json, currency, chunk_count, indexed_at) VALUES ('doc_0000000000000001', 'CC Minutes Draft', 'minutes', '2026-10-14', 2026, 'vineyard-civicclerk-meetings', 'mtg_cc_1', '[]', 'unknown', 1, ?)`,
    )
    .bind(NOW)
    .run();
  await shard
    .prepare(
      `INSERT INTO chunks (id, document_id, doc_title, page_start, page_end, section_title, text, character_count, ocr, created_at) VALUES ('c1', 'doc_0000000000000001', 'CC Minutes Draft', 1, 1, NULL, 'The council met.', 16, 0, ?)`,
    )
    .bind(NOW)
    .run();
  await shard.prepare(`INSERT INTO chunks_fts(rowid, doc_title, section_title, text) SELECT rowid, doc_title, section_title, text FROM chunks`).run();
}

const docOf = () => (h.env.CATALOG_DB as unknown as D1Database).prepare('SELECT * FROM documents WHERE id = ?').bind('doc_0000000000000001').first<Record<string, unknown>>();
const ingest = async (title: string, date: string, sha = 'c'.repeat(64)) => {
  const { upsertDocument, Budget } = await import('../worker/admin/routes');
  const r = await upsertDocument(
    h.env as never,
    {
      document: { title, documentDate: date, sha256: sha, documentType: 'minutes', meetingId: 'mtg_cc_1' },
      source: { canonicalKey: KEY, sourceId: 'vineyard-civicclerk-meetings', url: 'https://example.org/m.pdf' },
    },
    new Budget(h.env as never),
  );
  return (await r.json()) as { status: string; held?: boolean };
};

beforeEach(async () => {
  h = await staffHarness();
  owner = await h.makeOwner();
  clerk = await h.addPerson(owner.cookie, { name: 'Robin Recorder', email: 'robin@vineyard.example', role: 'editor', areas: ['records'] });
  await h.call('GET', '/archive/find?q=x', undefined, { cookie: clerk.cookie });
  await seed();
});

describe('correcting a city record', () => {
  it('needs the records area', async () => {
    const other = await h.addPerson(owner.cookie, { name: 'Mo Mapper', email: 'mo@vineyard.example', role: 'editor', areas: ['map'] });
    expect((await h.call('POST', '/archive/fix', { id: 'doc_0000000000000001', title: 'x' }, { cookie: other.cookie })).status).toBe(403);
  });

  it('fixes title, date and meeting everywhere, and the next read of the city site leaves it alone', async () => {
    const r = await h.call(
      'POST',
      '/archive/fix',
      { id: 'doc_0000000000000001', title: 'City Council minutes, October 14, 2026', date: '2026-10-28', meetingId: 'mtg_cc_2' },
      { cookie: clerk.cookie },
    );
    expect(r.status).toBe(200);
    const d = (await docOf())!;
    expect(d).toMatchObject({ title: 'City Council minutes, October 14, 2026', document_date: '2026-10-28', year: 2026, meeting_id: 'mtg_cc_2' });
    const db = h.env.CATALOG_DB as unknown as D1Database;
    expect(await db.prepare("SELECT minutes_document_id AS m FROM meetings WHERE id = 'mtg_cc_1'").first()).toEqual({ m: null });
    expect(await db.prepare("SELECT minutes_document_id AS m FROM meetings WHERE id = 'mtg_cc_2'").first()).toEqual({ m: 'doc_0000000000000001' });
    const shard = (h.env as unknown as { SEARCH_DB_0: D1Database }).SEARCH_DB_0;
    expect(await shard.prepare("SELECT title, document_date FROM shard_documents WHERE document_id = 'doc_0000000000000001'").first()).toEqual({
      title: 'City Council minutes, October 14, 2026',
      document_date: '2026-10-28',
    });
    expect(await shard.prepare("SELECT count(*) AS n FROM chunks_fts WHERE chunks_fts MATCH 'doc_title:october'").first()).toEqual({ n: 1 });
    // A new copy of the file arrives with the city's own title and date.
    expect((await ingest('CC Minutes Draft v2', '2026-10-14')).status).toBe('new_version');
    expect((await docOf())!).toMatchObject({ title: 'City Council minutes, October 14, 2026', document_date: '2026-10-28', meeting_id: 'mtg_cc_2' });
    const items = (await h.call('GET', '/audit?limit=3', undefined, { cookie: clerk.cookie })).body.items as Array<{ id: number; summary: string }>;
    expect(items[0].summary).toBe('Corrected the record "City Council minutes, October 14, 2026"');
    expect((await h.call('POST', '/audit/undo', { id: items[0].id }, { cookie: clerk.cookie })).status).toBe(200);
    expect((await docOf())!).toMatchObject({ title: 'CC Minutes Draft', document_date: '2026-10-14', meeting_id: 'mtg_cc_1', manual_json: null });
  });

  it('refuses a made-up type, a bad date and an unknown meeting', async () => {
    for (const b of [{ type: 'memo' }, { date: '10/14/2026' }, { meetingId: 'mtg_nope' }, { title: '<b>x</b>' }])
      expect((await h.call('POST', '/archive/fix', { id: 'doc_0000000000000001', ...b }, { cookie: clerk.cookie })).status).toBe(400);
  });
});

describe('hiding a record', () => {
  it('takes it out everywhere, says why at its link, refuses to file it again, and undo brings it back', async () => {
    const r = await h.call('POST', '/archive/hide', { id: 'doc_0000000000000001', reason: 'A duplicate of the approved minutes.' }, { cookie: clerk.cookie });
    expect(r.status).toBe(200);
    expect(await docOf()).toBeNull();
    const { getDocumentRow } = await import('../worker/api/documents');
    await expect(getDocumentRow(h.env as never, 'doc_0000000000000001')).rejects.toThrow(/taken out of the archive. A duplicate of the approved minutes./);
    const shard = (h.env as unknown as { SEARCH_DB_0: D1Database }).SEARCH_DB_0;
    expect(await shard.prepare("SELECT count(*) AS n FROM shard_documents WHERE document_id = 'doc_0000000000000001'").first()).toEqual({ n: 0 });
    expect(await ingest('CC Minutes Draft', '2026-10-14', SHA)).toMatchObject({ status: 'unchanged', held: true });
    expect(await docOf()).toBeNull();
    const found = (await h.call('GET', '/archive/find?q=', undefined, { cookie: clerk.cookie })).body.hidden as Array<{ id: string }>;
    expect(found.map((x) => x.id)).toEqual(['doc_0000000000000001']);
    const items = (await h.call('GET', '/audit?limit=3', undefined, { cookie: clerk.cookie })).body.items as Array<{ id: number; summary: string }>;
    expect((await h.call('POST', '/audit/undo', { id: items[0].id }, { cookie: clerk.cookie })).status).toBe(200);
    expect((await docOf())!.title).toBe('CC Minutes Draft');
    expect(await shard.prepare("SELECT count(*) AS n FROM shard_documents WHERE document_id = 'doc_0000000000000001'").first()).toEqual({ n: 1 });
    expect(await (h.env.CATALOG_DB as unknown as D1Database).prepare("SELECT minutes_document_id AS m FROM meetings WHERE id = 'mtg_cc_1'").first()).toEqual({ m: 'doc_0000000000000001' });
  });
});

describe('meetings', () => {
  it('cancels, moves and adds a video, and the agenda portal sync keeps it', async () => {
    const r = await h.call(
      'POST',
      '/archive/meeting',
      { id: 'mtg_cc_1', status: 'cancelled', date: '2026-10-21', location: 'Vineyard Library', video: 'https://youtube.com/watch?v=abc' },
      { cookie: clerk.cookie },
    );
    expect(r.status).toBe(200);
    const { upsertMeetings, Budget } = await import('../worker/admin/routes');
    await upsertMeetings(
      h.env as never,
      {
        meetings: [
          {
            id: 'mtg_cc_1',
            title: 'City Council Meeting',
            sourceId: 'vineyard-civicclerk-meetings',
            date: '2026-10-14',
            startTime: '18:00',
            location: 'City Hall',
            status: 'scheduled',
            governmentBodyId: 'city-council',
          },
        ],
      },
      new Budget(h.env as never),
    );
    const m = (await (h.env.CATALOG_DB as unknown as D1Database).prepare("SELECT * FROM meetings WHERE id = 'mtg_cc_1'").first<Record<string, unknown>>())!;
    expect(m).toMatchObject({ status: 'cancelled', meeting_date: '2026-10-21', location: 'Vineyard Library', start_time: '18:00' });
    const { parseMedia } = await import('../worker/lib/mappers');
    expect(parseMedia(m)[0]).toMatchObject({ kind: 'video', url: 'https://youtube.com/watch?v=abc' });
    expect((await h.call('POST', '/archive/meeting', { id: 'mtg_cc_1', video: 'javascript:alert(1)' }, { cookie: clerk.cookie })).status).toBe(400);
    const items = (await h.call('GET', '/audit?limit=3', undefined, { cookie: clerk.cookie })).body.items as Array<{ id: number; summary: string }>;
    expect(items[0].summary).toBe('Changed the meeting "City Council Meeting (2026-10-14)": marked it canceled, moved it to 2026-10-21, changed the place, added a video link');
  });
});
