/**
 * Every answer names an official by title and last name ("Council Member Nair", "Mayor Stratton",
 * "City Attorney Riddle"). Answers written by code do this themselves; a model-written answer is
 * rewritten here after the source check. A title comes only from the roster (the city's people
 * directory, plus the seat dates below): a name the roster does not hold, or a record dated outside
 * the person's seat, is left as written. Pure: no Worker types.
 */
import type { StaffPerson } from './contacts';

export interface Official {
  name: string;
  last: string;
  /** "Mayor", "Council Member", or the job title the directory gives ("City Attorney"). */
  title: string;
  /** First and last day the title held (inclusive). */
  from?: string;
  to?: string;
}

/**
 * The current mayor's and council's term began in January 2026 (src/console/votes.ts, COUNCIL_SEATS:
 * "Council members whose seat began after January 2026, when this council's term began"). A record
 * dated before that may name someone who then held another office, so no directory title is applied to it.
 */
export const TERM_FROM = '2026-01-01';

/**
 * Officials no longer in the directory, with their seat dates.
 * Ezra Nair, Council Member through September 15, 2026: the council chose Chip Price to fill his vacant
 * seat at its special meeting that day, and Nair voted on every item after the selection (draft minutes
 * of September 15, 2026, item 7.4, in the October 13, 2026 packet, doc_778fecc1b705e178 p. 7; see
 * COUNCIL_SEATS in src/console/votes.ts). His votes in the 2026 minutes are as "Council Member Nair"
 * (for example the August 11, 2026 minutes, doc_34ef709435ea7b2b p. 3).
 */
export const FORMER_OFFICIALS: Official[] = [{ name: 'Ezra Nair', last: 'Nair', title: 'Council Member', from: TERM_FROM, to: '2026-09-15' }];

/** Last names that are ordinary words: never rewritten on their own (see COMMON in contacts.ts). */
const COMMON_LAST = new Set(['price', 'wood', 'green', 'king', 'james', 'jones', 'thomas', 'adams', 'davis', 'smith', 'tyler', 'dye', 'baty', 'jackson', 'vance', 'young', 'hall', 'rose', 'banks', 'bond', 'nielsen', 'johnson', 'lara', 'evans']);

/** The title the directory gives a person, as it goes before a last name, or null when it gives none usable. */
export function directoryTitle(p: Pick<StaffPerson, 'kind' | 'role'>): string | null {
  const r = (p.role ?? '').replace(/\s+/g, ' ').trim();
  if (p.kind === 'elected') {
    if (/\bmayor\b/i.test(r) && !/\b(deputy|pro tem)/i.test(r)) return 'Mayor';
    if (/\bcouncil/i.test(r) || /\b(deputy mayor|mayor pro tem)/i.test(r)) return 'Council Member';
    return null;
  }
  // A plain job title ("City Attorney", "Public Works Director"); a description ("Director of ...") is not one.
  if (p.kind === 'staff' && r.length <= 40 && /^[A-Z][A-Za-z.]*(?: [A-Z][A-Za-z.]*){0,3}$/.test(r) && !/\b(of|and|for)\b/i.test(r)) return r;
  return null;
}

