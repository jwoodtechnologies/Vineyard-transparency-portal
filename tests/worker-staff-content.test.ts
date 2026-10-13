import { beforeEach, describe, expect, it, vi } from 'vitest';
import { staffHarness } from './helpers/staff';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

type H = Awaited<ReturnType<typeof staffHarness>>;
let h: H;
let api: typeof import('../worker/api/content');
let owner: { cookie: string };
let mapper: { cookie: string };
let other: { cookie: string };

const pub = async () =>
  (await (await api.publicContent(h.env as never)).json()) as {
    content: { projects?: { plans: Record<string, Record<string, string>>; also: Array<{ id: string; name: string; about: string }> | null } };
  };
const get = (who = mapper) => h.call('GET', '/content/get?key=projects', undefined, { cookie: who.cookie });
const save = (value: unknown, base: string | null, who = mapper) => h.call('POST', '/content/save', { key: 'projects', value, base }, { cookie: who.cookie });

beforeEach(async () => {
  h = await staffHarness();
  api = await import('../worker/api/content');
  owner = await h.makeOwner();
  mapper = await h.addPerson(owner.cookie, { name: 'Mo Mapper', email: 'mo@vineyard.example', role: 'editor', areas: ['map'] });
  other = await h.addPerson(owner.cookie, { name: 'Vic Voter', email: 'vic@vineyard.example', role: 'editor', areas: ['votes'] });
});

describe('who can change project wording', () => {
  it('needs the map area', async () => {
    expect((await get(other)).status).toBe(403);
    expect((await save({ plans: {}, also: null }, null, other)).status).toBe(403);
    expect((await get()).status).toBe(200);
  });

  it('refuses a piece that does not exist', async () => {
    expect((await h.call('GET', '/content/get?key=nope', undefined, { cookie: mapper.cookie })).status).toBe(400);
    expect((await h.call('POST', '/content/save', { key: '__proto__', value: {}, base: null }, { cookie: mapper.cookie })).status).toBe(400);
  });
});

describe('saving', () => {
  it('starts with nothing stored, and publishes a save at once', async () => {
    const first = await get();
    expect(first.body).toMatchObject({ key: 'projects', value: null, updatedAt: null });
    expect((await pub()).content).toEqual({});

    const r = await save({ plans: { 'Skate Park & Pump Track': { name: 'Skate park', category: 'Parks and trails', about: 'Opens next spring.' } }, also: null }, null);
    expect(r.status).toBe(200);
    expect((await pub()).content.projects?.plans['Skate Park & Pump Track']).toEqual({ name: 'Skate park', category: 'Parks and trails', about: 'Opens next spring.' });
    expect((await get()).body.updatedAt).toBe(r.body.updatedAt);
  });

  it('keeps only what was changed and drops empty entries', async () => {
    await save({ plans: { A: { about: 'Only this.' }, B: {}, C: { name: '  ', about: '' } }, also: null }, null);
    expect((await pub()).content.projects?.plans).toEqual({ A: { about: 'Only this.' } });
  });

  it('keeps one paragraph, refuses web page code, and checks the details', async () => {
    await save({ plans: { A: { name: 'Main Street', about: 'Line one.\n\nLine two.' } }, also: null }, null);
    expect((await pub()).content.projects?.plans.A).toEqual({ name: 'Main Street', about: 'Line one. Line two.' });
    const base = (await get()).body.updatedAt;
    const markup = await save({ plans: { A: { name: '<b>Main</b> Street' } }, also: null }, base);
    expect(markup.status).toBe(400);
    expect(markup.body.error.message).toMatch(/plain words/);
    expect((await save({ plans: { A: { about: 'Click <script>x</script>' } }, also: null }, base)).status).toBe(400);
    expect((await save({ plans: { A: { category: 'Not a group' } }, also: null }, base)).status).toBe(400);
    expect((await save({ plans: { A: { about: 'x'.repeat(501) } }, also: null }, base)).status).toBe(400);
    expect((await save({ plans: {}, also: [{ name: ' ', about: 'x' }] }, base)).status).toBe(400);
    expect((await save({ plans: {}, also: 'oops' }, base)).status).toBe(400);
    expect((await save({ plans: {}, also: Array.from({ length: 41 }, (_, i) => ({ name: `P${i}`, about: '' })) }, base)).status).toBe(400);
  });

  it('keeps a less-than sign when it is only a number or a comparison', async () => {
    const r = await save({ plans: { A: { about: 'Lots under <5 acres and >2 acres need review.' } }, also: null }, null);
    expect(r.status).toBe(200);
    expect((await pub()).content.projects?.plans.A.about).toBe('Lots under <5 acres and >2 acres need review.');
  });

  it('treats a project named like an object member as an ordinary project', async () => {
    await save({ plans: { constructor: { about: 'Odd name.' }, toString: { name: 'Another' } }, also: null }, null);
    const plans = (await pub()).content.projects?.plans ?? {};
    expect(Object.keys(plans).sort()).toEqual(['constructor', 'toString']);
    expect(plans.constructor).toEqual({ about: 'Odd name.' });
  });

  it('stores the other funded list, giving each entry an id', async () => {
    await save(
      {
        plans: {},
        also: [
          { name: 'Tucker Row Park', about: 'A park.' },
          { name: 'Trail benches', about: '' },
        ],
      },
      null,
    );
    const also = (await pub()).content.projects?.also ?? [];
    expect(also.map((a) => a.name)).toEqual(['Tucker Row Park', 'Trail benches']);
    expect(new Set(also.map((a) => a.id)).size).toBe(2);
    expect(also.every((a) => /^a_[0-9a-f]{8,16}$/.test(a.id))).toBe(true);
    // An empty list is a deliberate choice: nothing else is funded.
    const base = (await get()).body.updatedAt;
    await save({ plans: {}, also: [] }, base);
    expect((await pub()).content.projects?.also).toEqual([]);
  });
});

