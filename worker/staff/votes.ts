/**
 * Votes for the staff portal: see the motions read from each meeting's minutes, correct one (its wording,
 * who moved and seconded, how it ended, how each member voted), add one the minutes do not have yet, or take
 * one down. The public pages, member totals and chat answers all read the same two tables
 * (motions, motion_votes), so a correction shows everywhere at once.
 *
 * A motion staff touch is marked manual. The minutes reader (worker/api/votes.ts) leaves manual motions alone
 * and does not read a removed one back in (worker/lib/voteFix.ts), so a correction is not overwritten the next
 * time the minutes are read. Votes entered before any minutes exist give way to the minutes once they are read.
 */
import type { Env } from '../env';
import { badRequest, json, notFound } from '../lib/http';
import { plainLine, plainText } from '../lib/contrib';
import { isIsoDate } from '../lib/util';
import { motionFingerprint } from '../lib/voteFix';
import { PC, SCOPE_BODIES, currentCouncil, ensureVotesTables } from '../api/votes';
import { auditStatement, published, requireArea, type StaffUser } from './core';
import type { StaffCall } from './modules';
import { registerUndo } from './undo';

const VOTE_VALUES = ['yes', 'no', 'abstain', 'recused', 'absent'] as const;
type VoteValue = (typeof VOTE_VALUES)[number];
const RESULTS = ['carried', 'failed', 'unknown'];

interface Vote {
  member: string;
  vote: VoteValue;
}

type Row = Record<string, string | number | null>;

/** A motion as it was, for undo: its row, its roll call, and the removal marker if one was written. */
interface Snapshot {
  row: Row;
  votes: Vote[];
  tombstone: string | null;
}

const randomHex = (bytes: number) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
const TITLES = /^(?:mayor|mayor pro tem|councilmember|council member|councilman|councilwoman|commissioner|board member|chair|vice chair)\s+/i;

async function motionRow(env: Env, id: unknown): Promise<Row> {
  await ensureVotesTables(env);
  const row = await env.CATALOG_DB.prepare('SELECT * FROM motions WHERE id = ?')
    .bind(String(id ?? '').slice(0, 80))
    .first<Row>();
  if (!row) throw notFound('That vote was not found.');
  return row;
}

async function votesOf(env: Env, id: string): Promise<Vote[]> {
  const r = await env.CATALOG_DB.prepare('SELECT member, vote FROM motion_votes WHERE motion_id = ? ORDER BY member').bind(id).all<Vote>();
  return r.results ?? [];
}

async function snapshot(env: Env, id: string, tombstone: string | null = null): Promise<Snapshot> {
  return {
    row: await motionRow(env, id),
    votes: await votesOf(env, id),
    tombstone,
  };
}

const label = (row: Row) => {
  const text = String(row.item ?? row.motion ?? 'a motion').replace(/^\d+(?:\.\d+)*\.?\s+/, '');
  return `${text.length > 70 ? `${text.slice(0, 67)}...` : text} (${String(row.meeting_date ?? '').slice(0, 10)})`;
};

function readVotes(v: unknown): Vote[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > 30) throw badRequest('The votes list is not valid.');
  const seen = new Set<string>();
  const out: Vote[] = [];
  for (const x of v) {
    const member = plainLine((x as { member?: unknown })?.member, 80);
    const vote = (x as { vote?: unknown })?.vote;
    if (!member || !(VOTE_VALUES as readonly unknown[]).includes(vote)) throw badRequest('Each vote needs a name and Yes, No, Abstain, Recused or Absent.');
    if (seen.has(member.toLowerCase())) continue;
    seen.add(member.toLowerCase());
    out.push({ member, vote: vote as VoteValue });
  }
  return out;
}

interface Fields {
  item: string | null;
  motion: string;
  mover: string | null;
  seconder: string | null;
  result: string;
  votes: Vote[];
  yes: number;
  no: number;
}

