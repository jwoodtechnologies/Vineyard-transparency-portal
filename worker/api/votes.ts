/**
 * Voting records: every motion in the archive's minutes (City Council, Redevelopment Agency,
 * Planning Commission and any other body with minutes), who moved and seconded it, how it ended,
 * and how each member voted, read from the minutes themselves (worker/lib/votes.ts). One copy of
 * each meeting's minutes counts: approved or final minutes replace a draft of the same meeting.
 */
import type { Env } from '../env';
import { SearchRepository } from '../search/SearchRepository';
import { parseMinutes, type ParsedMotion } from '../lib/votes';
import { titleDate } from '../lib/adoptionDate';
import { json } from '../lib/http';

/** Bump to re-read every set of minutes after a parser change. */
export const VOTES_PARSER = 1;

let ready = false;
export async function ensureVotesTables(env: Env): Promise<void> {
  if (ready) return;
  await env.CATALOG_DB.batch(
    [
      `CREATE TABLE IF NOT EXISTS vote_docs (document_id TEXT PRIMARY KEY, meeting_key TEXT, body_id TEXT, meeting_date TEXT, rank INTEGER NOT NULL DEFAULT 0, motions INTEGER NOT NULL DEFAULT 0, parser INTEGER NOT NULL, parsed_at TEXT NOT NULL)`,
      `CREATE INDEX IF NOT EXISTS vote_docs_key ON vote_docs(meeting_key)`,
      `CREATE TABLE IF NOT EXISTS motions (id TEXT PRIMARY KEY, document_id TEXT NOT NULL, meeting_id TEXT, body_id TEXT, meeting_date TEXT, seq INTEGER, item TEXT, motion TEXT, mover TEXT, seconder TEXT, result TEXT, tally TEXT, tie_break INTEGER NOT NULL DEFAULT 0, unanimous INTEGER NOT NULL DEFAULT 0, inferred INTEGER NOT NULL DEFAULT 0, refs TEXT, page INTEGER)`,
      `CREATE INDEX IF NOT EXISTS motions_date ON motions(meeting_date)`,
      `CREATE INDEX IF NOT EXISTS motions_doc ON motions(document_id)`,
      `CREATE TABLE IF NOT EXISTS motion_votes (motion_id TEXT NOT NULL, member TEXT NOT NULL, vote TEXT NOT NULL, meeting_date TEXT, body_id TEXT, PRIMARY KEY (motion_id, member))`,
      `CREATE INDEX IF NOT EXISTS motion_votes_member ON motion_votes(member, meeting_date)`,
      `CREATE TABLE IF NOT EXISTS vote_members (member TEXT PRIMARY KEY, full_name TEXT, first_date TEXT, last_date TEXT)`,
    ].map((q) => env.CATALOG_DB.prepare(q)),
  );
  ready = true;
}

const rankOf = (title: string) => (/\b(approved|final|adopted)\b/i.test(title) ? 3 : /\bdraft\b/i.test(title) ? 1 : 2);
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

type DocRow = { id: string; title: string; document_date: string | null; government_body_id: string | null; meeting_id: string | null; search_shard: number };

/** Reads the next sets of minutes not yet read by this parser, until the time budget runs out. */
export async function processVotes(env: Env, budgetMs = 20_000, max = 400): Promise<{ read: number; motions: number; votes: number; superseded: number; left: number }> {
  await ensureVotesTables(env);
  const db = env.CATALOG_DB;
  const repo = new SearchRepository(env);
  const started = Date.now();
  const out = { read: 0, motions: 0, votes: 0, superseded: 0, left: 0 };
  while (Date.now() - started < budgetMs && out.read < max) {
    const rows = await db
      .prepare(
        `SELECT d.id, d.title, d.document_date, d.government_body_id, d.meeting_id, d.search_shard FROM documents d
         LEFT JOIN vote_docs v ON v.document_id = d.id AND v.parser = ?
         WHERE d.document_type = 'minutes' AND d.search_shard IS NOT NULL AND v.document_id IS NULL
         ORDER BY coalesce(d.document_date, '0000') DESC LIMIT 25`,
      )
      .bind(VOTES_PARSER)
      .all<DocRow>();
    const list = (rows.results ?? []).filter((r) => repo.activeShards.includes(Number(r.search_shard)));
    if (!list.length) break;
    for (const d of list) {
      if (Date.now() - started > budgetMs) break;
      const r = await readOne(env, repo, d).catch(() => null);
      out.read++;
      if (r) {
        out.motions += r.motions;
        out.votes += r.votes;
        if (r.superseded) out.superseded++;
      } else {
        // Unreadable: recorded so it is not retried forever (a parser bump retries it).
        await db.prepare('INSERT OR REPLACE INTO vote_docs (document_id, parser, parsed_at, motions) VALUES (?, ?, ?, 0)').bind(d.id, VOTES_PARSER, new Date().toISOString()).run();
      }
    }
  }
  const left = await db
    .prepare(`SELECT count(*) AS n FROM documents d LEFT JOIN vote_docs v ON v.document_id = d.id AND v.parser = ? WHERE d.document_type = 'minutes' AND d.search_shard IS NOT NULL AND v.document_id IS NULL`)
    .bind(VOTES_PARSER)
    .first<{ n: number }>();
  out.left = Number(left?.n ?? 0);
  return out;
}

