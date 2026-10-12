import { beforeEach, describe, expect, it, vi } from 'vitest';
import { staffHarness } from './helpers/staff';
import { handleSearch } from '../worker/api/search';
import { publicUpdates, updateProjects } from '../worker/contrib/updates';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

type H = Awaited<ReturnType<typeof staffHarness>>;
let h: H;
let owner: { cookie: string };
let clerk: { cookie: string };
let other: { cookie: string };

const TEXT = 'The new pickleball courts at Grove Park opened on October 10, 2026. All eight courts are lit until 10 pm.';

beforeEach(async () => {
  h = await staffHarness();
  owner = await h.makeOwner();
  clerk = await h.addPerson(owner.cookie, { name: 'Pat Clerk', email: 'pat@vineyard.example', role: 'editor', areas: ['notices'] });
  other = await h.addPerson(owner.cookie, { name: 'Vic Voter', email: 'vic@vineyard.example', role: 'editor', areas: ['votes'] });
});

const add = (b: Record<string, unknown>, who = clerk) => h.call('POST', '/updates/add', b, { cookie: who.cookie });
const list = async () => (await h.call('GET', '/updates/list', undefined, { cookie: clerk.cookie })).body;
const chunks = (documentId: string) => (h.env.SEARCH_DB_0.db.prepare('SELECT group_concat(text) AS t FROM chunks WHERE document_id = ?').get(documentId) as { t: string | null }).t ?? '';
const found = async (q: string): Promise<string[]> => {
  const res = await handleSearch(h.env as never, new URL(`https://vineyardportal.org/api/search?q=${encodeURIComponent(q)}`));
  return ((await res.json()) as { items: Array<{ document: { id: string } }> }).items.map((r) => r.document.id);
};
const publicList = async () =>
  ((await (await publicUpdates(h.env as never, new URL('https://x/api/updates'))).json()) as { items: Array<{ title: string; text: string; topic: string | null }> }).items;

describe('who can post updates', () => {
  it('needs the events and notices area, not just any account', async () => {
    expect((await add({ text: TEXT }, other)).status).toBe(403);
    expect((await h.call('GET', '/updates/list', undefined, { cookie: other.cookie })).status).toBe(403);
    expect((await add({ text: TEXT })).status).toBe(201);
  });
});

describe('posting', () => {
  it('makes a searchable record at once, labelled with the date and topic, and names who posted it', async () => {
    const r = await add({ title: 'Grove Park pickleball courts open', text: TEXT, date: '2026-10-12', topic: 'topic:parks' });
    expect(r.status).toBe(201);
    const doc = h.env.CATALOG_DB.db.prepare('SELECT source_id, document_type, document_date, title FROM documents WHERE id = ?').get(r.body.documentId);
    expect(doc).toEqual({ source_id: 'portal-staff', document_type: 'staff_update', document_date: '2026-10-12', title: 'Grove Park pickleball courts open' });
    expect(chunks(r.body.documentId)).toContain('Topic: Parks and trails');
    expect(await found('pickleball courts lit')).toContain(r.body.documentId);
    const items = (await list()).items;
    expect(items).toEqual([
      expect.objectContaining({ title: 'Grove Park pickleball courts open', date: '2026-10-12', topic: 'topic:parks', topicLabel: 'Topic: Parks and trails', postedBy: 'Pat Clerk' }),
    ]);
    expect((await publicList())[0]).toMatchObject({ title: 'Grove Park pickleball courts open' });
  });

  it('writes a title from the first line when none is given and dates it today', async () => {
    await add({ text: 'Water main repair on Holdaway Road finished.\nThe road is open again.' });
    const [item] = (await list()).items;
    expect(item.title).toBe('Water main repair on Holdaway Road finished.');
    expect(item.date).toBe((await list()).today);
  });

  it('lists funded projects and topics to choose from, and lands a project update on that project', async () => {
    const lists = await list();
    expect(lists.topics.length).toBeGreaterThan(3);
    expect(lists.projects.length).toBeGreaterThan(0);
    const p = updateProjects()[0];
    expect(lists.projects.map((x: { key: string }) => x.key)).toContain(p.key);
    await add({ text: 'The project is on schedule.', topic: `project:${p.key}` });
    const pub = (await (await publicUpdates(h.env as never, new URL(`https://x/api/updates?project=${p.key}`))).json()) as { items: unknown[] };
    expect(pub.items).toHaveLength(1);
  });

  it('checks the details', async () => {
    expect((await add({ text: '  ' })).status).toBe(400);
    expect((await add({ text: 'x', topic: 'project:nope' })).status).toBe(400);
    expect((await add({ text: 'x', date: '10/12/2026' })).status).toBe(400);
    expect((await add({ text: 'x', date: '2026-02-30' })).status).toBe(400);
  });

  it('moves the data version so cached pages refresh', async () => {
    const version = () => {
      try {
        return Number((h.env.CATALOG_DB.db.prepare('SELECT v FROM data_version WHERE id = 1').get() as { v: number } | undefined)?.v ?? 0);
      } catch {
        return 0;
      }
    };
    const before = version();
    await add({ text: TEXT });
    expect(version()).toBeGreaterThan(before);
  });
});

