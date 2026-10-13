import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PNG, fileForm } from './helpers/panel';
import { staffHarness } from './helpers/staff';
import { addFile, addForm, addStatus } from '../worker/contrib/resident';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

type H = Awaited<ReturnType<typeof staffHarness>>;
let h: H;
let owner: { cookie: string };
let reviewer: { cookie: string };
let editor: { cookie: string };

beforeEach(async () => {
  h = await staffHarness();
  owner = await h.makeOwner();
  reviewer = await h.addPerson(owner.cookie, { name: 'Rae Review', email: 'rae@vineyard.example', role: 'editor', areas: ['submissions'] });
  editor = await h.addPerson(owner.cookie, { name: 'Pat Clerk', email: 'pat@vineyard.example', role: 'editor', areas: ['records', 'notices'] }, 'a different long password');
});

function residentReq(body: unknown, form?: FormData) {
  const headers: Record<string, string> = { 'cf-connecting-ip': '192.0.2.7' };
  if (!form) headers['content-type'] = 'application/json';
  return new Request('https://vineyardportal.org/api/add', { method: 'POST', headers, body: form ?? JSON.stringify(body) });
}

async function sendNote(text: string): Promise<string> {
  const r = await addForm(h.env as never, residentReq({ kind: 'note', text }));
  expect(r.status).toBe(201);
  return ((await r.json()) as { id: string }).id;
}

const version = () => {
  try {
    return (h.env.CATALOG_DB.db.prepare('SELECT v FROM data_version WHERE id = 1').get() as { v: number } | undefined)?.v ?? 0;
  } catch {
    return 0;
  }
};
const row = (id: string) => h.env.CATALOG_DB.db.prepare('SELECT status, document_id, hidden_at, removed_at FROM resident_submissions WHERE id = ?').get(id) as Record<string, string | null> | undefined;
const post = (path: string, body: Record<string, unknown>, who = reviewer) => h.call('POST', path, body, { cookie: who.cookie });
const audit = async (who = reviewer) => (await h.call('GET', '/audit', undefined, { cookie: who.cookie })).body.items as Array<Record<string, unknown>>;

describe('who may review submissions', () => {
  it('keeps an editor without the submissions area out, and lets owners in', async () => {
    const id = await sendNote('A pothole on 400 North near the school.');
    expect((await h.call('GET', '/submissions/list', undefined, { cookie: editor.cookie })).status).toBe(403);
    expect((await post('/submissions/approve', { id }, editor)).status).toBe(403);
    expect((await post('/submissions/switch', { open: false }, editor)).status).toBe(403);
    expect((await h.call('GET', '/submissions/list')).status).toBe(401);
    expect((await h.call('GET', '/submissions/list', undefined, { cookie: owner.cookie })).status).toBe(200);
    const list = await h.call('GET', '/submissions/list', undefined, { cookie: reviewer.cookie });
    expect(list.status).toBe(200);
    expect(list.body.pending).toHaveLength(1);
    expect(list.body.open).toBe(true);
  });

  it('lists the new area for account forms', async () => {
    const state = await h.call('GET', '/state', undefined, { cookie: owner.cookie });
    expect(state.body.areas).toContainEqual({ key: 'submissions', label: 'Resident submissions' });
  });
});

