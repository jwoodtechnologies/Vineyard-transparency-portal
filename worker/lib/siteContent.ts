/**
 * Site content staff can edit without a code change: short pieces of wording and lists that the public pages ship with
 * built in. Each piece is one row in `site_content`, keyed by name, holding only what staff changed. A page uses the stored
 * piece when there is one and its built-in wording when there is not, so "use the original" is just deleting the row.
 *
 * A save is checked strictly: anything wrong is refused with a plain sentence. A read is checked leniently: a field or item
 * that no longer passes (a limit that was lowered, a group that was renamed) is dropped on its own, so one bad part can never
 * hide the rest of what staff wrote, and a stored row can never break a public page.
 *
 * To make another piece editable, add a spec to SPECS (its staff area, a checker, and a sentence for the activity log). The staff
 * routes (worker/staff/content.ts) and the public read (GET /api/content) pick it up.
 */
import type { Env } from '../env';
import { badRequest } from './http';
import { plainLine, plainText } from './contrib';
import { PROJECT_CATEGORIES, type ProjectCategory } from '../../src/lib/projectCategories';
import { builtInMeta } from '../../src/lib/projectMeta';
import {
  ADDED_KINDS,
  DIRECTORY,
  DIRECTORY_GROUPS,
  EDITABLE_LINKS,
  LINKS,
  SERVICE_HINT_MAX,
  SERVICE_LABEL_MAX,
  SERVICE_WORDS_MAX,
  SERVICE_WORD_MAX,
  SERVICES_ADDED_MAX,
  cleanPhone,
  isPhoneLink,
  safeHref,
  type AddedService,
  type ContactEdit,
  type ContactsContent,
  type LinkKey,
  type ServiceEdit,
  type ServiceLink,
  type ServicesContent,
} from '../../src/lib/cityServices';
import { WORK_ADDED_MAX, WORK_FIELDS, WORK_LIMITS, rowKey, type AddedWork, type ConstructionContent, type WorkFields } from '../../src/lib/constructionRows';
import type { Area } from '../staff/core';

export { PROJECT_CATEGORIES, type ProjectCategory };

export const PROJECT_NAME_MAX = 90;
export const PROJECT_ABOUT_MAX = 500;
export const PROJECT_GIS_MAX = 160;
export const MAX_PLAN_EDITS = 60;
export const MAX_ALSO = 40;

/** What staff changed about the funded projects beside the map. */
export interface ProjectsContent {
  /** By the project's name on the city's plan map. Only the fields staff changed are present. */
  plans: Record<string, { name?: string; category?: ProjectCategory; about?: string }>;
  /** The "also funded, not on the map" list. null means the built-in list. */
  also: Array<{ id: string; name: string; about: string }> | null;
}

export interface ContentSpec<T = unknown> {
  area: Area;
  label: string;
  /**
   * Cleans a piece. Strict (the default) throws a plain sentence staff can act on; lenient drops whatever does not pass and
   * never throws on content, for reading what is already stored.
   */
  check(v: unknown, lenient?: boolean): T;
  /** A sentence for the activity log. */
  summarize(before: T | null, after: T | null): string;
}

const asObject = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Staff type plain words. Text that looks like web page code is refused rather than quietly cut, so "under <5 acres" is never mangled. */
const MARKUP = /<\s*[a-zA-Z/!?]/;

function text(v: unknown, max: number, what: string, lenient: boolean, paragraph: boolean): string {
  if (typeof v !== 'string') return '';
  if (MARKUP.test(v)) {
    if (!lenient) throw badRequest(`${what} has web page code in it (something between < and >). Type plain words only.`);
    return '';
  }
  const raw = paragraph ? plainText(v, max * 2).replace(/\s+/g, ' ') : plainLine(v, max * 2);
  const out = raw.trim();
  if (out.length > max) {
    if (!lenient) throw badRequest(`${what} is longer than ${max} characters.`);
    return out.slice(0, max);
  }
  return out;
}

const randomHex = (bytes: number) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
const ALSO_ID = /^a_[0-9a-f]{8,16}$/;

