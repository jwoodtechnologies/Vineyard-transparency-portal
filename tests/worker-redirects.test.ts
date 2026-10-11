import { describe, expect, it } from 'vitest';
import { testEnv } from './helpers/d1';
import { ensureRedirects, redirectStatement, resolveMoved } from '../worker/lib/redirects';
import { getDocumentDetail } from '../worker/api/documents';

const now = '2026-10-11T00:00:00Z';

function seed() {
  const env = testEnv();
  const db = env.CATALOG_DB.db;
  const doc = (id: string, title: string) =>
    db
      .prepare(`INSERT INTO documents (id, slug, title, document_type, source_id, created_at, updated_at, first_seen_at, last_seen_at) VALUES (?, ?, ?, 'minutes', 'civicclerk', ?, ?, ?, ?)`)
      .run(id, id, title, now, now, now, now);
  doc('doc_aaaaaaaaaaaaaaaa', 'Kept minutes');
  // A second copy folded into the kept record before the redirect table existed: its source row moved over
  // and still carries the old id's characters 4 to 12.
  db.prepare(`INSERT INTO document_sources (id, document_id, source_id, source_url, canonical_key, retrieved_at) VALUES (?, ?, 'civicclerk', 'https://x/y.pdf', 'k1', ?)`).run('src_0123456789abcdef_bbbbbbbb', 'doc_aaaaaaaaaaaaaaaa', now);
  return env;
}

describe('old record ids', () => {
  it('follow a recorded move, a folded copy, or say why a record was taken out', async () => {
    const env = seed();
    await ensureRedirects(env);
    await env.CATALOG_DB.batch([
      redirectStatement(env, 'doc_cccccccccccccccc', 'doc_dddddddddddddddd', 'merged'),
      redirectStatement(env, 'doc_dddddddddddddddd', 'doc_aaaaaaaaaaaaaaaa', 'merged'),
      redirectStatement(env, 'doc_eeeeeeeeeeeeeeee', null, 'The project is not in the adopted budget.'),
    ]);
    expect(await resolveMoved(env, 'doc_cccccccccccccccc')).toEqual({ kind: 'moved', id: 'doc_aaaaaaaaaaaaaaaa' });
    expect(await resolveMoved(env, 'doc_bbbbbbbbffffffff')).toEqual({ kind: 'moved', id: 'doc_aaaaaaaaaaaaaaaa' });
    expect(await resolveMoved(env, 'doc_eeeeeeeeeeeeeeee')).toEqual({ kind: 'removed', reason: 'The project is not in the adopted budget.' });
    expect(await resolveMoved(env, 'doc_9999999999999999')).toBeNull();
  });

  it('answer the detail route with the current record', async () => {
    const env = seed();
    const res = await getDocumentDetail(env, new Request('https://vineyardportal.org/api/documents/doc_bbbbbbbbffffffff'), 'doc_bbbbbbbbffffffff');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { id: string }).id).toBe('doc_aaaaaaaaaaaaaaaa');
  });
});
