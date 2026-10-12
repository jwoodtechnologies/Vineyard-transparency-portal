import { describe, expect, it } from 'vitest';
import { testEnv } from './helpers/d1';
import { cookieOf, panel, setupOwner, uploaderSession, type TestEnv } from './helpers/panel';
import { publicUpdates, updateProjects } from '../worker/contrib/updates';
import { handleSearch } from '../worker/api/search';
import { handleAsk, RAG_SYSTEM_PROMPT } from '../worker/ai/rag';
import { SearchRepository } from '../worker/search/SearchRepository';
import { sourceLabelFor } from '../worker/lib/contrib';
import type { Env } from '../worker/env';

// Updates from the panel's Updates tab: records of their own, searchable and used by chat at once.

const TEXT = 'The new pickleball courts at Grove Park opened on October 10, 2026. All eight courts are lit until 10 pm.';

async function admin(env: TestEnv, owner: string): Promise<string> {
  const inv = (await (await panel(env, 'POST', '/api/invites/create', { body: { role: 'admin' }, cookie: owner })).json()) as { path: string };
  const r = await panel(env, 'POST', '/api/invite/accept', { body: { token: inv.path.split('/invite/')[1], login: 'cityadmin', password: 'vineyard city hall 2026' }, ip: '10.0.5.1' });
  expect(r.status).toBe(200);
  return cookieOf(r);
}

async function publish(env: TestEnv, cookie: string, body: Record<string, unknown>): Promise<{ id: string; documentId: string }> {
  const r = await panel(env, 'POST', '/api/updates/create', { body, cookie });
  expect(r.status, await r.clone().text()).toBe(201);
  return (await r.json()) as { id: string; documentId: string };
}

const chunks = (env: TestEnv, documentId: string) => (env.SEARCH_DB_0.db.prepare('SELECT group_concat(text) AS t FROM chunks WHERE document_id = ?').get(documentId) as { t: string | null }).t ?? '';

async function search(env: TestEnv, q: string): Promise<string[]> {
  const res = await handleSearch(env, new URL(`https://vineyardportal.org/api/search?q=${encodeURIComponent(q)}`));
  const j = (await res.json()) as { items: Array<{ document: { id: string } }> };
  return j.items.map((r) => r.document.id);
}

