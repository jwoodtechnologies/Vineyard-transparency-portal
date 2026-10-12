import { beforeEach, describe, expect, it, vi } from 'vitest';
import { staffHarness } from './helpers/staff';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

type H = Awaited<ReturnType<typeof staffHarness>>;
let h: H;
let api: typeof import('../worker/api/notices');
let owner: { cookie: string };
let clerk: { cookie: string };
let other: { cookie: string };

const day = (offset: number) => new Date(Date.now() - 6 * 3600_000 + offset * 86_400_000).toISOString().slice(0, 10);
const shownNow = async () =>
  ((await (await api.publicNotices(h.env as never)).json()) as { items: Array<{ id: string; message: string; tone: string; linkUrl: string | null; linkLabel: string | null }> }).items;

beforeEach(async () => {
  h = await staffHarness();
  api = await import('../worker/api/notices');
  owner = await h.makeOwner();
  clerk = await h.addPerson(owner.cookie, { name: 'Pat Clerk', email: 'pat@vineyard.example', role: 'editor', areas: ['notices'] });
  other = await h.addPerson(owner.cookie, { name: 'Vic Voter', email: 'vic@vineyard.example', role: 'editor', areas: ['votes'] });
});

const add = (b: Record<string, unknown>, who = clerk) => h.call('POST', '/notices/add', b, { cookie: who.cookie });

describe('who can post notices', () => {
  it('needs the notices area', async () => {
    expect((await add({ message: 'Hello' }, other)).status).toBe(403);
    expect((await h.call('GET', '/notices/list', undefined, { cookie: other.cookie })).status).toBe(403);
    expect((await add({ message: 'City Hall is closed Monday.' })).status).toBe(201);
  });
});

describe('posting', () => {
  it('shows a notice on the public list at once with its link', async () => {
    const r = await add({ message: 'City Hall is closed Monday, October 12.', tone: 'alert', linkUrl: 'vineyardutah.gov/closures', linkLabel: 'Closure list' });
    expect(r.status).toBe(201);
    expect(await shownNow()).toEqual([
      expect.objectContaining({ message: 'City Hall is closed Monday, October 12.', tone: 'alert', linkUrl: 'https://vineyardutah.gov/closures', linkLabel: 'Closure list' }),
    ]);
  });

  it('gives a link a plain label when none is written, and keeps no label without a link', async () => {
    await add({ message: 'One', linkUrl: 'https://vineyardutah.gov/a' });
    await add({ message: 'Two', linkLabel: 'Ignored' });
    const items = await shownNow();
    expect(items.find((i) => i.message === 'One')?.linkLabel).toBe('Learn more');
    expect(items.find((i) => i.message === 'Two')).toMatchObject({ linkUrl: null, linkLabel: null });
  });

  it('checks the details', async () => {
    expect((await add({ message: '  ' })).status).toBe(400);
    expect((await add({ message: 'x'.repeat(281) })).status).toBe(400);
    expect((await add({ message: 'Hi', linkUrl: 'javascript:alert(1)' })).status).toBe(400);
    expect((await add({ message: 'Hi', linkUrl: 'not a link' })).status).toBe(400);
    expect((await add({ message: 'Hi', startsOn: '10/12/2026' })).status).toBe(400);
    expect((await add({ message: 'Hi', startsOn: day(3), endsOn: day(1) })).status).toBe(400);
  });

  it('does not show a notice before its first day or after its last, but does on both', async () => {
    await add({ message: 'Later', startsOn: day(2) });
    await add({ message: 'Over', endsOn: day(-1) });
    await add({ message: 'Last day', endsOn: day(0) });
    await add({ message: 'First day', startsOn: day(0) });
    expect((await shownNow()).map((i) => i.message).sort()).toEqual(['First day', 'Last day']);
    const list = await h.call('GET', '/notices/list', undefined, { cookie: clerk.cookie });
    const status = Object.fromEntries(list.body.items.map((i: { message: string; status: string }) => [i.message, i.status]));
    expect(status).toEqual({ Later: 'scheduled', Over: 'ended', 'Last day': 'showing', 'First day': 'showing' });
  });

  it('shows alerts before information and at most three', async () => {
    for (const m of ['a', 'b', 'c']) await add({ message: `info ${m}` });
    await add({ message: 'urgent', tone: 'alert' });
    const items = await shownNow();
    expect(items).toHaveLength(3);
    expect(items[0].message).toBe('urgent');
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
    await add({ message: 'Hello' });
    expect(version()).toBeGreaterThan(before);
  });
});

describe('changing and hiding', () => {
  it('edits a notice, hides it without deleting it, and shows it again', async () => {
    const id = (await add({ message: 'Road closed' })).body.id as string;
    await h.call('POST', '/notices/edit', { id, message: 'Road closed until Friday', tone: 'alert' }, { cookie: clerk.cookie });
    expect(await shownNow()).toEqual([expect.objectContaining({ message: 'Road closed until Friday', tone: 'alert' })]);
    await h.call('POST', '/notices/edit', { id, message: 'Road closed until Friday', tone: 'alert', shown: false }, { cookie: clerk.cookie });
    expect(await shownNow()).toEqual([]);
    const list = await h.call('GET', '/notices/list', undefined, { cookie: clerk.cookie });
    expect(list.body.items[0]).toMatchObject({ status: 'hidden', shown: false });
    await h.call('POST', '/notices/edit', { id, message: 'Road closed until Friday', shown: true }, { cookie: clerk.cookie });
    expect(await shownNow()).toHaveLength(1);
  });

  it('removes a notice', async () => {
    const id = (await add({ message: 'Road closed' })).body.id as string;
    expect((await h.call('POST', '/notices/remove', { id }, { cookie: clerk.cookie })).status).toBe(200);
    expect(await shownNow()).toEqual([]);
    expect((await h.call('POST', '/notices/remove', { id }, { cookie: clerk.cookie })).status).toBe(404);
  });
});

describe('undo', () => {
  it('takes a posted notice down, and puts back a change and a removal', async () => {
    const id = (await add({ message: 'First wording' })).body.id as string;
    await h.call('POST', '/notices/edit', { id, message: 'Second wording' }, { cookie: clerk.cookie });
    await h.call('POST', '/notices/remove', { id }, { cookie: clerk.cookie });
    const entries = async () =>
      (await h.call('GET', '/audit?limit=10', undefined, { cookie: clerk.cookie })).body.items as Array<{ id: number; summary: string; undoable: boolean; undone_at: string | null }>;
    const undo = async (word: string) => {
      const e = (await entries()).find((x) => x.summary.startsWith(word) && !x.undone_at)!;
      expect(e.undoable).toBe(true);
      expect((await h.call('POST', '/audit/undo', { id: e.id }, { cookie: clerk.cookie })).status).toBe(200);
    };
    await undo('Removed the notice');
    expect((await shownNow())[0].message).toBe('Second wording');
    await undo('Changed the notice');
    expect((await shownNow())[0].message).toBe('First wording');
    await undo('Posted the notice');
    expect(await shownNow()).toEqual([]);
  });
});

describe('before any notice exists', () => {
  it('answers with an empty list', async () => {
    expect(await shownNow()).toEqual([]);
  });
});
