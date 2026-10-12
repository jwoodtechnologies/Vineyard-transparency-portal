import { beforeEach, describe, expect, it, vi } from 'vitest';
import { staffHarness } from './helpers/staff';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

type H = Awaited<ReturnType<typeof staffHarness>>;
let h: H;
let api: typeof import('../worker/api/people');
let owner: { cookie: string };
let clerk: { cookie: string };
let votesOnly: { cookie: string };

const db = () => h.env.CATALOG_DB.db;
const row = (slug: string) => db().prepare('SELECT * FROM people WHERE slug = ?').get(slug) as Record<string, unknown> | undefined;
const version = () => {
  try {
    return Number((db().prepare('SELECT v FROM data_version WHERE id = 1').get() as { v: number } | undefined)?.v ?? 0);
  } catch {
    return 0;
  }
};

/** What the city website read brings in each day. */
const SITE = [
  { slug: 'zack-stratton', name: 'Zack Stratton', kind: 'elected' as const, role: 'Mayor', title: 'Mayor', department: 'Mayor and City Council', term: 'January 2026 to January 2030', email: 'zstratton@vineyard.example', phone: null, photoUrl: null, sourceUrl: 'https://www.vineyardutah.gov/government/city_council2.php' },
  { slug: 'jacob-wood', name: 'Jacob Wood', kind: 'elected' as const, role: 'Council Member', title: 'Council Member', department: 'Mayor and City Council', term: 'January 2026 to January 2030', email: null, phone: null, photoUrl: null, sourceUrl: 'https://www.vineyardutah.gov/government/city_council2.php' },
  { slug: 'brian-voeks', name: 'Brian Voeks', kind: 'staff' as const, role: 'City Manager', title: 'City Manager', department: 'Executive', term: null, email: 'bvoeks@vineyard.example', phone: '801-226-1929', photoUrl: null, sourceUrl: 'https://www.vineyardutah.gov/government/city_staff.php' },
  { slug: 'nathan-steele', name: 'Nathan Steele', kind: 'board' as const, role: 'Chair', title: 'Chair', department: 'Planning Commission', term: 'Term ends 2028', email: null, phone: null, photoUrl: null, sourceUrl: 'https://www.vineyardutah.gov/government/board___commission_members.php' },
];

beforeEach(async () => {
  h = await staffHarness();
  api = await import('../worker/api/people');
  owner = await h.makeOwner();
  clerk = await h.addPerson(owner.cookie, { name: 'Pat Clerk', email: 'pat@vineyard.example', role: 'editor', areas: ['people'] });
  votesOnly = await h.addPerson(owner.cookie, { name: 'Vic Voter', email: 'vic@vineyard.example', role: 'editor', areas: ['votes'] });
  await api.upsertPeople(h.env as never, SITE, '2026-10-01');
});

describe('who can use the directory', () => {
  it('needs the people area', async () => {
    expect((await h.call('GET', '/directory/people', undefined, { cookie: votesOnly.cookie })).status).toBe(403);
    expect((await h.call('POST', '/directory/add', { kind: 'staff', name: 'Sam Lee', role: 'Clerk' }, { cookie: votesOnly.cookie })).status).toBe(403);
    expect((await h.call('GET', '/directory/people', undefined, { cookie: clerk.cookie })).status).toBe(200);
  });
});

describe('listing', () => {
  it('lists everyone with their details, council first, and filters', async () => {
    const all = await h.call('GET', '/directory/people', undefined, { cookie: clerk.cookie });
    expect(all.body.items.map((p: { name: string }) => p.name)).toEqual(['Zack Stratton', 'Jacob Wood', 'Brian Voeks', 'Nathan Steele']);
    expect(all.body.items[3].boards).toEqual(['Planning Commission']);
    const staff = await h.call('GET', '/directory/people?kind=staff', undefined, { cookie: clerk.cookie });
    expect(staff.body.items).toHaveLength(1);
    const found = await h.call('GET', '/directory/people?q=exec', undefined, { cookie: clerk.cookie });
    expect(found.body.items.map((p: { name: string }) => p.name)).toEqual(['Brian Voeks']);
  });

  it('offers departments and boards to pick from', async () => {
    db().prepare("INSERT INTO government_bodies (id, slug, name, kind) VALUES ('vineyard-library-board', 'vlb', 'Vineyard Library Board', 'board'), ('vineyard-cares-coalition', 'vcc', 'Vineyard Cares Coalition', 'board'), ('city-council', 'cc', 'Vineyard City Council', 'council')").run();
    const o = await h.call('GET', '/directory/options', undefined, { cookie: clerk.cookie });
    expect(o.body.departments).toEqual(['Executive']);
    expect(o.body.boards).toEqual(['Planning Commission', 'Vineyard Cares Coalition', 'Vineyard Library Board']);
  });
});