/** The roster: today's directory (elected officials and staff with a plain job title) and the former officials above. */
export function officialRoster(people: Array<Pick<StaffPerson, 'name' | 'kind' | 'role'>>): Official[] {
  const out: Official[] = [];
  for (const p of people) {
    const title = directoryTitle(p);
    const parts = p.name.trim().split(/\s+/);
    if (!title || parts.length < 2) continue;
    out.push({ name: parts.join(' '), last: parts[parts.length - 1], title, from: TERM_FROM });
  }
  for (const f of FORMER_OFFICIALS) if (!out.some((o) => o.last.toLowerCase() === f.last.toLowerCase())) out.push(f);
  // Two officials with one last name: neither is rewritten from the last name alone.
  return out;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** How the records and the model spell a council title. */
const COUNCIL_T = String.raw`(?:Council ?[Mm]ember|Councilmember|Council(?:wo)?man|Councilor|Council Person)`;
const COUNCIL_PL = String.raw`(?:Council ?[Mm]embers|Councilmembers|Councilors)`;
/** Titles that, written just before a name, already name the person properly (kept, spelling normalized). */
const ANY_TITLE = String.raw`(?:Mayor Pro Tem(?:pore|p)?|Deputy Mayor|Mayor|${COUNCIL_T}|${COUNCIL_PL}|Board Members?|Commissioners?|Chair(?:man|woman)?|Vice Chair)`;
const PLACE_AFTER = /^\s+(?:[A-Z][a-z]+|road|rd|street|st|drive|dr|lane|ln|avenue|ave|way|blvd|boulevard|park|fields?|farms?|estates?|subdivision|development|property|trail|school|elementary|crossing|canal|ditch|bridge|plaza|center|village)\b/;

const OPENERS = new Set('with and but then only both also when while after before since including except as at by for from of on to in yes no however meanwhile'.split(' '));

const normTitle =(t: string) => (new RegExp(`^${COUNCIL_T}$`, 'i').test(t) ? 'Council Member' : t);

/** True when every dated record the answer cites falls inside the official's seat. */
function seated(o: Official, dates: string[]): boolean {
  return dates.every((d) => d >= (o.from ?? TERM_FROM) && (!o.to || d <= o.to));
}

/**
 * Rewrites officials' names in a model-written sentence to title and last name:
 * "Councilmember Ezra Nair" -> "Council Member Nair"; "The mayor, Zack Stratton, broke the tie" ->
 * "Mayor Stratton broke the tie"; "Zack Stratton" -> "Mayor Stratton"; "Council Members Holdaway and
 * Lauret" -> "Council Member Holdaway and Council Member Lauret". `dates` are the dates of the records
 * the answer cites: a title from the directory is applied only when they fall inside the seat.
 */
export function titleOfficials(text: string, roster: Official[], dates: Array<string | null | undefined> = []): string {
  if (!roster.length || !text) return text;
  const known = dates.filter((d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)).map((d) => d.slice(0, 10));
  const lastCount = new Map<string, number>();
  for (const o of roster) lastCount.set(o.last.toLowerCase(), (lastCount.get(o.last.toLowerCase()) ?? 0) + 1);
  const byLast = (l: string) => roster.find((o) => o.last.toLowerCase() === l.toLowerCase());
  const lasts = roster.filter((o) => lastCount.get(o.last.toLowerCase()) === 1).map((o) => esc(o.last));
  let out = text;

  // "Council Members Holdaway, Lauret and McCumber": each member by title.
  if (lasts.length) {
    const L = `(?:${lasts.join('|')})`;
    out = out.replace(new RegExp(`\\b${COUNCIL_PL}\\s+(${L}(?:\\s*,\\s*(?:and\\s+)?${L}|\\s+and\\s+${L})+)\\b`, 'g'), (_m, list: string) =>
      list.replace(new RegExp(`\\b(${L})\\b`, 'g'), (n: string) => `Council Member ${byLast(n)?.last ?? n}`),
    );
  }

  for (const o of [...roster].sort((a, b) => b.name.length - a.name.length)) {
    const first = o.name.split(/\s+/).slice(0, -1).map(esc).join('\\s+');
    // A middle initial or a nickname in quotes may sit between first and last name.
    const FULL = `${first}(?:\\s+(?:[A-Z]\\.|"[A-Za-z]+"|“[A-Za-z]+”))?\\s+${esc(o.last)}`;
    const ok = seated(o, known);
    // "The mayor, Zack Stratton, ..." -> "Mayor Stratton ..."
    out = out.replace(new RegExp(`\\b([Tt]he|[Oo]ur)\\s+${esc(o.title.toLowerCase())}\\s*,\\s*${FULL}\\b(\\s*,)?`, 'g'), `${o.title} ${o.last}`);
    // A title already written before the full name: kept, with the last name only.
    out = out.replace(new RegExp(`\\b(${ANY_TITLE}|${esc(o.title)})\\s+${FULL}\\b`, 'g'), (_m, t: string) => `${normTitle(t)} ${o.last}`);
    // The full name with no title.
    if (ok) out = out.replace(new RegExp(`\\b${FULL}\\b`, 'g'), `${o.title} ${o.last}`);
    // "Councilmember Nair" -> "Council Member Nair".
    out = out.replace(new RegExp(`\\b${COUNCIL_T}\\s+${esc(o.last)}\\b`, 'g'), `Council Member ${o.last}`);
    // The last name alone ("Holdaway voted no"), when it can only be this official and is not a place.
    if (ok && lastCount.get(o.last.toLowerCase()) === 1 && o.last.length >= 4 && !COMMON_LAST.has(o.last.toLowerCase())) {
      out = out.replace(new RegExp(`\\b${esc(o.last)}\\b`, 'g'), (m: string, at: number, s: string) => {
        const before = s.slice(0, at);
        if (new RegExp(`(?:${ANY_TITLE}|${esc(o.title)})\\s+$`).test(before)) return m;
        // Preceded by a capitalized word that may be a first name ("Sarah Holdaway"): not ours to change.
        // A sentence opener ("With Holdaway absent") is not a name.
        const prev = before.match(/([A-Z][a-z]+)\s+$/);
        if (prev && !OPENERS.has(prev[1].toLowerCase())) return m;
        if (PLACE_AFTER.test(s.slice(at + m.length))) return m;
        return `${o.title} ${o.last}`;
      });
    }
  }
  return out;
}
