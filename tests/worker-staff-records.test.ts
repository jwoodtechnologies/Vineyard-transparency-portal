import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PNG, fileForm, pdfWith } from './helpers/panel';
import { staffHarness } from './helpers/staff';
import { STAFF_TYPES } from '../worker/lib/contrib';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

type H = Awaited<ReturnType<typeof staffHarness>>;
let h: H;
let owner: { cookie: string };
let clerk: { cookie: string };

beforeEach(async () => {
  h = await staffHarness();
  owner = await h.makeOwner();
  clerk = await h.addPerson(owner.cookie, { name: 'Pat Clerk', email: 'pat@vineyard.example', department: 'Recorder', role: 'editor', areas: ['records'] });
});

// The table is made by the first change, so before that the version is 0.
const version = () => {
  try {
    return (h.env.CATALOG_DB.db.prepare('SELECT v FROM data_version WHERE id = 1').get() as { v: number } | undefined)?.v ?? 0;
  } catch {
    return 0;
  }
};
const count = (sql: string, ...p: unknown[]) => Number((h.env.CATALOG_DB.db.prepare(sql).get(...p) as { n: number }).n);

async function addPdf(cookie: string, text: string, name: string, fields: Record<string, string> = {}) {
  return h.call('POST', '/records/file', undefined, { cookie, form: fileForm(await pdfWith(text), name, fields) });
}

describe('who may use the records area', () => {
  it('keeps people without the area out, and anyone not signed in', async () => {
    const budget = await h.addPerson(owner.cookie, { name: 'Bo Budget', email: 'bo@vineyard.example', role: 'editor', areas: ['budget'] }, 'a different long password');
    expect((await h.call('GET', '/records/uploads', undefined, { cookie: budget.cookie })).status).toBe(403);
    expect((await addPdf(budget.cookie, 'Agenda', 'agenda.pdf')).status).toBe(403);
    expect((await h.call('GET', '/records/uploads')).status).toBe(401);
    expect((await h.call('POST', '/records/file', undefined, { form: fileForm(PNG, 'a.png') })).status).toBe(401);
    expect((await h.call('POST', '/records/file', undefined, { cookie: clerk.cookie, csrf: false, form: fileForm(PNG, 'a.png') })).status).toBe(403);
  });

  it('offers only types the archive accepts', async () => {
    const r = await h.call('GET', '/records/uploads', undefined, { cookie: clerk.cookie });
    expect(r.status).toBe(200);
    for (const t of r.body.types as Array<{ key: string }>) expect(Object.keys(STAFF_TYPES)).toContain(t.key);
    expect(new Set((r.body.types as Array<{ key: string }>).map((t) => t.key)).size).toBe(Object.keys(STAFF_TYPES).length);
  });
});

describe('adding a file', () => {
  it('stores it with its details, names who added it and refreshes the public site', async () => {
    h.env.CATALOG_DB.db
      .prepare(`INSERT INTO meetings (id, slug, title, government_body_id, government_body_name, meeting_type, meeting_date, source_id, created_at, updated_at) VALUES ('mtg_1', 'mtg-1', 'City Council Meeting', 'city-council', 'City Council', 'regular', '2026-09-15T18:00:00', 'civicclerk', 't', 't')`)
      .run();
    const before = version();
    const r = await addPdf(clerk.cookie, 'Water rate study for Vineyard', 'water_rates.pdf', { type: 'staff_report', title: 'Water rate study', date: '2026-09-10', meetingId: 'mtg_1' });
    expect(r.status).toBe(201);
    expect(version()).toBe(before + 1);
    const doc = h.env.CATALOG_DB.db.prepare('SELECT title, document_type, document_date, meeting_id, source_id FROM documents WHERE id = ?').get(r.body.documentId) as Record<string, string>;
    expect(doc).toMatchObject({ title: 'Water rate study', document_type: 'staff_report', document_date: '2026-09-10', meeting_id: 'mtg_1', source_id: 'portal-staff' });

    const list = await h.call('GET', '/records/uploads', undefined, { cookie: clerk.cookie });
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({ title: 'Water rate study', typeKey: 'staff_report', added_by: 'Pat Clerk', meeting_title: 'City Council Meeting', kind: 'file' });

    const log = await h.call('GET', '/audit', undefined, { cookie: clerk.cookie });
    expect(log.body.items[0]).toMatchObject({ area: 'records', action: 'added', user_name: 'Pat Clerk', undoable: true });
  });

  it('adds minutes as minutes, so the votes reader picks them up', async () => {
    const r = await addPdf(clerk.cookie, 'City Council minutes', 'minutes.pdf', { type: 'minutes', title: 'City Council Minutes September 15 2026', date: '2026-09-15' });
    expect(r.status).toBe(201);
    expect(count("SELECT count(*) AS n FROM documents WHERE document_type = 'minutes' AND id = ?", r.body.documentId)).toBe(1);
  });

  it('refuses the same file twice, an unknown type and a file that is not a PDF, image or text file', async () => {
    expect((await addPdf(clerk.cookie, 'One', 'a.pdf')).status).toBe(201);
    expect((await addPdf(clerk.cookie, 'One', 'a.pdf')).status).toBe(409);
    expect((await addPdf(clerk.cookie, 'Two', 'b.pdf', { type: 'nonsense' })).status).toBe(400);
    const bad = await h.call('POST', '/records/file', undefined, { cookie: clerk.cookie, form: fileForm(new TextEncoder().encode('<html><script>x</script></html>'), 'x.pdf') });
    expect(bad.status).toBe(415);
    expect(count('SELECT count(*) AS n FROM uploads')).toBe(1);
  });
});