describe('two people saving at once', () => {
  it('refuses the second save until it has seen the first', async () => {
    const first = await save({ plans: { A: { about: 'One.' } }, also: null }, null);
    const late = await save({ plans: { A: { about: 'Two.' } }, also: null }, null);
    expect(late.status).toBe(409);
    expect(late.body.error.message).toMatch(/Reload/);
    expect((await save({ plans: { A: { about: 'Two.' } }, also: null }, first.body.updatedAt)).status).toBe(200);
    expect((await pub()).content.projects?.plans.A.about).toBe('Two.');
  });
});

describe('putting back the original', () => {
  it('removes the stored piece so pages use their built-in wording', async () => {
    const r = await save({ plans: { A: { about: 'One.' } }, also: null }, null);
    expect((await h.call('POST', '/content/reset', { key: 'projects', base: null }, { cookie: mapper.cookie })).status).toBe(409);
    expect((await h.call('POST', '/content/reset', { key: 'projects', base: r.body.updatedAt }, { cookie: mapper.cookie })).status).toBe(200);
    expect((await pub()).content).toEqual({});
    expect((await get()).body).toMatchObject({ value: null, updatedAt: null });
  });
});

describe('a stored piece with one bad part', () => {
  it('keeps the good parts and drops only the bad ones', async () => {
    const row = {
      plans: {
        Good: { about: 'Fine.', category: 'Parks and trails' },
        Renamed: { about: 'Kept.', category: 'A group that no longer exists' },
        TooLong: { about: 'x'.repeat(900) },
        Coded: { about: 'Click <b>here</b>' },
      },
      also: [{ id: 'a_0123456789ab', name: 'Kept project', about: 'ok' }, { name: '', about: 'no name' }, 'junk'],
    };
    await h.env.CATALOG_DB.prepare('CREATE TABLE IF NOT EXISTS site_content (key TEXT PRIMARY KEY, body TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT)').run();
    await h.env.CATALOG_DB.prepare('INSERT INTO site_content (key, body, updated_at, updated_by) VALUES (?, ?, ?, ?)').bind('projects', JSON.stringify(row), '2026-10-01T00:00:00.000Z', 'Test').run();
    const out = (await pub()).content.projects!;
    expect(out.plans.Good).toEqual({ about: 'Fine.', category: 'Parks and trails' });
    expect(out.plans.Renamed).toEqual({ about: 'Kept.' });
    expect(out.plans.TooLong.about).toHaveLength(500);
    expect(out.plans.Coded).toBeUndefined();
    expect(out.also?.map((a) => a.name)).toEqual(['Kept project']);
    // The staff screen sees the same, so the next save keeps what is good.
    expect((await get()).body.value.plans.Good.about).toBe('Fine.');
  });
});

describe('when the database cannot be read', () => {
  it('answers with the built-in wording and tells every cache not to keep it', async () => {
    await save({ plans: { A: { about: 'One.' } }, also: null }, null);
    await h.env.CATALOG_DB.prepare('DROP TABLE site_content').run();
    const res = await api.publicContent(h.env as never);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(((await res.json()) as { content: object }).content).toEqual({});
  });
});

