import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { staffHarness } from './helpers/staff';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

type H = Awaited<ReturnType<typeof staffHarness>>;
type Item = { id: string; title: string; category: string; start: string; end: string | null; allDay: boolean; location: string | null; url: string };
let h: H;
let api: typeof import('../worker/api/events');
let owner: { cookie: string };
let clerk: { cookie: string };
let other: { cookie: string };

/** The portal's calendar for a window, with the city's own calendar answering as the test says. */
async function calendar(from: string, to: string, city: unknown[] | 'down' = []): Promise<{ items: Item[]; unavailable?: boolean }> {
  vi.stubGlobal('fetch', async () => (city === 'down' ? new Response('no', { status: 503 }) : new Response(JSON.stringify(city), { status: 200 })));
  const res = await api.listEvents(h.env as never, new URL(`https://vineyardportal.org/api/events?from=${from}&to=${to}`));
  return (await res.json()) as { items: Item[]; unavailable?: boolean };
}

beforeEach(async () => {
  h = await staffHarness();
  api = await import('../worker/api/events');
  owner = await h.makeOwner();
  clerk = await h.addPerson(owner.cookie, { name: 'Pat Clerk', email: 'pat@vineyard.example', role: 'editor', areas: ['notices'] });
  other = await h.addPerson(owner.cookie, { name: 'Vic Voter', email: 'vic@vineyard.example', role: 'editor', areas: ['votes'] });
});

afterEach(() => vi.unstubAllGlobals());

const add = (b: Record<string, unknown>, who = clerk) => h.call('POST', '/events/add', b, { cookie: who.cookie });
const harvest = { title: 'Harvest Festival', date: '2026-10-24', startTime: '10:00', endTime: '14:30', location: 'Vineyard Town Center', category: 'Community', url: 'vineyardutah.gov/harvest' };

describe('who can add events', () => {
  it('needs the events and notices area', async () => {
    expect((await add(harvest, other)).status).toBe(403);
    expect((await h.call('GET', '/events/list', undefined, { cookie: other.cookie })).status).toBe(403);
    expect((await add(harvest)).status).toBe(201);
  });
});

describe('adding', () => {
  it('shows on the calendar at once, in the calendar shape, with its details', async () => {
    expect((await add(harvest)).status).toBe(201);
    const { items } = await calendar('2026-10-01', '2026-10-31');
    expect(items).toEqual([
      expect.objectContaining({
        title: 'Harvest Festival',
        category: 'Community',
        start: '2026-10-24T10:00:00',
        end: '2026-10-24T14:30:00',
        allDay: false,
        location: 'Vineyard Town Center',
        url: 'https://vineyardutah.gov/harvest',
      }),
    ]);
  });

  it('adds an all day event and a multi day event', async () => {
    await add({ title: 'City offices closed', date: '2026-11-26', allDay: true, startTime: '09:00' });
    await add({ title: 'Fall cleanup', date: '2026-10-19', endDate: '2026-10-23', category: 'Utilities' });
    const { items } = await calendar('2026-10-01', '2026-11-30');
    const closed = items.find((i) => i.title === 'City offices closed')!;
    expect(closed).toMatchObject({ allDay: true, start: '2026-11-26T00:00:00', end: null });
    const cleanup = items.find((i) => i.title === 'Fall cleanup')!;
    expect(cleanup.end).toBe('2026-10-23T00:00:00');
  });

  it('still shows a multi day event on a window that starts after its first day', async () => {
    await add({ title: 'Fall cleanup', date: '2026-10-19', endDate: '2026-10-23' });
    expect((await calendar('2026-10-21', '2026-10-22')).items.map((i) => i.title)).toEqual(['Fall cleanup']);
    expect((await calendar('2026-10-24', '2026-10-30')).items).toEqual([]);
    expect((await calendar('2026-10-01', '2026-10-18')).items).toEqual([]);
  });

  it('merges with the city calendar in date order, and keeps staff events when the city is unreachable', async () => {
    await add(harvest);
    await add({ title: 'Early event', date: '2026-10-03' });
    const down = await calendar('2026-10-01', '2026-10-31', 'down');
    expect(down.unavailable).toBe(true);
    expect(down.items.map((i) => i.title)).toEqual(['Early event', 'Harvest Festival']);
    const city = { id: 'c1', title: 'City Council Meeting', start: '2026-10-14T19:00:00', end: '2026-10-14T21:00:00' };
    const merged = await calendar('2026-10-01', '2026-10-31', [city]);
    expect(merged.unavailable).toBeUndefined();
    expect(merged.items.map((i) => i.title)).toEqual(['Early event', 'City Council Meeting', 'Harvest Festival']);
  });

  it('uses the calendar category words and falls back to community', async () => {
    await add({ title: 'Special meeting', date: '2026-10-08', category: 'City Meetings' });
    await add({ title: 'Mystery', date: '2026-10-09', category: 'Nonsense' });
    const { items } = await calendar('2026-10-01', '2026-10-31');
    expect(items.map((i) => i.category)).toEqual(['City Meetings', 'Community']);
  });

  it('checks the details', async () => {
    expect((await add({ ...harvest, title: ' ' })).status).toBe(400);
    expect((await add({ ...harvest, date: '10/24/2026' })).status).toBe(400);
    expect((await add({ ...harvest, date: '2026-02-30' })).status).toBe(400);
    expect((await add({ ...harvest, startTime: '25:00' })).status).toBe(400);
    expect((await add({ ...harvest, startTime: '14:00', endTime: '09:00' })).status).toBe(400);
    expect((await add({ ...harvest, endDate: '2026-10-20' })).status).toBe(400);
    expect((await add({ ...harvest, url: 'javascript:alert(1)' })).status).toBe(400);
    expect((await add({ ...harvest, url: 'not a link' })).status).toBe(400);
  });

  it('strips markup from the text', async () => {
    await add({ ...harvest, title: '<b>Harvest</b> Festival', description: 'Pie <script>alert(1)</script> contest' });
    const [item] = (await calendar('2026-10-01', '2026-10-31')).items;
    expect(item.title).not.toMatch(/[<>]/);
    const list = await h.call('GET', '/events/list', undefined, { cookie: clerk.cookie });
    expect(list.body.items[0].description).not.toMatch(/<script/);
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
    await add(harvest);
    expect(version()).toBeGreaterThan(before);
  });
});

