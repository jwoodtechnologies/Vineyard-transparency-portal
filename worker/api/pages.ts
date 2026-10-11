/**
 * One response per heavy page, so a phone makes one request instead of a waterfall of ten or more:
 *
 *   GET /api/pages/votes?body=&year=        City Council (and RDA) voting recap: years, the year's motions,
 *                                           the calendar's meetings, which minutes are read, people
 *   GET /api/pages/planning?year=           the same for the Planning Commission, plus attendance and the
 *                                           draft minutes printed in later packets (no per-meeting calls)
 *   GET /api/pages/construction             the city's Construction Projects page and the project list
 *
 * Each payload is built once per data version (worker/lib/dataVersion.ts) and stored in page_cache: the
 * five-minute check rebuilds the default payloads right after it changes data, so a request is one row
 * read (and usually an edge cache hit with no D1 read at all). A stored payload from an older data version
 * of the same build is served at once while the new one is built in the background; one from an earlier
 * deploy is rebuilt before it is served.
 */
import type { Env } from '../env';
import { badRequest, json } from '../lib/http';
import { dataVersion, readPage, writePage } from '../lib/dataVersion';
import { buildId } from '../lib/edgeCache';
import { listMeetings } from './misc';
import { listPeople } from './people';
import { commissionAttendance, handleVotes, meetingMinutes, PC, queryMotions, SCOPE_BODIES } from './votes';
import { findDraftMinutes, type DraftMinutes } from './draftMinutes';
import { getConstruction } from './construction';
import { getMapLayer } from './map';
import { PROJECTS } from '../lib/budgetData';

const BODY_NAME: Record<string, string> = { 'city-council': 'City Council', 'redevelopment-agency': 'Redevelopment Agency', 'planning-commission': 'Planning Commission' };

/** The fields the voting pages read from a meeting. */
interface MeetingLite {
  id: string;
  title: string;
  date: string | null;
  status: string;
  governmentBodyId: string | null;
  governmentBodyName: string | null;
  meetingType: string;
}

const internal = (path: string) => new URL(`https://vineyardportal.org${path}`);
const body = async <T>(res: Response | Promise<Response>): Promise<T> => (await (await res).json()) as T;
/** Utah's evening is already tomorrow in UTC, so the day is counted from six hours back. */
const utahToday = () => new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);

type VotesKind = 'council' | 'rda' | 'planning';
const kindOf = (b: string | null): VotesKind => (b === PC ? 'planning' : b === 'redevelopment-agency' ? 'rda' : 'council');

async function meetingsFor(env: Env, bodyId: string, year: number): Promise<MeetingLite[]> {
  const r = await body<{ items: Array<Record<string, unknown>> }>(listMeetings(env, internal(`/api/meetings?year=${year}&body=${bodyId}&pageSize=100&sort=date_desc`)));
  return (r.items ?? []).map((m) => ({
    id: String(m.id),
    title: String(m.title ?? ''),
    date: (m.date as string | null) ?? null,
    status: String(m.status ?? 'unknown'),
    governmentBodyId: (m.governmentBodyId as string | null) || null,
    governmentBodyName: (m.governmentBodyName as string | null) || null,
    meetingType: String(m.meetingType ?? 'other'),
  }));
}

/**
 * Planning Commission meetings held with no minutes read: where to look for draft minutes printed in a later
 * packet. Mirrors meetingsWithoutMinutes in src/console/votes.ts (canceled meetings and hearing notices are
 * not meetings that need minutes). Drafts already found are kept from the previous payload.
 */
