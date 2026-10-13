/**
 * People and boards for the staff portal: the Mayor and City Council, city staff, and the members of boards and
 * commissions as the portal's People and Boards pages show them. Staff can add someone, change a title,
 * department, term, contact or board seat, and take someone off the list when they leave (and put them back).
 *
 * The city website's list is still read every day, but a person staff touched is marked manual and the daily read
 * leaves them exactly as staff set them (worker/api/people.ts). Photos still come from the city website.
 */
import type { Env } from '../env';
import { badRequest, json, notFound } from '../lib/http';
import { plainLine } from '../lib/contrib';
import { boardIdFor } from '../api/boards';
import { ensurePeopleTable } from '../api/people';
import { ensureVotesTables, resetCouncilCache } from '../api/votes';
import { auditStatement, published, requireArea, type StaffUser } from './core';
import type { StaffCall } from './modules';
import { registerUndo } from './undo';

const KINDS = ['elected', 'staff', 'board'] as const;
type Kind = (typeof KINDS)[number];
const KIND_WORD: Record<Kind, string> = { elected: 'council member', staff: 'staff member', board: 'board member' };
const ELECTED_ROLES = ['Mayor', 'Council Member'];
const BOARD_ROLES = ['Chair', 'Vice Chair', 'Member', 'Alternate'];

const BASE = 'https://www.vineyardutah.gov/government/';
const SOURCE: Record<Kind, string> = { elected: `${BASE}city_council2.php`, staff: `${BASE}city_staff.php`, board: `${BASE}board___commission_members.php` };

type Row = Record<string, string | number | null>;

const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);

async function personRow(env: Env, slug: unknown): Promise<Row> {
  await ensurePeopleTable(env);
  const row = await env.CATALOG_DB.prepare('SELECT * FROM people WHERE slug = ?')
    .bind(String(slug ?? '').slice(0, 80))
    .first<Row>();
  if (!row) throw notFound('That person was not found.');
  return row;
}

const today = () => new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);

interface Fields {
  name: string;
  role: string;
  department: string | null;
  term: string | null;
  email: string | null;
  phone: string | null;
}

function fullName(v: unknown): string {
  const name = plainLine(v, 80);
  if (name.length < 3 || !name.includes(' ')) throw badRequest('Write the full name, first and last.');
  return name;
}

function readFields(kind: Kind, b: Record<string, unknown>, name: string): Fields {
  let role = plainLine(b.role, 80);
  let department: string | null;
  if (kind === 'elected') {
    if (!ELECTED_ROLES.includes(role)) throw badRequest('Choose Mayor or Council Member.');
    department = 'Mayor and City Council';
  } else if (kind === 'staff') {
    if (!role) throw badRequest('Write their job title.');
    department = plainLine(b.department, 80) || null;
  } else {
    if (!role) throw badRequest('Choose their role on the board.');
    const raw = Array.isArray(b.boards) ? b.boards : [];
    if (raw.length > 12) throw badRequest('That is too many boards for one person.');
    const boards = [...new Set(raw.map((x) => plainLine(x, 80)).filter(Boolean))];
    if (!boards.length) throw badRequest('Choose at least one board.');
    if (boards.some((x) => x.includes(';'))) throw badRequest('A board name cannot contain a semicolon.');
    department = boards.join('; ');
    role = role.replace(/\s+/g, ' ');
  }
  const email = plainLine(b.email, 120).toLowerCase() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('That email address does not look right.');
  const phone = plainLine(b.phone, 40) || null;
  if (phone && !/^[0-9 ()+.\-xX]{7,40}$/.test(phone)) throw badRequest('That phone number does not look right.');
  return { name, role, department, term: plainLine(b.term, 80) || null, email, phone };
}

async function onlyOneMayor(env: Env, role: string, except: string | null): Promise<void> {
  if (role !== 'Mayor') return;
  const other = await env.CATALOG_DB.prepare("SELECT name FROM people WHERE kind = 'elected' AND current = 1 AND role = 'Mayor' AND slug != ?")
    .bind(except ?? '')
    .first<{ name: string }>();
  if (other) throw badRequest(`${other.name} is listed as Mayor. Change them to Council Member first.`);
}