describe('changing and removing', () => {
  it('edits an update, searches the new words, and removes it from search and the public list', async () => {
    const r = await add({ title: 'Courts open', text: TEXT, date: '2026-10-12' });
    const id = r.body.id as string;
    const edit = await h.call(
      'POST',
      '/updates/edit',
      { id, title: 'Courts open', text: 'The Grove Park courts are open. Lights stay on until midnight.', date: '2026-10-12' },
      { cookie: clerk.cookie },
    );
    expect(edit.status).toBe(200);
    expect(chunks(r.body.documentId)).toContain('until midnight');
    expect(chunks(r.body.documentId)).not.toContain('eight courts');
    expect((await h.call('POST', '/updates/remove', { id }, { cookie: clerk.cookie })).status).toBe(200);
    expect(await found('pickleball courts lit')).not.toContain(r.body.documentId);
    expect(await publicList()).toEqual([]);
    expect((await list()).items).toEqual([]);
    expect((await h.call('POST', '/updates/remove', { id }, { cookie: clerk.cookie })).status).toBe(404);
  });

  it('keeps the topic when an edit leaves it out', async () => {
    const r = await add({ text: TEXT, topic: 'topic:parks' });
    await h.call('POST', '/updates/edit', { id: r.body.id, text: `${TEXT} Free to use.` }, { cookie: clerk.cookie });
    expect((await list()).items[0].topic).toBe('topic:parks');
  });
});

describe('undo', () => {
  it('takes a posted update down, puts back a change, and posts a removed update again', async () => {
    const r = await add({ title: 'First wording', text: TEXT, date: '2026-10-12', topic: 'topic:parks' });
    const id = r.body.id as string;
    await h.call('POST', '/updates/edit', { id, title: 'Second wording', text: 'Courts are closed for resurfacing.', date: '2026-10-13', topic: 'topic:roads' }, { cookie: clerk.cookie });
    await h.call('POST', '/updates/remove', { id }, { cookie: clerk.cookie });
    const entries = async () =>
      (await h.call('GET', '/audit?limit=10', undefined, { cookie: clerk.cookie })).body.items as Array<{ id: number; summary: string; undoable: boolean; undone_at: string | null }>;
    const undo = async (word: string) => {
      const e = (await entries()).find((x) => x.summary.startsWith(word) && !x.undone_at)!;
      expect(e.undoable).toBe(true);
      expect((await h.call('POST', '/audit/undo', { id: e.id }, { cookie: clerk.cookie })).status).toBe(200);
    };
    await undo('Removed the update');
    expect((await list()).items).toEqual([expect.objectContaining({ title: 'Second wording', date: '2026-10-13', topic: 'topic:roads' })]);
    await undo('Changed the update');
    expect((await list()).items).toEqual([expect.objectContaining({ title: 'First wording', date: '2026-10-12', topic: 'topic:parks' })]);
    await undo('Posted the update');
    expect((await list()).items).toEqual([]);
    expect(await publicList()).toEqual([]);
  });
});

describe('before any update exists', () => {
  it('lists nothing', async () => {
    expect((await list()).items).toEqual([]);
  });
});