async function draftsFor(env: Env, meetings: MeetingLite[], read: Array<{ date: string; bodyId: string }>, prior: Record<string, DraftMinutes | null> | undefined, recheck: boolean): Promise<Record<string, DraftMinutes | null>> {
  const today = utahToday();
  const have = new Set(read.map((r) => `${r.bodyId}|${r.date.slice(0, 10)}`));
  const groups = new Map<string, MeetingLite[]>();
  for (const m of meetings) {
    const date = (m.date ?? '').slice(0, 10);
    if (!date || date > today || !m.governmentBodyId) continue;
    if (/\b(?:public notice|notice of public hearing|comment period)\b/i.test(m.title) && !/\bcancel/i.test(m.title)) continue;
    const k = `${m.governmentBodyId}|${date}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(m);
  }
  const want: Array<{ key: string; date: string; body: string }> = [];
  for (const [k, list] of groups) {
    const date = k.slice(k.indexOf('|') + 1);
    if (have.has(k)) continue;
    if (list.some((m) => m.status === 'cancelled' || /\bcancel+(?:ed|ation)\b/i.test(m.title))) continue;
    if (!list.some((m) => m.status === 'held' || (m.status === 'scheduled' && date < today))) continue;
    const id = list[0].governmentBodyId as string;
    want.push({ key: k, date, body: BODY_NAME[id] ?? list[0].governmentBodyName ?? '' });
  }
  const out: Record<string, DraftMinutes | null> = {};
  await Promise.all(
    want.map(async (w) => {
      const before = prior?.[w.key];
      // A draft found stays found; a meeting with none is searched again at most once an hour (eight searches each).
      out[w.key] = before || (before === null && !recheck) ? before : w.body ? await findDraftMinutes(env, w.date, w.body).catch(() => null) : null;
    }),
  );
  return out;
}

export interface VotesPage {
  version: number;
  builtAt: string;
  kind: VotesKind;
  years: Array<{ year: number; motions: number; meetings: number }>;
  year: number | null;
  motions: { items: unknown[]; total: number };
  meetings: MeetingLite[];
  read: Array<{ date: string; bodyId: string; documentId: string; total: number; substantive: number }>;
  people: unknown[];
  drafts?: Record<string, DraftMinutes | null>;
  draftsCheckedAt?: string;
  attendance?: unknown;
}

/** Builds a voting page payload (the plain view: no member, word or result filter). */
export async function buildVotesPage(env: Env, kind: VotesKind, year: number | null, version: number, prior?: VotesPage | null): Promise<VotesPage> {
  const bodyParam = kind === 'planning' ? PC : kind === 'rda' ? 'redevelopment-agency' : null;
  const bodies = kind === 'planning' ? [PC] : kind === 'rda' ? ['redevelopment-agency'] : SCOPE_BODIES;
  const yearsQ = bodyParam ? `&body=${bodyParam}` : '';
  const [yearsRes, people] = await Promise.all([
    body<{ years: VotesPage['years'] }>(handleVotes(env, internal(`/api/votes/years?scope=current${yearsQ}`), 'years')),
    body<{ people: unknown[] }>(listPeople(env)),
  ]);
  const years = yearsRes.years ?? [];
  const y = year ?? years[0]?.year ?? Number(utahToday().slice(0, 4));
  const [motions, meetingLists, read, attendance] = await Promise.all([
    queryMotions(env, { body: bodyParam, year: y, pageSize: 400 }),
    Promise.all(bodies.map((b) => meetingsFor(env, b, y))),
    meetingMinutes(env, bodyParam, y),
    kind === 'planning' ? commissionAttendance(env) : Promise.resolve(undefined),
  ]);
  const meetings = meetingLists.flat();
  const page: VotesPage = { version, builtAt: new Date().toISOString(), kind, years, year: y, motions, meetings, read, people: people.people ?? [] };
  if (kind === 'planning') {
    page.attendance = attendance;
    const same = prior?.year === y ? prior : null;
    const recheck = !same?.draftsCheckedAt || Date.now() - Date.parse(same.draftsCheckedAt) > 3600_000;
    page.drafts = await draftsFor(env, meetings, read, same?.drafts, recheck);
    page.draftsCheckedAt = recheck ? page.builtAt : same!.draftsCheckedAt;
  }
  return page;
}

async function buildConstructionPage(env: Env, version: number): Promise<Record<string, unknown>> {
  const [construction, projects] = await Promise.all([
    body<Record<string, unknown>>(getConstruction(env)),
    getMapLayer(env, 'projects', internal('/api/map/layers/projects?page=0'))
      .then((r) => r.json() as Promise<unknown>)
      .catch(() => null),
  ]);
  // The adopted budget's capital projects, counted as /api/budget counts them, so /construction and /budget agree.
  const budget = { projects: PROJECTS.length, total: PROJECTS.reduce((t, p) => t + p.amount, 0) };
  return { version, builtAt: new Date().toISOString(), construction, projects, budget };
}

const pageKey = (name: string, year: number | null) => `${name}${year ? `:${year}` : ''}`;
const building = new Map<string, Promise<string>>();

/**
 * A stored payload for this data version, or a fresh build. An older stored payload is returned at once and
 * rebuilt in the background (waitUntil), so no reader waits on the build after the first one.
 */
async function servePage(env: Env, ctx: ExecutionContext | null, key: string, build: (version: number, prior: string | null) => Promise<unknown>): Promise<Response> {
  const version = await dataVersion(env);
  const thisBuild = buildId(env);
  const found = await readPage(env, key);
  // A payload built by an earlier deploy is never served: its shape or its reading of the records may have changed.
  const stored = found && found.build === thisBuild ? found : null;
  const rebuild = () => {
    const running = building.get(key);
    if (running) return running;
    const p = build(version, stored?.body ?? null)
      .then(async (payload) => {
        const text = JSON.stringify(payload);
        await writePage(env, key, version, text, thisBuild).catch(() => undefined);
        return text;
      })
      .finally(() => building.delete(key));
    building.set(key, p);
    return p;
  };
  const headers = { 'x-data-version': String(version), 'x-build': thisBuild };
  if (stored && stored.version === version) return respond(stored.body, headers);
  if (stored && ctx) {
    ctx.waitUntil(rebuild().catch(() => undefined));
    return respond(stored.body, { ...headers, 'x-page-stale': '1' });
  }
  return respond(await rebuild(), headers);
}

function respond(text: string, headers: Record<string, string>): Response {
  const res = json(null, { cache: 'public, max-age=300', headers });
  return new Response(text, { status: 200, headers: res.headers });
}

const parsePrior = <T>(text: string | null): T | null => {
  try {
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
};

export async function handlePages(env: Env, url: URL, name: string, ctx: ExecutionContext | null): Promise<Response> {
  const yearRaw = url.searchParams.get('year');
  if (yearRaw && !/^\d{4}$/.test(yearRaw)) throw badRequest('`year` must be a four digit year.');
  const year = yearRaw ? Number(yearRaw) : null;
  if (name === 'votes' || name === 'planning') {
    const b = name === 'planning' ? PC : url.searchParams.get('body');
    if (b && !/^[a-z0-9-]{2,60}$/.test(b)) throw badRequest('Invalid body.');
    const kind = kindOf(b);
    return servePage(env, ctx, pageKey(`votes-${kind}`, year), (version, prior) => buildVotesPage(env, kind, year, version, parsePrior<VotesPage>(prior)));
  }
  if (name === 'construction') return servePage(env, ctx, pageKey('construction', null), (version) => buildConstructionPage(env, version));
  throw badRequest('Unknown page.');
}

/** After the data changes: rebuild the default payloads so the next reader gets them with one row read. */
export async function rebuildPages(env: Env, kinds: VotesKind[] = ['council', 'planning', 'rda'], construction = false): Promise<Record<string, number>> {
  const version = await dataVersion(env);
  const build = buildId(env);
  const out: Record<string, number> = {};
  for (const kind of kinds) {
    const key = pageKey(`votes-${kind}`, null);
    const stored = await readPage(env, key);
    const prior = parsePrior<VotesPage>(stored && stored.build === build ? stored.body : null);
    const page = await buildVotesPage(env, kind, null, version, prior);
    await writePage(env, key, version, JSON.stringify(page), build);
    out[kind] = page.motions.items.length;
  }
  if (construction) {
    await writePage(env, 'construction', version, JSON.stringify(await buildConstructionPage(env, version)), build);
    out.construction = 1;
  }
  return out;
}
