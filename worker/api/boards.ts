/**
 * Boards and commissions: every body that meets, with its members as the city website lists them
 * today, its meeting count, its last and next meeting, and whether it is still active (a body with
 * no meeting in the past year and none scheduled is shown as inactive).
 */
import type { Env } from '../env';
import { ensurePeopleTable } from './people';
import { json } from '../lib/http';

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
      if (!ALIAS[b.toLowerCase()]) listedOnly.set(id, b);
      push(id, { slug: p.slug, name: p.name, role: p.role, term: p.term, photo });
    }
  }
  const rank = (r: string) => (/^mayor$|^chair/i.test(r) ? 0 : /vice/i.test(r) ? 1 : /council member|board member|commissioner|member/i.test(r) ? 3 : 2);
  const out = (bodies.results ?? [])
    .filter((b) => !SKIP.has(b.id))
    .map((b) => ({
      id: b.id,
      name: b.name,
      kind: STAFF_COMMITTEES.has(b.id) ? 'staff committee' : b.id === 'city-council' ? 'council' : 'board',
      meetings: Number(b.meetings ?? 0),
      firstMeeting: b.first,
      lastMeeting: b.last,
      nextMeeting: b.next,
      active: Boolean(b.next) || Boolean(b.last && b.last >= yearAgo),
      members: (members.get(b.id) ?? []).sort((x, y) => rank(x.role) - rank(y.role) || x.name.localeCompare(y.name)),
    }));
  // Boards the city lists members for that have no meetings on file yet.
  for (const [id, name] of listedOnly) if (!out.some((b) => b.id === id)) out.push({ id, name, kind: 'board', meetings: 0, firstMeeting: null, lastMeeting: null, nextMeeting: null, active: true, members: members.get(id) ?? [] });
  const order = (b: (typeof out)[number]) => (b.id === 'city-council' ? 0 : b.id === 'redevelopment-agency' ? 1 : b.kind === 'staff committee' ? 4 : b.active ? 2 : 3);
  out.sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
  return json({ boards: out, asOf: today }, { cache: 'public, max-age=600' });
}