describe('a bad stored row', () => {
  it('is left out instead of breaking the page', async () => {
    await save({ plans: { A: { about: 'Fine.' } }, also: null }, null);
    await h.env.CATALOG_DB.prepare('UPDATE site_content SET body = ? WHERE key = ?').bind('{not json', 'projects').run();
    expect((await pub()).content).toEqual({});
    expect((await get()).body.value).toBeNull();
  });
});

describe('the activity log', () => {
  it('names a project by its edited name, else the name the portal shows, else tidily by the city name', async () => {
    const entries = async () => (await h.call('GET', '/audit?limit=10', undefined, { cookie: mapper.cookie })).body.items as Array<{ summary: string }>;
    const one = await save({ plans: { 'Large Shed \u2013 Roadway (1 shed)': { about: 'A shed.' } }, also: null }, null);
    expect((await entries())[0].summary).toBe('Changed the map project "Large shed for streets equipment"');
    const two = await save({ plans: { 'Large Shed \u2013 Roadway (1 shed)': { about: 'A shed.' }, 'New \u2013 Road & Path': { about: 'New.' } }, also: null }, one.body.updatedAt);
    expect((await entries())[0].summary).toBe('Changed the map project "New Road and Path"');
    await save(
      { plans: { 'Large Shed \u2013 Roadway (1 shed)': { about: 'A shed.' }, 'New \u2013 Road & Path': { about: 'New.' }, B: { about: 'x' } }, also: [{ name: 'P', about: '' }] },
      two.body.updatedAt,
    );
    expect((await entries())[0].summary).toBe('Changed the map project "B" and the list of other funded projects');
  });
});

describe('undo', () => {
  it('puts back the earlier wording, and the original when there was none', async () => {
    const entries = async () =>
      (await h.call('GET', '/audit?limit=10', undefined, { cookie: mapper.cookie })).body.items as Array<{ id: number; summary: string; undoable: boolean; undone_at: string | null }>;
    const undo = async (word: string) => {
      const e = (await entries()).find((x) => x.summary.startsWith(word) && !x.undone_at)!;
      expect(e.undoable).toBe(true);
      expect((await h.call('POST', '/audit/undo', { id: e.id }, { cookie: mapper.cookie })).status).toBe(200);
    };
    const one = await save({ plans: { A: { name: 'Main Street', about: 'One.' } }, also: null }, null);
    await save({ plans: { A: { name: 'Main Street', about: 'Two.' } }, also: null }, one.body.updatedAt);
    expect((await entries())[0].summary).toBe('Changed the map project "Main Street"');
    await undo('Changed the map project');
    expect((await pub()).content.projects?.plans.A.about).toBe('One.');
    await undo('Changed the map project');
    expect((await pub()).content).toEqual({});
  });

  it('refuses to undo an older save while a newer one stands, so nobody loses later work', async () => {
    const entries = async () => (await h.call('GET', '/audit?limit=10', undefined, { cookie: mapper.cookie })).body.items as Array<{ id: number; summary: string; undone_at: string | null }>;
    const one = await save({ plans: { A: { about: 'One.' } }, also: null }, null);
    await save({ plans: { A: { about: 'One.' }, B: { about: 'Two.' } }, also: null }, one.body.updatedAt);
    const [newer, older] = (await entries()).filter((e) => !e.undone_at);
    const tooEarly = await h.call('POST', '/audit/undo', { id: older.id }, { cookie: mapper.cookie });
    expect(tooEarly.status).toBe(400);
    expect(tooEarly.body.error.message).toMatch(/Undo the newer changes first/);
    expect(Object.keys((await pub()).content.projects!.plans).sort()).toEqual(['A', 'B']);
    expect((await h.call('POST', '/audit/undo', { id: newer.id }, { cookie: mapper.cookie })).status).toBe(200);
    expect((await h.call('POST', '/audit/undo', { id: older.id }, { cookie: mapper.cookie })).status).toBe(200);
    expect((await pub()).content).toEqual({});
  });

  it('puts back the list when a reset to the original is undone', async () => {
    const r = await save({ plans: { A: { about: 'One.' } }, also: null }, null);
    await h.call('POST', '/content/reset', { key: 'projects', base: r.body.updatedAt }, { cookie: mapper.cookie });
    expect((await pub()).content).toEqual({});
    const reset = ((await h.call('GET', '/audit?limit=10', undefined, { cookie: mapper.cookie })).body.items as Array<{ id: number; summary: string }>).find((e) =>
      e.summary.startsWith('Put back the original wording'),
    )!;
    expect((await h.call('POST', '/audit/undo', { id: reset.id }, { cookie: mapper.cookie })).status).toBe(200);
    expect((await pub()).content.projects?.plans.A.about).toBe('One.');
  });
});
