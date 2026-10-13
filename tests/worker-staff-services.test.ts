import { beforeEach, describe, expect, it, vi } from 'vitest';
import { staffHarness } from './helpers/staff';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

type H = Awaited<ReturnType<typeof staffHarness>>;
let h: H;
let owner: { cookie: string };
let site: { cookie: string };
let mapper: { cookie: string };

const save = (key: string, value: unknown, base: string | null = null, who = site) => h.call('POST', '/content/save', { key, value, base }, { cookie: who.cookie });
const get = (key: string, who = site) => h.call('GET', `/content/get?key=${key}`, undefined, { cookie: who.cookie });
const entries = async () => (await h.call('GET', '/audit?limit=10', undefined, { cookie: site.cookie })).body.items as Array<{ summary: string }>;

beforeEach(async () => {
  h = await staffHarness();
  owner = await h.makeOwner();
  site = await h.addPerson(owner.cookie, { name: 'Sam Site', email: 'sam@vineyard.example', role: 'editor', areas: ['site'] });
  mapper = await h.addPerson(owner.cookie, { name: 'Mo Mapper', email: 'mo@vineyard.example', role: 'editor', areas: ['map'] });
});

describe('service links', () => {
  it('needs the site area', async () => {
    expect((await get('services', mapper)).status).toBe(403);
    expect((await save('services', { edits: {}, hidden: [], added: [] }, null, mapper)).status).toBe(403);
    expect((await get('services')).status).toBe(200);
  });

  it('keeps only real changes to a built-in service', async () => {
    const r = await save('services', {
      edits: { 'grama-form': { label: 'Records request (GRAMA)', hint: 'New note', words: ['Public Records', 'public records', ''] }, budget: {} },
      hidden: [],
      added: [],
    });
    expect(r.status).toBe(200);
    expect(r.body.value.edits).toEqual({ 'grama-form': { hint: 'New note', words: ['public records'] } });
    expect((await entries())[0].summary).toBe('Changed the service link "Records request (GRAMA)"');
  });

  it('never stores a link that is not a web page', async () => {
    for (const href of ['javascript:alert(1)', 'data:text/html,hi', '//evil.example', 'https://user:pw@example.com/', 'ftp://example.com/']) {
      const r = await save('services', { edits: { fees: { href } }, hidden: [], added: [] });
      expect(r.status, href).toBe(400);
    }
    const ok = await save('services', { edits: { fees: { href: 'https://www.vineyardutah.gov/fees-2027' } }, hidden: [], added: [] });
    expect(ok.body.value.edits.fees.href).toBe('https://www.vineyardutah.gov/fees-2027');
  });

  it('adds, hides and removes, and names each in the activity log', async () => {
    const one = await save('services', {
      edits: {},
      hidden: [],
      added: [{ id: '', label: 'Dog license', hint: '', href: 'https://example.org/dogs', group: 'Permits and development', kind: 'form', words: ['dog license', 'pet license'] }],
    });
    expect(one.status).toBe(200);
    const id = one.body.value.added[0].id as string;
    expect(id).toMatch(/^s_[0-9a-f]{10}$/);
    expect((await entries())[0].summary).toBe('Added the service link "Dog license"');
    const two = await save('services', { ...one.body.value, hidden: [id, 'jobs', 'not-a-service'] }, one.body.updatedAt);
    expect(two.body.value.hidden).toEqual([id, 'jobs']);
    expect((await entries())[0].summary).toBe('Changed 2 service links');
    const three = await save('services', { edits: {}, hidden: ['jobs'], added: [] }, two.body.updatedAt);
    expect(three.body.value.hidden).toEqual(['jobs']);
    expect((await entries())[0].summary).toBe('Removed the service link "Dog license"');
  });

  it('refuses unknown services, groups and odd search words', async () => {
    expect((await save('services', { edits: { nope: { label: 'X' } }, hidden: [], added: [] })).status).toBe(400);
    expect((await save('services', { edits: { fees: { group: 'Somewhere' } }, hidden: [], added: [] })).status).toBe(400);
    expect((await save('services', { edits: { fees: { words: ['(a+)+$'] } }, hidden: [], added: [] })).status).toBe(400);
    expect((await save('services', { edits: {}, hidden: [], added: [{ label: '', href: 'https://example.org' }] })).status).toBe(400);
  });
});

describe('phone numbers and quick links', () => {
  it('stores a phone as the city writes it, and refuses one that is not 10 digits', async () => {
    const r = await save('contacts', { edits: { cityHall: { phone: '(801) 555-0100' } }, hidden: [] });
    expect(r.body.value.edits).toEqual({ cityHall: { phone: '801-555-0100' } });
    expect((await entries())[0].summary).toBe('Changed the phone number for "Call City Hall" to 801-555-0100');
    expect((await save('contacts', { edits: { police: { phone: '555-0100' } }, hidden: [] }, r.body.updatedAt)).status).toBe(400);
    expect((await save('contacts', { edits: { staff: { label: 'X' } }, hidden: [] }, r.body.updatedAt)).status).toBe(400);
  });

  it('feeds the number the assistant writes', async () => {
    const facts = await import('../worker/lib/cityFacts');
    facts.resetCityFacts();
    await save('contacts', { edits: { cityHall: { phone: '801-555-0100' }, police: { phone: '801-555-0199' } }, hidden: [] });
    await facts.refreshCityFacts(h.env as never);
    expect(facts.cityHallPhone()).toBe('801-555-0100');
    expect(facts.policePhone()).toBe('801-555-0199');
    const { whoIsAnswer } = await import('../worker/ai/contacts');
    expect(whoIsAnswer({ slug: 'a', name: 'Ann Lee', kind: 'staff', role: 'Planner', department: null, email: null, phone: null } as never, facts.cityHallPhone())).toMatch(
      /City Hall at 801-555-0100\.$/,
    );
    const { topicsFor } = await import('../worker/ai/topics');
    expect(
      topicsFor('my neighbor is too loud at night', '2026-10-01', { police: facts.policePhone() })
        .map((t) => t.note)
        .join(' '),
    ).toContain('801-555-0199');
    facts.resetCityFacts();
  });
});
