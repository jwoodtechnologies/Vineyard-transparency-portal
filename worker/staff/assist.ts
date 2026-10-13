/**
 * The staff assistant: a person says in plain words what changed ("Add the 400 South waterline to construction, it starts
 * November 3") and, optionally, attaches a file. The assistant picks ONE action from a short fixed list and fills in its
 * fields. Nothing is published here: the screen shows the plan as a preview card, the person can correct any field, and
 * Publish sends it to the same route the matching staff screen uses, with the same checks, permissions and activity log.
 *
 * It can never change anything outside that list, and it only offers actions the person's account is allowed to do.
 */
import type { Env } from '../env';
import { badRequest, json } from '../lib/http';
import { plainLine, plainText, STAFF_TYPES } from '../lib/contrib';
import { utahToday } from '../lib/coverage';
import { aiText, DEFAULT_AI_MODEL } from '../ai/answer';
import { meteredRun } from '../ai/meter';
import { getConstruction } from '../api/construction';
import { WORK_LIMITS, rolesOf, type GlanceTable } from '../../src/lib/constructionRows';
import { canEdit, type Area, type StaffUser } from './core';
import type { StaffCall } from './modules';

export type AssistAction = 'construction_add' | 'construction_change' | 'construction_hide' | 'notice' | 'event' | 'update' | 'record_note' | 'record_file';

export interface AssistPlan {
  action: AssistAction;
  fields: Record<string, string>;
}

const AREA: Record<AssistAction, Area> = {
  construction_add: 'map',
  construction_change: 'map',
  construction_hide: 'map',
  notice: 'notices',
  event: 'notices',
  update: 'notices',
  record_note: 'records',
  record_file: 'records',
};

const WHAT: Record<AssistAction, string> = {
  construction_add: 'add projects to Construction now',
  construction_change: 'change Construction now',
  construction_hide: 'change Construction now',
  notice: 'post notices',
  event: 'add events',
  update: 'post updates',
  record_note: 'add records',
  record_file: 'add records',
};

const AREA_LABEL: Record<string, string> = { map: 'Map and projects', notices: 'Notices and events', records: 'Records' };

/** Each action's fields and their length caps. Anything else the model writes is dropped. */
const FIELDS: Record<AssistAction, Record<string, number>> = {
  construction_add: { name: WORK_LIMITS.name, where: WORK_LIMITS.where, work: WORK_LIMITS.work, status: WORK_LIMITS.status, expected: WORK_LIMITS.expected },
  construction_change: { project: WORK_LIMITS.name, where: WORK_LIMITS.where, work: WORK_LIMITS.work, status: WORK_LIMITS.status, expected: WORK_LIMITS.expected },
  construction_hide: { project: WORK_LIMITS.name },
  notice: { message: 280, tone: 5, startsOn: 10, endsOn: 10 },
  event: { title: 120, date: 10, startTime: 5, endTime: 5, location: 150, description: 1000 },
  update: { title: 200, text: 4000 },
  record_note: { title: 200, text: 20000, date: 10 },
  record_file: { title: 300, type: 20, date: 10 },
};

export const ACTIONS = Object.keys(FIELDS) as AssistAction[];

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function systemPrompt(today: string, projects: string[], file: string | null): string {
  return [
    'You turn one message from a Vineyard, Utah city staff member into ONE action for the city transparency portal.',
    'Reply with JSON only, no other words: {"action": "...", "fields": {...}} or {"action": "none", "reason": "..."}.',
    `Today is ${today}. Write dates as YYYY-MM-DD and times as 24-hour HH:MM. Never invent facts the message does not give; leave a field out instead.`,
    'Actions:',
    '- construction_add: a new project under Construction now. fields: name, where, work, status (for example "Starts November 3"), expected (expected finish, for example "Spring 2027").',
    `- construction_change: change a project already under Construction now. fields: project (copied exactly from this list: ${projects.length ? projects.map((p) => `"${p}"`).join(', ') : 'none listed'}), and only the fields that change: where, work, status, expected.`,
    '- construction_hide: take a finished project off Construction now. fields: project (from the same list).',
    '- notice: a short alert at the top of every page, such as a closure. fields: message (under 280 characters), tone ("alert" for urgent, else "info"), startsOn, endsOn.',
    '- event: something on the public calendar. fields: title, date, startTime, endTime, location, description.',
    '- update: a short news-style update, such as a finished project. fields: title, text.',
    '- record_note: plain text to keep as a public record. fields: title, text, date.',
    file
      ? `- record_file: the attached file "${file}" as a record. fields: title, type (one of: ${Object.keys(STAFF_TYPES).join(', ')}), date (the document's date if the message or file name gives it).`
      : '- record_file: only when a file is attached (none is).',
    'Use "none" when the message asks for anything else, such as changing votes, budgets, pages or accounts, or deleting things.',
    'Write plain, factual wording in full sentences where text is needed. No opinions, no emoji, no dashes used as punctuation.',
  ].join('\n');
}

/** The first JSON object in the model's reply. */
function parseJson(raw: string): Record<string, unknown> | null {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/g, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(text.slice(start, end + 1));
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]+/g) ?? []);

/** The listed project a name means: exact first, then the one sharing the most words (at least half of the shorter name). */
export function matchProject(name: string, projects: string[]): string | null {
  const n = name.trim().toLowerCase();
  if (!n) return null;
  const exact = projects.find((p) => p.toLowerCase() === n);
  if (exact) return exact;
  const want = words(n);
  let best: { p: string; score: number } | null = null;
  for (const p of projects) {
    const have = words(p);
    const shared = [...want].filter((w) => have.has(w)).length;
    const score = shared / Math.max(1, Math.min(want.size, have.size));
    if (shared && score >= 0.5 && (!best || score > best.score)) best = { p, score };
  }
  return best?.p ?? null;
}