describe('updates', () => {
  it('an admin publishes an update: a staff_update record, indexed and searchable at once', async () => {
    const env = testEnv();
    const owner = await setupOwner(env);
    const cookie = await admin(env, owner);
    const { documentId } = await publish(env, cookie, { title: 'Grove Park pickleball courts open', text: TEXT, date: '2026-10-12', topic: 'topic:parks' });
    const doc = env.CATALOG_DB.db.prepare('SELECT source_id, document_type, document_date, title FROM documents WHERE id = ?').get(documentId);
    expect(doc).toEqual({ source_id: 'portal-staff', document_type: 'staff_update', document_date: '2026-10-12', title: 'Grove Park pickleball courts open' });
    const text = chunks(env, documentId);
    expect(text).toContain('Update from Vineyard City staff, Oct 12, 2026');
    expect(text).toContain('Topic: Parks and trails');
    expect(text).toContain('eight courts are lit');
    expect(await search(env, 'pickleball courts lit')).toContain(documentId);
    // The author is kept with the update.
    const row = env.CATALOG_DB.db.prepare("SELECT u.account_id, a.name FROM uploads u JOIN panel_accounts a ON a.id = u.account_id WHERE u.kind = 'update'").get();
    expect(row).toMatchObject({ name: 'Vineyard Admin' });
    expect(sourceLabelFor('portal-staff', 'staff_update', '2026-10-12')).toBe('Update from Vineyard City staff, Oct 12, 2026');
    expect(sourceLabelFor('portal-staff', 'note', '2026-10-12')).toBe('Added by portal staff');
  });

  it('a title and date are optional (first line, today); text is required; topics come from the lists', async () => {
    const env = testEnv();
    const owner = await setupOwner(env);
    const { documentId } = await publish(env, owner, { text: 'We finished this construction project.\nThanks for your patience.' });
    const doc = env.CATALOG_DB.db.prepare('SELECT title, document_date FROM documents WHERE id = ?').get(documentId) as { title: string; document_date: string };
    expect(doc.title).toBe('We finished this construction project.');
    expect(doc.document_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((await panel(env, 'POST', '/api/updates/create', { body: { text: '  ' }, cookie: owner })).status).toBe(400);
    expect((await panel(env, 'POST', '/api/updates/create', { body: { text: 'x', topic: 'project:nope' }, cookie: owner })).status).toBe(400);
    expect((await panel(env, 'POST', '/api/updates/create', { body: { text: 'x', date: '10/12/2026' }, cookie: owner })).status).toBe(400);
  });

  it('an update for a funded project is listed for its card under the map', async () => {
    const env = testEnv();
    const owner = await setupOwner(env);
    const p = updateProjects().find((x) => x.gis === '1200 North Bridge')!;
    expect(p).toBeTruthy();
    const { documentId } = await publish(env, owner, { title: 'Bridge design finished', text: 'The design of the 1200 North overpass bridge is finished.', date: '2026-10-01', topic: `project:${p.key}` });
    await publish(env, owner, { title: 'Courts open', text: TEXT, date: '2026-10-12', topic: 'topic:parks' });
    const all = (await (await publicUpdates(env, new URL('https://x/api/updates'))).json()) as { items: Array<Record<string, unknown>> };
    expect(all.items.map((u) => u.title)).toEqual(['Courts open', 'Bridge design finished']);
    const one = (await (await publicUpdates(env, new URL(`https://x/api/updates?project=${p.key}`))).json()) as { items: Array<Record<string, unknown>> };
    expect(one.items).toEqual([expect.objectContaining({ id: documentId, projectGis: '1200 North Bridge', topic: 'Project: 1200 North Bridge', date: '2026-10-01' })]);
    expect(chunks(env, documentId)).toContain('Project: 1200 North Bridge');
  });

  it('edits re-index the record and keep the earlier text in the log; removal takes it off search', async () => {
    const env = testEnv();
    const owner = await setupOwner(env);
    const cookie = await admin(env, owner);
    const { id, documentId } = await publish(env, cookie, { title: 'Courts', text: 'The pickleball courts open next week.', date: '2026-10-05' });
    expect((await panel(env, 'POST', '/api/updates/edit', { body: { id, title: 'Courts open', text: TEXT, date: '2026-10-12' }, cookie: owner })).status).toBe(200);
    expect(chunks(env, documentId)).toContain('eight courts');
    expect(chunks(env, documentId)).not.toContain('open next week');
    const list = (await (await panel(env, 'GET', '/api/updates', { cookie })).json()) as { items: Array<{ id: string; history: Array<{ action: string; by: string; before: { text: string } | null }> }> };
    const h = list.items[0].history;
    expect(h.map((x) => [x.action, x.by])).toEqual([
      ['edit', 'Owner'],
      ['add', 'Vineyard Admin'],
    ]);
    expect(h[0].before?.text).toBe('The pickleball courts open next week.');
    expect((await panel(env, 'POST', '/api/updates/delete', { body: { id }, cookie })).status).toBe(200);
    expect(env.CATALOG_DB.db.prepare('SELECT count(*) AS n FROM documents WHERE id = ?').get(documentId)!.n).toBe(0);
    expect(await search(env, 'pickleball courts lit')).not.toContain(documentId);
    const after = (await (await panel(env, 'GET', '/api/updates', { cookie })).json()) as { items: unknown[]; removed: Array<{ title: string; before: { text: string } }> };
    expect(after.items).toEqual([]);
    expect(after.removed[0]).toMatchObject({ title: 'Courts open', before: { text: TEXT } });
  });

  it('uploaders cannot post updates, and updates stay out of the Uploads list', async () => {
    const env = testEnv();
    const owner = await setupOwner(env);
    const up = await uploaderSession(env, owner);
    expect((await panel(env, 'POST', '/api/updates/create', { body: { text: 'Hello' }, cookie: up })).status).toBe(403);
    expect((await panel(env, 'GET', '/api/updates', { cookie: up })).status).toBe(403);
    await publish(env, owner, { text: 'An update.' });
    const uploads = (await (await panel(env, 'GET', '/api/uploads', { cookie: owner })).json()) as { items: unknown[] };
    expect(uploads.items).toEqual([]);
  });
});

// ------------------------------------------------------------------ chat

/** Workers AI: the rewrite and the search plan fail, the reranker keeps the order, and the answer is `write(user message)`. */
function ai(write: (user: string) => string, seen: string[]) {
  return {
    run: async (_model: string, input: Record<string, unknown>) => {
      if (typeof input.query === 'string') return { response: (input.contexts as unknown[]).map((_, i) => ({ id: i, score: 0.9 - i * 0.001 })) };
      const msgs = (input.messages ?? []) as Array<{ role: string; content: string }>;
      if (msgs[0]?.content.startsWith(RAG_SYSTEM_PROMPT.slice(0, 60))) {
        seen.push(msgs[msgs.length - 1].content);
        return { response: write(msgs[msgs.length - 1].content) };
      }
      return { response: 'not json' };
    },
  };
}

/** The [n] of the source whose text holds `needle`, or 0. */
const sourceWith = (user: string, needle: string) => {
  for (const m of user.matchAll(/\[(\d+)\][^\n]*\n<<<\n([\s\S]*?)\n>>>/g)) if (m[2].includes(needle)) return Number(m[1]);
  return 0;
};

describe('chat reads updates as records', () => {
  it('cites a published update with its label, and the newer update wins over an older record', async () => {
    const env = testEnv();
    env.CATALOG_DB.db.exec('ALTER TABLE quota_usage ADD COLUMN ai_neurons REAL NOT NULL DEFAULT 0');
    // An older city record that says the courts are still being built.
    const repo = new SearchRepository(env);
    const now = '2026-06-01T00:00:00Z';
    env.CATALOG_DB.db
      .prepare(
        `INSERT INTO documents (id, slug, title, document_type, document_date, year, government_body_id, government_body_name, meeting_id, source_id, created_at, updated_at, first_seen_at, last_seen_at)
         VALUES ('doc_old_courts', 'doc_old_courts', 'Grove Park pickleball courts staff report', 'staff_report', '2026-06-01', 2026, 'city-council', 'City Council', NULL, 'vineyard-city', ?, ?, ?, ?)`,
      )
      .run(now, now, now, now);
    await repo.replaceDocument(
      0,
      { documentId: 'doc_old_courts', title: 'Grove Park pickleball courts staff report', documentType: 'staff_report', documentNumber: null, documentDate: '2026-06-01', year: 2026, governmentBodyId: 'city-council', sourceId: 'vineyard-city', meetingId: null, categories: [], currency: 'historical' },
      [{ id: 'doc_old_courts:1', pageStart: 1, pageEnd: 1, sectionTitle: null, text: 'The Grove Park pickleball courts are under construction and expected to open in the fall.' }],
    );
    const owner = await setupOwner(env);
    const { documentId } = await publish(env, owner, { title: 'Grove Park pickleball courts open', text: TEXT, date: '2026-10-12', topic: 'topic:parks' });

    const seen: string[] = [];
    const write = (u: string) => `Yes. The pickleball courts at Grove Park opened on October 10, 2026, and all eight are lit until 10 pm [${sourceWith(u, 'eight courts')}].`;
    const req = new Request('https://example.test/api/ask', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': 't-upd' }, body: JSON.stringify({ question: 'Are the Grove Park pickleball courts open?' }) });
    const res = await handleAsk({ ...env, AI: ai(write, seen) } as unknown as Env, req);
    const r = (await res.json()) as { answer: string; citations: Array<{ documentId: string; sourceLabel?: string | null; documentType?: string }> };

    // The model saw the update as a dated source of type "staff update", and the prompt says how to treat it.
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]).toMatch(/\[\d+\] Grove Park pickleball courts open \| staff update \| 2026-10-12/);
    expect(RAG_SYSTEM_PROMPT).toContain('"staff update" is an update posted by Vineyard City staff');
    // The answer cites the update, with its label.
    expect(r.answer).toContain('eight are lit');
    expect(r.citations).toEqual([expect.objectContaining({ documentId, sourceLabel: 'Update from Vineyard City staff, Oct 12, 2026' })]);
  });
});