export function checkProjects(v: unknown, lenient = false): ProjectsContent {
  const o = asObject(v);
  const plansIn = asObject(o.plans);
  const keys = Object.keys(plansIn);
  if (keys.length > MAX_PLAN_EDITS && !lenient) throw badRequest(`That is more than ${MAX_PLAN_EDITS} projects changed at once. Save in smaller steps.`);
  // A plain object with no prototype: a project called "constructor" or "toString" is just another name.
  const plans = Object.create(null) as ProjectsContent['plans'];
  for (const gis of keys.slice(0, MAX_PLAN_EDITS)) {
    const key = plainLine(gis, PROJECT_GIS_MAX);
    if (!key) continue;
    const p = asObject(plansIn[gis]);
    const entry: ProjectsContent['plans'][string] = {};
    const name = text(p.name, PROJECT_NAME_MAX, 'A project name', lenient, false);
    const about = text(p.about, PROJECT_ABOUT_MAX, 'A description', lenient, true);
    const category = PROJECT_CATEGORIES.find((c) => c === p.category);
    if (typeof p.category === 'string' && p.category && !category && !lenient) throw badRequest('Choose a group from the list.');
    if (name) entry.name = name;
    if (category) entry.category = category;
    if (about) entry.about = about;
    if (Object.keys(entry).length) plans[key] = entry;
  }

  let also: ProjectsContent['also'] = null;
  if (o.also !== null && o.also !== undefined) {
    if (!Array.isArray(o.also)) {
      if (!lenient) throw badRequest('The list of other funded projects did not come through. Reload and try again.');
    } else {
      if (o.also.length > MAX_ALSO && !lenient) throw badRequest(`Keep this list to ${MAX_ALSO} projects or fewer.`);
      also = [];
      for (const raw of o.also.slice(0, MAX_ALSO)) {
        const a = asObject(raw);
        const name = text(a.name, PROJECT_NAME_MAX, 'A project name', lenient, false);
        if (!name) {
          if (!lenient) throw badRequest('Give every project in the list a name.');
          continue;
        }
        const about = text(a.about, PROJECT_ABOUT_MAX, 'A description', lenient, true);
        const id = typeof a.id === 'string' && ALSO_ID.test(a.id) ? a.id : `a_${randomHex(5)}`;
        also.push({ id, name, about });
      }
      const seen = new Set<string>();
      for (const a of also) {
        if (seen.has(a.id)) a.id = `a_${randomHex(5)}`;
        seen.add(a.id);
      }
    }
  }
  return { plans, also };
}

/** "Name", or "Name and Other", for a short list of names. */
const nameList = (names: string[]) => (names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

function summarizeProjects(before: ProjectsContent | null, after: ProjectsContent | null): string {
  const b = before?.plans ?? {};
  const a = after?.plans ?? {};
  const changed = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => JSON.stringify(b[k] ?? null) !== JSON.stringify(a[k] ?? null));
  const parts: string[] = [];
  if (changed.length === 1) {
    const k = changed[0];
    // The name staff see in the list: theirs if they set one, otherwise the portal's own name for it.
    const shown = a[k]?.name ?? b[k]?.name ?? builtInMeta(k).name;
    parts.push(a[k] ? `Changed the map project "${shown}"` : `Put back the original wording for the map project "${shown}"`);
  } else if (changed.length > 1) {
    parts.push(`Changed ${changed.length} map projects`);
  }
  if (JSON.stringify(before?.also ?? null) !== JSON.stringify(after?.also ?? null)) {
    const was = before?.also?.map((x) => x.name) ?? null;
    const now = after?.also?.map((x) => x.name) ?? null;
    let line = 'the list of other funded projects';
    if (was && now) {
      const added = now.filter((n) => !was.includes(n));
      const removed = was.filter((n) => !now.includes(n));
      if (added.length && !removed.length) line = `the list of other funded projects (added ${nameList(added)})`;
      else if (removed.length && !added.length) line = `the list of other funded projects (removed ${nameList(removed)})`;
    } else if (!now) {
      line = 'the list of other funded projects (back to the original list)';
    }
    parts.push(parts.length ? `and ${line}` : `Changed ${line}`);
  }
  return parts.join(' ') || 'Saved the map project wording';
}

// ---- Service links (the Services page and the buttons under answers)