function readFields(b: Record<string, unknown>): Fields {
  const motion = plainText(b.motion, 2000).replace(/\s+/g, ' ').trim();
  if (!motion) throw badRequest('Write what the motion was.');
  const result = String(b.result ?? '');
  if (!RESULTS.includes(result)) throw badRequest('Choose Carried or Failed.');
  const votes = readVotes(b.votes);
  const yes = votes.filter((x) => x.vote === 'yes').length;
  const no = votes.filter((x) => x.vote === 'no').length;
  if (votes.length && result === 'carried' && yes < no) throw badRequest('The votes show more No than Yes, so this cannot be marked Carried. Check the votes.');
  if (votes.length && result === 'failed' && yes > no) throw badRequest('The votes show more Yes than No, so this cannot be marked Failed. Check the votes.');
  return {
    item: plainLine(b.item, 300) || null,
    motion,
    mover: plainLine(b.mover, 80) || null,
    seconder: plainLine(b.seconder, 80) || null,
    result,
    votes,
    yes,
    no,
  };
}

const voteStatements = (env: Env, id: string, date: string | null, body: string | null, votes: Vote[]) => [
  env.CATALOG_DB.prepare('DELETE FROM motion_votes WHERE motion_id = ?').bind(id),
  ...votes.map((v) => env.CATALOG_DB.prepare('INSERT OR REPLACE INTO motion_votes (motion_id, member, vote, meeting_date, body_id) VALUES (?, ?, ?, ?, ?)').bind(id, v.member, v.vote, date, body)),
];

