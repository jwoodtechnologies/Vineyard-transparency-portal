import { beforeEach, describe, expect, it, vi } from 'vitest';
import { staffHarness } from './helpers/staff';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

type H = Awaited<ReturnType<typeof staffHarness>>;
let h: H;
let api: typeof import('../worker/api/notices');
let map: typeof import('../worker/api/map');
let owner: { cookie: string };
let clerk: { cookie: string };
let other: { cookie: string };

const day = (offset: number) => new Date(Date.now() - 6 * 3600_000 + offset * 86_400_000).toISOString().slice(0, 10);
const shownNow = async () =>
  ((await (await api.publicNotices(h.env as never)).json()) as { items: Array<{ id: string; message: string; tone: string; linkUrl: string | null; linkLabel: string | null }> }).items;

beforeEach(async () => {
  h = await staffHarness();
  api = await import('../worker/api/notices');
  map = await import('../worker/api/map');
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

const plain = (iso: string) => `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}, ${iso.slice(0, 4)}`;
const road = {
  type: 'LineString',
  coordinates: [
    [-111.7517, 40.3085],
    [-111.7497, 40.3085],
  ],
};
const place = (over: Record<string, unknown> = {}) => ({ title: 'Main Street closed', kind: 'closure', geometry: road, ...over });
const alerts = async () =>
  (await (await map.getMapLayer(h.env as never, 'alerts', new URL('https://x.test/api/map/layers/alerts'))).json()) as {
    features: Array<{ id: string; geometry: { type: string; coordinates: unknown }; properties: Record<string, string | null> }>;
  };
const catalog = async () => ((await (await map.listMapLayers(h.env as never)).json()) as { layers: Array<{ key: string; label: string; group: string; geometry: string; on: boolean }> }).layers;

describe('notices on the map', () => {
  it('draws a placed notice on the alerts layer with plain words and keeps the top bar when asked', async () => {
    const r = await add({
      message: 'Main Street is closed between 100 West and 200 West for water work.',
      startsOn: day(0),
      endsOn: day(2),
      linkUrl: 'vineyardutah.gov/main',
      place: place(),
    });
    expect(r.status).toBe(201);
    const { features } = await alerts();
    expect(features).toHaveLength(1);
    expect(features[0]).toMatchObject({
      id: r.body.id,
      geometry: { type: 'LineString', coordinates: road.coordinates },
      properties: {
        Title: 'Main Street closed',
        Type: 'Road closure',
        Details: 'Main Street is closed between 100 West and 200 West for water work.',
        When: `${plain(day(0))} to ${plain(day(2))}`,
        More: 'https://vineyardutah.gov/main',
      },
    });
    expect((await shownNow()).map((i) => i.id)).toEqual([r.body.id]);
  });

  it('can show on the map only, or in the top bar only, and needs at least one', async () => {
    const mapOnly = await add({ message: 'Detour on Mill Road', onBar: false, place: place({ title: 'Detour', kind: 'detour' }) });
    const barOnly = await add({ message: 'City Hall closes early' });
    expect((await shownNow()).map((i) => i.id)).toEqual([barOnly.body.id]);
    expect((await alerts()).features.map((f) => f.id)).toEqual([mapOnly.body.id]);
    const none = await add({ message: 'Nowhere', onBar: false });
    expect(none.status).toBe(400);
    expect(none.body.error.message).toMatch(/where the notice shows/i);
  });

  it('lists the layer in the map catalog only while a placed notice is showing', async () => {
    expect((await catalog()).some((l) => l.key === 'alerts')).toBe(false);
    const id = (await add({ message: 'Detour', place: place() })).body.id as string;
    expect((await catalog()).find((l) => l.key === 'alerts')).toMatchObject({ label: 'Closures and notices', group: 'Streets', geometry: 'mixed', on: true });
    await h.call('POST', '/notices/edit', { id, message: 'Detour', shown: false, place: place() }, { cookie: clerk.cookie });
    expect((await catalog()).some((l) => l.key === 'alerts')).toBe(false);
    expect((await alerts()).features).toEqual([]);
  });

  it('leaves out a notice before its first day or after its last', async () => {
    await add({ message: 'Later', startsOn: day(2), place: place() });
    await add({ message: 'Over', endsOn: day(-1), place: place() });
    const now = await add({ message: 'Now', endsOn: day(1), place: place({ title: 'Now' }) });
    const f = (await alerts()).features;
    expect(f.map((x) => x.id)).toEqual([now.body.id]);
    expect(f[0].properties.When).toMatch(/^Until /);
  });

  it('checks the place before keeping it', async () => {
    const bad = async (p: Record<string, unknown>) => (await add({ message: 'x', place: p })).status;
    expect(await bad(place({ title: '  ' }))).toBe(400);
    expect(await bad(place({ geometry: { type: 'Point', coordinates: [-111.7, 41.9] } }))).toBe(400);
    expect(await bad(place({ geometry: { type: 'Point', coordinates: ['a', 'b'] } }))).toBe(400);
    expect(await bad(place({ geometry: { type: 'LineString', coordinates: [[-111.75, 40.3]] } }))).toBe(400);
    expect(
      await bad(
        place({
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [-111.75, 40.3],
                [-111.74, 40.3],
              ],
            ],
          },
        }),
      ),
    ).toBe(400);
    expect(await bad(place({ geometry: { type: 'MultiPoint', coordinates: [] } }))).toBe(400);
    expect(await bad(place({ geometry: null }))).toBe(400);
    expect(await bad(place({ geometry: { type: 'LineString', coordinates: Array.from({ length: 201 }, (_, i) => [-111.75 + i * 0.0001, 40.3]) } }))).toBe(400);
  });

  it('stores an area closed, tidies the name, and falls back to a plain kind', async () => {
    const square = {
      type: 'Polygon',
      coordinates: [
        [
          [-111.75, 40.3],
          [-111.74, 40.3],
          [-111.74, 40.31],
          [-111.75, 40.31],
        ],
      ],
    };
    const id = (await add({ message: 'Fireworks', place: place({ title: '<b>Fireworks</b> zone', kind: 'nonsense', geometry: square }) })).body.id as string;
    const f = (await alerts()).features.find((x) => x.id === id)!;
    expect(f.properties).toMatchObject({ Title: 'Fireworks zone', Type: 'Notice' });
    const ring = (f.geometry.coordinates as number[][][])[0];
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]);
  });

  it('shows the place on the staff list and undoes a change to it', async () => {
    const id = (await add({ message: 'Closed', place: place() })).body.id as string;
    await h.call('POST', '/notices/edit', { id, message: 'Closed', place: place({ title: 'Moved', geometry: { type: 'Point', coordinates: [-111.74, 40.31] } }) }, { cookie: clerk.cookie });
    const list = await h.call('GET', '/notices/list', undefined, { cookie: clerk.cookie });
    expect(list.body.kinds.map((k: { key: string }) => k.key)).toContain('closure');
    expect(list.body.items[0]).toMatchObject({ onBar: true, place: { title: 'Moved', kind: 'closure', geometry: { type: 'Point' } } });
    const e = ((await h.call('GET', '/audit?limit=5', undefined, { cookie: clerk.cookie })).body.items as Array<{ id: number; summary: string }>).find((x) =>
      x.summary.startsWith('Changed the notice'),
    )!;
    expect((await h.call('POST', '/audit/undo', { id: e.id }, { cookie: clerk.cookie })).status).toBe(200);
    expect((await alerts()).features[0]).toMatchObject({ geometry: { type: 'LineString' }, properties: { Title: 'Main Street closed' } });
  });

  it('removing a notice takes it off the map, and undoing the removal puts it back with its place', async () => {
    const id = (await add({ message: 'Closed', place: place() })).body.id as string;
    await h.call('POST', '/notices/remove', { id }, { cookie: clerk.cookie });
    expect((await alerts()).features).toEqual([]);
    const e = ((await h.call('GET', '/audit?limit=5', undefined, { cookie: clerk.cookie })).body.items as Array<{ id: number; summary: string }>).find((x) =>
      x.summary.startsWith('Removed the notice'),
    )!;
    expect((await h.call('POST', '/audit/undo', { id: e.id }, { cookie: clerk.cookie })).status).toBe(200);
    expect((await alerts()).features.map((x) => x.id)).toEqual([id]);
  });

  it('upgrades a notices table made before the map existed', async () => {
    const db = h.env.CATALOG_DB.db;
    db.exec('DROP TABLE IF EXISTS site_notices');
    db.exec(
      `CREATE TABLE site_notices (id TEXT PRIMARY KEY, tone TEXT NOT NULL, message TEXT NOT NULL, link_url TEXT, link_label TEXT, starts_on TEXT, ends_on TEXT,
        shown INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, created_by TEXT, updated_at TEXT NOT NULL, updated_by TEXT)`,
    );
    db.exec("INSERT INTO site_notices (id, tone, message, created_at, updated_at) VALUES ('ntc_old', 'info', 'Old notice', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')");
    vi.resetModules();
    const fresh = await import('../worker/api/notices');
    const items = ((await (await fresh.publicNotices(h.env as never)).json()) as { items: Array<{ id: string }> }).items;
    expect(items.map((i) => i.id)).toEqual(['ntc_old']);
  });
});
