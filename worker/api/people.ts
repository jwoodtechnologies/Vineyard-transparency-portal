/**
 * People: the mayor, City Council, staff and board members as the city lists them today, with
 * their photo, title, term and contact, plus what the archive says about them.
 *
 *   GET /api/people              everyone currently listed (and former officials still on file)
 *   GET /api/people/:slug        one profile + records that mention them + their recorded
 *                                motions and votes from council minutes (newest first)
 *   GET /api/people/:slug/photo  their photo from the city website (cached at the edge)
 *   POST /api/admin/people       (ingest) replace today's list
 */
import type { Env } from '../env';
import { CACHE, HttpError, json, notFound } from '../lib/http';
import { SearchRepository, type ChunkHit } from '../search/SearchRepository';

export interface PersonInput {
  slug: string;
  name: string;
  kind: 'elected' | 'staff' | 'board';
  role: string;
  title: string | null;
  department: string | null;
  term: string | null;
  email: string | null;
  phone: string | null;
  photoUrl: string | null;
  sourceUrl: string;
}

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null || v === '' ? null : String(v));

let ready = false;
export async function ensurePeopleTable(env: Env): Promise<void> {
  if (ready) return;
  await env.CATALOG_DB.prepare(
    `CREATE TABLE IF NOT EXISTS people (
       slug TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, role TEXT NOT NULL, title TEXT, department TEXT,
       term TEXT, email TEXT, phone TEXT, photo_url TEXT, source_url TEXT NOT NULL,
       current INTEGER NOT NULL DEFAULT 1, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL)`,
  ).run();
  ready = true;
}

const PHOTO_HOST = /^https:\/\/(www\.)?vineyardutah\.(gov|org)\//;