/** Puts a motion back exactly as a snapshot has it (undo), and lifts its removal marker. */
async function restore(env: Env, snap: Snapshot): Promise<void> {
  const row = snap.row;
  const cols = Object.keys(row).filter((k) => /^[a-z_]+$/.test(k));
  const id = String(row.id);
  await env.CATALOG_DB.batch([
    env.CATALOG_DB.prepare('DELETE FROM motion_votes WHERE motion_id = ?').bind(id),
    env.CATALOG_DB.prepare('DELETE FROM motions WHERE id = ?').bind(id),
    env.CATALOG_DB.prepare(`INSERT INTO motions (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).bind(...cols.map((c) => row[c] ?? null)),
    ...voteStatements(env, id, (row.meeting_date as string | null) ?? null, (row.body_id as string | null) ?? null, snap.votes),
    ...(snap.tombstone ? [env.CATALOG_DB.prepare('DELETE FROM vote_tombstones WHERE fp = ?').bind(snap.tombstone)] : []),
  ]);
}

/** Names for the boards votes are kept for, used when the city's meeting list has not named them. */
const KNOWN_BODIES: Record<string, string> = {
  'city-council': 'City Council',
  'redevelopment-agency': 'Redevelopment Agency',
  [PC]: 'Planning Commission',
};
const humanize = (id: string) => id.replace(/-/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** Every board that can have a vote: the city's listed bodies, plus any that already have votes, plus the three that always do. */
async function bodies(env: Env): Promise<Array<{ id: string; name: string }>> {
  const db = env.CATALOG_DB;
  const [listed, used] = await Promise.all([
    db
      .prepare("SELECT id, name FROM government_bodies WHERE id NOT IN ('general', 'public-notices') ORDER BY name")
      .all<{ id: string; name: string }>()
      .catch(() => ({ results: [] as Array<{ id: string; name: string }> })),
    db
      .prepare('SELECT DISTINCT body_id AS id FROM motions WHERE body_id IS NOT NULL')
      .all<{ id: string }>()
      .catch(() => ({ results: [] as Array<{ id: string }> })),
  ]);
  const out = new Map<string, string>();
  for (const b of listed.results ?? []) out.set(b.id, b.name.replace(/^Vineyard /, ''));
  for (const id of [...Object.keys(KNOWN_BODIES), ...(used.results ?? []).map((b) => b.id)]) if (!out.has(id)) out.set(id, KNOWN_BODIES[id] ?? humanize(id));
  return [...out].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

async function meetings(env: Env): Promise<Record<string, unknown>> {
  const r = await env.CATALOG_DB.prepare(
    `SELECT meeting_date AS date, body_id AS body, count(*) AS motions, sum(manual) AS edited
     FROM motions WHERE meeting_date IS NOT NULL GROUP BY 1, 2 ORDER BY 1 DESC, 2 LIMIT 120`,
  ).all<Record<string, unknown>>();
  return {
    meetings: (r.results ?? []).map((m) => ({
      ...m,
      date: String(m.date).slice(0, 10),
      motions: Number(m.motions),
      edited: Number(m.edited ?? 0),
    })),
    bodies: await bodies(env),
  };
}

async function search(env: Env, q: string): Promise<Record<string, unknown>> {
  const words = q
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 2)
    .slice(0, 5);
  if (!words.length) return { matches: [] };
  const where = words.map(() => "(lower(motion) LIKE ? OR lower(coalesce(item, '')) LIKE ?)").join(' AND ');
  const params = words.flatMap((w) => [`%${w.replace(/[%_\\]/g, '')}%`, `%${w.replace(/[%_\\]/g, '')}%`]);
  const r = await env.CATALOG_DB.prepare(
    `SELECT id, meeting_date AS date, body_id AS body, item, motion, manual FROM motions WHERE meeting_date IS NOT NULL AND ${where} ORDER BY meeting_date DESC LIMIT 40`,
  )
    .bind(...params)
    .all<Record<string, unknown>>();
  return {
    matches: (r.results ?? []).map((m) => ({
      ...m,
      date: String(m.date).slice(0, 10),
      manual: Number(m.manual) === 1,
    })),
  };
}

/** The names that can be picked for a meeting: everyone on its record, plus the sitting council for council bodies. */
async function rosterFor(env: Env, body: string, date: string, extra: string[]): Promise<string[]> {
  const db = env.CATALOG_DB;
  const [voted, present, listed] = await Promise.all([
    db.prepare('SELECT DISTINCT member AS n FROM motion_votes WHERE body_id = ? AND meeting_date = ?').bind(body, date).all<{ n: string }>(),
    db.prepare('SELECT DISTINCT member AS n FROM meeting_attendance WHERE body_id = ? AND meeting_date = ?').bind(body, date).all<{ n: string }>(),
    db.prepare('SELECT DISTINCT name AS n FROM meeting_roster WHERE body_id = ? AND meeting_date = ?').bind(body, date).all<{ n: string }>(),
  ]);
  const names = new Set<string>();
  for (const r of [...(voted.results ?? []), ...(present.results ?? []), ...(listed.results ?? [])]) if (r.n) names.add(r.n.replace(TITLES, '').trim());
  for (const n of extra) if (n) names.add(n.replace(TITLES, '').trim());
  if (SCOPE_BODIES.includes(body)) for (const n of await currentCouncil(env)) names.add(n);
  const all = [...names].filter(Boolean);
  // A last name alone is dropped when the full name is there.
  const lastOf = (n: string) => (n.split(' ').pop() ?? n).toLowerCase();
  const fullLasts = new Set(all.filter((n) => n.includes(' ')).map(lastOf));
  return all.filter((n) => n.includes(' ') || !fullLasts.has(lastOf(n))).sort((a, b) => lastOf(a).localeCompare(lastOf(b)) || a.localeCompare(b));
}

async function meetingMotions(env: Env, date: string, body: string): Promise<Record<string, unknown>> {
  await ensureVotesTables(env);
  const db = env.CATALOG_DB;
  const rows = await db.prepare('SELECT * FROM motions WHERE meeting_date = ? AND body_id = ? ORDER BY seq').bind(date, body).all<Row>();
  const votes = await db
    .prepare('SELECT motion_id, member, vote FROM motion_votes WHERE motion_id IN (SELECT id FROM motions WHERE meeting_date = ? AND body_id = ?) ORDER BY member')
    .bind(date, body)
    .all<{ motion_id: string; member: string; vote: string }>();
  const by = new Map<string, Vote[]>();
  for (const v of votes.results ?? [])
    (by.get(v.motion_id) ?? by.set(v.motion_id, []).get(v.motion_id)!).push({
      member: v.member,
      vote: v.vote as VoteValue,
    });
  const list = (rows.results ?? []).map((r) => ({
    id: String(r.id),
    item: (r.item as string | null) ?? null,
    motion: String(r.motion ?? ''),
    mover: (r.mover as string | null) ?? null,
    seconder: (r.seconder as string | null) ?? null,
    result: String(r.result ?? 'unknown'),
    tally: (r.tally as string | null) ?? null,
    inferred: Number(r.inferred) === 1,
    manual: Number(r.manual) === 1,
    documentId: String(r.document_id ?? ''),
    page: r.page == null ? null : Number(r.page),
    votes: by.get(String(r.id)) ?? [],
  }));
  const extra = list.flatMap((m) => [m.mover, m.seconder].filter((x): x is string => Boolean(x)));
  const name = (await bodies(env)).find((b) => b.id === body)?.name ?? body;
  return {
    date,
    body,
    bodyName: name,
    motions: list,
    roster: await rosterFor(env, body, date, extra),
  };
}

async function save(env: Env, me: StaffUser, b: Record<string, unknown>): Promise<Record<string, unknown>> {
  const before = await snapshot(env, String(b.id ?? ''));
  const f = readFields(b);
  const id = String(before.row.id);
  const date = (before.row.meeting_date as string | null) ?? null;
  const body = (before.row.body_id as string | null) ?? null;
  const fp = (before.row.fp as string | null) ?? motionFingerprint(body, date, String(before.row.motion ?? ''));
  const tally = f.votes.length ? `${f.yes}-${f.no}` : ((before.row.tally as string | null) ?? null);
  const unanimous = f.votes.length ? Number(f.no === 0 && f.yes > 0) : Number(before.row.unanimous ?? 0);
  const inferred = f.votes.length ? 0 : Number(before.row.inferred ?? 0);
  const after = {
    ...before.row,
    item: f.item,
    motion: f.motion,
    mover: f.mover,
    seconder: f.seconder,
    result: f.result,
    tally,
    unanimous,
    inferred,
    manual: 1,
    fp,
  };
  await env.CATALOG_DB.batch([
    env.CATALOG_DB.prepare('UPDATE motions SET item = ?, motion = ?, mover = ?, seconder = ?, result = ?, tally = ?, unanimous = ?, inferred = ?, manual = 1, fp = ? WHERE id = ?').bind(
      f.item,
      f.motion,
      f.mover,
      f.seconder,
      f.result,
      tally,
      unanimous,
      inferred,
      fp,
      id,
    ),
    ...voteStatements(env, id, date, body, f.votes),
    auditStatement(env, me, {
      area: 'votes',
      action: 'edited',
      entity: 'vote',
      entityId: id,
      summary: `Corrected the vote on ${label(after)}`,
      before,
      after: { row: after, votes: f.votes, tombstone: null },
    }),
  ]);
  await published(env);
  return { ok: true, id };
}

async function add(env: Env, me: StaffUser, b: Record<string, unknown>): Promise<Record<string, unknown>> {
  await ensureVotesTables(env);
  const date = typeof b.date === 'string' && isIsoDate(b.date.trim()) ? b.date.trim() : null;
  if (!date) throw badRequest('Choose the meeting date.');
  const body = String(b.body ?? '');
  if (!(await bodies(env)).some((x) => x.id === body)) throw badRequest('Choose the board or council.');
  const f = readFields(b);
  const db = env.CATALOG_DB;
  // Tied to the minutes file when the meeting has one (so the vote links to it), otherwise to nothing until the minutes are read.
  const doc = await db
    .prepare('SELECT document_id FROM vote_docs WHERE body_id = ? AND meeting_date = ? AND motions > 0 ORDER BY rank DESC, motions DESC LIMIT 1')
    .bind(body, date)
    .first<{ document_id: string }>();
  const meeting = await db.prepare('SELECT id FROM meetings WHERE government_body_id = ? AND substr(meeting_date, 1, 10) = ? LIMIT 1').bind(body, date).first<{ id: string }>();
  const next = await db.prepare('SELECT coalesce(max(seq), 0) + 1 AS n FROM motions WHERE body_id = ? AND meeting_date = ?').bind(body, date).first<{ n: number }>();
  const id = `man_${randomHex(8)}`;
  const tally = f.votes.length ? `${f.yes}-${f.no}` : null;
  const row: Row = {
    id,
    document_id: doc?.document_id ?? '',
    meeting_id: meeting?.id ?? null,
    body_id: body,
    meeting_date: date,
    seq: Number(next?.n ?? 1),
    item: f.item,
    motion: f.motion,
    mover: f.mover,
    seconder: f.seconder,
    result: f.result,
    tally,
    tie_break: 0,
    unanimous: f.votes.length ? Number(f.no === 0 && f.yes > 0) : 0,
    inferred: 0,
    refs: null,
    page: null,
    items: null,
    manual: 1,
    fp: motionFingerprint(body, date, f.motion),
  };
  const cols = Object.keys(row);
  await db.batch([
    db.prepare(`INSERT INTO motions (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).bind(...cols.map((c) => row[c])),
    ...voteStatements(env, id, date, body, f.votes),
    auditStatement(env, me, {
      area: 'votes',
      action: 'added',
      entity: 'vote',
      entityId: id,
      summary: `Added a vote: ${label(row)}`,
      after: { row, votes: f.votes, tombstone: null },
    }),
  ]);
  await published(env);
  return { ok: true, id, date, body };
}

async function remove(env: Env, me: StaffUser, b: Record<string, unknown>): Promise<Record<string, unknown>> {
  const row = await motionRow(env, b.id);
  const id = String(row.id);
  // A motion read from the minutes is remembered as removed so the next reading does not bring it back; one staff typed in simply goes.
  const fp = id.startsWith('man_') ? null : ((row.fp as string | null) ?? motionFingerprint(row.body_id as string | null, row.meeting_date as string | null, String(row.motion ?? '')));
  const before = await snapshot(env, id, fp);
  await env.CATALOG_DB.batch([
    env.CATALOG_DB.prepare('DELETE FROM motion_votes WHERE motion_id = ?').bind(id),
    env.CATALOG_DB.prepare('DELETE FROM motions WHERE id = ?').bind(id),
    ...(fp
      ? [
          env.CATALOG_DB.prepare('INSERT OR REPLACE INTO vote_tombstones (fp, body_id, meeting_date, removed_at) VALUES (?, ?, ?, ?)').bind(
            fp,
            row.body_id ?? null,
            row.meeting_date ?? null,
            new Date().toISOString(),
          ),
        ]
      : []),
    auditStatement(env, me, {
      area: 'votes',
      action: 'removed',
      entity: 'vote',
      entityId: id,
      summary: `Removed the vote on ${label(row)}`,
      before,
    }),
  ]);
  await published(env);
  return { ok: true };
}

export async function votes(call: StaffCall): Promise<Response | null> {
  const { env, request, url, me, route, body } = call;
  if (!route.startsWith('/votes/')) return null;
  requireArea(me, 'votes');

  if (request.method === 'GET') {
    if (route === '/votes/meetings') {
      const q = (url.searchParams.get('q') ?? '').trim();
      await ensureVotesTables(env);
      return json(q ? await search(env, q) : await meetings(env));
    }
    if (route === '/votes/motions' || route === '/votes/roster') {
      const date = url.searchParams.get('date') ?? '';
      const bodyId = url.searchParams.get('body') ?? '';
      if (!isIsoDate(date) || !/^[a-z0-9-]{2,80}$/.test(bodyId)) throw badRequest('Choose a meeting.');
      return json(route === '/votes/motions' ? await meetingMotions(env, date, bodyId) : { roster: await rosterFor(env, bodyId, date, []) });
    }
    return null;
  }

  const b = body ?? {};
  if (route === '/votes/save') return json(await save(env, me, b));
  if (route === '/votes/add') return json(await add(env, me, b), { status: 201 });
  if (route === '/votes/remove') return json(await remove(env, me, b));
  return null;
}

// Undo: an add is taken down, a change or removal is put back as it was.
registerUndo('vote', async (env, user, entry) => {
  void user;
  const id = entry.entity_id ?? '';
  if (entry.action === 'added') {
    const row = await motionRow(env, id);
    await env.CATALOG_DB.batch([env.CATALOG_DB.prepare('DELETE FROM motion_votes WHERE motion_id = ?').bind(id), env.CATALOG_DB.prepare('DELETE FROM motions WHERE id = ?').bind(id)]);
    return `Took down the added vote on ${label(row)}`;
  }
  if (entry.action === 'edited' || entry.action === 'removed') {
    const snap = entry.before_json ? (JSON.parse(entry.before_json) as Snapshot) : null;
    if (!snap?.row) throw badRequest('The earlier version was not kept.');
    await ensureVotesTables(env);
    await restore(env, snap);
    return `Put back the vote on ${label(snap.row)}`;
  }
  throw badRequest('This change cannot be undone automatically.');
});
