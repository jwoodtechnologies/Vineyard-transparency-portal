/**
 * Helpers for the staff screen that edits the wording of the funded projects beside the map. The screen keeps one working
 * copy of what staff have saved (ProjectsContent) and every change is a small pure step on it, so what is stored only ever
 * holds the fields that differ from the wording the portal ships with.
 */
import { builtInMeta, type AlsoFunded, type Category, type Plan, type ProjectEdit, type ProjectsContent } from '../construction';

export const NAME_MAX = 90;
export const ABOUT_MAX = 500;
export const ALSO_MAX = 40;

export interface ProjectDraft {
  name: string;
  category: Category;
  about: string;
}

export interface AlsoDraft {
  name: string;
  about: string;
}

export const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();

export const draftOf = (p: Pick<Plan, 'name' | 'category' | 'about'>): ProjectDraft => ({ name: p.name, category: p.category, about: p.about ?? '' });

/** What to store for a project: only the fields that differ from the built-in wording, or null when nothing does. */
export function editFrom(gis: string, d: ProjectDraft): ProjectEdit | null {
  const base = builtInMeta(gis);
  const edit: ProjectEdit = {};
  const name = squash(d.name);
  const about = squash(d.about);
  if (name && name !== base.name) edit.name = name;
  if (d.category !== base.category) edit.category = d.category;
  if (about && about !== (base.about ?? '')) edit.about = about;
  return Object.keys(edit).length ? edit : null;
}

/** A sentence to show before saving, or '' when the draft is fine. */
export function checkDraft(d: Pick<ProjectDraft, 'name' | 'about'>): string {
  if (!squash(d.name)) return 'Give the project a name.';
  if (squash(d.name).length > NAME_MAX) return `Keep the name under ${NAME_MAX} characters.`;
  if (squash(d.about).length > ABOUT_MAX) return `Keep the description under ${ABOUT_MAX} characters.`;
  return '';
}

export function checkAlso(d: AlsoDraft): string {
  if (!squash(d.name)) return 'Give the project a name.';
  if (squash(d.name).length > NAME_MAX) return `Keep the name under ${NAME_MAX} characters.`;
  if (squash(d.about).length > ABOUT_MAX) return `Keep the description under ${ABOUT_MAX} characters.`;
  return '';
}

/** Nothing left that differs from the shipped wording: the stored piece can be removed. */
export const isUnchanged = (c: ProjectsContent): boolean => Object.keys(c.plans).length === 0 && c.also === null;

/** The working copy with one project's edit set (or put back to the original when edit is null). null when nothing is left to store. */
export function withPlan(content: ProjectsContent | null, gis: string, edit: ProjectEdit | null): ProjectsContent | null {
  const plans = { ...(content?.plans ?? {}) };
  if (edit) plans[gis] = edit;
  else delete plans[gis];
  const next: ProjectsContent = { plans, also: content?.also ?? null };
  return isUnchanged(next) ? null : next;
}

/** The working copy without the edits for these project names (ones the city has since taken off its map). */
export function withoutPlans(content: ProjectsContent | null, gisNames: string[]): ProjectsContent | null {
  const plans = { ...(content?.plans ?? {}) };
  for (const g of gisNames) delete plans[g];
  const next: ProjectsContent = { plans, also: content?.also ?? null };
  return isUnchanged(next) ? null : next;
}

/** The working copy with the "also funded" list replaced (null: back to the built-in list). */
export function withAlso(content: ProjectsContent | null, also: AlsoFunded[] | null): ProjectsContent | null {
  const next: ProjectsContent = { plans: { ...(content?.plans ?? {}) }, also };
  return isUnchanged(next) ? null : next;
}

/** Places a draft where it belongs in the list: replaces the item at `index`, or adds to the end when index is -1. */
export function withItem(list: AlsoFunded[], index: number, d: AlsoDraft): AlsoFunded[] {
  const item = { name: squash(d.name), about: squash(d.about) };
  if (index < 0) return [...list, { id: '', ...item }];
  return list.map((a, i) => (i === index ? { ...a, ...item } : a));
}

export const withoutItem = (list: AlsoFunded[], index: number): AlsoFunded[] => list.filter((_, i) => i !== index);

export function moveItem(list: AlsoFunded[], index: number, by: -1 | 1): AlsoFunded[] {
  const to = index + by;
  if (to < 0 || to >= list.length) return list;
  const out = [...list];
  [out[index], out[to]] = [out[to], out[index]];
  return out;
}

/** Does a project match what was typed in the search box? */
export function matches(p: Pick<Plan, 'name' | 'gis' | 'about' | 'category' | 'location'>, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [p.name, p.gis, p.about ?? '', p.category, p.location].some((s) => s.toLowerCase().includes(needle));
}

export const charsLeft = (text: string, max: number): string => {
  const left = max - squash(text).length;
  return left >= 0 ? `${left} characters left` : `${-left} characters too many`;
};
