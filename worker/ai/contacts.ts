/**
 * City staff in Ask: who a question names, who "he" or "she" means in a follow-up, and which
 * current staff member a resident should contact for what they are asking about. Only people the
 * city website lists today are used. Pure (no Worker types) so it is exact and tested.
 */

export interface StaffPerson {
  slug: string;
  name: string;
  kind: string; // elected | staff | board
  role: string;
  department: string | null;
  email: string | null;
  phone: string | null;
}

/** Last names that are ordinary words here and never match on their own. */
const COMMON = new Set(['price', 'wood', 'green', 'king', 'james', 'jones', 'thomas', 'adams', 'davis', 'smith', 'tyler', 'dye', 'baty', 'jackson', 'vance', 'young', 'hall', 'rose', 'banks', 'bond', 'nielsen', 'johnson']);
/** A name followed by one of these is a place: "Holdaway Road", "Holdaway Fields". */
const PLACE_AFTER = /^(road|rd|street|st|drive|dr|lane|ln|avenue|ave|way|blvd|boulevard|park|fields?|farms?|estates?|subdivision|development|property|trail|school|elementary|crossing|canal|ditch|bridge|plaza|center|village)\b/;

const norm = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9' -]+/g, ' ').replace(/\s+/g, ' ').trim()} `;