const label = (row: Row) => `${String(row.name)} (${String(row.title ?? row.role)})`;

async function list(env: Env, url: URL): Promise<Record<string, unknown>> {
  await ensurePeopleTable(env);
  const kind = url.searchParams.get('kind') ?? '';
  const words = (url.searchParams.get('q') ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 2)
    .slice(0, 5);
  const where: string[] = [];
  const params: string[] = [];
  if ((KINDS as readonly string[]).includes(kind)) {
    where.push('kind = ?');
    params.push(kind);
  }
  for (const w of words) {
    const like = `%${w.replace(/[%_\\]/g, '')}%`;
    where.push("(lower(name) LIKE ? OR lower(role) LIKE ? OR lower(coalesce(department, '')) LIKE ?)");
    params.push(like, like, like);
  }
  const r = await env.CATALOG_DB.prepare(
    `SELECT slug, name, kind, role, department, term, email, phone, current, manual, photo_url FROM people ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY current DESC, CASE kind WHEN 'elected' THEN 0 WHEN 'staff' THEN 1 ELSE 2 END, CASE role WHEN 'Mayor' THEN 0 ELSE 1 END, name LIMIT 300`,
  )
    .bind(...params)
    .all<Row>();
  const items = (r.results ?? []).map((p) => ({
    slug: String(p.slug),
    name: String(p.name),
    kind: String(p.kind),
    role: String(p.role),
    department: (p.department as string | null) ?? null,
    boards: p.kind === 'board' ? String(p.department ?? '').split(';').map((x) => x.trim()).filter(Boolean) : [],
    term: (p.term as string | null) ?? null,
    email: (p.email as string | null) ?? null,
    phone: (p.phone as string | null) ?? null,
    current: Number(p.current) === 1,
    manual: Number(p.manual) === 1,
    hasPhoto: Boolean(p.photo_url),
  }));
  return { items };
}

/** Suggestions for the forms: departments already in use, and the boards a person can sit on. */
async function options(env: Env): Promise<Record<string, unknown>> {
  await ensurePeopleTable(env);
  const db = env.CATALOG_DB;
  const [staff, board, bodies] = await Promise.all([
    db.prepare("SELECT DISTINCT department FROM people WHERE kind = 'staff' AND department IS NOT NULL ORDER BY department").all<{ department: string }>(),
    db.prepare("SELECT DISTINCT department FROM people WHERE kind = 'board' AND department IS NOT NULL").all<{ department: string }>(),
    db.prepare("SELECT id, name FROM government_bodies WHERE id NOT IN ('general', 'public-notices', 'city-council', 'redevelopment-agency')").all<{ id: string; name: string }>().catch(() => ({ results: [] as Array<{ id: string; name: string }> })),
  ]);
  // One name per board: the name the city website uses when someone already sits there, otherwise the meeting body's own name.
  const boards = new Map<string, string>();
  for (const r of board.results ?? []) {
    for (const n of r.department.split(';').map((x) => x.trim()).filter(Boolean)) if (!boards.has(boardIdFor(n))) boards.set(boardIdFor(n), n);
  }
  for (const b of bodies.results ?? []) {
    const name = [b.name, b.name.replace(/^Vineyard /, '')].find((c) => boardIdFor(c) === b.id);
    if (name && !boards.has(b.id)) boards.set(b.id, name);
  }
  return {
    departments: (staff.results ?? []).map((d) => d.department),
    boards: [...boards.values()].sort((a, b) => a.localeCompare(b)),
    boardRoles: BOARD_ROLES,
  };
}

