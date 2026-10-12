/**
 * Where each content area plugs into the staff API. A module answers the routes it owns (and
 * checks that the signed-in person may edit its area) and returns null for everything else.
 */
import type { Env } from '../env';
import type { StaffUser } from './core';
import { records } from './records';

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

const MODULES: Module[] = [records];

export async function handleStaffModules(call: StaffCall): Promise<Response | null> {
  for (const m of MODULES) {
    const r = await m(call);
    if (r) return r;
  }
  return null;
}
