/**
 * Voting records: every motion in the archive's minutes (City Council, Redevelopment Agency,
 * Planning Commission and any other body with minutes), who moved and seconded it, how it ended,
 * and how each member voted, read from the minutes themselves (worker/lib/votes.ts). One copy of
 * each meeting's minutes counts: approved or final minutes replace a draft of the same meeting.
 */
import type { Env } from '../env';
import { SearchRepository } from '../search/SearchRepository';
import { parseMinutes, rosterFrom, type ParsedMotion } from '../lib/votes';
import { titleDate } from '../lib/adoptionDate';
import { json } from '../lib/http';

/** Bump to re-read every set of minutes after a parser change. */
export const VOTES_PARSER = 17;

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
      `CREATE TABLE IF NOT EXISTS meeting_attendance (document_id TEXT NOT NULL, body_id TEXT, meeting_date TEXT, member TEXT NOT NULL, status TEXT NOT NULL, PRIMARY KEY (document_id, member))`,
      `CREATE INDEX IF NOT EXISTS meeting_attendance_body ON meeting_attendance(body_id, meeting_date)`,
      `CREATE TABLE IF NOT EXISTS meeting_roster (document_id TEXT NOT NULL, body_id TEXT, meeting_date TEXT, name TEXT NOT NULL, role TEXT NOT NULL, PRIMARY KEY (document_id, name))`,
      `CREATE INDEX IF NOT EXISTS meeting_roster_body ON meeting_roster(body_id, meeting_date)`,
    ].map((q) => env.CATALOG_DB.prepare(q)),
  );
  // Consent items each consent motion approved (added after the table first shipped).
  await env.CATALOG_DB.prepare('ALTER TABLE motions ADD COLUMN items TEXT').run().catch(() => undefined);
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
  // Attachments carry the packet they came in ("..., 2026-05-26, item 1)"): that is not the minutes' own date.
  const guessDate = titleDate((d.title ?? '').replace(/\s*\([^()]*\d{4}-\d{2}-\d{2}[^()]*\)\s*$/, '')) ?? d.document_date;
  const parsed = parseMinutes(text, guessDate);
  // Hearing notices and announcements are sometimes filed as minutes: no attendance list, no "minutes" in the name.
  if (!/minute/i.test(d.title ?? '') && parsed.present.length < 3) {
    await db.batch([
      db.prepare('DELETE FROM motion_votes WHERE motion_id IN (SELECT id FROM motions WHERE document_id = ?)').bind(d.id),
      db.prepare('DELETE FROM motions WHERE document_id = ?').bind(d.id),
      db.prepare('DELETE FROM meeting_attendance WHERE document_id = ?').bind(d.id),
      db.prepare('DELETE FROM meeting_roster WHERE document_id = ?').bind(d.id),
      db.prepare('INSERT OR REPLACE INTO vote_docs (document_id, parser, parsed_at, motions) VALUES (?, ?, ?, 0)').bind(d.id, VOTES_PARSER, now),
    ]);
    return { motions: 0, votes: 0, superseded: false };
  }
  // The date printed in the minutes wins (a file named for the meeting that approved it holds an earlier
  // meeting), unless it is far from the file's own date (a date quoted in the text, not the meeting's).
  const near = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) <= 75 * 86_400_000;
  // Minutes are filed on or after their meeting, so a printed date later than the file's own is a date quoted in the text.
  // A file name with the wrong year ("12.3.2026" on December 3, 2025 minutes) or a date still in the future yields to the printed date.
  const typo = Boolean(parsed.date && guessDate && (parsed.date.slice(5) === guessDate.slice(5) || guessDate > now.slice(0, 10)));
  const date = parsed.date && (!guessDate || typo || (parsed.date <= guessDate && near(parsed.date, guessDate))) ? parsed.date : guessDate && guessDate > now.slice(0, 10) ? (d.document_date ?? guessDate) : guessDate;
  // The record's own body wins; the heading only fills in when the record has none.
  const body = (d.government_body_id && d.government_body_id !== 'general' ? d.government_body_id : null) ?? parsed.body ?? 'unknown';
  const key = `${body}|${date ?? d.id}`;
  const rank = rankOf(d.title);
  // Members by full name where the minutes print it ("Jacob Holdaway", not "Holdaway"), so people
  // who share a last name across the years stay separate.
  const full = (n: string | null) => (n ? (parsed.fullNames[n] ?? n) : n);
  const motions = parsed.motions.map((m) => ({ ...m, mover: full(m.mover), seconder: full(m.seconder), votes: m.votes.map((v) => ({ ...v, member: full(v.member) as string })) }));

  // One copy per meeting.
  const other = await db
    .prepare('SELECT document_id, rank, motions FROM vote_docs WHERE meeting_key = ? AND document_id != ? AND motions > 0 AND parser = ? ORDER BY motions DESC, rank DESC LIMIT 1')
    .bind(key, d.id, VOTES_PARSER)
    .first<{ document_id: string; rank: number; motions: number }>();
  // A copy with no readable motions (a scan before OCR, say) never displaces one that has them.
  // The fuller copy wins (a draft with every motion beats an approved file that lost its text); approved breaks ties.
  if (other && (!motions.length || other.motions > motions.length || (other.motions === motions.length && other.rank >= rank))) {
    await db.batch([
      db.prepare('DELETE FROM motion_votes WHERE motion_id IN (SELECT id FROM motions WHERE document_id = ?)').bind(d.id),
      db.prepare('DELETE FROM motions WHERE document_id = ?').bind(d.id),
      db.prepare('DELETE FROM meeting_attendance WHERE document_id = ?').bind(d.id),
      db.prepare('DELETE FROM meeting_roster WHERE document_id = ?').bind(d.id),
      db.prepare('INSERT OR REPLACE INTO vote_docs (document_id, meeting_key, body_id, meeting_date, rank, motions, parser, parsed_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)').bind(d.id, key, body, date, rank, VOTES_PARSER, now),
    ]);
    return { motions: 0, votes: 0, superseded: true };
  }
  const stmts: D1PreparedStatement[] = [];
  const clear = (docId: string) => {
    stmts.push(db.prepare('DELETE FROM motion_votes WHERE motion_id IN (SELECT id FROM motions WHERE document_id = ?)').bind(docId));
    stmts.push(db.prepare('DELETE FROM motions WHERE document_id = ?').bind(docId));
    stmts.push(db.prepare('DELETE FROM meeting_attendance WHERE document_id = ?').bind(docId));
    stmts.push(db.prepare('DELETE FROM meeting_roster WHERE document_id = ?').bind(docId));
  };
  clear(d.id);
  // One file per meeting: anything another file left under this body and date goes (it is re-read on its own turn).
  if (date && motions.length) {
    stmts.push(db.prepare('DELETE FROM motion_votes WHERE motion_id IN (SELECT id FROM motions WHERE body_id = ? AND meeting_date = ? AND document_id != ?)').bind(body, date, d.id));
    stmts.push(db.prepare('DELETE FROM motions WHERE body_id = ? AND meeting_date = ? AND document_id != ?').bind(body, date, d.id));
  }
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
        .prepare('INSERT INTO motions (id, document_id, meeting_id, body_id, meeting_date, seq, item, motion, mover, seconder, result, tally, tie_break, unanimous, inferred, refs, page, items) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, d.id, d.meeting_id, body, date, m.seq, m.item, m.text, m.mover, m.seconder, m.result, m.tally, m.tieBreak ? 1 : 0, m.unanimous ? 1 : 0, m.inferred ? 1 : 0, m.refs.length ? JSON.stringify(m.refs) : null, pageOf(m), m.items.length ? JSON.stringify(m.items) : null),
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
  // Who attended (present or absent as the minutes list them), by full name where printed.
  for (const [list, status] of [[parsed.present, 'present'], [parsed.absent, 'absent']] as const)
    for (const n of new Set(list.map((x) => full(x) as string)))
      stmts.push(db.prepare('INSERT OR REPLACE INTO meeting_attendance (document_id, body_id, meeting_date, member, status) VALUES (?, ?, ?, ?, ?)').bind(d.id, body, date, n, status));
  // The members the minutes list at the top, with chair, vice chair and alternate roles.
  for (const r of rosterFrom(text.slice(0, 3000))) stmts.push(db.prepare('INSERT OR REPLACE INTO meeting_roster (document_id, body_id, meeting_date, name, role) VALUES (?, ?, ?, ?, ?)').bind(d.id, body, date, r.name, r.role));
  stmts.push(db.prepare('INSERT OR REPLACE INTO vote_docs (document_id, meeting_key, body_id, meeting_date, rank, motions, parser, parsed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(d.id, key, body, date, rank, motions.length || 1, VOTES_PARSER, now));
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

/**
 * What the portal shows: the current City Council (mayor and council members as the city website
 * lists them today), from the start of this council's term (January 2026) on, at City Council
 * meetings and at the Redevelopment Agency, where the same council sits as the board.
 */
export const SCOPE_FROM = '2026-01-01';
export const SCOPE_BODIES = ['city-council', 'redevelopment-agency'];
export const PC = 'planning-commission';
let councilCache: { at: number; names: string[] } | null = null;
export async function currentCouncil(env: Env): Promise<string[]> {
  if (!councilCache || Date.now() - councilCache.at > 10 * 60_000) {
    const r = await env.CATALOG_DB.prepare("SELECT name FROM people WHERE current = 1 AND kind = 'elected'").all<{ name: string }>().catch(() => ({ results: [] as Array<{ name: string }> }));
    councilCache = { at: Date.now(), names: (r.results ?? []).map((x) => x.name) };
  }
  return councilCache.names;
}
/** The current official a recorded name refers to ("Holdaway" or "Jacob Holdaway"), or null. */
export function councilName(member: string, council: string[]): string | null {
  const m = member.toLowerCase();
  return council.find((n) => n.toLowerCase() === m) ?? (!member.includes(' ') ? (council.find((n) => (n.split(' ').pop() ?? '').toLowerCase() === m) ?? null) : null);
}
const SCOPE_SQL = `m.body_id IN ('city-council', 'redevelopment-agency') AND m.meeting_date >= '${SCOPE_FROM}'`;
const scopeSql = (body: string | null | undefined) => (body === PC ? `m.body_id = '${PC}' AND m.meeting_date >= '${SCOPE_FROM}'` : SCOPE_SQL);

export interface Commissioner {
  name: string;
  role: string;
  term: string | null;
  slug: string | null;
  photo: string | null;
}
/**
 * The Planning Commission as it sits now: commissioners in this year's minutes (the latest two
 * meetings with minutes), and city website members with a current term who sat this year. Names
 * the website still lists who have not sat this year are left out. Chair and alternates as the
 * minutes or the website label them.
 */
/** Website listings known to be out of date: Natalie Harbin was replaced by Daria Evans (2026). */
const REPLACED = new Set(['natalie harbin']);
/** Roles the sources do not print: Graden Ostler is an alternate. */
const ROLE_OVERRIDES: Record<string, string> = { ostler: 'Alternate' };

/**
 * A board as it sits now: the members its newest minutes this year list (with chair, vice chair and
 * alternate roles), plus anyone the city website lists for it with a current or open term.
 */
export async function currentRoster(env: Env, body: string, siteNames: string[]): Promise<Commissioner[]> {
  await ensureVotesTables(env);
  const db = env.CATALOG_DB;
  const year = Number(new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 4));
  const lastOf = (n: string) => (n.split(' ').pop() ?? n).toLowerCase();
  const out = new Map<string, Commissioner>();
  const roster = (await db.prepare('SELECT document_id, meeting_date, name, role FROM meeting_roster WHERE body_id = ? AND meeting_date >= ? ORDER BY meeting_date DESC').bind(body, SCOPE_FROM).all<{ document_id: string; meeting_date: string; name: string; role: string }>()).results ?? [];
  const rosterDocs = [...new Set(roster.map((r) => r.document_id))].slice(0, 2);
  for (const r of roster.filter((x) => rosterDocs.includes(x.document_id))) {
    if (!out.has(lastOf(r.name))) out.set(lastOf(r.name), { name: r.name, role: r.role === 'Member' ? 'Commissioner' : r.role, term: null, slug: null, photo: null });
  }
  // Minutes that list members without titles ("Present: Daria Evans, Brad Fagg"): the attendance list.
  const docs = (await db.prepare('SELECT DISTINCT document_id, meeting_date FROM meeting_attendance WHERE body_id = ? AND meeting_date >= ? ORDER BY meeting_date DESC').bind(body, SCOPE_FROM).all<{ document_id: string; meeting_date: string }>()).results ?? [];
  if (!rosterDocs.length && docs.length) {
    const latest = docs.slice(0, 2).map((d) => d.document_id);
    const att = (await db.prepare('SELECT member, document_id FROM meeting_attendance WHERE body_id = ? AND meeting_date >= ?').bind(body, SCOPE_FROM).all<{ member: string; document_id: string }>()).results ?? [];
    for (const a of att.filter((x) => latest.includes(x.document_id) && x.member.includes(' '))) if (!out.has(lastOf(a.member))) out.set(lastOf(a.member), { name: a.member, role: 'Commissioner', term: null, slug: null, photo: null });
  }
  if (siteNames.length) {
    const like = siteNames.map(() => 'department LIKE ?').join(' OR ');
    const site = (await db.prepare(`SELECT slug, name, role, term, photo_url FROM people WHERE current = 1 AND kind = 'board' AND (${like})`).bind(...siteNames.map((n) => `%${n}%`)).all<{ slug: string; name: string; role: string; term: string | null; photo_url: string | null }>()).results ?? [];
    for (const p of site) {
      const end = (p.term ?? '').match(/((?:19|20)\d{2})\s*$/);
      const termOk = !end || Number(end[1]) >= year;
      if (!termOk || REPLACED.has(p.name.toLowerCase())) continue;
      const have = out.get(lastOf(p.name));
      // Only a body's own chair is "Chair" ("Library Board Chair"); "VYC Beautification Chair" keeps its title.
      const siteRole = /alternate/i.test(p.role) ? 'Alternate' : /^(?:[a-z]+ (?:board|commission) )?vice[- ]chair(?:person)?$/i.test(p.role) ? 'Vice Chair' : /^(?:[a-z]+ (?:board|commission) )?chair(?:person)?$/i.test(p.role) ? 'Chair' : /^member$/i.test(p.role) ? 'Commissioner' : p.role;
      out.set(lastOf(p.name), { name: have?.name ?? p.name, role: have && have.role !== 'Commissioner' ? have.role : siteRole, term: p.term, slug: p.slug, photo: p.photo_url ? `/api/people/${p.slug}/photo` : null });
    }
  }
  // Roles the latest minutes state in the text ("Chairperson Steele called the meeting to order").
  const latestDoc = rosterDocs[0] ?? docs[0]?.document_id;
  if (latestDoc && !rosterDocs.length) {
    const repo = new SearchRepository(env);
    const row = await db.prepare('SELECT search_shard FROM documents WHERE id = ?').bind(latestDoc).first<{ search_shard: number | null }>();
    if (row?.search_shard != null && repo.activeShards.includes(Number(row.search_shard))) {
      const text = (await repo.documentChunks(Number(row.search_shard), latestDoc)).map((c) => c.text).join(' ').replace(/\s+/g, ' ');
      const mark = (re: RegExp, role: string) => {
        for (const m of text.matchAll(re)) {
          const c = out.get(m[1].toLowerCase());
          if (c && c.role === 'Commissioner') c.role = role;
        }
      };
      mark(/\balternate (?:commissioner|member)\s+(?:[A-Z][a-z]+\s+)?([A-Z][A-Za-z'-]+)/g, 'Alternate');
      mark(/\bvice[- ]chair(?:person|man|woman)?\s+(?:[A-Z][a-z]+\s+)?([A-Z][A-Za-z'-]+)/gi, 'Vice Chair');
      mark(/(?<!vice[- ])\bchair(?:person|man|woman)?\s+(?:[A-Z][a-z]+\s+)?([A-Z][A-Za-z'-]+)\s+(?:called|opened|adjourned)/gi, 'Chair');
    }
  }
  for (const c of out.values()) {
    const o = ROLE_OVERRIDES[lastOf(c.name)];
    if (o && body === PC) c.role = o;
  }
  const rank = (r: string) => (r === 'Chair' ? 0 : r === 'Vice Chair' ? 1 : r === 'Alternate' ? 3 : 2);
  return [...out.values()].sort((a, b) => rank(a.role) - rank(b.role) || a.name.localeCompare(b.name));
}

export const currentCommission = (env: Env) => currentRoster(env, PC, ['Planning Commission']);

/** The officials whose votes a scope shows: the current council, or the current commission. */
async function officialsFor(env: Env, body: string | null | undefined): Promise<string[]> {
  return body === PC ? (await currentCommission(env)).map((c) => c.name) : currentCouncil(env);
}

/** Planning Commission attendance this year: each meeting with minutes, who was present or absent. */
export async function commissionAttendance(env: Env): Promise<{ meetings: Array<{ date: string; documentId: string; present: string[]; absent: string[] }>; roster: Commissioner[] }> {
  const roster = await currentCommission(env);
  const rows = (await env.CATALOG_DB.prepare(`SELECT a.document_id, a.meeting_date, a.member, a.status FROM meeting_attendance a JOIN vote_docs v ON v.document_id = a.document_id AND v.motions > 0 WHERE a.body_id = ? AND a.meeting_date >= ? ORDER BY a.meeting_date DESC`).bind(PC, SCOPE_FROM).all<{ document_id: string; meeting_date: string; member: string; status: string }>()).results ?? [];
  const by = new Map<string, { date: string; documentId: string; present: string[]; absent: string[] }>();
  for (const r of rows) {
    const k = r.meeting_date;
    const m = by.get(k) ?? by.set(k, { date: r.meeting_date, documentId: r.document_id, present: [], absent: [] }).get(k)!;
    (r.status === 'present' ? m.present : m.absent).push(r.member);
  }
  // A commissioner on the roster who is in neither list was not recorded at that meeting.
  return { meetings: [...by.values()], roster };
}

const BODY_NAMES: Record<string, string> = { 'city-council': 'City Council', 'redevelopment-agency': 'Redevelopment Agency', 'planning-commission': 'Planning Commission' };
const bodyName = (id: string | null) => (id ? (BODY_NAMES[id] ?? id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())) : null);

/** Housekeeping motions: approving minutes or the agenda, adjourning, closed sessions, opening and closing hearings. */
export const PROCEDURAL = /^(?:to\s+)?(?:(?:approve|accept|adopt)\s+(?:the\s+)?(?:(?:[\w,']+\s+){0,6})?(?:minutes|agenda)\b(?![^.]*\b(?:and|with)\b[^.]*(?:resolution|ordinance|item|consent))|adjourn|recess|(?:go|move|enter|convene|went)\s+(?:in)?to\s+(?:a\s+)?(?:closed|executive|regular|work)\s+(?:session|meeting)|(?:close|end|leave|exit|return from)\s+(?:the\s+)?(?:closed|executive)\s+(?:session|meeting)|(?:return|reconvene|go back)\s+(?:in)?to\s+(?:the\s+)?(?:regular|open)|(?:open|close|continue)\s+(?:the\s+)?public hearing|excuse\b|take a (?:short )?(?:break|recess)|nominate\b(?!.*commission))/i;

export interface MotionOut {
  id: string;
  meetingId: string | null;
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
  items: string[];
  documentId: string;
  page: number | null;
  votes: Array<{ member: string; vote: string }>;
}

/** Motions, newest first, filtered by member, body, year, result and words in the motion. */
export async function queryMotions(env: Env, f: { all?: boolean; member?: string | null; body?: string | null; year?: number | null; q?: string | null; result?: string | null; vote?: string | null; page?: number; pageSize?: number }): Promise<{ items: MotionOut[]; total: number }> {
  await ensureVotesTables(env);
  let sql = scopeSql(f.body);
  const params: unknown[] = [];
  const last = f.member ? (f.member.split(' ').pop() ?? f.member) : null;
  if (f.member && f.vote) {
    sql += ' AND EXISTS (SELECT 1 FROM motion_votes v WHERE v.motion_id = m.id AND v.member IN (?, ?) AND v.vote = ?)';
    params.push(f.member, last, f.vote);
  } else if (f.member) {
    sql += ' AND (m.mover IN (?, ?) OR m.seconder IN (?, ?) OR EXISTS (SELECT 1 FROM motion_votes v WHERE v.motion_id = m.id AND v.member IN (?, ?)))';
    params.push(f.member, last, f.member, last, f.member, last);
  }
  if (f.body && f.body !== PC) {
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
  if (!f.all) sql += " AND m.motion NOT LIKE 'approve the minutes%' AND m.motion NOT LIKE 'adjourn%' AND lower(m.motion) NOT LIKE '%closed session%' AND lower(m.motion) NOT LIKE '%public hearing%' AND lower(m.motion) NOT LIKE 'approve the agenda%'";
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
  const list = (rows.results ?? []).filter((r) => f.all || !PROCEDURAL.test(String(r.motion ?? '').trim()));
  const votes = list.length
    ? await env.CATALOG_DB.prepare('SELECT motion_id, member, vote FROM motion_votes WHERE motion_id IN (SELECT value FROM json_each(?))')
        .bind(JSON.stringify(list.map((r) => r.id)))
        .all<{ motion_id: string; member: string; vote: string }>()
    : { results: [] };
  const byMotion = new Map<string, Array<{ member: string; vote: string }>>();
  for (const v of votes.results ?? []) (byMotion.get(v.motion_id) ?? byMotion.set(v.motion_id, []).get(v.motion_id)!).push({ member: v.member, vote: v.vote });
  const order = { yes: 0, no: 1, abstain: 2, recused: 3, absent: 4 } as Record<string, number>;
  const council = await officialsFor(env, f.body);
  // Members who sat this year and have since left (a resignation) still show in the votes they cast,
  // by the full name the minutes print; they are not offered as a filter.
  const past = new Set(
    ((await env.CATALOG_DB.prepare(`SELECT member FROM motion_votes m WHERE ${scopeSql(f.body)} AND member LIKE '% %' GROUP BY member HAVING count(*) >= 5`).all<{ member: string }>().catch(() => ({ results: [] }))).results ?? []).map((r) => r.member),
  );
  const named = (n: string | null) => (n ? (councilName(n, council) ?? n) : null);
  const voter = (n: string) => councilName(n, council) ?? (past.has(n) ? n : '');
  return {
    total: Number(count?.n ?? 0),
    items: list.map((r) => ({
      id: String(r.id),
      meetingId: (r.meeting_id as string | null) ?? null,
      date: (r.meeting_date as string | null) ?? null,
      bodyId: (r.body_id as string | null) ?? null,
      bodyName: bodyName((r.body_id as string | null) ?? null),
      item: (r.item as string | null) ?? null,
      motion: String(r.motion ?? ''),
      result: String(r.result ?? 'unknown'),
      tally: (r.tally as string | null) ?? null,
      tieBreak: Number(r.tie_break) === 1,
      unanimous: Number(r.unanimous) === 1,
      inferred: Number(r.inferred) === 1,
      refs: r.refs ? (JSON.parse(String(r.refs)) as string[]) : [],
      items: r.items ? (JSON.parse(String(r.items)) as string[]) : [],
      documentId: String(r.document_id),
      page: r.page == null ? null : Number(r.page),
      mover: named((r.mover as string | null) ?? null),
      seconder: named((r.seconder as string | null) ?? null),
      // "Unanimous" with no names in the minutes is not a roll call: no member is shown as voting.
      votes: (Number(r.inferred) === 1 ? [] : byMotion.get(String(r.id)) ?? [])
        .map((v) => ({ member: voter(v.member), vote: v.vote }))
        .filter((v) => v.member)
        .sort((a, b) => (order[a.vote] ?? 9) - (order[b.vote] ?? 9) || a.member.localeCompare(b.member)),
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

/** The current council's totals in scope (optionally for one year or body), by full name. */
export async function voteMembers(env: Env, f: { year?: number | null; body?: string | null } = {}): Promise<VoteMember[]> {
  await ensureVotesTables(env);
  const cond: string[] = [f.body === PC ? `body_id = '${PC}'` : `body_id IN ('city-council', 'redevelopment-agency')`, `meeting_date >= '${SCOPE_FROM}'`];
  const p: unknown[] = [];
  if (f.year) {
    cond.push('substr(meeting_date, 1, 4) = ?');
    p.push(String(f.year));
  }
  if (f.body && f.body !== PC) {
    cond.push('body_id = ?');
    p.push(f.body);
  }
  const w = `WHERE ${cond.join(' AND ')}`;
  const [tot, moved, council] = await Promise.all([
    env.CATALOG_DB.prepare(`SELECT member, vote, count(*) AS n, group_concat(DISTINCT body_id) AS bodies, min(meeting_date) AS first, max(meeting_date) AS last FROM motion_votes ${w} GROUP BY member, vote`)
      .bind(...p)
      .all<{ member: string; vote: string; n: number; bodies: string; first: string; last: string }>(),
    env.CATALOG_DB.prepare(`SELECT who, kind, count(*) AS n FROM (SELECT mover AS who, 'moved' AS kind, meeting_date, body_id FROM motions UNION ALL SELECT seconder, 'seconded', meeting_date, body_id FROM motions) ${w} GROUP BY who, kind`)
      .bind(...p)
      .all<{ who: string | null; kind: string; n: number }>(),
    officialsFor(env, f.body),
  ]);
  const map = new Map<string, VoteMember>();
  for (const name of council) map.set(name, { member: name, fullName: name, firstDate: null, lastDate: null, motions: 0, yes: 0, no: 0, abstain: 0, recused: 0, absent: 0, moved: 0, seconded: 0, bodies: [] });
  for (const r of tot.results ?? []) {
    const name = councilName(r.member, council);
    const x = name ? map.get(name) : undefined;
    if (!x) continue;
    const k = r.vote as 'yes' | 'no' | 'abstain' | 'recused' | 'absent';
    if (k in x) x[k] += Number(r.n);
    x.motions += Number(r.n);
    x.bodies = [...new Set([...x.bodies, ...String(r.bodies ?? '').split(',').filter(Boolean)])];
    if (!x.firstDate || r.first < x.firstDate) x.firstDate = r.first;
    if (!x.lastDate || r.last > x.lastDate) x.lastDate = r.last;
  }
  for (const r of moved.results ?? []) {
    const name = r.who ? councilName(r.who, council) : null;
    const x = name ? map.get(name) : undefined;
    if (x) x[r.kind === 'moved' ? 'moved' : 'seconded'] += Number(r.n);
  }
  // The mayor first, then the council members by name.
  return [...map.values()].sort((a, b) => Number(/stratton/i.test(b.member)) - Number(/stratton/i.test(a.member)) || a.member.localeCompare(b.member));
}

export async function handleVotes(env: Env, url: URL, sub: string | undefined): Promise<Response> {
  const p = url.searchParams;
  const year = Number(p.get('year')) || null;
  const body = p.get('body') && /^[a-z0-9-]{2,60}$/.test(p.get('body')!) ? p.get('body') : null;
  if (sub === 'attendance') return json(await commissionAttendance(env), { cache: 'public, max-age=300' });
  if (sub === 'meetings') return json({ meetings: await meetingMinutes(env, body, year) }, { cache: 'public, max-age=300' });
  if (sub === 'members') return json({ members: await voteMembers(env, { year, body }) }, { cache: 'public, max-age=300' });
  if (sub === 'years') {
    await ensureVotesTables(env);
    const m = p.get('member') && /^[A-Za-z'’. -]{2,60}$/.test(p.get('member')!) ? p.get('member') : null;
    const cond = ['meeting_date IS NOT NULL', body === PC ? `body_id = '${PC}'` : `body_id IN ('city-council', 'redevelopment-agency')`, `meeting_date >= '${SCOPE_FROM}'`];
    const args: unknown[] = [];
    if (body && body !== PC) {
      cond.push('body_id = ?');
      args.push(body);
    }
    if (m) {
      const l = m.split(' ').pop() ?? m;
      cond.push('(mover IN (?, ?) OR seconder IN (?, ?) OR EXISTS (SELECT 1 FROM motion_votes v WHERE v.motion_id = motions.id AND v.member IN (?, ?)))');
      args.push(m, l, m, l, m, l);
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
  const lower = ` ${question.toLowerCase().replace(/[^a-z0-9' -]+/g, ' ')} `;
  const members = await currentCouncil(env);
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
  // The topic asked about: all its words, then its most specific single words. A question about a
  // topic with no recorded motion gets no card (never someone's unrelated latest votes).
  const tries = [...new Set([words.slice(0, 3).join(' '), ...[...words].sort((x, y) => y.length - x.length).slice(0, 3)])].filter(Boolean);
  for (const q of tries) {
    const r = await queryMotions(env, { member, q, pageSize: 5 });
    if (r.items.length) return { member, q, items: r.items };
  }
  if (member && !words.length) {
    const r = await queryMotions(env, { member, pageSize: 5 });
    if (r.items.length) return { member, q: '', items: r.items };
  }
  return null;
}

/** "What's the latest thing that passed?", "what did the council approve most recently": no topic, just the newest action. */
export const LATEST_ACTION_Q = /\b(latest|most recent(ly)?|last|newest|recent(ly)?|just)\b[^.?!]{0,60}\b(pass(ed|es)?|approv(ed|e|al)|adopt(ed)?|vot(ed|e|es)|decid(ed|e)|decisions?|motions?|actions?|enacted)\b|\b(pass(ed)?|approv(ed|e)|adopt(ed)?|vot(ed|e)[^.?!]{0,12}on|decid(ed|e))\b[^.?!]{0,60}\b(latest|most recent(ly)?|last|recent(ly)?|lately)\b/i;

const STOP_TERMS = new Set('what when where which while with that this these those there their they them have has had been being from into about after before over under than then also just only very more most much many some such each every other city council vineyard meeting meetings year years month today current currently now recent recently lately going happening happen status update plans planned plan does will would could should doing done right still latest this year thing things passed pass passes approved approve approval adopted adopt voted vote votes decided decide decision decisions motion motions action actions enacted last newest most that them did were been'.split(' '));

/**
 * What the council has actually done on a topic this year, as evidence the answer can cite: each
 * recorded motion (with its result and vote) becomes a passage from the minutes it came from.
 */
export async function motionEvidence(env: Env, question: string, from: string, to: string, limit = 8, latest = false): Promise<import('../search/types').ChunkHit[]> {
  await ensureVotesTables(env);
  const terms = [...new Set(question.toLowerCase().replace(/[^a-z0-9' -]+/g, ' ').split(/\s+/).filter((w) => w.length >= 4 && !STOP_TERMS.has(w)))].slice(0, 6);
  if (!terms.length && !latest) return [];
  const like = terms.map(() => "(lower(m.motion) LIKE ? OR lower(coalesce(m.item, '')) LIKE ?)").join(' OR ');
  // "The latest thing passed": the newest policy votes that carried, whatever they were about.
  const rows = latest
    ? await env.CATALOG_DB.prepare(
        `SELECT m.*, d.title AS doc_title FROM motions m JOIN documents d ON d.id = m.document_id
         WHERE ${SCOPE_SQL} AND m.meeting_date <= ? AND m.result = 'carried' ORDER BY m.meeting_date DESC, m.seq LIMIT 40`,
      )
        .bind(to)
        .all<Record<string, unknown>>()
    : await env.CATALOG_DB.prepare(
        `SELECT m.*, d.title AS doc_title FROM motions m JOIN documents d ON d.id = m.document_id
         WHERE ${SCOPE_SQL} AND m.meeting_date BETWEEN ? AND ? AND (${like}) ORDER BY m.meeting_date DESC, m.seq LIMIT ?`,
      )
        .bind(from, to, ...terms.flatMap((t) => [`%${t}%`, `%${t}%`]), limit)
        .all<Record<string, unknown>>();
  let list = rows.results ?? [];
  if (latest) {
    list = list.filter((r) => !PROCEDURAL.test(String(r.motion ?? '').trim()) && !/public hearing|closed session/i.test(String(r.motion ?? '')));
    // The newest meeting's votes, all of them; older meetings only to fill out the list.
    const newest = list[0]?.meeting_date;
    list = [...list.filter((r) => r.meeting_date === newest), ...list.filter((r) => r.meeting_date !== newest)].slice(0, Math.max(limit, list.filter((r) => r.meeting_date === newest).length));
  }
  // Adjournments and approving minutes never stand in as the answer to a question about a vote.
  if (!latest) list = list.filter((r) => !PROCEDURAL.test(String(r.motion ?? '').trim()));
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
      (() => {
        try {
          const it = r.items ? (JSON.parse(String(r.items)) as string[]) : [];
          return it.length ? `The consent items approved in this motion: ${it.map((x) => x.replace(/^\d+\.\d+\s+/, '')).join('; ')}.` : '';
        } catch {
          return '';
        }
      })(),
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

export interface MeetingMinutes {
  date: string;
  bodyId: string;
  documentId: string;
  /** Every motion in the meeting's own minutes, routine ones included. */
  total: number;
  /** Motions on policy items (what the voting record lists). */
  substantive: number;
}

/**
 * Each meeting since SCOPE_FROM whose own minutes have been read, keyed by the date printed in them
 * (a file titled for one meeting that holds an earlier meeting's minutes counts for the earlier one).
 */
export async function meetingMinutes(env: Env, body: string | null, year: number | null): Promise<MeetingMinutes[]> {
  await ensureVotesTables(env);
  const bodies = body === PC ? [PC] : body && SCOPE_BODIES.includes(body) ? [body] : SCOPE_BODIES;
  const rows =
    (
      await env.CATALOG_DB.prepare(
        `SELECT v.body_id, v.meeting_date, v.document_id, v.motions, v.rank FROM vote_docs v JOIN documents d ON d.id = v.document_id
           WHERE v.body_id IN (${bodies.map(() => '?').join(', ')}) AND v.meeting_date >= ?${year ? ' AND substr(v.meeting_date, 1, 4) = ?' : ''}
             AND (v.motions > 0 OR lower(d.title) LIKE '%minute%')
           ORDER BY v.motions DESC, v.rank DESC`,
      )
        .bind(...bodies, SCOPE_FROM, ...(year ? [String(year)] : []))
        .all<{ body_id: string; meeting_date: string; document_id: string; motions: number; rank: number }>()
    ).results ?? [];
  const sub = await queryMotions(env, { body: body === PC ? PC : bodies.length === 1 ? bodies[0] : null, year, pageSize: 400 });
  const count = new Map<string, number>();
  for (const m of sub.items) count.set(`${m.bodyId}|${m.date}`, (count.get(`${m.bodyId}|${m.date}`) ?? 0) + 1);
  const out = new Map<string, MeetingMinutes>();
  for (const r of rows) {
    const k = `${r.body_id}|${r.meeting_date}`;
    if (!r.meeting_date || out.has(k)) continue;
    out.set(k, { date: r.meeting_date, bodyId: r.body_id, documentId: r.document_id, total: Number(r.motions), substantive: count.get(k) ?? 0 });
  }
  return [...out.values()].sort((a, b) => b.date.localeCompare(a.date));
}
