import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { staffHarness } from './helpers/staff';
import { checkWatchUrl, isDue, linkedFileType, pickDue } from '../worker/sync/webWatch';

type H = Awaited<ReturnType<typeof staffHarness>>;

describe('watched website addresses', () => {
  it('takes public http and https pages', () => {
    expect(checkWatchUrl('https://www.utahcounty.gov/news')).toEqual({ ok: true, url: 'https://www.utahcounty.gov/news' });
    expect(checkWatchUrl('alpineschools.org/board')).toMatchObject({ ok: true, url: 'https://alpineschools.org/board' });
  });

  it('refuses other schemes, address literals, private names, odd ports, credentials and the portal', () => {
    for (const bad of [
      'ftp://example.com/x',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'http://127.0.0.1/',
      'http://10.0.0.5/admin',
      'http://192.168.1.1',
      'http://2130706433/',
      'http://0x7f000001/',
      'http://[::1]/',
      'http://localhost:8080/',
      'http://printer.local/',
      'http://intranet/',
      'https://city.internal/',
      'https://user:pw@example.com/',
      'https://example.com:8443/',
      'https://vineyardportal.org/staff',
      '',
    ])
      expect(checkWatchUrl(bad).ok, bad).toBe(false);
  });

  it('queues only PDF, Word and Excel links on public hosts', () => {
    expect(linkedFileType('https://example.org/files/budget.pdf')).toBe('pdf');
    expect(linkedFileType('https://example.org/a/plan.XLSX')).toBe('xlsx');
    expect(linkedFileType('https://example.org/page.html')).toBeNull();
    expect(linkedFileType('http://10.0.0.1/secret.pdf')).toBeNull();
  });
});

describe('which watched pages are due', () => {
  const now = Date.parse('2026-10-14T12:00:00Z');
  const row = (id: string, every: number, checked: string | null, extra: Partial<{ paused: number; deleted_at: string | null }> = {}) => ({ id, every_min: every, last_checked_at: checked, paused: 0, deleted_at: null, ...extra });

  it('is due when never checked or once its interval has passed, never when paused or deleted', () => {
    expect(isDue(row('a', 60, null), now)).toBe(true);
    expect(isDue(row('b', 60, '2026-10-14T11:01:00Z'), now)).toBe(true);
    expect(isDue(row('c', 60, '2026-10-14T11:30:00Z'), now)).toBe(false);
    expect(isDue(row('d', 10, null, { paused: 1 }), now)).toBe(false);
    expect(isDue(row('e', 10, null, { deleted_at: 'x' }), now)).toBe(false);
  });

  it('checks at most a few a tick, longest overdue first', () => {
    const rows = [row('weekly', 10080, '2026-10-01T00:00:00Z'), row('hourly', 60, '2026-10-14T10:00:00Z'), row('new', 10, null), row('fresh', 60, '2026-10-14T11:59:00Z'), row('daily', 1440, '2026-10-12T00:00:00Z')];
    expect(pickDue(rows, now, 3).map((r) => r.id)).toEqual(['weekly', 'daily', 'hourly']);
    expect(pickDue(rows, now, 10)).toHaveLength(4);
  });
});

