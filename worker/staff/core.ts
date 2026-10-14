/**
 * Staff accounts, permissions, sessions and the activity log.
 *
 * Roles: owner (everything, including who may sign in), admin (every area, manages editors) and
 * editor (only the areas they were given). Sessions are random tokens kept hashed in D1, so
 * turning an account off signs it out at once.
 */
import type { Env } from '../env';
import { HttpError } from '../lib/http';
import { bumpDataVersion } from '../lib/dataVersion';
import { randomToken, sha256 } from '../panel/auth';

export const AREAS = ['records', 'votes', 'people', 'map', 'budget', 'notices', 'site', 'submissions'] as const;
export type Area = (typeof AREAS)[number];

export const AREA_LABELS: Record<Area, string> = {
  records: 'Records and meetings',
  votes: 'Votes',
  people: 'People and boards',
  map: 'Map and projects',
  budget: 'Budget',
  notices: 'Events and notices',
  site: 'Site pages and links',
  submissions: 'Resident submissions',
};

export type Role = 'owner' | 'admin' | 'editor';
const RANK: Record<Role, number> = { owner: 3, admin: 2, editor: 1 };

export interface StaffUser {
  id: string;
  email: string;
  name: string;
  department: string | null;
  role: Role;
  areas: Area[];
  active: boolean;
  /** The new staff tour: null until finished or skipped (see ensureStaffTables). */
  tour: string | null;
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  department: string | null;
  role: string;
  areas: string;
  active: number;
  tour?: string | null;
  pass_hash?: string | null;
  salt?: string | null;
  iterations?: number | null;
}

export const isArea = (v: unknown): v is Area => typeof v === 'string' && (AREAS as readonly string[]).includes(v);
export const isRole = (v: unknown): v is Role => v === 'owner' || v === 'admin' || v === 'editor';

export function toUser(r: UserRow): StaffUser {
  let areas: Area[] = [];
  try {
    const parsed: unknown = JSON.parse(r.areas);
    if (Array.isArray(parsed)) areas = parsed.filter(isArea);
  } catch {
    /* an unreadable list means no areas */
  }
  return { id: r.id, email: r.email, name: r.name, department: r.department, role: isRole(r.role) ? r.role : 'editor', areas, active: r.active === 1, tour: r.tour ?? null };
}

/** Owners and admins reach every area; editors only the ones they were given. */
export function canEdit(user: StaffUser, area: Area): boolean {
  return user.role === 'owner' || user.role === 'admin' || user.areas.includes(area);
}

export function requireArea(user: StaffUser, area: Area): void {
  if (!canEdit(user, area)) throw new HttpError(403, 'unauthorized', 'Your account does not include this area.');
}

export const canManageUsers = (user: StaffUser): boolean => user.role === 'owner' || user.role === 'admin';

/**
 * A manager can act on people below their own level. There is one master owner, made once at setup from the owner-panel
 * sign-in: nobody else can change or turn off that account, and only the owner can change their own name.
 */
export function canManage(actor: StaffUser, target: Pick<StaffUser, 'role' | 'id'>): boolean {
  if (target.role === 'owner') return actor.id === target.id;
  if (actor.role === 'owner') return true;
  return actor.role === 'admin' && RANK[target.role] < RANK.admin;
}

/** The owner role is never handed out: it comes only from setup. The owner can make admins and editors; an admin, editors. */
export function canGrant(actor: StaffUser, role: Role): boolean {
  if (role === 'owner') return false;
  if (actor.role === 'owner') return true;
  return actor.role === 'admin' && role === 'editor';
}

// ------------------------------------------------------------------ sessions

export const STAFF_COOKIE = 'vtp_s';
export const STAFF_COOKIE_PATH = '/api/staff';
const SESSION_HOURS = 12;