describe('adding', () => {
  it('adds a staff member who shows on the public list at once', async () => {
    const before = version();
    const r = await h.call('POST', '/directory/add', { kind: 'staff', name: 'Sam Lee', role: 'Deputy Recorder', department: 'Recorder', email: 'SLee@Vineyard.example', phone: '(801) 555-0100' }, { cookie: clerk.cookie });
    expect(r.status).toBe(201);
    expect(r.body.slug).toBe('sam-lee');
    expect(row('sam-lee')).toMatchObject({ name: 'Sam Lee', kind: 'staff', role: 'Deputy Recorder', title: 'Deputy Recorder', department: 'Recorder', email: 'slee@vineyard.example', current: 1, manual: 1 });
    expect(version()).toBeGreaterThan(before);
    const pub = (await (await api.listPeople(h.env as never)).json()) as { people: Array<{ name: string }> };
    expect(pub.people.map((p) => p.name)).toContain('Sam Lee');
  });

  it('adds a board member with several boards', async () => {
    const r = await h.call('POST', '/directory/add', { kind: 'board', name: 'Dana Ruiz', role: 'Member', boards: ['Planning Commission', 'Library Board'], term: 'Term ends 2029' }, { cookie: clerk.cookie });
    expect(r.status).toBe(201);
    expect(row('dana-ruiz')?.department).toBe('Planning Commission; Library Board');
  });

  it('checks the details', async () => {
    const bad = (b: Record<string, unknown>) => h.call('POST', '/directory/add', b, { cookie: clerk.cookie });
    expect((await bad({ kind: 'staff', name: 'Cher', role: 'Clerk' })).status).toBe(400);
    expect((await bad({ kind: 'staff', name: 'Sam Lee', role: '' })).status).toBe(400);
    expect((await bad({ kind: 'staff', name: 'Sam Lee', role: 'Clerk', email: 'nope' })).status).toBe(400);
    expect((await bad({ kind: 'staff', name: 'Sam Lee', role: 'Clerk', phone: 'call me' })).status).toBe(400);
    expect((await bad({ kind: 'board', name: 'Dana Ruiz', role: 'Member', boards: [] })).status).toBe(400);
    expect((await bad({ kind: 'elected', name: 'Dana Ruiz', role: 'Dictator' })).status).toBe(400);
    expect((await bad({ kind: 'nobody', name: 'Dana Ruiz', role: 'Member' })).status).toBe(400);
  });

  it('will not list the same person twice, and says when they are only hidden', async () => {
    const dupe = await h.call('POST', '/directory/add', { kind: 'staff', name: 'Brian Voeks', role: 'City Manager' }, { cookie: clerk.cookie });
    expect(dupe.status).toBe(400);
    expect(dupe.body.error.message).toMatch(/already in the directory/);
    await h.call('POST', '/directory/remove', { slug: 'brian-voeks' }, { cookie: clerk.cookie });
    const hidden = await h.call('POST', '/directory/add', { kind: 'staff', name: 'Brian Voeks', role: 'City Manager' }, { cookie: clerk.cookie });
    expect(hidden.body.error.message).toMatch(/Restore them/);
  });

  it('keeps one Mayor', async () => {
    const r = await h.call('POST', '/directory/add', { kind: 'elected', name: 'Rae Fox', role: 'Mayor' }, { cookie: clerk.cookie });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/Zack Stratton is listed as Mayor/);
    const ok = await h.call('POST', '/directory/add', { kind: 'elected', name: 'Rae Fox', role: 'Council Member', term: 'January 2026 to January 2030' }, { cookie: clerk.cookie });
    expect(ok.status).toBe(201);
  });

  it('gives a second person with the same name on a different board their own page', async () => {
    await h.call('POST', '/directory/add', { kind: 'board', name: 'Dana Ruiz', role: 'Member', boards: ['Planning Commission'] }, { cookie: clerk.cookie });
    db().prepare("UPDATE people SET name = 'Dana Rios' WHERE slug = 'dana-ruiz'").run();
    const second = await h.call('POST', '/directory/add', { kind: 'board', name: 'Dana Ruiz', role: 'Member', boards: ['Library Board'] }, { cookie: clerk.cookie });
    expect(second.body.slug).toBe('dana-ruiz-2');
  });
});

