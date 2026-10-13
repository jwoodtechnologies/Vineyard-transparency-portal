/**
 * The budget for the staff portal. The Budget page, the map's project amounts and the chat's budget answers all read one
 * budget (worker/lib/budgetData.ts). Staff edit it as a whole, check it, and save it as a new numbered version with a note
 * saying what changed and where the figures came from. Every version is kept: an earlier one can be restored, and the
 * activity log's Undo goes back to the version before a save.
 */
import type { Env } from '../env';
import { badRequest, json, notFound } from '../lib/http';
import { BASE } from '../lib/mapLayers';
import { budgetBookNow, builtInBudgetBook, type BudgetBook } from '../lib/budgetData';
import { checkBudgetBook, summarizeChange, totalsFrom, TOLERANCE } from '../lib/budgetBook';
import { activate, activeVersion, ensureBudgetTables, KEEP_VERSIONS, readBook, type BudgetVersionRow } from '../lib/budgetStore';
import { nowIso } from '../lib/util';
import { auditStatement, published, requireArea, type StaffUser } from './core';
import type { StaffCall } from './modules';
import { registerUndo } from './undo';

const NOTE_MIN = 8;
const NOTE_MAX = 300;

const clean = (v: unknown, max: number) =>
  typeof v === 'string'
    ? v
        .replace(/<[^>]*>/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max)
    : '';

async function versions(env: Env): Promise<BudgetVersionRow[]> {
  const r = await env.CATALOG_DB.prepare('SELECT version, created_at, created_by, note, summary FROM budget_versions ORDER BY version DESC LIMIT 40').all<BudgetVersionRow>();
  return r.results ?? [];
}

async function overview(env: Env): Promise<Record<string, unknown>> {
  await ensureBudgetTables(env);
  const active = await activeVersion(env);
  // The Worker has already loaded the active version (worker/index.ts), so the live budget is it.
  return { active, book: budgetBookNow(), builtIn: builtInBudgetBook(), versions: await versions(env), tolerance: TOLERANCE, noteMin: NOTE_MIN, noteMax: NOTE_MAX };
}

/** What the screen sends: the whole budget. */
function bookFrom(b: Record<string, unknown>): { book: BudgetBook | null; errors: string[] } {
  return checkBudgetBook(b.book);
}

function readNote(b: Record<string, unknown>): string {
  const note = clean(b.note, NOTE_MAX);
  if (note.length < NOTE_MIN) throw badRequest('Write a short note on what changed and where the figures came from, such as "Amendment 2, Ordinance 2026-14".');
  return note;
}

/** Saves `book` as the next version and makes it the active one. */
async function save(env: Env, me: StaffUser, book: BudgetBook, note: string, verb: 'saved' | 'restored', from?: number): Promise<{ version: number; summary: string }> {
  await ensureBudgetTables(env);
  const before = await activeVersion(env);
  const previous = (await readBook(env, before)) ?? builtInBudgetBook();
  const summary = summarizeChange(previous, book);
  const row = await env.CATALOG_DB.prepare('SELECT COALESCE(MAX(version), 0) + 1 AS v FROM budget_versions').first<{ v: number }>();
  const version = Number(row?.v ?? 1);
  const now = nowIso();
  const label = verb === 'restored' ? `Restored budget version ${from} as version ${version}` : `Saved budget version ${version}`;
  await env.CATALOG_DB.batch([
    env.CATALOG_DB.prepare('INSERT INTO budget_versions (version, created_at, created_by, note, summary, book) VALUES (?, ?, ?, ?, ?, ?)').bind(
      version,
      now,
      me.name,
      note,
      summary.slice(0, 500),
      JSON.stringify(book),
    ),
    env.CATALOG_DB.prepare('INSERT INTO budget_state (id, version, changed_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET version = excluded.version, changed_at = excluded.changed_at').bind(
      version,
      now,
    ),
    env.CATALOG_DB.prepare('DELETE FROM budget_versions WHERE version <= ? AND version <> ?').bind(version - KEEP_VERSIONS, before),
    auditStatement(env, me, { area: 'budget', action: verb, entity: 'budget', entityId: String(version), summary: `${label}: ${note}`, before: { version: before }, after: { version, summary } }),
  ]);
  await published(env);
  await activate(env, version, book);
  return { version, summary };
}

// ---- finding things to link to

interface DocHit {
  id: string;
  title: string;
  date: string | null;
  type: string | null;
}

/** Documents in the archive by title, for choosing the budget book, slides or amendment. */
async function searchDocuments(env: Env, q: string): Promise<DocHit[]> {
  const term = `%${q
    .replace(/[%_\\]/g, '')
    .trim()
    .slice(0, 60)}%`;
  const r = await env.CATALOG_DB.prepare(
    `SELECT id, title, document_date, document_type FROM documents
     WHERE (title LIKE ? OR id = ?) AND coalesce(currency, '') <> 'withdrawn'
     ORDER BY CASE WHEN document_type IN ('budget', 'presentation') THEN 0 ELSE 1 END, document_date DESC LIMIT 20`,
  )
    .bind(term, q.trim().slice(0, 40))
    .all<{ id: string; title: string; document_date: string | null; document_type: string | null }>()
    .catch(() => ({ results: [] as Array<{ id: string; title: string; document_date: string | null; document_type: string | null }> }));
  return (r.results ?? []).map((d) => ({ id: d.id, title: d.title, date: d.document_date, type: d.document_type }));
}