async function readOne(env: Env, repo: SearchRepository, d: DocRow): Promise<{ motions: number; votes: number; superseded: boolean }> {
  const db = env.CATALOG_DB;
  const chunks = await repo.documentChunks(Number(d.search_shard), d.id);
  const text = chunks.map((c) => c.text).join('\n\n');
  const now = new Date().toISOString();
  const guessDate = titleDate(d.title) ?? d.document_date;
  const parsed = parseMinutes(text, guessDate);
  const date = parsed.date ?? guessDate;
  const body = parsed.body ?? d.government_body_id ?? 'unknown';
  const key = `${body}|${date ?? d.id}`;
  const rank = rankOf(d.title);
  const motions = parsed.motions;

  // One copy per meeting: approved or final minutes win over drafts; among equals, the fuller one.
  const other = await db
    .prepare('SELECT document_id, rank, motions FROM vote_docs WHERE meeting_key = ? AND document_id != ? AND motions > 0 ORDER BY rank DESC, motions DESC LIMIT 1')
    .bind(key, d.id)
    .first<{ document_id: string; rank: number; motions: number }>();
  if (other && (other.rank > rank || (other.rank === rank && other.motions >= motions.length))) {
    await db.prepare('INSERT OR REPLACE INTO vote_docs (document_id, meeting_key, body_id, meeting_date, rank, motions, parser, parsed_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)').bind(d.id, key, body, date, rank, VOTES_PARSER, now).run();
    return { motions: 0, votes: 0, superseded: true };
  }
  const stmts: D1PreparedStatement[] = [];
  const clear = (docId: string) => {
    stmts.push(db.prepare('DELETE FROM motion_votes WHERE motion_id IN (SELECT id FROM motions WHERE document_id = ?)').bind(docId));
    stmts.push(db.prepare('DELETE FROM motions WHERE document_id = ?').bind(docId));
  };
  clear(d.id);
  if (other) {
    clear(other.document_id);
    stmts.push(db.prepare('UPDATE vote_docs SET motions = 0 WHERE document_id = ?').bind(other.document_id));
  }
  let votes = 0;
  const pageOf = (m: ParsedMotion): number | null => {
    const probe = squash(m.text).slice(0, 40);
    if (probe.length < 8) return null;
    const hit = chunks.find((c) => squash(c.text).includes(probe));
    return hit?.pageStart ?? null;
  };
  for (const m of motions) {
    const id = `${d.id}:${m.seq}`;
    stmts.push(
      db
        .prepare('INSERT INTO motions (id, document_id, meeting_id, body_id, meeting_date, seq, item, motion, mover, seconder, result, tally, tie_break, unanimous, inferred, refs, page) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, d.id, d.meeting_id, body, date, m.seq, m.item, m.text, m.mover, m.seconder, m.result, m.tally, m.tieBreak ? 1 : 0, m.unanimous ? 1 : 0, m.inferred ? 1 : 0, m.refs.length ? JSON.stringify(m.refs) : null, pageOf(m)),
    );
    for (const v of m.votes) {
      stmts.push(db.prepare('INSERT OR REPLACE INTO motion_votes (motion_id, member, vote, meeting_date, body_id) VALUES (?, ?, ?, ?, ?)').bind(id, v.member, v.vote, date, body));
      votes++;
    }
  }
  const members = new Set([...motions.flatMap((m) => m.votes.map((v) => v.member)), ...motions.flatMap((m) => [m.mover, m.seconder].filter((x): x is string => Boolean(x)))]);
  for (const member of members)
    stmts.push(
      db
        .prepare(
          `INSERT INTO vote_members (member, full_name, first_date, last_date) VALUES (?, ?, ?, ?)
           ON CONFLICT(member) DO UPDATE SET full_name = coalesce(excluded.full_name, vote_members.full_name),
             first_date = min(coalesce(vote_members.first_date, excluded.first_date), coalesce(excluded.first_date, vote_members.first_date)),
             last_date = max(coalesce(vote_members.last_date, excluded.last_date), coalesce(excluded.last_date, vote_members.last_date))`,
        )
        .bind(member, parsed.fullNames[member] ?? null, date, date),
    );
  stmts.push(db.prepare('INSERT OR REPLACE INTO vote_docs (document_id, meeting_key, body_id, meeting_date, rank, motions, parser, parsed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(d.id, key, body, date, rank, motions.length, VOTES_PARSER, now));
  for (let i = 0; i < stmts.length; i += 80) await db.batch(stmts.slice(i, i + 80));
  return { motions: motions.length, votes, superseded: false };
}

// ------------------------------------------------------------------------------------------ read API

const BODY_NAMES: Record<string, string> = { 'city-council': 'City Council', 'redevelopment-agency': 'Redevelopment Agency', 'planning-commission': 'Planning Commission' };
const bodyName = (id: string | null) => (id ? (BODY_NAMES[id] ?? id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())) : null);

export interface MotionOut {
  id: string;
  date: string | null;
  bodyId: string | null;
  bodyName: string | null;
  item: string | null;
  motion: string;
  mover: string | null;
  seconder: string | null;
  result: string;
  tally: string | null;
  tieBreak: boolean;
  unanimous: boolean;
  inferred: boolean;
  refs: string[];
  documentId: string;
  page: number | null;
  votes: Array<{ member: string; vote: string }>;
}

/** Motions, newest first, filtered by member, body, year, result and words in the motion. */
export async function queryMotions(env: Env, f: { member?: string | null; body?: string | null; year?: number | null; q?: string | null; result?: string | null; vote?: string | null; page?: number; pageSize?: number }): Promise<{ items: MotionOut[]; total: number }> {
  await ensureVotesTables(env);
  let sql = '1=1';
  const params: unknown[] = [];
  if (f.member && f.vote) {
    sql += ' AND EXISTS (SELECT 1 FROM motion_votes v WHERE v.motion_id = m.id AND v.member = ? AND v.vote = ?)';
    params.push(f.member, f.vote);
  } else if (f.member) {
    sql += ' AND (m.mover = ? OR m.seconder = ? OR EXISTS (SELECT 1 FROM motion_votes v WHERE v.motion_id = m.id AND v.member = ?))';
    params.push(f.member, f.member, f.member);
  }
  if (f.body) {
    sql += ' AND m.body_id = ?';
    params.push(f.body);
  }
  if (f.year) {
    sql += ' AND substr(m.meeting_date, 1, 4) = ?';
    params.push(String(f.year));
  }
  if (f.result) {
    sql += ' AND m.result = ?';
    params.push(f.result);
  }
  for (const w of (f.q ?? '').toLowerCase().split(/\s+/).filter((x) => x.length >= 2).slice(0, 6)) {
    sql += " AND (lower(m.motion) LIKE ? OR lower(coalesce(m.item, '')) LIKE ? OR lower(coalesce(m.refs, '')) LIKE ?)";
    params.push(`%${w}%`, `%${w}%`, `%${w}%`);
  }
  const pageSize = Math.min(100, Math.max(1, f.pageSize ?? 30));
  const page = Math.max(1, f.page ?? 1);
  const [rows, count] = await Promise.all([
    env.CATALOG_DB.prepare(`SELECT m.* FROM motions m WHERE ${sql} ORDER BY m.meeting_date DESC, m.seq ASC LIMIT ? OFFSET ?`)
      .bind(...params, pageSize, (page - 1) * pageSize)
      .all<Record<string, unknown>>(),
    env.CATALOG_DB.prepare(`SELECT count(*) AS n FROM motions m WHERE ${sql}`)
      .bind(...params)
      .first<{ n: number }>(),
  ]);
  const list = rows.results ?? [];
  const votes = list.length
    ? await env.CATALOG_DB.prepare('SELECT motion_id, member, vote FROM motion_votes WHERE motion_id IN (SELECT value FROM json_each(?))')
        .bind(JSON.stringify(list.map((r) => r.id)))
        .all<{ motion_id: string; member: string; vote: string }>()
    : { results: [] };
  const byMotion = new Map<string, Array<{ member: string; vote: string }>>();
  for (const v of votes.results ?? []) (byMotion.get(v.motion_id) ?? byMotion.set(v.motion_id, []).get(v.motion_id)!).push({ member: v.member, vote: v.vote });
  const order = { yes: 0, no: 1, abstain: 2, recused: 3, absent: 4 } as Record<string, number>;
  return {
    total: Number(count?.n ?? 0),
    items: list.map((r) => ({
      id: String(r.id),
      date: (r.meeting_date as string | null) ?? null,
      bodyId: (r.body_id as string | null) ?? null,
      bodyName: bodyName((r.body_id as string | null) ?? null),
      item: (r.item as string | null) ?? null,
      motion: String(r.motion ?? ''),
      mover: (r.mover as string | null) ?? null,
      seconder: (r.seconder as string | null) ?? null,
      result: String(r.result ?? 'unknown'),
      tally: (r.tally as string | null) ?? null,
      tieBreak: Number(r.tie_break) === 1,
      unanimous: Number(r.unanimous) === 1,
      inferred: Number(r.inferred) === 1,
      refs: r.refs ? (JSON.parse(String(r.refs)) as string[]) : [],
      documentId: String(r.document_id),
      page: r.page == null ? null : Number(r.page),
      votes: (byMotion.get(String(r.id)) ?? []).sort((a, b) => (order[a.vote] ?? 9) - (order[b.vote] ?? 9) || a.member.localeCompare(b.member)),
    })),
  };
}

export interface VoteMember {
  member: string;
  fullName: string | null;
  firstDate: string | null;
  lastDate: string | null;
  motions: number;
  yes: number;
  no: number;
  abstain: number;
  recused: number;
  absent: number;
  moved: number;
  seconded: number;
  bodies: string[];
}

/** Everyone who has voted, with their totals (optionally for one year or body). */
export async function voteMembers(env: Env, f: { year?: number | null; body?: string | null } = {}): Promise<VoteMember[]> {
  await ensureVotesTables(env);
  const cond: string[] = [];
  const p: unknown[] = [];
  if (f.year) {
    cond.push('substr(meeting_date, 1, 4) = ?');
    p.push(String(f.year));
  }
  if (f.body) {
    cond.push('body_id = ?');
    p.push(f.body);
  }
  const w = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  const [tot, moved, info] = await Promise.all([
    env.CATALOG_DB.prepare(`SELECT member, vote, count(*) AS n, group_concat(DISTINCT body_id) AS bodies FROM motion_votes ${w} GROUP BY member, vote`)
      .bind(...p)
      .all<{ member: string; vote: string; n: number; bodies: string }>(),
    env.CATALOG_DB.prepare(`SELECT who, kind, count(*) AS n FROM (SELECT mover AS who, 'moved' AS kind, meeting_date, body_id FROM motions UNION ALL SELECT seconder, 'seconded', meeting_date, body_id FROM motions) ${w.replace(/meeting_date|body_id/g, (c) => c)} GROUP BY who, kind`)
      .bind(...p)
      .all<{ who: string | null; kind: string; n: number }>(),
    env.CATALOG_DB.prepare('SELECT member, full_name, first_date, last_date FROM vote_members').all<{ member: string; full_name: string | null; first_date: string | null; last_date: string | null }>(),
  ]);
  const map = new Map<string, VoteMember>();
  const get = (m: string) => {
    let x = map.get(m);
    if (!x) {
      x = { member: m, fullName: null, firstDate: null, lastDate: null, motions: 0, yes: 0, no: 0, abstain: 0, recused: 0, absent: 0, moved: 0, seconded: 0, bodies: [] };
      map.set(m, x);
    }
    return x;
  };
  for (const r of tot.results ?? []) {
    const x = get(r.member);
    const k = r.vote as 'yes' | 'no' | 'abstain' | 'recused' | 'absent';
    if (k in x) x[k] += Number(r.n);
    x.motions += Number(r.n);
    x.bodies = [...new Set([...x.bodies, ...String(r.bodies ?? '').split(',').filter(Boolean)])];
  }
  for (const r of moved.results ?? []) if (r.who && map.has(r.who)) get(r.who)[r.kind === 'moved' ? 'moved' : 'seconded'] += Number(r.n);
  for (const r of info.results ?? []) {
    const x = map.get(r.member);
    if (x) Object.assign(x, { fullName: r.full_name, firstDate: r.first_date, lastDate: r.last_date });
  }
  // Names that appear only a handful of times are usually staff or applicants, not voting members.
  return [...map.values()].filter((x) => x.motions >= 3).sort((a, b) => String(b.lastDate ?? '').localeCompare(String(a.lastDate ?? '')) || b.motions - a.motions);
}

export async function handleVotes(env: Env, url: URL, sub: string | undefined): Promise<Response> {
  const p = url.searchParams;
  const year = Number(p.get('year')) || null;
  const body = p.get('body') && /^[a-z0-9-]{2,60}$/.test(p.get('body')!) ? p.get('body') : null;
  if (sub === 'members') return json({ members: await voteMembers(env, { year, body }) }, { cache: 'public, max-age=300' });
  const member = p.get('member') && /^[A-Za-z'’-]{2,40}$/.test(p.get('member')!) ? p.get('member') : null;
  const result = ['carried', 'failed', 'unknown'].includes(p.get('result') ?? '') ? p.get('result') : null;
  const vote = ['yes', 'no', 'abstain', 'recused', 'absent'].includes(p.get('vote') ?? '') ? p.get('vote') : null;
  const r = await queryMotions(env, { member, body, year, result, vote, q: (p.get('q') ?? '').slice(0, 120), page: Number(p.get('page')) || 1, pageSize: Number(p.get('pageSize')) || 30 });
  return json(r, { cache: 'public, max-age=300' });
}

const VOTE_Q = /\b(vote[sd]?|voting|motion|moved|seconded|position on|stance|support(ed)?|oppose[sd]?|against|for or against|aye|nay|how did)\b/i;
const NOT_TERMS = new Set('how did does do what when where which who whom whose was were is are the a an of on in to for and or with about vote votes voted voting motion motions moved seconded support supported oppose opposed against council councilmember member members mayor commissioner board city vineyard this that last year their his her they record records position stance aye nay yes no'.split(' '));

/** "How did Holdaway vote on the 400 South design?": that member's recorded votes on it. */
export async function votesFor(env: Env, question: string, people: Array<{ name: string }>): Promise<{ member: string | null; q: string; items: MotionOut[] } | null> {
  if (!VOTE_Q.test(question)) return null;
  await ensureVotesTables(env);
  const known = await env.CATALOG_DB.prepare('SELECT member FROM vote_members').all<{ member: string }>();
  const lower = ` ${question.toLowerCase().replace(/[^a-z0-9' -]+/g, ' ')} `;
  const members = (known.results ?? []).map((r) => r.member);
  const fromPeople = people.map((p) => p.name.split(/\s+/).pop() ?? '').filter((l) => members.includes(l) && (lower.includes(` ${l.toLowerCase()} `) || lower.includes(` ${l.toLowerCase()}'`)));
  const member = fromPeople[0] ?? members.find((m) => m.length >= 4 && lower.includes(` ${m.toLowerCase()} `)) ?? null;
  const words = lower
    .split(/\s+/)
    .map((w) => w.replace(/'s$/, ''))
    .filter((w) => w.length >= 3 && !NOT_TERMS.has(w) && !(member && w === member.toLowerCase()) && !people.some((p) => p.name.toLowerCase().split(/\s+/).includes(w)));
  if (!member && !words.length) return null;
  for (const q of [words.slice(0, 3).join(' '), words.slice(0, 1).join(' ')]) {
    if (!q && !member) continue;
    const r = await queryMotions(env, { member, q, pageSize: 5 });
    if (r.items.length) return { member, q, items: r.items };
  }
  if (member) {
    const r = await queryMotions(env, { member, pageSize: 5 });
    if (r.items.length) return { member, q: '', items: r.items };
  }
  return null;
}
