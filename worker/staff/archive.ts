/**
 * Corrections to the city's own records and meetings, not only what staff uploaded. Staff can fix a record's title, type,
 * date or meeting, hide a duplicate or misfiled record (and put it back), and mark a meeting canceled or moved, change its
 * time or place, or add a video link.
 *
 * A correction is written into the record's own row (so every page, search and answer shows it) and locked in manual_json,
 * which every automated read checks (worker/lib/manual.ts). A hidden record is moved whole into document_holds and its link
 * says why it was taken out; the automated reads never file it again. Every change is in Activity and can be undone.
 */
import type { Env } from '../env';
import { badRequest, json, notFound } from '../lib/http';
import { plainLine } from '../lib/contrib';
import { ensureManual } from '../lib/manual';
import { ensureRedirects, redirectStatement } from '../lib/redirects';
import { DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS, categoriesForType, normalizeType } from '../lib/taxonomy';
import { SearchRepository } from '../search/SearchRepository';
import { auditStatement, published, requireArea, type StaffUser } from './core';
import type { StaffCall } from './modules';
import { registerUndo } from './undo';

type Row = Record<string, unknown>;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const POINTER: Record<string, string> = { agenda: 'agenda_document_id', agenda_packet: 'packet_document_id', minutes: 'minutes_document_id' };