describe('notes and links', () => {
  it('adds a note and a link and shows them in the list', async () => {
    const n = await h.call('POST', '/records/note', { title: 'Park survey', text: 'Residents asked for shade at Grove Park.' }, { cookie: clerk.cookie });
    expect(n.status).toBe(201);
    const l = await h.call('POST', '/records/link', { url: 'https://vineyardutah.gov/news', title: 'City news' }, { cookie: clerk.cookie });
    expect(l.status).toBe(201);
    const list = await h.call('GET', '/records/uploads', undefined, { cookie: clerk.cookie });
    expect(list.body.items.map((i: { kind: string }) => i.kind).sort()).toEqual(['link', 'note']);
  });

  it('refuses a link that is not a web address and an empty note', async () => {
    expect((await h.call('POST', '/records/link', { url: 'javascript:alert(1)', title: 'x' }, { cookie: clerk.cookie })).status).toBe(400);
    expect((await h.call('POST', '/records/note', { title: 'x', text: '   ' }, { cookie: clerk.cookie })).status).toBe(400);
  });
});

describe('editing, undoing and removing', () => {
  async function one() {
    const r = await addPdf(clerk.cookie, 'Ordinance text', 'ord.pdf', { type: 'ordinance', title: 'Ordinance 2026-12', date: '2026-08-04' });
    return { id: r.body.id as string, documentId: r.body.documentId as string };
  }

  it('changes the details and the public record follows', async () => {
    const { id, documentId } = await one();
    const r = await h.call('POST', '/records/edit', { id, title: 'Ordinance 2026-12 Fee Schedule', type: 'resolution', date: '2026-08-05' }, { cookie: clerk.cookie });
    expect(r.status).toBe(200);
    const doc = h.env.CATALOG_DB.db.prepare('SELECT title, document_type, document_date FROM documents WHERE id = ?').get(documentId) as Record<string, string>;
    expect(doc).toMatchObject({ title: 'Ordinance 2026-12 Fee Schedule', document_type: 'resolution', document_date: '2026-08-05' });
  });

  it('puts an edit back with one tap', async () => {
    const { id, documentId } = await one();
    const before = version();
    await h.call('POST', '/records/edit', { id, title: 'Wrong title', type: 'budget', date: '2026-01-01' }, { cookie: clerk.cookie });
    const log = await h.call('GET', '/audit', undefined, { cookie: clerk.cookie });
    const entry = log.body.items.find((i: { action: string }) => i.action === 'edited');
    expect(entry.undoable).toBe(true);
    const undo = await h.call('POST', '/audit/undo', { id: entry.id }, { cookie: clerk.cookie });
    expect(undo.status).toBe(200);
    const doc = h.env.CATALOG_DB.db.prepare('SELECT title, document_type, document_date FROM documents WHERE id = ?').get(documentId) as Record<string, string>;
    expect(doc).toMatchObject({ title: 'Ordinance 2026-12', document_type: 'ordinance', document_date: '2026-08-04' });
    expect(version()).toBeGreaterThan(before + 1);
    expect((await h.call('POST', '/audit/undo', { id: entry.id }, { cookie: clerk.cookie })).status).toBe(400);
  });

  it('undoing an add takes the record and its file down', async () => {
    const { documentId } = await one();
    const log = await h.call('GET', '/audit', undefined, { cookie: clerk.cookie });
    const entry = log.body.items.find((i: { action: string }) => i.action === 'added');
    expect((await h.call('POST', '/audit/undo', { id: entry.id }, { cookie: clerk.cookie })).status).toBe(200);
    expect(count('SELECT count(*) AS n FROM documents WHERE id = ?', documentId)).toBe(0);
    expect(count('SELECT count(*) AS n FROM uploads')).toBe(0);
  });

  it('removes a record for good and offers no undo for it', async () => {
    const { id, documentId } = await one();
    expect((await h.call('POST', '/records/delete', { id }, { cookie: clerk.cookie })).status).toBe(200);
    expect(count('SELECT count(*) AS n FROM documents WHERE id = ?', documentId)).toBe(0);
    const log = await h.call('GET', '/audit', undefined, { cookie: clerk.cookie });
    expect(log.body.items[0]).toMatchObject({ action: 'removed', undoable: false });
    expect((await h.call('POST', '/records/delete', { id }, { cookie: clerk.cookie })).status).toBe(404);
  });

  it('lets any records editor change what a colleague added', async () => {
    const { id } = await one();
    const other = await h.addPerson(owner.cookie, { name: 'Sam Planner', email: 'sam@vineyard.example', role: 'editor', areas: ['records'] }, 'yet another long password');
    expect((await h.call('POST', '/records/edit', { id, title: 'Ordinance 2026-12 (corrected)' }, { cookie: other.cookie })).status).toBe(200);
  });

  it('finds an upload by part of its title', async () => {
    await one();
    await h.call('POST', '/records/note', { title: 'Park survey', text: 'Shade at Grove Park.' }, { cookie: clerk.cookie });
    const found = await h.call('GET', '/records/uploads?q=ordinance', undefined, { cookie: clerk.cookie });
    expect(found.body.items.map((i: { title: string }) => i.title)).toEqual(['Ordinance 2026-12']);
  });
});