/** Current people named in the text: full name, any two parts of a longer name, title + last name, or a distinctive last name. */
export function namedIn(text: string, people: StaffPerson[]): StaffPerson[] {
  const raw = norm(text);
  const q = raw.replace(/ ([a-z']+)(?= (\S+))/g, (m, w: string, next: string) => (PLACE_AFTER.test(next) && people.some((p) => p.name.toLowerCase().split(/\s+/).includes(w)) ? ' __place__' : m));
  const found: StaffPerson[] = [];
  const add = (p: StaffPerson) => !found.includes(p) && found.push(p);
  for (const p of people) if (q.includes(` ${p.name.toLowerCase()} `) || q.includes(` ${p.name.toLowerCase()}'`)) add(p);
  for (const p of people) {
    const parts = p.name.toLowerCase().split(/\s+/);
    // "David Kyle" or "Kyle Herring" for David Kyle Herring.
    for (let i = 0; i + 1 < parts.length; i++) if (parts.length >= 3 && q.includes(` ${parts[i]} ${parts[i + 1]} `)) add(p);
    // First and last name with a middle name skipped.
    if (parts.length >= 3 && q.includes(` ${parts[0]} ${parts[parts.length - 1]} `)) add(p);
    const last = parts[parts.length - 1];
    if (new RegExp(`\\b(mayor|deputy mayor|council ?(member|man|woman)|councilor|director|manager|recorder|officer|mr|mrs|ms)\\s+${last}\\b`).test(q)) add(p);
  }
  if (!found.length) {
    for (const p of people) {
      const parts = p.name.toLowerCase().split(/\s+/);
      const last = parts[parts.length - 1];
      const sameLast = people.filter((x) => x.name.toLowerCase().endsWith(` ${last}`)).length;
      if (last.length >= 5 && !COMMON.has(last) && sameLast === 1 && q.includes(` ${last} `)) add(p);
    }
  }
  return found;
}

/** "Who is he?", "what does she do", "how do I reach him": a follow-up about a person. */
export const PERSON_PRONOUN = /\b(he|she|him|her|his|hers)\b/i;
export const isPersonFollowUp = (q: string) => PERSON_PRONOUN.test(q) && q.trim().split(/\s+/).length <= 10;

/** The question asks who someone is or how to reach them (not what they voted on or said). */
export function isIdentityQuestion(q: string, named: StaffPerson | null): boolean {
  const t = q.trim();
  if (/\b(vot\w*|said|say|says|think|position|stance|motion|propos\w*|support\w*|oppos\w*|record|history)\b/i.test(t)) return false;
  if (/^(who\s+(is|was|'s)|who's|what\s+(does|is)\s+.*\b(do|job|role|title|position)\b|tell me (about|who)|how (do|can) i (reach|contact|email|call)|contact (info|information)|(what is|what's) (his|her|their) (email|phone|number|title|role|job))/i.test(t)) return true;
  // Just a name, or a correction ("No, David Kyle").
  if (named) {
    const rest = norm(t).replace(new RegExp(` (${named.name.toLowerCase().split(/\s+/).join('|')}) `, 'g'), ' ').replace(/ (no|not|i mean|meant|actually|the|mr|mrs|ms|is|who|about|please|sorry) /g, ' ').trim();
    if (rest.split(/\s+/).filter(Boolean).length <= 1) return true;
  }
  return false;
}

const DEPT = (p: StaffPerson) => (p.department && p.department !== p.role && !/mayor and city council/i.test(p.department) ? p.department.replace(/'S\b/g, "'s") : null);

/** One plain sentence from the city's own directory, with contact details the city publishes. */
export function whoIsAnswer(p: StaffPerson): string {
  const dept = DEPT(p);
  const where = p.kind === 'elected' ? "on the city's list of elected officials" : "on the city's staff directory";
  const role = /^council ?member$/i.test(p.role) ? 'a member of the City Council' : /^(a|an|the)\b/i.test(p.role) ? p.role : `the ${p.role}`;
  const first = `${p.name} is ${role}${dept ? ` (${dept})` : ''} for Vineyard, as listed ${where}.`;
  const reach = [p.email ? `email ${p.email}` : null, p.phone ? `call ${p.phone}` : null].filter(Boolean);
  return reach.length ? `${first} To reach ${p.name.split(/\s+/)[0]}, ${reach.join(' or ')}.` : `${first} The city does not list a direct email or phone, so reach ${p.name.split(/\s+/)[0]} through City Hall at 801-226-1929.`;
}

/** What a resident is asking for help with, and which staff title handles it. */
const TOPICS: Array<{ match: RegExp; title: RegExp; dept?: RegExp }> = [
  { match: /\b(code enforcement|noise|noisy|loud|nuisance|barking|weeds?|junk|trash in (the )?yard|abandoned (car|vehicle)|rv parked|parked on (the )?(lawn|grass)|neighbou?rs?\b.*\b(complain|report)|complain\w*)\b/i, title: /code enforcement/i },
  { match: /\b(pot ?holes?|street (repair|damage|light)|streetlights?|snow ?plow\w*|plowing|storm ?drains?|storm ?water|sidewalks? (crack|broken|repair)|road (damage|repair)|curb|gutter)\b/i, title: /streets? .*stormwater manager|stormwater manager/i },
  { match: /\b(water (main|leak|break|outage|pressure|quality|line)|no water|sewer|wastewater|backup|meter)\b/i, title: /environmental utilities manager/i },
  { match: /\b(public works|road construction|construction on|capital (improvement )?projects?|engineering|traffic (signal|light|study)|speed bumps?)\b/i, title: /public works\/engineering director|public works.*director/i },
  { match: /\b(grama|records? requests?|public records? request|minutes request)\b/i, title: /^city recorder$/i },
  { match: /\b(building permits?|permit inspection|inspections?|building official|certificate of occupancy|remodel|basement finish)\b/i, title: /chief building official/i },
  { match: /\b(trees?|arborist|tree trimming)\b/i, title: /arborist/i },
  { match: /\b(parks?|pavilion|reserv\w* a (park|pavilion)|recreation|rec programs?|sports leagues?|splash pad)\b/i, title: /parks .*recreation director|recreation director/i },
  { match: /\b(budget|finance|financial|audit|taxes|tax rate|accounts payable)\b/i, title: /finance director/i },
  { match: /\b(newsletter|press|media|social media|communications?)\b/i, title: /communications/i },
];
/** Asking for help or how to do something, not asking what happened in a meeting. */
const HELP = /\b(how (do|can|should) i|who (do|should|can) i|where (do|can) i|i (want|need|have) to|i'?d like to|report|complain\w*|file|contact|call|email|reach|fix|broken|problem|issue|request|help|is there someone|someone to|my (neighbou?r|street|road|yard|house|water|sewer|permit))\b/i;

/** The one current staff member to contact for what the resident is asking, when it makes sense. */
export function contactFor(q: string, people: StaffPerson[]): StaffPerson | null {
  if (!HELP.test(q)) return null;
  const staff = people.filter((p) => p.kind === 'staff');
  for (const t of TOPICS) {
    if (!t.match.test(q)) continue;
    const p = staff.find((s) => t.title.test(s.role));
    if (p) return p;
  }
  return null;
}

/** "For this, the city staff contact is Ed Kennedy, Code Enforcement Officer." */
export function contactLine(p: StaffPerson): string {
  const reach = p.email ? ` (${p.email})` : p.phone ? ` (${p.phone})` : '';
  return `The city staff contact for this is ${p.name}, ${p.role}${reach}.`;
}

/** "The deputy mayor", "the city recorder", "code enforcement officer": whoever holds that title today (one holder only). */
export function titleIn(q: string, people: StaffPerson[]): StaffPerson | null {
  const t = norm(q);
  const hits = people.filter((p) => {
    const role = norm(p.role).trim();
    if (role.length < 6 || /^(council member|member|staff|mayor)$/.test(role)) return false;
    return role.split('/').some((r) => r.trim().length >= 6 && t.includes(` ${r.trim()} `));
  });
  if (/ deputy mayor /.test(t)) return hits.find((p) => /deputy mayor/i.test(p.role)) ?? null;
  if (!hits.length && / (the )?mayor('s)? /.test(t) && !/ mayor pro tem /.test(t)) return people.find((p) => p.kind === 'elected' && /^mayor$/i.test(p.role)) ?? null;
  // The longest matching title wins ("deputy recorder" over "recorder"); a title several people hold is ambiguous.
  hits.sort((a, b) => b.role.length - a.role.length);
  const best = hits[0];
  return best && hits.filter((h) => h.role === best.role).length === 1 ? best : null;
}

/** The person a follow-up means: the one named first in the last answer, else in the last question. */
export function personFromTurns(turns: string[], people: StaffPerson[]): StaffPerson | null {
  for (const text of turns) {
    const found = namedIn(text, people);
    if (!found.length) continue;
    const low = text.toLowerCase();
    const at = (p: StaffPerson) => {
      const parts = p.name.toLowerCase().split(/\s+/);
      const idx = [p.name.toLowerCase(), ...parts].map((s) => low.indexOf(s)).filter((i) => i >= 0);
      return idx.length ? Math.min(...idx) : Infinity;
    };
    return found.sort((a, b) => at(a) - at(b))[0];
  }
  return null;
}