describe('the staff list', () => {
  it('marks past events and lists newest first', async () => {
    await add({ title: 'Long ago', date: '2020-01-05' });
    await add({ title: 'Far ahead', date: '2099-01-05' });
    const list = await h.call('GET', '/events/list', undefined, { cookie: clerk.cookie });
    expect(list.body.items.map((i: { title: string; past: boolean }) => [i.title, i.past])).toEqual([
      ['Far ahead', false],
      ['Long ago', true],
    ]);
    expect(list.body.categories.map((c: { key: string }) => c.key)).toContain('City Meetings');
  });
});

describe('changing and removing', () => {
  it('edits an event and removes it', async () => {
    const id = (await add(harvest)).body.id as string;
    const edit = await h.call('POST', '/events/edit', { ...harvest, id, title: 'Harvest Festival and Parade', date: '2026-10-25' }, { cookie: clerk.cookie });
    expect(edit.status).toBe(200);
    expect((await calendar('2026-10-01', '2026-10-31')).items).toEqual([expect.objectContaining({ title: 'Harvest Festival and Parade', start: '2026-10-25T10:00:00' })]);
    expect((await h.call('POST', '/events/remove', { id }, { cookie: clerk.cookie })).status).toBe(200);
    expect((await calendar('2026-10-01', '2026-10-31')).items).toEqual([]);
    expect((await h.call('POST', '/events/remove', { id }, { cookie: clerk.cookie })).status).toBe(404);
    expect((await h.call('POST', '/events/edit', { ...harvest, id }, { cookie: clerk.cookie })).status).toBe(404);
  });
});

describe('undo', () => {
  it('takes an added event down, and puts back a change and a removal', async () => {
    const id = (await add(harvest)).body.id as string;
    await h.call('POST', '/events/edit', { ...harvest, id, title: 'Renamed' }, { cookie: clerk.cookie });
    await h.call('POST', '/events/remove', { id }, { cookie: clerk.cookie });
    const entries = async () =>
      (await h.call('GET', '/audit?limit=10', undefined, { cookie: clerk.cookie })).body.items as Array<{ id: number; summary: string; undoable: boolean; undone_at: string | null }>;
    const undo = async (word: string) => {
      const e = (await entries()).find((x) => x.summary.startsWith(word) && !x.undone_at)!;
      expect(e.undoable).toBe(true);
      expect((await h.call('POST', '/audit/undo', { id: e.id }, { cookie: clerk.cookie })).status).toBe(200);
    };
    const titles = async () => (await calendar('2026-10-01', '2026-10-31')).items.map((i) => i.title);
    await undo('Removed the event');
    expect(await titles()).toEqual(['Renamed']);
    await undo('Changed the event');
    expect(await titles()).toEqual(['Harvest Festival']);
    await undo('Added the event');
    expect(await titles()).toEqual([]);
  });
});

describe('before any event exists', () => {
  it('lists nothing and the calendar answers', async () => {
    const list = await h.call('GET', '/events/list', undefined, { cookie: clerk.cookie });
    expect(list.body.items).toEqual([]);
    expect((await calendar('2026-10-01', '2026-10-31')).items).toEqual([]);
  });
});
