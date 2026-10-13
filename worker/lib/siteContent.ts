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

const defineSpec = <T>(s: ContentSpec<T>): ContentSpec => s as unknown as ContentSpec;

export const SPECS: Record<string, ContentSpec> = {
  projects: defineSpec<ProjectsContent>({ area: 'map', label: 'Map project descriptions', check: checkProjects, summarize: summarizeProjects }),
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
