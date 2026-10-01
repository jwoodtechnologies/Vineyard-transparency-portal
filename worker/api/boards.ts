/**
 * Boards and commissions: every body that meets, with its members as the city website lists them
 * today, its meeting count, its last and next meeting, and whether it is still active (a body with
 * no meeting in the past year and none scheduled is shown as inactive).
 */
import type { Env } from '../env';
import { ensurePeopleTable } from './people';
import { json } from '../lib/http';
import { currentRoster } from './votes';

/** The city website's board names, matched to the meeting portal's bodies. */
const ALIAS: Record<string, string> = {
  'bicycle advisory commission': 'active-transportation-commission',
  'active transportation commission': 'active-transportation-commission',
  'executive youth council': 'youth-council',
  'youth council': 'youth-council',
  'library board': 'vineyard-library-board',
  'arch commission': 'arch-commission',
  'communities that care commission': 'communities-that-care-commission',
  'planning commission': 'planning-commission',
  'vineyard cares board': 'vineyard-cares-coalition',
};
const SKIP = new Set(['general', 'public-notices']);
const STAFF_COMMITTEES = new Set(['development-review-committee', 'technical-advisory-committee', 'administrative-law-judge-hearing-officer', 'board-of-appeals-building-department']);

const slug = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export async function listBoards(env: Env): Promise<Response> {
  await ensurePeopleTable(env);
  const today = new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
  const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  const [bodies, people] = await Promise.all([
    env.CATALOG_DB.prepare(
      `SELECT gb.id, gb.name, count(m.id) AS meetings,
              max(CASE WHEN substr(m.meeting_date, 1, 10) <= ? THEN substr(m.meeting_date, 1, 10) END) AS last,
              min(CASE WHEN substr(m.meeting_date, 1, 10) >= ? AND lower(coalesce(m.status, '')) NOT LIKE '%cancel%' THEN substr(m.meeting_date, 1, 10) END) AS next,
              min(substr(m.meeting_date, 1, 10)) AS first
       FROM government_bodies gb LEFT JOIN meetings m ON m.government_body_id = gb.id
       GROUP BY gb.id, gb.name`,
    )
      .bind(today, today)
      .all<{ id: string; name: string; meetings: number; last: string | null; next: string | null; first: string | null }>(),
    env.CATALOG_DB.prepare("SELECT slug, name, kind, role, department, term, photo_url FROM people WHERE current = 1 AND kind IN ('board', 'elected')").all<{ slug: string; name: string; kind: string; role: string; department: string | null; term: string | null; photo_url: string | null }>(),
  ]);
  type Member = { slug: string; name: string; role: string; term: string | null; photo: string | null };
  const year = Number(today.slice(0, 4));
  // Who actually voted with each body this year, from the minutes (to keep members serving past a
  // listed term end, and to drop names the city page still shows after a term ended).
  const sat = await env.CATALOG_DB.prepare('SELECT DISTINCT body_id, member FROM motion_votes WHERE meeting_date >= ?')
    .bind(`${year}-01-01`)
    .all<{ body_id: string; member: string }>()
    .catch(() => ({ results: [] as Array<{ body_id: string; member: string }> }));
  const satWith = (id: string, name: string) => (sat.results ?? []).some((r) => r.body_id === id && (r.member.toLowerCase() === name.toLowerCase() || r.member.toLowerCase() === (name.split(' ').pop() ?? '').toLowerCase()));
  const hidden = new Map<string, number>();
  const websiteBoards = new Map<string, string>();
  const members = new Map<string, Member[]>();
  const listedOnly = new Map<string, string>();
  const push = (id: string, m: Member) => (members.get(id) ?? members.set(id, []).get(id)!).push(m);
  for (const p of people.results ?? []) {
    const photo = p.photo_url ? `/api/people/${p.slug}/photo` : null;
    if (p.kind === 'elected') {
      // The City Council sits as the Redevelopment Agency board.
      for (const id of ['city-council', 'redevelopment-agency']) push(id, { slug: p.slug, name: p.name, role: id === 'redevelopment-agency' ? (p.role === 'Mayor' ? 'Chair' : 'Board Member') : p.role, term: p.term, photo });
      continue;
    }
    for (const b of (p.department ?? '').split(';').map((x) => x.trim()).filter(Boolean)) {
      const id = ALIAS[b.toLowerCase()] ?? slug(b);
      websiteBoards.set(id, b);
      if (!ALIAS[b.toLowerCase()]) listedOnly.set(id, b);
      // A listed term that ended before this year: shown only if the minutes show them still serving.
      const end = (p.term ?? '').match(/((?:19|20)\d{2})\s*$/);
      if (end && Number(end[1]) < year && !satWith(id, p.name)) {
        hidden.set(id, (hidden.get(id) ?? 0) + 1);
        continue;
      }
      push(id, { slug: p.slug, name: p.name, role: p.role, term: p.term, photo });
    }
  }
  const rank = (r: string) => (/^mayor$/i.test(r) || (/\bchair\b/i.test(r) && !/vice/i.test(r)) ? 0 : /vice/i.test(r) ? 1 : /^(council member|board member|commissioner|member)$/i.test(r) ? 3 : 2);
  // Each board as it sits now: its newest minutes this year (with chair, vice chair and alternate
  // roles) plus the city website's members with a current term.
  const siteNames = new Map<string, string[]>();
  for (const [name, id] of Object.entries(ALIAS)) (siteNames.get(id) ?? siteNames.set(id, []).get(id)!).push(name);
  const boardIds = [...new Set([...websiteBoards.keys(), 'planning-commission', 'arch-commission'])].filter((id) => id !== 'city-council' && id !== 'redevelopment-agency');
  await Promise.all(
    boardIds.map(async (id) => {
      const r = await currentRoster(env, id, siteNames.get(id) ?? [websiteBoards.get(id) ?? id]).catch(() => null);
      if (r?.length) {
        members.set(id, r.map((c) => ({ slug: c.slug ?? `pc-${slug(c.name)}`, name: c.name, role: c.role, term: c.term, photo: c.photo })));
        hidden.delete(id);
      }
    }),
  );
  // The boards the city website lists today, plus the City Council and the Redevelopment Agency.
  const out = (bodies.results ?? [])
    .filter((b) => !SKIP.has(b.id) && (b.id === 'city-council' || b.id === 'redevelopment-agency' || websiteBoards.has(b.id)))
    .map((b) => ({
      id: b.id,
      // The name the body meets under (the website may still use an older one).
      name: b.name.replace(/^Vineyard /, ''),
      meetingName: websiteBoards.get(b.id) ?? b.name,
      hiddenExpired: hidden.get(b.id) ?? 0,
      kind: STAFF_COMMITTEES.has(b.id) ? 'staff committee' : b.id === 'city-council' ? 'council' : 'board',
      meetings: Number(b.meetings ?? 0),
      firstMeeting: b.first,
      lastMeeting: b.last,
      nextMeeting: b.next,
      active: Boolean(b.next) || Boolean(b.last && b.last >= yearAgo),
      members: (members.get(b.id) ?? []).sort((x, y) => rank(x.role) - rank(y.role) || x.name.localeCompare(y.name)),
    }));
  // Boards the city lists members for that have no meetings on file yet.
  for (const [id, name] of listedOnly) if (!out.some((b) => b.id === id)) out.push({ id, name, meetingName: name, hiddenExpired: hidden.get(id) ?? 0, kind: 'board', meetings: 0, firstMeeting: null, lastMeeting: null, nextMeeting: null, active: true, members: members.get(id) ?? [] });
  const order = (b: (typeof out)[number]) => (b.id === 'city-council' ? 0 : b.id === 'redevelopment-agency' ? 1 : b.kind === 'staff committee' ? 4 : b.active ? 2 : 3);
  out.sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
  return json({ boards: out, asOf: today }, { cache: 'public, max-age=600' });
}