/** Ingest: today's list replaces yesterday's. People no longer listed stay on file as former. */
export async function upsertPeople(env: Env, people: PersonInput[], asOf: string): Promise<Response> {
  await ensurePeopleTable(env);
  const db = env.CATALOG_DB;
  const clean = people
    .filter((p) => p && /^[a-z0-9-]{2,80}$/.test(p.slug) && p.name && ['elected', 'staff', 'board'].includes(p.kind))
    .slice(0, 400)
    .map((p) => ({ ...p, photoUrl: p.photoUrl && PHOTO_HOST.test(p.photoUrl) ? p.photoUrl : null }));
  if (!clean.length) throw new HttpError(400, 'bad_request', 'No people.');
  const kinds = [...new Set(clean.map((p) => p.kind))];
  const stmts = [
    db.prepare(`UPDATE people SET current = 0 WHERE kind IN (SELECT value FROM json_each(?)) AND slug NOT IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(kinds), JSON.stringify(clean.map((p) => p.slug))),
    ...clean.map((p) =>
      db
        .prepare(
          `INSERT INTO people (slug, name, kind, role, title, department, term, email, phone, photo_url, source_url, current, first_seen, last_seen)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
           ON CONFLICT(slug) DO UPDATE SET name = excluded.name, kind = excluded.kind, role = excluded.role, title = excluded.title, department = excluded.department,
             term = excluded.term, email = excluded.email, phone = excluded.phone, photo_url = coalesce(excluded.photo_url, people.photo_url),
             source_url = excluded.source_url, current = 1, last_seen = excluded.last_seen`,
        )
        .bind(p.slug, p.name.slice(0, 120), p.kind, p.role.slice(0, 120), str(p.title), str(p.department), str(p.term), str(p.email), str(p.phone), str(p.photoUrl), p.sourceUrl, asOf, asOf),
    ),
  ];
  const r = await db.batch(stmts);
  return json({ ok: true, people: clean.length, rowsWritten: r.reduce((t, x) => t + Number(x.meta?.rows_written ?? 0), 0) });
}

function card(r: Row) {
  return {
    slug: String(r.slug),
    name: String(r.name),
    kind: String(r.kind),
    role: String(r.role),
    title: str(r.title),
    department: str(r.department),
    term: str(r.term),
    email: str(r.email),
    phone: str(r.phone),
    photo: r.photo_url ? `/api/people/${encodeURIComponent(String(r.slug))}/photo` : null,
    sourceUrl: String(r.source_url),
    current: Number(r.current) === 1,
    asOf: String(r.last_seen),
  };
}

export async function listPeople(env: Env): Promise<Response> {
  await ensurePeopleTable(env);
  const res = await env.CATALOG_DB.prepare(
    `SELECT * FROM people ORDER BY current DESC, CASE kind WHEN 'elected' THEN 0 WHEN 'staff' THEN 1 ELSE 2 END, CASE role WHEN 'Mayor' THEN 0 ELSE 1 END, name`,
  ).all<Row>();
  return json({ people: (res.results ?? []).map(card) }, { cache: CACHE.list });
}

const q = (s: string) => `"${s.replace(/"/g, '""')}"`;

function byDocument(hits: ChunkHit[], max: number) {
  const seen = new Map<string, ChunkHit>();
  for (const h of hits) if (!seen.has(h.documentId)) seen.set(h.documentId, h);
  return [...seen.values()]
    .sort((a, b) => String(b.documentDate ?? '').localeCompare(String(a.documentDate ?? '')))
    .slice(0, max)
    .map((h) => ({ documentId: h.documentId, title: h.title, type: h.documentType, date: h.documentDate, page: h.pageStart, excerpt: h.excerpt }));
}

export async function getPerson(env: Env, slug: string): Promise<Response> {
  await ensurePeopleTable(env);
  const row = await env.CATALOG_DB.prepare('SELECT * FROM people WHERE slug = ?').bind(slug).first<Row>();
  if (!row) throw notFound('That person is not in the city directory.');
  const person = card(row);
  const repo = new SearchRepository(env);
  const parts = person.name.split(/\s+/);
  const last = parts[parts.length - 1];
  const [mentions, votes] = repo.available
    ? await Promise.all([
        repo.searchChunks(q(person.name), {}, 60, false, true).catch(() => [] as ChunkHit[]),
        // Minutes record votes by last name ("motion carried 4-0 (Holdaway, Lauret, McCumber, Wood)").
        person.kind === 'elected' || person.kind === 'board'
          ? repo.searchChunks(`${q(last)} AND (${['motion', 'seconded', 'carried', 'aye', 'nay', 'voted'].map(q).join(' OR ')})`, { documentTypes: ['minutes'] }, 80, false, true).catch(() => [] as ChunkHit[])
          : Promise.resolve([] as ChunkHit[]),
      ])
    : [[], []];
  return json({ person, records: byDocument(mentions, 15), votes: byDocument(votes, 15) }, { cache: CACHE.list });
}

export async function getPersonPhoto(env: Env, slug: string): Promise<Response> {
  await ensurePeopleTable(env);
  const row = await env.CATALOG_DB.prepare('SELECT photo_url FROM people WHERE slug = ?').bind(slug).first<{ photo_url: string | null }>();
  const src = row?.photo_url;
  if (!src || !PHOTO_HOST.test(src)) throw notFound('No photo on file.');
  const cache = (caches as unknown as { default: Cache }).default;
  const key = new Request(`https://vineyardportal.org/__photo/${encodeURIComponent(slug)}?u=${encodeURIComponent(src)}`);
  const hit = await cache.match(key).catch(() => undefined);
  if (hit) return hit;
  const r = await fetch(src, { headers: { 'user-agent': 'VineyardTransparencyPortal/1.0 (+https://vineyardportal.org)' } });
  const type = r.headers.get('content-type') ?? '';
  if (!r.ok || !type.startsWith('image/')) throw notFound('Photo unavailable.');
  const res = new Response(r.body, { headers: { 'content-type': type, 'cache-control': 'public, max-age=86400', 'x-content-type-options': 'nosniff' } });
  await cache.put(key, res.clone()).catch(() => undefined);
  return res;
}