describe('approve and reject', () => {
  it('approves into a public record, logs it in Activity without an undo, and refreshes the site', async () => {
    const id = await sendNote('The crosswalk light at Main and Center is out.');
    const before = version();
    const r = await post('/submissions/approve', { id });
    expect(r.status).toBe(200);
    expect(r.body.documentId).toBeTruthy();
    expect(version()).toBe(before + 1);
    expect(row(id)).toMatchObject({ status: 'approved', document_id: r.body.documentId });
    const [entry] = await audit();
    expect(entry).toMatchObject({ area: 'submissions', action: 'approved', user_name: 'Rae Review', undoable: false });
    const residentLog = h.env.CATALOG_DB.db.prepare("SELECT detail FROM resident_log WHERE action = 'approve'").get() as { detail: string };
    expect(residentLog.detail).toMatch(/^by Rae Review/);
    // Approving twice is refused in a sentence.
    const again = await post('/submissions/approve', { id });
    expect(again.status).toBe(409);
    expect(again.body.error.message).toBe('That item is not waiting for review.');
  });

  it('rejects by deleting the item and its file, with no undo', async () => {
    const r = await addFile(h.env as never, residentReq(null, fileForm(PNG, 'spam.png', { title: 'Spam' })));
    const id = ((await r.json()) as { id: string }).id;
    expect(h.env.ARCHIVE.objects.size).toBe(1);
    expect((await post('/submissions/reject', { id })).status).toBe(200);
    expect(row(id)).toBeUndefined();
    expect(h.env.ARCHIVE.objects.size).toBe(0);
    const [entry] = await audit();
    expect(entry).toMatchObject({ action: 'rejected', undoable: false });
    const gone = await post('/submissions/reject', { id });
    expect(gone.status).toBe(404);
    expect(gone.body.error.message).toMatch(/not found/);
  });

  it('shows a pending file to reviewers only', async () => {
    const r = await addFile(h.env as never, residentReq(null, fileForm(PNG, 'map.png')));
    const id = ((await r.json()) as { id: string }).id;
    expect(row(id)?.status).toBe('pending');
    expect((await h.call('GET', `/submissions/file?id=${id}`, undefined, { cookie: editor.cookie })).status).toBe(403);
  });
});

describe('approved items', () => {
  it('hides and restores, and each can be undone from Activity', async () => {
    const id = await sendNote('Free compost pickup at the public works yard on Saturday.');
    await post('/submissions/approve', { id });

    expect((await post('/submissions/hide', { id })).status).toBe(200);
    expect(row(id)?.hidden_at).toBeTruthy();
    let [entry] = await audit();
    expect(entry).toMatchObject({ action: 'hidden', entity: 'submission', undoable: true });

    // Undo the hide: it is public again with a new record.
    const undo = await h.call('POST', '/audit/undo', { id: entry.id }, { cookie: reviewer.cookie });
    expect(undo.status).toBe(200);
    expect(undo.body.summary).toMatch(/Put back/);
    expect(row(id)?.hidden_at).toBeNull();
    expect(row(id)?.document_id).toBeTruthy();

    // Hide, then restore with the button, then undo the restore.
    await post('/submissions/hide', { id });
    expect((await post('/submissions/restore', { id })).status).toBe(200);
    expect(row(id)?.hidden_at).toBeNull();
    [entry] = await audit();
    expect(entry).toMatchObject({ action: 'restored', undoable: true });
    expect((await h.call('POST', '/audit/undo', { id: entry.id }, { cookie: reviewer.cookie })).status).toBe(200);
    expect(row(id)?.hidden_at).toBeTruthy();

    // An editor without the area cannot undo it.
    const mine = (await audit()).find((e) => e.action === 'hidden' && !e.undone_at)!;
    expect((await h.call('POST', '/audit/undo', { id: mine.id }, { cookie: editor.cookie })).status).toBe(403);
  });

  it('removes for good, with no undo, and refuses to remove a pending item', async () => {
    const waiting = await sendNote('Still waiting for review.');
    const refused = await post('/submissions/remove', { id: waiting });
    expect(refused.status).toBe(400);
    expect(refused.body.error.message).toBe('Approve or reject this item first.');

    const id = await sendNote('A note to remove later.');
    await post('/submissions/approve', { id });
    expect((await post('/submissions/remove', { id })).status).toBe(200);
    expect(row(id)?.removed_at).toBeTruthy();
    const [entry] = await audit();
    expect(entry).toMatchObject({ action: 'removed', entity: 'submission-removed', undoable: false });
    const hide = await post('/submissions/hide', { id });
    expect(hide.status).toBe(400);
    expect(hide.body.error.message).toBe('That item was removed for good.');
  });
});

describe('pausing submissions', () => {
  it('pauses and opens again, and the pause can be undone', async () => {
    expect((await post('/submissions/switch', { open: false })).status).toBe(200);
    expect(((await (await addStatus(h.env as never)).json()) as { open: boolean }).open).toBe(false);
    const [entry] = await audit();
    expect(entry).toMatchObject({ action: 'paused', undoable: true });
    expect((await h.call('POST', '/audit/undo', { id: entry.id }, { cookie: reviewer.cookie })).status).toBe(200);
    expect(((await (await addStatus(h.env as never)).json()) as { open: boolean }).open).toBe(true);
    const bad = await post('/submissions/switch', {});
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toBe('Choose whether submissions are open or paused.');
  });
});
