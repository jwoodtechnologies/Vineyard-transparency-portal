import { beforeEach, describe, expect, it, vi } from 'vitest';
import { staffHarness } from './helpers/staff';
import { cleanPlan, matchProject } from '../worker/staff/assist';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const admin = { role: 'admin' as const, areas: [] as string[] };
const mapper = { role: 'editor' as const, areas: ['map'] };
const projects = ['Center Street Crosswalk', '400 South Waterline'];

describe('what the assistant proposes', () => {
  it('keeps only the fields of the chosen action, cleaned', () => {
    const r = cleanPlan(
      { action: 'construction_add', fields: { name: ' Holdaway Road  repaving ', status: 'Starts November 3', html: '<b>x</b>', expected: 'Spring 2027' } },
      { projects, file: null, user: mapper as never },
    );
    expect(r).toEqual({ plan: { action: 'construction_add', fields: { name: 'Holdaway Road repaving', status: 'Starts November 3', expected: 'Spring 2027' } }, message: '' });
  });

  it('only offers what the account may do', () => {
    expect(cleanPlan({ action: 'notice', fields: { message: 'Closed Monday' } }, { projects, file: null, user: mapper as never }).message).toMatch(/cannot post notices/);
    expect(cleanPlan({ action: 'update', fields: { text: 'Done' } }, { projects, file: null, user: { role: 'editor', areas: ['notices'] } as never }).message).toMatch(/owner or an admin/);
  });

  it('refuses anything off the list, and a file action with no file', () => {
    expect(cleanPlan({ action: 'delete_everything' }, { projects, file: null, user: admin as never }).plan).toBeNull();
    expect(cleanPlan({ action: 'none', reason: 'Votes are changed on the Votes screen.' }, { projects, file: null, user: admin as never }).message).toMatch(/^Votes are changed/);
    expect(cleanPlan({ action: 'record_file', fields: { title: 'x' } }, { projects, file: null, user: admin as never }).message).toMatch(/Attach the file/);
    expect(cleanPlan(null, { projects, file: null, user: admin as never }).plan).toBeNull();
  });

  it('matches a project loosely, and turns a change to an unlisted one into an add', () => {
    expect(matchProject('the 400 south waterline project', projects)).toBe('400 South Waterline');
    expect(matchProject('library', projects)).toBeNull();
    const r = cleanPlan({ action: 'construction_change', fields: { project: 'Mill Road signal', status: 'Done' } }, { projects, file: null, user: admin as never });
    expect(r.plan).toEqual({ action: 'construction_add', fields: { name: 'Mill Road signal', status: 'Done' } });
    expect(cleanPlan({ action: 'construction_hide', fields: { project: 'Nope' } }, { projects, file: null, user: admin as never }).plan).toBeNull();
  });

  it('drops dates and times in the wrong shape and says what is missing', () => {
    const r = cleanPlan({ action: 'event', fields: { title: 'Fall festival', date: 'next Friday', startTime: '6pm' } }, { projects, file: null, user: admin as never });
    expect(r.plan?.fields).toEqual({ title: 'Fall festival' });
    expect(r.message).toMatch(/Fill in the date/);
    expect(cleanPlan({ action: 'record_file', fields: { type: 'memo' } }, { projects, file: 'a.pdf', user: admin as never }).plan?.fields.type).toBe('other');
  });
});

describe('the assistant route', () => {
  let h: Awaited<ReturnType<typeof staffHarness>>;
  let owner: { cookie: string };
  beforeEach(async () => {
    h = await staffHarness();
    owner = await h.makeOwner();
  });

  it('plans from the model reply and publishes nothing by itself', async () => {
    (h.env as unknown as { AI: unknown }).AI = { run: async () => ({ response: 'Sure. {"action":"notice","fields":{"message":"Center Street is closed Monday.","tone":"alert"}}' }) };
    const r = await h.call('POST', '/assist/plan', { text: 'Center Street closed Monday, put up an alert' }, { cookie: owner.cookie });
    expect(r.status).toBe(200);
    expect(r.body.plan).toEqual({ action: 'notice', fields: { message: 'Center Street is closed Monday.', tone: 'alert' } });
    expect((await h.call('GET', '/notices/list', undefined, { cookie: owner.cookie })).body.items ?? []).toHaveLength(0);
  });

  it('falls back to a record for a file when the model is not there', async () => {
    (h.env as unknown as { AI: unknown }).AI = { run: async () => Promise.reject(new Error('down')) };
    const r = await h.call('POST', '/assist/plan', { text: '', fileName: 'October_newsletter.pdf' }, { cookie: owner.cookie });
    expect(r.body.plan).toEqual({ action: 'record_file', fields: { title: 'October newsletter', type: 'other' } });
    const none = await h.call('POST', '/assist/plan', { text: 'add a park' }, { cookie: owner.cookie });
    expect(none.body.plan).toBeNull();
    expect(none.body.message).toMatch(/not available/);
  });
});

describe('the master owner', () => {
  it('is the only owner, and nobody else can change it', async () => {
    const h = await staffHarness();
    const owner = await h.makeOwner();
    expect((await h.call('POST', '/users', { name: 'Second Owner', email: 'two@vineyard.example', role: 'owner' }, { cookie: owner.cookie })).status).toBe(403);
    const admin = await h.addPerson(owner.cookie, { name: 'Ada Admin', email: 'ada@vineyard.example', role: 'admin' });
    expect((await h.call('POST', '/users/update', { id: admin.id, role: 'owner' }, { cookie: owner.cookie })).status).toBe(403);
    const list = (await h.call('GET', '/users', undefined, { cookie: admin.cookie })).body.items as Array<{ id: string; role: string; canManage: boolean }>;
    const me = list.find((u) => u.role === 'owner')!;
    expect(me.canManage).toBe(false);
    expect((await h.call('POST', '/users/update', { id: me.id, active: false }, { cookie: admin.cookie })).status).toBe(403);
    expect((await h.call('POST', '/users/update', { id: me.id, name: 'Not Jacob' }, { cookie: admin.cookie })).status).toBe(403);
  });
});