let featureMemo: { at: number; items: Array<{ id: number; name: string }> } | null = null;

/** The projects on the city's Capital Improvement Plan map (number and name), for linking a budget line to the map. Empty when the city's map service does not answer. */
async function mapFeatures(): Promise<{ items: Array<{ id: number; name: string }>; unavailable: boolean }> {
  if (featureMemo && Date.now() - featureMemo.at < 3_600_000) return { items: featureMemo.items, unavailable: false };
  try {
    const p = new URLSearchParams({ where: '1=1', outFields: 'OBJECTID,Project_Name', returnGeometry: 'false', orderByFields: 'OBJECTID', resultRecordCount: '2000', f: 'json' });
    const res = await fetch(`${BASE}Capital_Improvement_Plan_Public_View/FeatureServer/650/query?${p}`, {
      headers: { accept: 'application/json', 'user-agent': 'VineyardTransparencyPortal/1.0 (+https://vineyardportal.org)' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { error?: unknown; features?: Array<{ attributes?: { OBJECTID?: number; Project_Name?: string } }> };
    if (data.error || !Array.isArray(data.features)) throw new Error('bad answer');
    const items = data.features.flatMap((f) => (f.attributes?.OBJECTID && f.attributes.Project_Name ? [{ id: Number(f.attributes.OBJECTID), name: String(f.attributes.Project_Name) }] : []));
    featureMemo = { at: Date.now(), items };
    return { items, unavailable: false };
  } catch {
    return { items: featureMemo?.items ?? [], unavailable: !featureMemo };
  }
}

export async function budget(call: StaffCall): Promise<Response | null> {
  const { env, request, me, route, body, url } = call;
  if (!route.startsWith('/budget/')) return null;
  requireArea(me, 'budget');

  if (request.method === 'GET') {
    if (route === '/budget/book') return json(await overview(env));
    if (route === '/budget/version') {
      await ensureBudgetTables(env);
      const v = Number(url.searchParams.get('v'));
      const book = Number.isInteger(v) && v >= 0 ? await readBook(env, v) : null;
      if (!book) throw notFound('That version was not found.');
      return json({ version: v, book });
    }
    if (route === '/budget/documents') return json({ items: await searchDocuments(env, url.searchParams.get('q') ?? '') });
    if (route === '/budget/features') return json(await mapFeatures());
    return null;
  }

  const b = body ?? {};
  if (route === '/budget/check') {
    const { book, errors } = bookFrom(b);
    if (!book) return json({ ok: false, errors });
    await ensureBudgetTables(env);
    const before = (await readBook(env, await activeVersion(env))) ?? builtInBudgetBook();
    return json({ ok: true, errors: [], summary: summarizeChange(before, book) });
  }
  if (route === '/budget/totals') {
    const raw = (b.book ?? {}) as Partial<BudgetBook>;
    const now = budgetBookNow();
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0);
    const line = (r: unknown) => ({ adopted: num((r as { adopted?: unknown })?.adopted), amended: num((r as { amended?: unknown })?.amended) });
    const list = (v: unknown) => (Array.isArray(v) ? v.slice(0, 400) : []);
    const totals = totalsFrom(
      {
        funds: [],
        departments: list(raw.departments).map((r) => ({ name: '', prior: 0, ...line(r) })),
        transfersOut: list(raw.transfersOut).map((r) => ({ name: '', prior: 0, ...line(r) })),
        revenue: list(raw.revenue).map((r) => ({ name: '', amount: num((r as { amount?: unknown })?.amount) })),
        transfersIn: list(raw.transfersIn).map((r) => ({ name: '', amount: num((r as { amount?: unknown })?.amount) })),
      },
      { ...now.general, tentativeTotal: num(raw.general?.tentativeTotal ?? now.general.tentativeTotal) },
    );
    return json({ totals });
  }
  if (route === '/budget/save') {
    const note = readNote(b);
    const { book, errors } = bookFrom(b);
    if (!book) return json({ ok: false, errors });
    const r = await save(env, me, book, note, 'saved');
    return json({ ok: true, ...r }, { status: 201 });
  }
  if (route === '/budget/restore') {
    const v = Number(b.version);
    await ensureBudgetTables(env);
    const book = Number.isInteger(v) && v >= 0 ? await readBook(env, v) : null;
    if (!book) throw notFound('That version was not found.');
    const note = clean(b.note, NOTE_MAX) || (v === 0 ? 'Restored the built-in budget' : `Restored version ${v}`);
    const r = await save(env, me, book, note, 'restored', v);
    return json({ ok: true, ...r });
  }
  return null;
}

/** Undo: the budget goes back to the version that was active before the save (or the built-in one). */
registerUndo('budget', async (env, _user, entry) => {
  await ensureBudgetTables(env);
  const before = (entry.before_json ? (JSON.parse(entry.before_json) as { version?: number }) : null)?.version;
  if (typeof before !== 'number') throw badRequest('The earlier version was not kept.');
  const book = await readBook(env, before);
  if (!book) throw badRequest('The earlier version is no longer stored.');
  await env.CATALOG_DB.prepare('INSERT INTO budget_state (id, version, changed_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET version = excluded.version, changed_at = excluded.changed_at')
    .bind(before, nowIso())
    .run();
  await activate(env, before, before === 0 ? null : book);
  return before === 0 ? 'Went back to the built-in budget' : `Went back to budget version ${before}`;
});