const BUILT_IN = new Map(DIRECTORY.map((d) => [d.id, d]));
const ADDED_ID = /^s_[0-9a-f]{8,16}$/;
const WORD_OK = /^[\p{L}\p{N}][\p{L}\p{N} '&.-]*$/u;

function words(v: unknown, lenient: boolean): string[] {
  if (v === undefined || v === null) return [];
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [];
  if (list.length > SERVICE_WORDS_MAX && !lenient) throw badRequest(`Use at most ${SERVICE_WORDS_MAX} words or phrases.`);
  const out: string[] = [];
  for (const raw of list.slice(0, SERVICE_WORDS_MAX)) {
    const w = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().toLowerCase() : '';
    if (!w) continue;
    if (w.length > SERVICE_WORD_MAX || !WORD_OK.test(w)) {
      if (!lenient) throw badRequest(`"${w.slice(0, 40)}" cannot be used as a search word. Use letters, numbers and spaces, ${SERVICE_WORD_MAX} characters at most.`);
      continue;
    }
    if (!out.includes(w)) out.push(w);
  }
  return out;
}

function href(v: unknown, lenient: boolean): string | null {
  const h = safeHref(v);
  if (!h && !lenient) throw badRequest('That web address will not work. Paste the full address, starting with https://, or a page of the portal starting with /.');
  return h;
}

const group = (v: unknown, lenient: boolean) => {
  const g = DIRECTORY_GROUPS.find((x) => x === v);
  if (!g && !lenient) throw badRequest('Choose a group from the list.');
  return g ?? null;
};

export function checkServices(v: unknown, lenient = false): ServicesContent {
  const o = asObject(v);
  const editsIn = asObject(o.edits);
  const edits = Object.create(null) as ServicesContent['edits'];
  for (const id of Object.keys(editsIn).slice(0, DIRECTORY.length + 10)) {
    const b = BUILT_IN.get(id);
    if (!b) {
      if (!lenient) throw badRequest('One of those services is no longer on the list. Reload the page and try again.');
      continue;
    }
    const e = asObject(editsIn[id]);
    const out: ServiceEdit = {};
    const label = text(e.label, SERVICE_LABEL_MAX, 'A name', lenient, false);
    if (label && label !== b.label) out.label = label;
    if (typeof e.hint === 'string') {
      const hint = text(e.hint, SERVICE_HINT_MAX, 'A short note', lenient, false);
      if (hint !== (b.hint ?? '')) out.hint = hint;
    }
    if (typeof e.href === 'string' && e.href.trim()) {
      const h = href(e.href, lenient);
      if (h && h !== b.href) out.href = h;
    }
    if (e.group !== undefined && e.group !== null && e.group !== '') {
      const g = group(e.group, lenient);
      if (g && g !== b.group) out.group = g;
    }
    const w = words(e.words, lenient);
    if (w.length) out.words = w;
    if (Object.keys(out).length) edits[id] = out;
  }

  let addedIn = Array.isArray(o.added) ? o.added : [];
  if (addedIn.length > SERVICES_ADDED_MAX) {
    if (!lenient) throw badRequest(`Keep added services to ${SERVICES_ADDED_MAX} or fewer.`);
    addedIn = addedIn.slice(0, SERVICES_ADDED_MAX);
  }
  const added: AddedService[] = [];
  const seen = new Set<string>();
  for (const raw of addedIn) {
    const a = asObject(raw);
    const label = text(a.label, SERVICE_LABEL_MAX, 'A name', lenient, false);
    if (!label) {
      if (!lenient) throw badRequest('Give every added service a name.');
      continue;
    }
    if (typeof a.href !== 'string' || !a.href.trim()) {
      if (!lenient) throw badRequest(`Add the web address for "${label}".`);
      continue;
    }
    const h = href(a.href, lenient);
    const g = group(a.group, lenient);
    if (!h || !g) continue;
    let id = typeof a.id === 'string' && ADDED_ID.test(a.id) ? a.id : `s_${randomHex(5)}`;
    if (seen.has(id)) id = `s_${randomHex(5)}`;
    seen.add(id);
    const kind = ADDED_KINDS.find((k) => k === a.kind) ?? 'page';
    added.push({ id, label, hint: text(a.hint, SERVICE_HINT_MAX, 'A short note', lenient, false), href: h, group: g, kind, words: words(a.words, lenient) });
  }

  const known = new Set([...BUILT_IN.keys(), ...added.map((a) => a.id)]);
  const hidden = [...new Set((Array.isArray(o.hidden) ? o.hidden : []).filter((x): x is string => typeof x === 'string' && known.has(x)))];
  return { edits, hidden, added };
}

/** One change in a sentence, or the count when a save made several. */
function oneOrCount(changes: string[], many: (n: number) => string, none: string): string {
  if (changes.length === 1) return changes[0];
  return changes.length ? many(changes.length) : none;
}

function summarizeServices(before: ServicesContent | null, after: ServicesContent | null): string {
  if (!after) return 'Put back the original service links';
  const nameOf = (id: string, c: ServicesContent | null) => c?.edits[id]?.label ?? c?.added.find((a) => a.id === id)?.label ?? BUILT_IN.get(id)?.label ?? id;
  const changes: string[] = [];
  const bAdded = new Map((before?.added ?? []).map((a) => [a.id, a]));
  const aAdded = new Map(after.added.map((a) => [a.id, a]));
  for (const [id, a] of aAdded) {
    const was = bAdded.get(id);
    if (!was) changes.push(`Added the service link "${a.label}"`);
    else if (JSON.stringify(was) !== JSON.stringify(a)) changes.push(`Changed the service link "${a.label}"`);
  }
  for (const [id, a] of bAdded) if (!aAdded.has(id)) changes.push(`Removed the service link "${a.label}"`);
  for (const id of new Set([...Object.keys(before?.edits ?? {}), ...Object.keys(after.edits)])) {
    const was = JSON.stringify(before?.edits[id] ?? null);
    const now = JSON.stringify(after.edits[id] ?? null);
    if (was === now) continue;
    changes.push(after.edits[id] ? `Changed the service link "${nameOf(id, after)}"` : `Put back the original wording for the service link "${nameOf(id, before)}"`);
  }
  const bh = new Set(before?.hidden ?? []);
  const ah = new Set(after.hidden);
  for (const id of ah) if (!bh.has(id)) changes.push(`Hid the service link "${nameOf(id, after)}"`);
  for (const id of bh) if (!ah.has(id) && (BUILT_IN.has(id) || aAdded.has(id))) changes.push(`Showed the service link "${nameOf(id, after)}" again`);
  return oneOrCount(changes, (n) => `Changed ${n} service links`, 'Saved the service links');
}

// ---- Phone numbers and quick links (the buttons under answers, and City Hall's number)

export function checkContacts(v: unknown, lenient = false): ContactsContent {
  const o = asObject(v);
  const editsIn = asObject(o.edits);
  const edits: ContactsContent['edits'] = {};
  for (const key of Object.keys(editsIn)) {
    const k = EDITABLE_LINKS.find((x) => x === key);
    if (!k) {
      if (!lenient) throw badRequest('One of those links is no longer on the list. Reload the page and try again.');
      continue;
    }
    const b = LINKS[k] as ServiceLink;
    const e = asObject(editsIn[key]);
    const out: ContactEdit = {};
    const label = text(e.label, SERVICE_LABEL_MAX, 'A name', lenient, false);
    if (label && label !== b.label) out.label = label;
    if (isPhoneLink(k)) {
      if (typeof e.phone === 'string' && e.phone.trim()) {
        const phone = cleanPhone(e.phone);
        if (!phone && !lenient) throw badRequest('Type the phone number as 10 digits, like 801-226-1929.');
        if (phone && phone !== b.hint) out.phone = phone;
      }
    } else {
      if (typeof e.hint === 'string') {
        const hint = text(e.hint, SERVICE_HINT_MAX, 'A short note', lenient, false);
        if (hint !== (b.hint ?? '')) out.hint = hint;
      }
      if (typeof e.href === 'string' && e.href.trim()) {
        const h = href(e.href, lenient);
        if (h && h !== b.href) out.href = h;
      }
    }
    if (Object.keys(out).length) edits[k] = out;
  }
  const hidden = [...new Set((Array.isArray(o.hidden) ? o.hidden : []).filter((x): x is LinkKey => typeof x === 'string' && EDITABLE_LINKS.includes(x as LinkKey)))];
  return { edits, hidden };
}

function summarizeContacts(before: ContactsContent | null, after: ContactsContent | null): string {
  if (!after) return 'Put back the original phone numbers and quick links';
  const nameOf = (k: LinkKey) => after.edits[k]?.label ?? before?.edits[k]?.label ?? LINKS[k].label;
  const changes: string[] = [];
  for (const k of EDITABLE_LINKS) {
    const was = before?.edits[k] ?? null;
    const now = after.edits[k] ?? null;
    if (JSON.stringify(was) === JSON.stringify(now)) continue;
    if (!now) changes.push(`Put back the original "${nameOf(k)}"`);
    else if (now.phone && now.phone !== was?.phone) changes.push(`Changed the phone number for "${nameOf(k)}" to ${now.phone}`);
    else changes.push(`Changed "${nameOf(k)}"`);
  }
  const bh = new Set(before?.hidden ?? []);
  const ah = new Set(after.hidden);
  for (const k of ah) if (!bh.has(k)) changes.push(`Hid "${nameOf(k)}"`);
  for (const k of bh) if (!ah.has(k)) changes.push(`Showed "${nameOf(k)}" again`);
  return oneOrCount(changes, (n) => `Changed ${n} phone numbers and quick links`, 'Saved the phone numbers and quick links');
}

// ---- Construction now (the city's Construction Projects table, corrected and added to)

const WORK_ID = /^c_[0-9a-f]{8,16}$/;
const WORK_LABEL: Record<keyof WorkFields, string> = { where: 'Where', work: 'The work', status: 'Status', expected: 'Expected finish' };

export function checkConstruction(v: unknown, lenient = false): ConstructionContent {
  const o = asObject(v);
  const editsIn = asObject(o.edits);
  const edits = Object.create(null) as ConstructionContent['edits'];
  for (const raw of Object.keys(editsIn).slice(0, 80)) {
    const key = rowKey(raw);
    if (!key) continue;
    const e = asObject(editsIn[raw]);
    const out: Partial<WorkFields> = {};
    for (const f of WORK_FIELDS) if (typeof e[f] === 'string') out[f] = text(e[f], WORK_LIMITS[f], WORK_LABEL[f], lenient, f === 'work');
    if (Object.keys(out).length) edits[key] = out;
  }
  let addedIn = Array.isArray(o.added) ? o.added : [];
  if (addedIn.length > WORK_ADDED_MAX) {
    if (!lenient) throw badRequest(`Keep added projects to ${WORK_ADDED_MAX} or fewer. Hide or remove finished ones first.`);
    addedIn = addedIn.slice(0, WORK_ADDED_MAX);
  }
  const added: AddedWork[] = [];
  const seen = new Set<string>();
  for (const raw of addedIn) {
    const a = asObject(raw);
    const name = text(a.name, WORK_LIMITS.name, 'A project name', lenient, false);
    if (!name) {
      if (!lenient) throw badRequest('Give every added project a name.');
      continue;
    }
    let id = typeof a.id === 'string' && WORK_ID.test(a.id) ? a.id : `c_${randomHex(5)}`;
    if (seen.has(id)) id = `c_${randomHex(5)}`;
    seen.add(id);
    const row: AddedWork = { id, name, where: '', work: '', status: '', expected: '' };
    for (const f of WORK_FIELDS) row[f] = text(a[f], WORK_LIMITS[f], WORK_LABEL[f], lenient, f === 'work');
    added.push(row);
  }
  const ids = new Set(added.map((a) => a.id));
  const hidden = [...new Set((Array.isArray(o.hidden) ? o.hidden : []).filter((x): x is string => typeof x === 'string').map((x) => (ids.has(x) ? x : rowKey(x))).filter(Boolean))].slice(0, 80);
  return { edits, hidden, added };
}

function summarizeConstruction(before: ConstructionContent | null, after: ConstructionContent | null): string {
  if (!after) return 'Put back the city page as it is for Construction now';
  const changes: string[] = [];
  const bAdded = new Map((before?.added ?? []).map((a) => [a.id, a]));
  const aAdded = new Map(after.added.map((a) => [a.id, a]));
  const nameOf = (k: string) => aAdded.get(k)?.name ?? bAdded.get(k)?.name ?? k;
  for (const [id, a] of aAdded) {
    const was = bAdded.get(id);
    if (!was) changes.push(`Added "${a.name}" to Construction now`);
    else if (JSON.stringify(was) !== JSON.stringify(a)) changes.push(`Changed "${a.name}" in Construction now`);
  }
  for (const [id, a] of bAdded) if (!aAdded.has(id)) changes.push(`Removed "${a.name}" from Construction now`);
  for (const k of new Set([...Object.keys(before?.edits ?? {}), ...Object.keys(after.edits)])) {
    if (JSON.stringify(before?.edits[k] ?? null) === JSON.stringify(after.edits[k] ?? null)) continue;
    changes.push(after.edits[k] ? `Corrected "${nameOf(k)}" in Construction now` : `Put back the city's wording for "${nameOf(k)}"`);
  }
  const bh = new Set(before?.hidden ?? []);
  const ah = new Set(after.hidden);
  for (const k of ah) if (!bh.has(k)) changes.push(`Hid "${nameOf(k)}" from Construction now`);
  for (const k of bh) if (!ah.has(k) && (aAdded.has(k) || !bAdded.has(k))) changes.push(`Showed "${nameOf(k)}" in Construction now again`);
  return oneOrCount(changes, (n) => `Made ${n} changes to Construction now`, 'Saved Construction now');
}

const defineSpec = <T>(s: ContentSpec<T>): ContentSpec => s as unknown as ContentSpec;

export const SPECS: Record<string, ContentSpec> = {
  projects: defineSpec<ProjectsContent>({ area: 'map', label: 'Map project descriptions', check: checkProjects, summarize: summarizeProjects }),
  construction: defineSpec<ConstructionContent>({ area: 'map', label: 'Construction now', check: checkConstruction, summarize: summarizeConstruction }),
  services: defineSpec<ServicesContent>({ area: 'site', label: 'Service links', check: checkServices, summarize: summarizeServices }),
  contacts: defineSpec<ContactsContent>({ area: 'site', label: 'Phone numbers and quick links', check: checkContacts, summarize: summarizeContacts }),
};

export const specFor = (key: unknown): ContentSpec | null => (typeof key === 'string' && Object.prototype.hasOwnProperty.call(SPECS, key) ? SPECS[key] : null);

let ready: Promise<void> | null = null;
export function ensureContentTable(env: Env): Promise<void> {
  ready ??= env.CATALOG_DB.prepare('CREATE TABLE IF NOT EXISTS site_content (key TEXT PRIMARY KEY, body TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT)')
    .run()
    .then(
      () => undefined,
      (e) => {
        ready = null;
        throw e;
      },
    );
  return ready;
}

export interface StoredContent {
  value: unknown;
  updatedAt: string;
  updatedBy: string | null;
}

/** The stored piece, read leniently, or null when nothing is stored or the row is not JSON at all. */
export async function readContent(env: Env, key: string): Promise<StoredContent | null> {
  const spec = specFor(key);
  if (!spec) return null;
  await ensureContentTable(env);
  const row = await env.CATALOG_DB.prepare('SELECT body, updated_at, updated_by FROM site_content WHERE key = ?').bind(key).first<{ body: string; updated_at: string; updated_by: string | null }>();
  if (!row) return null;
  try {
    return { value: spec.check(JSON.parse(row.body), true), updatedAt: row.updated_at, updatedBy: row.updated_by };
  } catch {
    return null;
  }
}

/** Everything staff have changed, for the public pages. A row that is not JSON is left out. Errors reading the table are thrown, never turned into "nothing changed". */
export async function allContent(env: Env): Promise<{ content: Record<string, unknown>; changedAt: string | null }> {
  await ensureContentTable(env);
  const r = await env.CATALOG_DB.prepare('SELECT key, body, updated_at FROM site_content').all<{ key: string; body: string; updated_at: string }>();
  const content: Record<string, unknown> = {};
  let changedAt: string | null = null;
  for (const row of r.results ?? []) {
    const spec = specFor(row.key);
    if (!spec) continue;
    try {
      content[row.key] = spec.check(JSON.parse(row.body), true);
      if (!changedAt || row.updated_at > changedAt) changedAt = row.updated_at;
    } catch {
      // Not JSON: skipped.
    }
  }
  return { content, changedAt };
}
