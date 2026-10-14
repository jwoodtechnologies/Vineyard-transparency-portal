/**
 * Where each content area plugs into the staff API. A module answers the routes it owns (and
 * checks that the signed-in person may edit its area) and returns null for everything else.
 */
import type { Env } from '../env';
import type { StaffUser } from './core';
import { records } from './records';
import { votes } from './votes';
import { people } from './people';
import { notices } from './notices';
import { events } from './events';
import { updates } from './updates';
import { budget } from './budget';
import { content } from './content';
import { submissions } from './submissions';
import { insights } from './insights';
import { assist } from './assist';
import { archive } from './archive';
import { schedules } from './schedules';
import { watch } from './watch';

export interface StaffCall {
  env: Env;
  request: Request;
  url: URL;
  ctx: ExecutionContext;
  me: StaffUser;
  /** Path after /api/staff, e.g. "/records/upload". */
  route: string;
  /** Parsed JSON body for POST requests; null for GET. */
  body: Record<string, unknown> | null;
}

type Module = (call: StaffCall) => Promise<Response | null>;

const MODULES: Module[] = [records, votes, people, notices, events, updates, budget, content, submissions, insights, assist, archive, schedules, watch];

export async function handleStaffModules(call: StaffCall): Promise<Response | null> {
  for (const m of MODULES) {
    const r = await m(call);
    if (r) return r;
  }
  return null;
}