const manualOf = (row: Row): Record<string, unknown> => {
  try {
    const m = typeof row.manual_json === 'string' ? JSON.parse(row.manual_json) : null;
    return m && typeof m === 'object' && !Array.isArray(m) ? (m as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

async function docRow(env: Env, id: unknown): Promise<Row> {
  const row = await env.CATALOG_DB.prepare('SELECT * FROM documents WHERE id = ?')
    .bind(String(id ?? '').slice(0, 40))
    .first<Row>();
  if (!row) throw notFound('That record is not in the archive. It may have been hidden already.');
  return row;
}

/** The parts of a record staff can correct, as stored. */
interface Fix {
  title: string;
  document_type: string;
  document_date: string | null;
  meeting_id: string | null;
  manual_json: string | null;
}
const fixOf = (r: Row): Fix => ({
  title: String(r.title),
  document_type: String(r.document_type),
  document_date: (r.document_date as string | null) ?? null,
  meeting_id: (r.meeting_id as string | null) ?? null,
  manual_json: (r.manual_json as string | null) ?? null,
});

/** Writes a record's corrected fields to the catalog, the meeting links and the search copy. Returns rows written. */
async function applyFix(env: Env, row: Row, next: Fix): Promise<D1PreparedStatement[]> {
  const db = env.CATALOG_DB;
  const id = String(row.id);
  const year = next.document_date ? Number(next.document_date.slice(0, 4)) : null;
  const cats = JSON.stringify(categoriesForType(normalizeType(next.document_type)));
  const stmts: D1PreparedStatement[] = [
    db
      .prepare('UPDATE documents SET title = ?, document_type = ?, categories_json = ?, document_date = ?, year = ?, meeting_id = ?, manual_json = ?, updated_at = ? WHERE id = ?')
      .bind(next.title, next.document_type, cats, next.document_date, year, next.meeting_id, next.manual_json, new Date().toISOString(), id),
  ];
  // An agenda, packet or minutes moved to another meeting takes that meeting's link with it.
  if (next.meeting_id !== row.meeting_id || next.document_type !== row.document_type) {
    for (const col of Object.values(POINTER)) stmts.push(db.prepare(`UPDATE meetings SET ${col} = NULL WHERE ${col} = ?`).bind(id));
    const col = POINTER[next.document_type];
    if (col && next.meeting_id) stmts.push(db.prepare(`UPDATE meetings SET ${col} = ? WHERE id = ? AND ${col} IS NULL`).bind(id, next.meeting_id));
  }
  const shard = row.search_shard == null ? null : Number(row.search_shard);
  const repo = new SearchRepository(env);
  if (shard != null && repo.activeShards.includes(shard)) {
    const s = repo.shard(shard);
    const writes: D1PreparedStatement[] = [
      s
        .prepare('UPDATE shard_documents SET title = ?, document_type = ?, document_date = ?, year = ?, meeting_id = ?, categories_json = ? WHERE document_id = ?')
        .bind(next.title, next.document_type, next.document_date, year, next.meeting_id, cats, id),
    ];
    // Searching by the new title finds it: the title copy on each passage is rewritten, for records of a reasonable size.
    if (next.title !== row.title && Number(row.chunk_count ?? 0) <= 300) {
      writes.push(
        s.prepare("INSERT INTO chunks_fts(chunks_fts, rowid, doc_title, section_title, text) SELECT 'delete', rowid, doc_title, section_title, text FROM chunks WHERE document_id = ?").bind(id),
        s.prepare('UPDATE chunks SET doc_title = ? WHERE document_id = ?').bind(next.title, id),
        s.prepare('INSERT INTO chunks_fts(rowid, doc_title, section_title, text) SELECT rowid, doc_title, section_title, text FROM chunks WHERE document_id = ?').bind(id),
      );
    }
    await s.batch(writes);
  }
  return stmts;
}

async function meetingExists(env: Env, id: string): Promise<boolean> {
  return Boolean(await env.CATALOG_DB.prepare('SELECT 1 FROM meetings WHERE id = ?').bind(id).first());
}

async function fixRecord(env: Env, me: StaffUser, b: Row): Promise<Response> {
  const row = await docRow(env, b.id);
  const before = fixOf(row);
  const manual = manualOf(row);
  const next: Fix = { ...before };
  if (b.title !== undefined) {
    const t = plainLine(b.title, 300);
    if (!t) throw badRequest('Give the record a title.');
    if (/<\s*[a-zA-Z/!?]/.test(t)) throw badRequest('Type the title as plain words.');
    next.title = t;
    manual.title = true;
  }
  if (b.type !== undefined) {
    const t = DOCUMENT_TYPES.find((x) => x === b.type);
    if (!t) throw badRequest('Choose a record type from the list.');
    next.document_type = t;
    manual.document_type = true;
  }
  if (b.date !== undefined) {
    const d = typeof b.date === 'string' ? b.date.trim() : '';
    if (d && !ISO.test(d)) throw badRequest('Use a date like 2026-10-12.');
    next.document_date = d || null;
    manual.document_date = true;
  }
  if (b.meetingId !== undefined) {
    const m = typeof b.meetingId === 'string' ? b.meetingId.trim() : '';
    if (m && !(await meetingExists(env, m))) throw badRequest('That meeting is not in the archive.');
    next.meeting_id = m || null;
    manual.meeting_id = true;
  }
  next.manual_json = Object.keys(manual).length ? JSON.stringify(manual) : null;
  if (JSON.stringify(next) === JSON.stringify(before)) return json({ ok: true, unchanged: true });
  const stmts = await applyFix(env, row, next);
  stmts.push(auditStatement(env, me, { area: 'records', action: 'edited', entity: 'archive-fix', entityId: String(row.id), summary: `Corrected the record "${next.title}"`, before, after: next }));
  await env.CATALOG_DB.batch(stmts);
  await published(env);
  return json({ ok: true });
}

registerUndo('archive-fix', async (env, user, entry) => {
  await ensureManual(env);
  const before = JSON.parse(String(entry.before_json)) as Fix;
  const row = await docRow(env, entry.entity_id);
  const stmts = await applyFix(env, row, before);
  stmts.push(
    auditStatement(env, user, {
      area: 'records',
      action: 'undone',
      entity: 'archive-fix-undo',
      entityId: String(row.id),
      summary: `Undid the correction to "${before.title}"`,
      before: fixOf(row),
      after: before,
    }),
  );
  await env.CATALOG_DB.batch(stmts);
  await published(env);
  return `Put back "${before.title}" as it was.`;
});

async function hide(env: Env, me: StaffUser, b: Row): Promise<Response> {
  await ensureRedirects(env);
  const row = await docRow(env, b.id);
  const reason = plainLine(b.reason, 160) || 'City staff took it out of the archive.';
  const keep = typeof b.keepId === 'string' && b.keepId ? b.keepId : null;
  if (keep) {
    if (keep === row.id) throw badRequest('Choose a different record to keep.');
    await docRow(env, keep);
  }
  const id = String(row.id);
  const db = env.CATALOG_DB;
  const shard = row.search_shard == null ? null : Number(row.search_shard);
  const repo = new SearchRepository(env);
  const live = shard != null && repo.activeShards.includes(shard);
  const shardRow = live ? await repo.shard(shard!).prepare('SELECT * FROM shard_documents WHERE document_id = ?').bind(id).first<Row>() : null;
  const refs: Array<{ id: string; col: string }> = [];
  for (const col of Object.values(POINTER)) {
    const r = await db.prepare(`SELECT id FROM meetings WHERE ${col} = ?`).bind(id).all<{ id: string }>();
    for (const m of r.results ?? []) refs.push({ id: m.id, col });
  }
  await db.batch([
    db
      .prepare('INSERT OR REPLACE INTO document_holds (document_id, sha256, reason, row_json, shard, shard_row_json, meeting_refs_json, held_by, held_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, (row.sha256 as string | null) ?? null, reason, JSON.stringify(row), shard, shardRow ? JSON.stringify(shardRow) : null, JSON.stringify(refs), me.id, new Date().toISOString()),
    ...refs.map((r) => db.prepare(`UPDATE meetings SET ${r.col} = NULL WHERE id = ? AND ${r.col} = ?`).bind(r.id, id)),
    db.prepare('DELETE FROM documents WHERE id = ?').bind(id),
    redirectStatement(env, id, keep, keep ? `It was a second copy. ${reason}` : reason),
    auditStatement(env, me, {
      area: 'records',
      action: 'removed',
      entity: 'archive-hide',
      entityId: id,
      summary: `Hid the record "${String(row.title)}"`,
      before: { title: row.title },
      after: { reason, keep },
    }),
  ]);
  // The passages stay in the search copy but nothing finds them without their record, so putting it back needs no re-reading.
  if (live) await repo.shard(shard!).prepare('DELETE FROM shard_documents WHERE document_id = ?').bind(id).run();
  await published(env);
  return json({ ok: true });
}

async function unhide(env: Env, me: StaffUser | null, id: string): Promise<string> {
  const db = env.CATALOG_DB;
  const h = await db.prepare('SELECT * FROM document_holds WHERE document_id = ?').bind(id.slice(0, 40)).first<Row>();
  if (!h) throw notFound('That record is not hidden.');
  const row = JSON.parse(String(h.row_json)) as Row;
  const cols = Object.keys(row).filter((k) => /^[a-z_]+$/.test(k));
  const refs = JSON.parse(String(h.meeting_refs_json ?? '[]')) as Array<{ id: string; col: string }>;
  const stmts: D1PreparedStatement[] = [
    db.prepare(`INSERT OR REPLACE INTO documents (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).bind(...cols.map((k) => row[k] as never)),
    ...refs.filter((r) => Object.values(POINTER).includes(r.col)).map((r) => db.prepare(`UPDATE meetings SET ${r.col} = ? WHERE id = ? AND ${r.col} IS NULL`).bind(id, r.id)),
    db.prepare('DELETE FROM document_redirects WHERE old_id = ?').bind(id),
    db.prepare('DELETE FROM document_holds WHERE document_id = ?').bind(id),
  ];
  if (me) stmts.push(auditStatement(env, me, { area: 'records', action: 'restored', entity: 'archive-unhide', entityId: id, summary: `Put back the record "${String(row.title)}"` }));
  await db.batch(stmts);
  const shard = h.shard == null ? null : Number(h.shard);
  const repo = new SearchRepository(env);
  if (shard != null && repo.activeShards.includes(shard) && h.shard_row_json) {
    const s = JSON.parse(String(h.shard_row_json)) as Row;
    const sc = Object.keys(s).filter((k) => /^[a-z_]+$/.test(k));
    await repo
      .shard(shard)
      .prepare(`INSERT OR REPLACE INTO shard_documents (${sc.join(', ')}) VALUES (${sc.map(() => '?').join(', ')})`)
      .bind(...sc.map((k) => s[k] as never))
      .run();
  }
  await published(env);
  return String(row.title);
}

registerUndo('archive-hide', async (env, user, entry) => {
  await ensureManual(env);
  const title = await unhide(env, null, String(entry.entity_id));
  await env.CATALOG_DB.batch([
    auditStatement(env, user, { area: 'records', action: 'undone', entity: 'archive-unhide', entityId: String(entry.entity_id), summary: `Put back the record "${title}"` }),
  ]);
  return `"${title}" is back in the archive.`;
});

// ---- meetings

interface MeetingFix {
  status: string;
  meeting_date: string;
  start_time: string | null;
  location: string | null;
  manual_json: string | null;
}
const meetingFixOf = (r: Row): MeetingFix => ({
  status: String(r.status),
  meeting_date: String(r.meeting_date),
  start_time: (r.start_time as string | null) ?? null,
  location: (r.location as string | null) ?? null,
  manual_json: (r.manual_json as string | null) ?? null,
});

async function meetingRow(env: Env, id: unknown): Promise<Row> {
  const row = await env.CATALOG_DB.prepare('SELECT * FROM meetings WHERE id = ?')
    .bind(String(id ?? '').slice(0, 128))
    .first<Row>();
  if (!row) throw notFound('That meeting is not in the archive.');
  return row;
}

const writeMeeting = (env: Env, id: string, m: MeetingFix) =>
  env.CATALOG_DB.prepare('UPDATE meetings SET status = ?, meeting_date = ?, start_time = ?, location = ?, manual_json = ?, updated_at = ? WHERE id = ?').bind(
    m.status,
    m.meeting_date,
    m.start_time,
    m.location,
    m.manual_json,
    new Date().toISOString(),
    id,
  );

async function fixMeeting(env: Env, me: StaffUser, b: Row): Promise<Response> {
  const row = await meetingRow(env, b.id);
  const before = meetingFixOf(row);
  const manual = manualOf(row);
  const next: MeetingFix = { ...before };
  const changes: string[] = [];
  if (b.status !== undefined) {
    if (b.status !== 'cancelled' && b.status !== 'scheduled') throw badRequest('Choose canceled or scheduled.');
    next.status = b.status;
    manual.status = true;
    changes.push(b.status === 'cancelled' ? 'marked it canceled' : 'marked it as happening');
  }
  if (b.date !== undefined) {
    const d = typeof b.date === 'string' ? b.date.trim() : '';
    if (!ISO.test(d)) throw badRequest('Choose the new date.');
    if (d !== before.meeting_date) {
      manual.original_date ??= before.meeting_date;
      next.meeting_date = d;
      manual.meeting_date = true;
      changes.push(`moved it to ${d}`);
    }
  }
  if (b.startTime !== undefined) {
    const t = typeof b.startTime === 'string' ? b.startTime.trim() : '';
    if (t && !HHMM.test(t)) throw badRequest('Choose the start time.');
    next.start_time = t || null;
    manual.start_time = true;
    changes.push('changed the time');
  }
  if (b.location !== undefined) {
    next.location = plainLine(b.location, 300) || null;
    manual.location = true;
    changes.push('changed the place');
  }
  if (b.video !== undefined) {
    const media = Array.isArray(manual.media) ? (manual.media as Array<Record<string, unknown>>) : [];
    if (b.video === null || b.video === '') {
      delete manual.media;
      changes.push('removed the video link');
    } else {
      const url = typeof b.video === 'string' ? b.video.trim() : '';
      let ok: boolean;
      try {
        const u = new URL(url);
        ok = u.protocol === 'https:' && !u.username && !u.password;
      } catch {
        ok = false;
      }
      if (!ok) throw badRequest('Paste the full video address, starting with https://.');
      manual.media = [{ kind: 'video', label: 'Meeting video', url, sourceId: 'staff' }, ...media.filter((m) => m.url !== url)].slice(0, 3);
      changes.push('added a video link');
    }
  }
  if (Array.isArray(b.unlock)) for (const k of b.unlock) if (typeof k === 'string') delete manual[k];
  next.manual_json = Object.keys(manual).length ? JSON.stringify(manual) : null;
  if (JSON.stringify(next) === JSON.stringify(before)) return json({ ok: true, unchanged: true });
  const title = `${String(row.title)} (${before.meeting_date})`;
  await env.CATALOG_DB.batch([
    writeMeeting(env, String(row.id), next),
    auditStatement(env, me, {
      area: 'records',
      action: 'edited',
      entity: 'meeting-fix',
      entityId: String(row.id),
      summary: `Changed the meeting "${title}": ${changes.join(', ') || 'put back what the city lists'}`,
      before,
      after: next,
    }),
  ]);
  await published(env);
  return json({ ok: true });
}

registerUndo('meeting-fix', async (env, user, entry) => {
  await ensureManual(env);
  const before = JSON.parse(String(entry.before_json)) as MeetingFix;
  const row = await meetingRow(env, entry.entity_id);
  await env.CATALOG_DB.batch([
    writeMeeting(env, String(row.id), before),
    auditStatement(env, user, {
      area: 'records',
      action: 'undone',
      entity: 'meeting-fix-undo',
      entityId: String(row.id),
      summary: `Undid the change to the meeting "${String(row.title)}"`,
      before: meetingFixOf(row),
      after: before,
    }),
  ]);
  await published(env);
  return 'The meeting is back as it was.';
});

// ---- lists for the screen

async function find(env: Env, q: string): Promise<Row> {
  const like = `%${q.replace(/[%_]/g, ' ').trim()}%`;
  const items = q.trim()
    ? await env.CATALOG_DB.prepare(
        `SELECT d.id, d.title, d.document_type, d.document_date, d.meeting_id, d.source_id, d.manual_json, m.title AS meeting_title, m.meeting_date AS meeting_date
         FROM documents d LEFT JOIN meetings m ON m.id = d.meeting_id WHERE d.title LIKE ?1 OR d.document_number LIKE ?1 OR d.id = ?2 ORDER BY d.document_date DESC LIMIT 40`,
      )
        .bind(like, q.trim())
        .all<Row>()
    : { results: [] as Row[] };
  const held = await env.CATALOG_DB.prepare(
    `SELECT document_id AS id, reason, held_at, json_extract(row_json, '$.title') AS title, json_extract(row_json, '$.document_type') AS document_type, json_extract(row_json, '$.document_date') AS document_date
     FROM document_holds WHERE ?1 = '' OR json_extract(row_json, '$.title') LIKE ?2 ORDER BY held_at DESC LIMIT 40`,
  )
    .bind(q.trim(), like)
    .all<Row>();
  return { items: items.results ?? [], hidden: held.results ?? [], types: DOCUMENT_TYPES.map((t) => ({ key: t, label: DOCUMENT_TYPE_LABELS[t] })) };
}

async function meetings(env: Env, q: string): Promise<Row> {
  const like = `%${q.replace(/[%_]/g, ' ').trim()}%`;
  const r = await env.CATALOG_DB.prepare(
    `SELECT id, title, government_body_name, meeting_date, start_time, location, status, manual_json FROM meetings
     WHERE (?1 = '' AND meeting_date >= date('now', '-60 days')) OR (?1 <> '' AND (title LIKE ?2 OR government_body_name LIKE ?2 OR meeting_date = ?1))
     ORDER BY meeting_date DESC LIMIT 80`,
  )
    .bind(q.trim(), like)
    .all<Row>();
  return { items: r.results ?? [] };
}

export async function archive(call: StaffCall): Promise<Response | null> {
  const { env, request, url, me, route, body } = call;
  if (!route.startsWith('/archive/')) return null;
  requireArea(me, 'records');
  await ensureManual(env);
  if (request.method === 'GET') {
    if (route === '/archive/find') return json(await find(env, (url.searchParams.get('q') ?? '').slice(0, 120)));
    if (route === '/archive/meetings') return json(await meetings(env, (url.searchParams.get('q') ?? '').slice(0, 120)));
    return null;
  }
  const b = body ?? {};
  if (route === '/archive/fix') return fixRecord(env, me, b);
  if (route === '/archive/hide') return hide(env, me, b);
  if (route === '/archive/unhide') {
    const title = await unhide(env, me, String(b.id ?? ''));
    return json({ ok: true, title });
  }
  if (route === '/archive/meeting') return fixMeeting(env, me, b);
  return null;
}