async function add(env: Env, me: StaffUser, b: Record<string, unknown>): Promise<Record<string, unknown>> {
  await ensurePeopleTable(env);
  const kind = String(b.kind ?? '') as Kind;
  if (!KINDS.includes(kind)) throw badRequest('Choose what kind of person this is.');
  const f = readFields(kind, b, fullName(b.name));
  await onlyOneMayor(env, f.role, null);
  const db = env.CATALOG_DB;
  const base = slugify(f.name);
  if (base.length < 2) throw badRequest('Write the full name, first and last.');
  let slug = base;
  for (let n = 2; n < 10; n++) {
    const hit = await db.prepare('SELECT name, current FROM people WHERE slug = ?').bind(slug).first<{ name: string; current: number }>();
    if (!hit) break;
    if (hit.name.toLowerCase() === f.name.toLowerCase() && kind !== 'board') throw badRequest(Number(hit.current) === 1 ? `${hit.name} is already in the directory.` : `${hit.name} is in the directory but hidden. Restore them from the list instead.`);
    slug = `${base.slice(0, 76)}-${n}`;
  }
  const row: Row = {
    slug, name: f.name, kind, role: f.role, title: f.role, department: f.department, term: f.term, email: f.email, phone: f.phone, photo_url: null, source_url: SOURCE[kind], current: 1, first_seen: today(), last_seen: today(), manual: 1,
  };
  const cols = Object.keys(row);
  await db.batch([
    db.prepare(`INSERT INTO people (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).bind(...cols.map((c) => row[c])),
    auditStatement(env, me, { area: 'people', action: 'added', entity: 'person', entityId: slug, summary: `Added ${label(row)} as a ${KIND_WORD[kind]}`, after: row }),
  ]);
  resetCouncilCache();
  await published(env);
  return { ok: true, slug };
}

async function edit(env: Env, me: StaffUser, b: Record<string, unknown>): Promise<Record<string, unknown>> {
  const before = await personRow(env, b.slug);
  const kind = String(before.kind) as Kind;
  // A council member's name is how their votes are found in the minutes, so it is not changed here.
  const given = plainLine(b.name, 80);
  const f = readFields(kind, b, kind === 'elected' || !given ? String(before.name) : fullName(given));
  await onlyOneMayor(env, f.role, String(before.slug));
  const after: Row = { ...before, name: f.name, role: f.role, title: f.role, department: f.department, term: f.term, email: f.email, phone: f.phone, manual: 1 };
  await env.CATALOG_DB.batch([
    env.CATALOG_DB.prepare('UPDATE people SET name = ?, role = ?, title = ?, department = ?, term = ?, email = ?, phone = ?, manual = 1 WHERE slug = ?').bind(f.name, f.role, f.role, f.department, f.term, f.email, f.phone, String(before.slug)),
    auditStatement(env, me, { area: 'people', action: 'edited', entity: 'person', entityId: String(before.slug), summary: `Changed ${label(after)}`, before, after }),
  ]);
  resetCouncilCache();
  await published(env);
  return { ok: true };
}

async function setCurrent(env: Env, me: StaffUser, b: Record<string, unknown>, current: boolean): Promise<Record<string, unknown>> {
  const before = await personRow(env, b.slug);
  if (current && String(before.kind) === 'elected' && String(before.role) === 'Mayor') await onlyOneMayor(env, 'Mayor', String(before.slug));
  const after: Row = { ...before, current: current ? 1 : 0, manual: 1 };
  await env.CATALOG_DB.batch([
    env.CATALOG_DB.prepare('UPDATE people SET current = ?, manual = 1, last_seen = ? WHERE slug = ?').bind(current ? 1 : 0, current ? today() : String(before.last_seen), String(before.slug)),
    auditStatement(env, me, { area: 'people', action: current ? 'restored' : 'removed', entity: 'person', entityId: String(before.slug), summary: `${current ? 'Put back' : 'Took off the list'} ${label(before)}`, before, after }),
  ]);
  resetCouncilCache();
  await published(env);
  return { ok: true };
}

const PHOTO_MAX = 3 * 1024 * 1024;

/** The kind of image the bytes really are (never what the browser claims), or null. */
function imageType(b: Uint8Array): { mime: string; ext: string } | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { mime: 'image/png', ext: 'png' };
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return { mime: 'image/webp', ext: 'webp' };
  return null;
}

/** A photo staff upload for a person: stored in the portal's own storage, and kept even when the city website changes. */
async function photo(env: Env, me: StaffUser, request: Request): Promise<Record<string, unknown>> {
  if (!env.ARCHIVE) throw badRequest('Photo storage is not set up.');
  const form = await request.formData().catch(() => null);
  if (!form) throw badRequest('Choose a photo.');
  const row = await personRow(env, form.get('slug'));
  const file = form.get('file');
  if (!file || typeof file === 'string') throw badRequest('Choose a photo.');
  const bytes = new Uint8Array(await (file as File).arrayBuffer());
  if (bytes.byteLength > PHOTO_MAX) throw badRequest('That photo is larger than 3 MB. Choose a smaller one.');
  const type = imageType(bytes);
  if (!type) throw badRequest('Choose a JPEG, PNG or WebP photo.');
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].slice(0, 8).map((x) => x.toString(16).padStart(2, '0')).join('');
  const key = `media/people/${row.slug}-${hash}.${type.ext}`;
  await env.ARCHIVE.put(key, bytes, { httpMetadata: { contentType: type.mime, cacheControl: 'public, max-age=31536000, immutable' } });
  const before = { photo_url: row.photo_url, manual: row.manual };
  await env.CATALOG_DB.batch([
    env.CATALOG_DB.prepare('UPDATE people SET photo_url = ?, manual = 1 WHERE slug = ?').bind(`r2:${key}`, row.slug),
    auditStatement(env, me, { area: 'people', action: 'edited', entity: 'person-photo', entityId: String(row.slug), summary: `Changed the photo of ${String(row.name)}`, before, after: { photo_url: `r2:${key}` } }),
  ]);
  await published(env);
  return { ok: true, photo: `/api/people/${encodeURIComponent(String(row.slug))}/photo` };
}

registerUndo('person-photo', async (env, _user, entry) => {
  await ensurePeopleTable(env);
  const before = JSON.parse(String(entry.before_json)) as { photo_url: string | null; manual: number };
  await env.CATALOG_DB.prepare('UPDATE people SET photo_url = ?, manual = ? WHERE slug = ?').bind(before.photo_url, before.manual ?? 0, String(entry.entity_id)).run();
  await published(env);
  return 'The earlier photo is back.';
});

export async function people(call: StaffCall): Promise<Response | null> {
  const { env, request, url, me, route, body } = call;
  if (!route.startsWith('/directory/')) return null;
  requireArea(me, 'people');

  if (request.method === 'GET') {
    if (route === '/directory/people') return json(await list(env, url));
    if (route === '/directory/options') return json(await options(env));
    return null;
  }
  if (route === '/directory/photo') return json(await photo(env, me, request));
  const b = body ?? {};
  if (route === '/directory/add') return json(await add(env, me, b), { status: 201 });
  if (route === '/directory/edit') return json(await edit(env, me, b));
  if (route === '/directory/remove') return json(await setCurrent(env, me, b, false));
  if (route === '/directory/restore') return json(await setCurrent(env, me, b, true));
  return null;
}

/** Undo: an add is taken back out, anything else is put back as it was. */
registerUndo('person', async (env, _user, entry) => {
  await ensurePeopleTable(env);
  await ensureVotesTables(env);
  const slug = entry.entity_id ?? '';
  if (entry.action === 'added') {
    await env.CATALOG_DB.prepare('DELETE FROM people WHERE slug = ?').bind(slug).run();
    resetCouncilCache();
    return `Took out the person who was added (${slug})`;
  }
  const before = entry.before_json ? (JSON.parse(entry.before_json) as Row) : null;
  if (!before?.slug) throw badRequest('The earlier version was not kept.');
  const cols = Object.keys(before).filter((k) => /^[a-z_]+$/.test(k));
  await env.CATALOG_DB.batch([
    env.CATALOG_DB.prepare('DELETE FROM people WHERE slug = ?').bind(String(before.slug)),
    env.CATALOG_DB.prepare(`INSERT INTO people (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).bind(...cols.map((c) => before[c] ?? null)),
  ]);
  resetCouncilCache();
  return `Put back ${label(before)}`;
});