describe('the Boards page', () => {
  it('shows a board member staff added, with the role they were given', async () => {
    db().prepare("INSERT INTO government_bodies (id, slug, name, kind) VALUES ('vineyard-library-board', 'vineyard-library-board', 'Vineyard Library Board', 'board')").run();
    await h.call('POST', '/directory/add', { kind: 'board', name: 'Dana Ruiz', role: 'Vice Chair', boards: ['Library Board'], term: 'Term ends December 2028' }, { cookie: clerk.cookie });
    const boards = await import('../worker/api/boards');
    const pub = (await (await boards.listBoards(h.env as never)).json()) as { boards: Array<{ id: string; members: Array<{ name: string; role: string }> }> };
    const lib = pub.boards.find((b) => b.id === 'vineyard-library-board');
    expect(lib?.members).toEqual([expect.objectContaining({ name: 'Dana Ruiz', role: 'Vice Chair' })]);
    await h.call('POST', '/directory/remove', { slug: 'dana-ruiz' }, { cookie: clerk.cookie });
    const after = (await (await boards.listBoards(h.env as never)).json()) as { boards: Array<{ id: string; members: unknown[] }> };
    expect(after.boards.find((b) => b.id === 'vineyard-library-board')?.members ?? []).toEqual([]);
  });
});

describe('changing', () => {
  it('changes a title and contact, keeps the name of a council member, and marks the person as staff-set', async () => {
    const r = await h.call('POST', '/directory/edit', { slug: 'brian-voeks', name: 'Someone Else', role: 'City Manager and Administrator', department: 'Executive', email: 'brian@vineyard.example', phone: '801-226-1929' }, { cookie: clerk.cookie });
    expect(r.status).toBe(200);
    expect(row('brian-voeks')).toMatchObject({ name: 'Someone Else', role: 'City Manager and Administrator', title: 'City Manager and Administrator', email: 'brian@vineyard.example', manual: 1 });
    const c = await h.call('POST', '/directory/edit', { slug: 'jacob-wood', name: 'Jake Wood', role: 'Council Member', term: 'January 2026 to January 2030', email: 'jwood@vineyard.example' }, { cookie: clerk.cookie });
    expect(c.status).toBe(200);
    expect(row('jacob-wood')).toMatchObject({ name: 'Jacob Wood', email: 'jwood@vineyard.example' });
  });

  it('moves a board member between boards', async () => {
    await h.call('POST', '/directory/edit', { slug: 'nathan-steele', role: 'Vice Chair', boards: ['Planning Commission', 'Arch Commission'], term: 'Term ends 2028' }, { cookie: clerk.cookie });
    expect(row('nathan-steele')).toMatchObject({ role: 'Vice Chair', department: 'Planning Commission; Arch Commission' });
  });

  it('will not make a second Mayor', async () => {
    const r = await h.call('POST', '/directory/edit', { slug: 'jacob-wood', role: 'Mayor' }, { cookie: clerk.cookie });
    expect(r.status).toBe(400);
  });

  it('says so when the person is not there', async () => {
    expect((await h.call('POST', '/directory/edit', { slug: 'nobody-here', role: 'Clerk' }, { cookie: clerk.cookie })).status).toBe(404);
  });
});

