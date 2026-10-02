/**
 * GET /api/draft-minutes?date=YYYY-MM-DD&body=City Council : a meeting's minutes before the city posts them as a
 * file. Until the council approves them, the draft minutes are printed inside the NEXT meeting's agenda packet.
 * This finds that page, so the portal can open it. Returns { draft: null } when there is none.
 */
import type { Env } from '../env';
import { CACHE, badRequest, json } from '../lib/http';
import { runSearch } from './search';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const KINDS = ['regular', 'special', 'work', 'joint'];

export interface DraftMinutes {
  documentId: string;
  title: string;
  /** Date of the packet that holds the draft. */
  date: string | null;
  page: number;
}

export async function findDraftMinutes(env: Env, date: string, body: string): Promise<DraftMinutes | null> {
  const [y, m, d] = date.split('-').map(Number);
  const spoken = `${MONTHS[m - 1]} ${d}, ${y}`;
  const names = [body.toLowerCase(), ...(/council/i.test(body) && !/redevelopment/i.test(body) ? ['city council'] : [])];
  const tries = [...new Set(names)].flatMap((name) => KINDS.map((kind) => `minutes of a ${kind} ${name} meeting ${spoken}`));
  const results = await Promise.all(
    tries.map((q) =>
      runSearch(env, { q, filters: { documentTypes: ['agenda_packet'], dateFrom: date }, match: 'phrase', titleOnly: false, sort: 'date_asc', page: 1, pageSize: 5 }).catch(() => null),
    ),
  );
  for (const res of results) {
    for (const it of res?.items ?? []) {
      const hit = it.excerpts.find((e) => e.page != null && /minutes of/i.test(e.text));
      if (hit?.page != null) return { documentId: it.document.id, title: it.document.title, date: it.document.date, page: hit.page };
    }
  }
  return null;
}

export async function getDraftMinutes(env: Env, url: URL): Promise<Response> {
  const date = url.searchParams.get('date') ?? '';
  const body = (url.searchParams.get('body') ?? 'City Council').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number(date.slice(5, 7)) < 1 || Number(date.slice(5, 7)) > 12) throw badRequest('`date` must be a YYYY-MM-DD date.');
  if (!/^[A-Za-z][A-Za-z &'-]{2,60}$/.test(body)) throw badRequest('`body` must be a public body name.');
  return json({ draft: await findDraftMinutes(env, date, body) }, { cache: CACHE.list });
}
