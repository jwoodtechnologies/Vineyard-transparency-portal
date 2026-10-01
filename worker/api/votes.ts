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
export const VOTES_PARSER = 3;

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
  // A new parser version starts the member list over (dates and names are rebuilt as minutes are re-read).
  const begun = await db.prepare('SELECT count(*) AS n FROM vote_docs WHERE parser = ?').bind(VOTES_PARSER).first<{ n: number }>();
  if (!Number(begun?.n ?? 0)) await db.prepare('DELETE FROM vote_members').run();
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
  if (!out.left) await resolveBareNames(env).catch(() => undefined);
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
  // The record's own body wins; the heading only fills in when the record has none.
  const body = (d.government_body_id && d.government_body_id !== 'general' ? d.government_body_id : null) ?? parsed.body ?? 'unknown';
  const key = `${body}|${date ?? d.id}`;
  const rank = rankOf(d.title);
  // Members by full name where the minutes print it ("Jacob Holdaway", not "Holdaway"), so people
  // who share a last name across the years stay separate.
  const full = (n: string | null) => (n ? (parsed.fullNames[n] ?? n) : n);
  const motions = parsed.motions.map((m) => ({ ...m, mover: full(m.mover), seconder: full(m.seconder), votes: m.votes.map((v) => ({ ...v, member: full(v.member) as string })) }));

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
        .bind(member, member.includes(' ') ? member : null, date, date),
    );
  stmts.push(db.prepare('INSERT OR REPLACE INTO vote_docs (document_id, meeting_key, body_id, meeting_date, rank, motions, parser, parsed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(d.id, key, body, date, rank, motions.length, VOTES_PARSER, now));
  for (let i = 0; i < stmts.length; i += 80) await db.batch(stmts.slice(i, i + 80));
  return { motions: motions.length, votes, superseded: false };
}

/**
 * Minutes that print only a last name ("COUNCILMEMBER HOLDAWAY") are matched to the one member with
 * that last name who was voting at the time, so their votes join that person's record.
 */
export async function resolveBareNames(env: Env): Promise<number> {
  const db = env.CATALOG_DB;
  const members = (await db.prepare('SELECT member, first_date, last_date FROM vote_members').all<{ member: string; first_date: string | null; last_date: string | null }>()).results ?? [];
  const fulls = members.filter((m) => m.member.includes(' ') && m.first_date && m.last_date);
  let changed = 0;
  for (const bare of members.filter((m) => !m.member.includes(' '))) {
    const same = fulls.filter((f) => f.member.split(' ').pop() === bare.member);
    if (!same.length) continue;
    const dates = (await db.prepare('SELECT DISTINCT meeting_date AS d FROM motion_votes WHERE member = ?').bind(bare.member).all<{ d: string | null }>()).results ?? [];
    for (const { d } of dates) {
      if (!d) continue;
      const slack = (x: string, days: number) => new Date(Date.parse(`${x}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
      const fit = same.filter((f) => d >= slack(f.first_date!, -200) && d <= slack(f.last_date!, 200));
      if (fit.length !== 1) continue;
      const who = fit[0].member;
      await db.batch([
        db.prepare('UPDATE OR IGNORE motion_votes SET member = ? WHERE member = ? AND meeting_date = ?').bind(who, bare.member, d),
        db.prepare('UPDATE motions SET mover = ? WHERE mover = ? AND meeting_date = ?').bind(who, bare.member, d),
        db.prepare('UPDATE motions SET seconder = ? WHERE seconder = ? AND meeting_date = ?').bind(who, bare.member, d),
      ]);
      changed++;
    }
    const left = await db.prepare('SELECT count(*) AS n FROM motion_votes WHERE member = ?').bind(bare.member).first<{ n: number }>();
    if (!Number(left?.n ?? 0)) await db.prepare('DELETE FROM vote_members WHERE member = ?').bind(bare.member).run();
  }
  return changed;
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
  const pageSize = Math.min(400, Math.max(1, f.pageSize ?? 30));
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
  if (sub === 'years') {
    await ensureVotesTables(env);
    const m = p.get('member') && /^[A-Za-z'’. -]{2,60}$/.test(p.get('member')!) ? p.get('member') : null;
    const cond = ['meeting_date IS NOT NULL'];
    const args: unknown[] = [];
    if (body) {
      cond.push('body_id = ?');
      args.push(body);
    }
    if (m) {
      cond.push('(mover = ? OR seconder = ? OR EXISTS (SELECT 1 FROM motion_votes v WHERE v.motion_id = motions.id AND v.member = ?))');
      args.push(m, m, m);
    }
    const r = await env.CATALOG_DB.prepare(`SELECT substr(meeting_date, 1, 4) AS year, count(*) AS motions, count(DISTINCT meeting_date) AS meetings FROM motions WHERE ${cond.join(' AND ')} GROUP BY 1 ORDER BY 1 DESC`)
      .bind(...args)
      .all<{ year: string; motions: number; meetings: number }>();
    return json({ years: (r.results ?? []).map((x) => ({ year: Number(x.year), motions: Number(x.motions), meetings: Number(x.meetings) })) }, { cache: 'public, max-age=300' });
  }
  const member = p.get('member') && /^[A-Za-z'’. -]{2,60}$/.test(p.get('member')!) ? p.get('member') : null;
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
  const known = await env.CATALOG_DB.prepare('SELECT member FROM vote_members ORDER BY last_date DESC').all<{ member: string }>();
  const lower = ` ${question.toLowerCase().replace(/[^a-z0-9' -]+/g, ' ')} `;
  const members = (known.results ?? []).map((r) => r.member);
  const lastOf = (m: string) => (m.split(' ').pop() ?? m).toLowerCase();
  const said = (m: string) => lower.includes(` ${m.toLowerCase()} `) || lower.includes(` ${lastOf(m)} `) || lower.includes(` ${lastOf(m)}'`);
  // A current official named in the question first, then the most recent member with that name.
  const fromPeople = people.map((p) => p.name).filter((n) => members.includes(n) && said(n));
  const member = fromPeople[0] ?? members.find((m) => lastOf(m).length >= 4 && said(m)) ?? null;
  const words = lower
    .split(/\s+/)
    .map((w) => w.replace(/'s$/, ''))
    .filter((w) => w.length >= 3 && !NOT_TERMS.has(w) && !(member && member.toLowerCase().split(' ').includes(w)) && !people.some((p) => p.name.toLowerCase().split(/\s+/).includes(w)));
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

const STOP_TERMS = new Set('what when where which while with that this these those there their they them have has had been being from into about after before over under than then also just only very more most much many some such each every other city council vineyard meeting meetings year years month today current currently now recent recently lately going happening happen status update plans planned plan does will would could should doing done right still latest this year'.split(' '));

/**
 * What the council has actually done on a topic this year, as evidence the answer can cite: each
 * recorded motion (with its result and vote) becomes a passage from the minutes it came from.
 */
export async function motionEvidence(env: Env, question: string, from: string, to: string, limit = 8): Promise<import('../search/types').ChunkHit[]> {
  await ensureVotesTables(env);
  const terms = [...new Set(question.toLowerCase().replace(/[^a-z0-9' -]+/g, ' ').split(/\s+/).filter((w) => w.length >= 4 && !STOP_TERMS.has(w)))].slice(0, 6);
  if (!terms.length) return [];
  const like = terms.map(() => "(lower(m.motion) LIKE ? OR lower(coalesce(m.item, '')) LIKE ?)").join(' OR ');
  const rows = await env.CATALOG_DB.prepare(
    `SELECT m.*, d.title AS doc_title FROM motions m JOIN documents d ON d.id = m.document_id
     WHERE m.meeting_date BETWEEN ? AND ? AND (${like}) ORDER BY m.meeting_date DESC, m.seq LIMIT ?`,
  )
    .bind(from, to, ...terms.flatMap((t) => [`%${t}%`, `%${t}%`]), limit)
    .all<Record<string, unknown>>();
  const list = rows.results ?? [];
  if (!list.length) return [];
  const votes = await env.CATALOG_DB.prepare('SELECT motion_id, member, vote FROM motion_votes WHERE motion_id IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify(list.map((r) => r.id)))
    .all<{ motion_id: string; member: string; vote: string }>();
  return list.map((r) => {
    const vs = (votes.results ?? []).filter((v) => v.motion_id === r.id);
    const by = (k: string) => vs.filter((v) => v.vote === k).map((v) => v.member).join(', ');
    const result = r.result === 'carried' ? 'The motion passed' : r.result === 'failed' ? 'The motion failed' : 'The result was not recorded';
    const text = [
      `${bodyName(r.body_id as string | null) ?? 'Meeting'} meeting of ${r.meeting_date}.`,
      r.item ? `Agenda item: ${r.item}.` : '',
      `Motion${r.mover ? ` by ${r.mover}` : ''}${r.seconder ? `, seconded by ${r.seconder}` : ''}: to ${String(r.motion ?? '').replace(/^to\s+/i, '')}.`,
      `${result}${r.tally ? ` ${r.tally}` : ''}.`,
      by('yes') ? `Yes: ${by('yes')}.` : '',
      by('no') ? `No: ${by('no')}.` : '',
      by('abstain') || by('recused') ? `Abstained or recused: ${[by('abstain'), by('recused')].filter(Boolean).join(', ')}.` : '',
    ]
      .filter(Boolean)
      .join(' ');
    return {
      shard: 0,
      chunkId: `vote:${r.id}`,
      documentId: String(r.document_id),
      pageStart: r.page == null ? null : Number(r.page),
      pageEnd: r.page == null ? null : Number(r.page),
      sectionTitle: (r.item as string | null) ?? null,
      score: 10,
      excerpt: text.slice(0, 300),
      highlights: [],
      text,
      title: `${String(r.doc_title ?? 'Minutes')} (recorded vote)`,
      documentType: 'minutes',
      documentNumber: null,
      documentDate: (r.meeting_date as string | null) ?? null,
      year: r.meeting_date ? Number(String(r.meeting_date).slice(0, 4)) : null,
      governmentBodyId: (r.body_id as string | null) ?? null,
      sourceId: 'vineyard-civicclerk-meetings',
      categoriesJson: '[]',
    };
  });
}