describe('removing and putting back', () => {
  it('takes someone off the public list and puts them back', async () => {
    await h.call('POST', '/directory/remove', { slug: 'brian-voeks' }, { cookie: clerk.cookie });
    expect(row('brian-voeks')).toMatchObject({ current: 0, manual: 1 });
    const pub = (await (await api.listPeople(h.env as never)).json()) as { people: Array<{ name: string }> };
    expect(pub.people.map((p) => p.name)).not.toContain('Brian Voeks');
    const listed = await h.call('GET', '/directory/people?q=voeks', undefined, { cookie: clerk.cookie });
    expect(listed.body.items[0]).toMatchObject({ name: 'Brian Voeks', current: false });
    await h.call('POST', '/directory/restore', { slug: 'brian-voeks' }, { cookie: clerk.cookie });
    expect(row('brian-voeks')?.current).toBe(1);
  });

  it('takes a former council member off the sitting council used for votes', async () => {
    const votes = await import('../worker/api/votes');
    expect(await votes.currentCouncil(h.env as never)).toContain('Jacob Wood');
    await h.call('POST', '/directory/remove', { slug: 'jacob-wood' }, { cookie: clerk.cookie });
    expect(await votes.currentCouncil(h.env as never)).not.toContain('Jacob Wood');
  });
});

describe('the daily city website read', () => {
  it('leaves what staff set alone and does not bring back someone staff removed', async () => {
    await h.call('POST', '/directory/edit', { slug: 'brian-voeks', role: 'City Manager and Administrator', department: 'Executive' }, { cookie: clerk.cookie });
    await h.call('POST', '/directory/remove', { slug: 'nathan-steele' }, { cookie: clerk.cookie });
    await h.call('POST', '/directory/add', { kind: 'staff', name: 'Sam Lee', role: 'Deputy Recorder', department: 'Recorder' }, { cookie: clerk.cookie });
    await api.upsertPeople(h.env as never, SITE, '2026-10-02');
    expect(row('brian-voeks')).toMatchObject({ role: 'City Manager and Administrator', last_seen: '2026-10-01' });
    expect(row('nathan-steele')?.current).toBe(0);
    // Sam Lee is not on the website, but the read must not hide someone staff added.
    expect(row('sam-lee')?.current).toBe(1);
    // Everyone else follows the website as before.
    expect(row('zack-stratton')?.last_seen).toBe('2026-10-02');
  });
});

describe('undo', () => {
  it('takes an added person back out, and puts back a change and a removal', async () => {
    await h.call('POST', '/directory/add', { kind: 'staff', name: 'Sam Lee', role: 'Deputy Recorder' }, { cookie: clerk.cookie });
    await h.call('POST', '/directory/edit', { slug: 'brian-voeks', role: 'Interim Manager', department: 'Executive' }, { cookie: clerk.cookie });
    await h.call('POST', '/directory/remove', { slug: 'zack-stratton' }, { cookie: clerk.cookie });
    const log = await h.call('GET', '/audit?limit=10', undefined, { cookie: clerk.cookie });
    const find = (word: string) => log.body.items.find((i: { summary: string }) => i.summary.includes(word));
    for (const word of ['Took off the list', 'Changed', 'Added Sam Lee']) {
      const entry = find(word);
      expect(entry.undoable).toBe(true);
      const u = await h.call('POST', '/audit/undo', { id: entry.id }, { cookie: clerk.cookie });
      expect(u.status).toBe(200);
    }
    expect(row('sam-lee')).toBeUndefined();
    expect(row('brian-voeks')).toMatchObject({ role: 'City Manager', manual: 0 });
    expect(row('zack-stratton')).toMatchObject({ current: 1, manual: 0 });
  });
});

describe('older databases', () => {
  it('adds the manual column to a people table made before it existed', async () => {
    db().exec('DROP TABLE people');
    db().exec('CREATE TABLE people (slug TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, role TEXT NOT NULL, title TEXT, department TEXT, term TEXT, email TEXT, phone TEXT, photo_url TEXT, source_url TEXT NOT NULL, current INTEGER NOT NULL DEFAULT 1, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL)');
    db().exec("INSERT INTO people (slug, name, kind, role, source_url, first_seen, last_seen) VALUES ('old-person', 'Old Person', 'staff', 'Clerk', 'x', '2026-01-01', '2026-01-01')");
    vi.resetModules();
    const fresh = await import('../worker/api/people');
    await fresh.ensurePeopleTable(h.env as never);
    expect(row('old-person')?.manual).toBe(0);
    // A second call, and a second copy of the module, do not fail on the column that is already there.
    vi.resetModules();
    await (await import('../worker/api/people')).ensurePeopleTable(h.env as never);
  });
});