export function sessionCookie(value: string, maxAge: number): string {
  return `${STAFF_COOKIE}=${value}; Path=${STAFF_COOKIE_PATH}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}

export async function startSession(env: Env, userId: string, request: Request): Promise<string> {
  const token = randomToken(32);
  const now = new Date();
  await env.CATALOG_DB.batch([
    env.CATALOG_DB.prepare('DELETE FROM staff_sessions WHERE user_id = ? AND expires_at < ?').bind(userId, now.toISOString()),
    env.CATALOG_DB.prepare('INSERT INTO staff_sessions (token_hash, user_id, created_at, expires_at, ip, agent) VALUES (?, ?, ?, ?, ?, ?)').bind(
      await sha256(token),
      userId,
      now.toISOString(),
      new Date(now.getTime() + SESSION_HOURS * 3600_000).toISOString(),
      request.headers.get('cf-connecting-ip') ?? null,
      (request.headers.get('user-agent') ?? '').slice(0, 200),
    ),
    env.CATALOG_DB.prepare('UPDATE staff_users SET last_login_at = ? WHERE id = ?').bind(now.toISOString(), userId),
  ]);
  return sessionCookie(token, SESSION_HOURS * 3600);
}

function cookieToken(request: Request): string | null {
  const m = new RegExp(`(?:^|;\\s*)${STAFF_COOKIE}=([A-Za-z0-9_-]{20,80})`).exec(request.headers.get('cookie') ?? '');
  return m ? m[1] : null;
}

export async function currentUser(env: Env, request: Request): Promise<StaffUser | null> {
  const token = cookieToken(request);
  if (!token) return null;
  const row = await env.CATALOG_DB.prepare(
    `SELECT u.id, u.email, u.name, u.department, u.role, u.areas, u.active, u.tour FROM staff_sessions s
     JOIN staff_users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`,
  )
    .bind(await sha256(token), new Date().toISOString())
    .first<UserRow>();
  return row ? toUser(row) : null;
}

export async function endSession(env: Env, request: Request): Promise<void> {
  const token = cookieToken(request);
  if (token) await env.CATALOG_DB.prepare('DELETE FROM staff_sessions WHERE token_hash = ?').bind(await sha256(token)).run();
}

export async function requireUser(env: Env, request: Request): Promise<StaffUser> {
  const user = await currentUser(env, request);
  if (!user) throw new HttpError(401, 'unauthorized', 'Please sign in.');
  return user;
}

// ------------------------------------------------------------------ activity log

export interface AuditInput {
  area: Area | 'accounts';
  action: string;
  entity: string;
  entityId?: string | null;
  summary: string;
  before?: unknown;
  after?: unknown;
}

const clip = (v: unknown): string | null => {
  if (v === undefined || v === null) return null;
  const s = JSON.stringify(v);
  return s.length > 200_000 ? JSON.stringify({ truncated: true }) : s;
};

/** The statement that records a change; run it in the same batch as the change itself. */
export function auditStatement(env: Env, user: Pick<StaffUser, 'id' | 'name'>, a: AuditInput): D1PreparedStatement {
  return env.CATALOG_DB.prepare(
    'INSERT INTO staff_audit (at, user_id, user_name, area, action, entity, entity_id, summary, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(new Date().toISOString(), user.id, user.name, a.area, a.action, a.entity, a.entityId ?? null, a.summary.slice(0, 300), clip(a.before), clip(a.after));
}

export interface AuditRow {
  id: number;
  at: string;
  user_id: string | null;
  user_name: string | null;
  area: string;
  action: string;
  entity: string;
  entity_id: string | null;
  summary: string;
  before_json: string | null;
  after_json: string | null;
  undone_at: string | null;
  undone_by: string | null;
}

// ------------------------------------------------------------------ publishing

/**
 * Tells the public site that something staff changed is now live. The archive's data version
 * (worker/lib/dataVersion.ts) is what edge caches and stored page payloads are keyed to, so the
 * next view reads fresh data. Call it after the change is saved.
 */
export const published = (env: Env): Promise<number> => bumpDataVersion(env);

export const newUserId = (): string => `u_${[...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