describe('watched websites in the staff portal', () => {
  let h: H;
  let owner: { cookie: string };
  beforeEach(async () => {
    h = await staffHarness();
    owner = await h.makeOwner();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('lets owners add, edit, pause and delete, logs each change and undoes it', async () => {
    let r = await h.call('POST', '/watch/add', { label: 'County news', url: 'https://www.utahcounty.gov/news', every: '1h' }, { cookie: owner.cookie });
    expect(r.status).toBe(201);
    const id = r.body.id as string;
    let list = await h.call('GET', '/watch/list', undefined, { cookie: owner.cookie });
    const items = list.body.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ label: 'County news', every: 'Hourly', paused: false });
    expect(list.body.budget).toMatchObject({ limit: expect.any(Number), usedToday: expect.any(Number) });

    expect((await h.call('POST', '/watch/add', { label: 'Again', url: 'https://www.utahcounty.gov/news', every: '1h' }, { cookie: owner.cookie })).status).toBe(400);
    expect((await h.call('POST', '/watch/add', { label: 'Bad', url: 'http://10.0.0.1/', every: '1h' }, { cookie: owner.cookie })).status).toBe(400);
    expect((await h.call('POST', '/watch/add', { label: 'Bad', url: 'https://example.org/', every: '5m' }, { cookie: owner.cookie })).status).toBe(400);

    r = await h.call('POST', '/watch/edit', { id, label: 'County news room', every: '1d' }, { cookie: owner.cookie });
    expect(r.status).toBe(200);
    r = await h.call('POST', '/watch/pause', { id, paused: true }, { cookie: owner.cookie });
    expect(r.status).toBe(200);
    expect((await h.call('POST', '/watch/delete', { id }, { cookie: owner.cookie })).status).toBe(200);
    list = await h.call('GET', '/watch/list', undefined, { cookie: owner.cookie });
    expect(list.body.items).toHaveLength(0);

    const audit = await h.call('GET', '/audit', undefined, { cookie: owner.cookie });
    const entries = audit.body.items as Array<{ id: number; summary: string; undoable: boolean }>;
    expect(entries.map((e) => e.summary).slice(0, 4)).toEqual(['Stopped watching "County news room"', 'Paused watching "County news room"', 'Changed the watched page "County news room"', 'Started watching "County news" (hourly)']);
    // Undo the delete: it is back, still paused, as it was.
    r = await h.call('POST', '/audit/undo', { id: entries[0].id }, { cookie: owner.cookie });
    expect(r.status).toBe(200);
    list = await h.call('GET', '/watch/list', undefined, { cookie: owner.cookie });
    expect(list.body.items).toEqual([expect.objectContaining({ label: 'County news room', every: 'Daily', paused: true })]);
  });

  it('is for owners and administrators only, and caps how many pages are watched', async () => {
    const clerk = await h.addPerson(owner.cookie, { name: 'Pat Clerk', email: 'pat@vineyard.example', department: 'Recorder', role: 'editor', areas: ['records'] });
    expect((await h.call('GET', '/watch/list', undefined, { cookie: clerk.cookie })).status).toBe(403);
    expect((await h.call('POST', '/watch/add', { label: 'x', url: 'https://example.org/', every: '1h' }, { cookie: clerk.cookie })).status).toBe(403);
    expect((await h.call('GET', '/schedules/list', undefined, { cookie: clerk.cookie })).status).toBe(403);
    const { MAX_WATCHED } = await import('../worker/sync/webWatch');
    for (let i = 0; i < MAX_WATCHED; i++) expect((await h.call('POST', '/watch/add', { label: `Page ${i}`, url: `https://example.org/p${i}`, every: '1d' }, { cookie: owner.cookie })).status).toBe(201);
    const over = await h.call('POST', '/watch/add', { label: 'One more', url: 'https://example.org/more', every: '1d' }, { cookie: owner.cookie });
    expect(over.status).toBe(400);
  });

  it('checks due pages on the cron: stores a version, indexes it and queues new linked files', async () => {
    await h.call('POST', '/watch/add', { label: 'Board page', url: 'https://example.org/board', every: '1h' }, { cookie: owner.cookie });
    const html = `<html><head><title>Board</title></head><body><h1>School board meetings</h1><p>${'The board meets on the second Tuesday of each month at the district office. '.repeat(4)}</p>
      <a href="/files/agenda-oct.pdf">October agenda</a> <a href="https://example.org/files/minutes.docx">Minutes</a> <a href="/about.html">About</a> <a href="http://10.0.0.1/x.pdf">x</a></body></html>`;
    const seen: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      seen.push(url);
      if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /\n', { status: 200 });
      const res = new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
      Object.defineProperty(res, 'url', { value: url });
      return res;
    });
    const { runWebWatch } = await import('../worker/sync/webWatch');
    const { Budget } = await import('../worker/admin/routes');
    const out = (await runWebWatch(h.env as never, new Budget(h.env as never))) as { due: number; checks: Array<{ changed: boolean; files: number }> };
    expect(out.due).toBe(1);
    expect(out.checks[0]).toMatchObject({ changed: true, files: 2 });
    expect(seen).toContain('https://example.org/robots.txt');
    const queued = h.env.CATALOG_DB.db.prepare("SELECT url FROM crawl_queue WHERE source_id = 'watched-websites' ORDER BY url").all() as Array<{ url: string }>;
    expect(queued.map((q) => q.url)).toEqual(['https://example.org/files/agenda-oct.pdf', 'https://example.org/files/minutes.docx']);
    // Just checked: not due again for an hour.
    const again = (await runWebWatch(h.env as never, new Budget(h.env as never))) as { due: number };
    expect(again.due).toBe(0);
    const sched = await h.call('GET', '/schedules/list', undefined, { cookie: owner.cookie });
    const rows = sched.body.items as Array<{ id: string; group: string; name: string; every: string; status: string }>;
    expect(rows.find((r) => r.group === 'Watched website')).toMatchObject({ name: 'Board page', every: 'Hourly', status: 'Working' });
    expect(rows.find((r) => r.id === 'utah-pmn' || r.name === 'Utah Public Notices')).toMatchObject({ every: 'Every 15 minutes' });
    expect(rows.some((r) => r.group === 'GitHub' && r.every === 'Daily at 09:17 UTC')).toBe(true);
  });
});
