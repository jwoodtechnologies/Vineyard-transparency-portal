/**
 * GET /api/projects/detail?gis=<map project name>  or  ?fund=<fund key>&name=<budget line name>
 *
 * One funded capital project, each part from a record:
 *   budget     the line(s) on the FY 27 Final Budget Slides (worker/lib/budgetData PROJECTS), with page
 *   votes      the budget adoption vote on June 23, 2026 (City Council, or the RDA board for its own fund)
 *              and any motion whose agenda item or wording names the project, from the motions tables
 *   documents  contracts, bid awards, staff reports and resolutions whose title names the project (full-text title search)
 *   status     the city's Construction Projects table row that names it, with the date the page was read;
 *              else the budget, as of its adoption date
 * Names are matched conservatively (worker/lib/projectMatch.ts); a record that might belong to another
 * funded project is left out. Edge cached.
 */
import type { Env } from '../env';
import { BUDGET_DOCS } from '../lib/budgetData';
import { notFound, json } from '../lib/http';
import { DOCUMENT_TYPE_LABELS, normalizeType } from '../lib/taxonomy';
import {
  budgetBlock,
  budgetStatus,
  findProject,
  fundedProjects,
  glanceStatus,
  namesProject,
  noDash,
  projectVotes,
  RELATED_FROM,
  RELATED_TYPES,
  searchPhrases,
  type BudgetBlock,
  type FundedProject,
  type ProjectStatus,
  type ProjectVote,
  type RelatedDoc,
} from '../lib/projectMatch';
import { parseQuery } from '../search/query';
import { SearchRepository } from '../search/SearchRepository';
import { summariesByIds } from './documents';
import { queryMotions } from './votes';
import { bestConstruction } from './construction';
import type { DocumentType } from '../../src/types/models';

export interface ProjectDetailPayload {
  key: string;
  name: string;
  budget: BudgetBlock & { documentId: string };
  status: ProjectStatus;
  votes: ProjectVote[];
  documents: RelatedDoc[];
}

const MAX_DOCS = 8;

/** Archive records whose title names this project and no other funded project. */
export async function relatedDocuments(env: Env, p: FundedProject): Promise<RelatedDoc[]> {
  const repo = new SearchRepository(env);
  const phrases = searchPhrases(p);
  if (!repo.available || !phrases.length) return [];
  const parsed = parseQuery(phrases.map((x) => `"${x}"`).join(' '), { match: 'any', titleOnly: true });
  if (!parsed.fts) return [];
  const hits = await repo.searchChunks(parsed.fts, { documentTypes: [...RELATED_TYPES] as DocumentType[], dateFrom: RELATED_FROM }, 400, false, false);
  const ids = [...new Set(hits.map((h) => h.documentId))].slice(0, 60);
  const docs = await summariesByIds(env, ids);
  const all = fundedProjects();
  return [...docs.values()]
    .filter((d) => namesProject(p, d.title, all))
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || a.title.localeCompare(b.title))
    .slice(0, MAX_DOCS)
    .map((d) => ({ id: d.id, title: noDash(d.title), type: d.documentType, typeLabel: DOCUMENT_TYPE_LABELS[normalizeType(d.documentType)], date: d.date ?? null }));
}

async function statusFor(env: Env, p: FundedProject): Promise<ProjectStatus> {
  const snap = await bestConstruction(env).catch(() => null);
  const rows = snap?.glance?.rows ?? [];
  return (snap && rows.length ? glanceStatus(p, rows, snap.retrievedAt, snap.url || null) : null) ?? budgetStatus(BUDGET_DOCS.book);
}

async function votesFor(env: Env, p: FundedProject): Promise<ProjectVote[]> {
  const r = await queryMotions(env, { pageSize: 400 });
  return projectVotes(p, r.items);
}

export async function getProjectDetail(env: Env, url: URL): Promise<Response> {
  const q = url.searchParams;
  const clip = (k: string) => (q.get(k) ?? '').slice(0, 200) || null;
  const p = findProject({ gis: clip('gis'), fund: clip('fund'), name: clip('name') });
  if (!p) throw notFound('No funded project by that name.');
  // Each part stands alone: one source being unreachable never hides the others.
  const [votes, documents, status] = await Promise.all([votesFor(env, p).catch(() => []), relatedDocuments(env, p).catch(() => []), statusFor(env, p)]);
  const body: ProjectDetailPayload = { key: p.key, name: p.name, budget: budgetBlock(p, BUDGET_DOCS.slides), status, votes, documents };
  return json(body, { cache: 'public, max-age=600, stale-while-revalidate=3600' });
}