/** Cleans what the model proposed into a plan the screen can show, or a sentence saying why there is none. */
export function cleanPlan(
  raw: Record<string, unknown> | null,
  ctx: { projects: string[]; file: string | null; user: Pick<StaffUser, 'role' | 'areas'> },
): { plan: AssistPlan | null; message: string } {
  const unclear = 'I could not tell what to change from that. Say what it is and what should happen, for example: "Add the 400 South waterline to Construction now, starting November 3."';
  if (!raw) return { plan: null, message: unclear };
  if (raw.action === 'none') {
    const why = plainLine(raw.reason, 200);
    return {
      plan: null,
      message: `${why ? `${why} ` : ''}The assistant can add or change Construction now, post a notice, event or update, or add a record. For anything else, use the screens below.`.trim(),
    };
  }
  const action = ACTIONS.find((a) => a === raw.action);
  if (!action) return { plan: null, message: unclear };
  if (action === 'record_file' && !ctx.file) return { plan: null, message: 'Attach the file first, then say what it is.' };
  const area = AREA[action];
  if (!canEdit(ctx.user as StaffUser, area)) return { plan: null, message: `Your account cannot ${WHAT[action]}. Ask an admin to add the ${AREA_LABEL[area] ?? area} area to your account.` };
  if (action === 'update' && ctx.user.role !== 'owner' && ctx.user.role !== 'admin') return { plan: null, message: 'Only the owner or an admin can post updates. You can post a notice instead.' };

  const inFields = raw.fields && typeof raw.fields === 'object' && !Array.isArray(raw.fields) ? (raw.fields as Record<string, unknown>) : {};
  const fields: Record<string, string> = {};
  for (const [k, max] of Object.entries(FIELDS[action])) {
    const v = inFields[k];
    if (typeof v !== 'string' && typeof v !== 'number') continue;
    const s = k === 'text' || k === 'description' || k === 'work' ? plainText(String(v), max).trim() : plainLine(String(v), max);
    if (s) fields[k] = s;
  }
  for (const k of ['date', 'startsOn', 'endsOn']) if (fields[k] && !ISO.test(fields[k])) delete fields[k];
  for (const k of ['startTime', 'endTime']) if (fields[k] && !HHMM.test(fields[k])) delete fields[k];
  if (action === 'notice') fields.tone = fields.tone === 'alert' ? 'alert' : 'info';
  if (action === 'record_file' && !(fields.type && fields.type in STAFF_TYPES)) fields.type = 'other';

  if (action === 'construction_change' || action === 'construction_hide') {
    const match = matchProject(fields.project ?? '', ctx.projects);
    if (!match) {
      if (action === 'construction_hide') return { plan: null, message: `"${fields.project ?? ''}" is not on Construction now, so there is nothing to hide.` };
      // A change to a project that is not listed is really a new one.
      const { project, ...rest } = fields;
      return { plan: { action: 'construction_add', fields: { name: project ?? '', ...rest } }, message: '' };
    }
    fields.project = match;
  }
  const need: Partial<Record<AssistAction, string[]>> = { construction_add: ['name'], notice: ['message'], event: ['title', 'date'], update: ['text'], record_note: ['text'] };
  const missing = (need[action] ?? []).filter((k) => !fields[k]);
  if (missing.length) return { plan: { action, fields }, message: `Fill in the ${missing.join(' and ')} before publishing.` };
  return { plan: { action, fields }, message: '' };
}

async function currentProjects(env: Env): Promise<string[]> {
  try {
    const c = (await (await getConstruction(env)).json()) as { glance?: GlanceTable | null };
    const g = c.glance;
    if (!g) return [];
    const title = rolesOf(g.headers).title;
    return g.rows
      .map((r) => (r[title] ?? '').trim())
      .filter(Boolean)
      .slice(0, 40);
  } catch {
    return [];
  }
}

export async function assist(call: StaffCall): Promise<Response | null> {
  const { env, request, me, route, body } = call;
  if (route !== '/assist/plan' || request.method !== 'POST') return null;
  const text = plainText(body?.text, 2000).trim();
  const file = plainLine(body?.fileName, 200) || null;
  if (!text && !file) throw badRequest('Say what changed.');
  const projects = await currentProjects(env);
  let raw: Record<string, unknown> | null;
  try {
    const out = await meteredRun(env, env.AI_MODEL || DEFAULT_AI_MODEL, {
      messages: [
        { role: 'system', content: systemPrompt(utahToday(), projects, file) },
        { role: 'user', content: text || `File attached: ${file}` },
      ],
      max_tokens: 700,
      temperature: 0.1,
    });
    raw = parseJson(aiText(out));
  } catch (e) {
    console.error(JSON.stringify({ event: 'assist_ai_failed', message: String(e instanceof Error ? e.message : e).slice(0, 200) }));
    // Without the model, a file still becomes a record the person fills in; anything else goes to the screens.
    if (file) raw = { action: 'record_file', fields: { title: file.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ') } };
    else return json({ plan: null, message: 'The assistant is not available right now. Use the screens below; they work the same way.' });
  }
  return json({ ...cleanPlan(raw, { projects, file, user: me }), projects });
}
