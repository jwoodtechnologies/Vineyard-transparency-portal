/**
 * Reads the real schedule settings: the Worker's cron triggers in wrangler.jsonc and the schedule blocks of
 * the GitHub workflows. scripts/gen-schedules.mjs runs these over the files and writes
 * worker/lib/schedules.generated.ts; tests/schedules.test.ts fails when that file no longer matches them.
 * Also turns a cron expression into plain words and finds its next run.
 */

export interface WorkflowSchedule {
  /** File name under .github/workflows. */
  file: string;
  /** The workflow's name: line. */
  name: string;
  crons: Array<{ cron: string; note: string }>;
}

/** The Worker's cron triggers from wrangler.jsonc (comments allowed). */
export function wranglerCrons(jsonc: string): string[] {
  const m = /"triggers"\s*:\s*\{\s*"crons"\s*:\s*\[([^\]]*)\]/.exec(jsonc);
  if (!m) return [];
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

/** A workflow's schedule: each cron with the comment lines written just above it. */
export function workflowSchedule(file: string, yml: string): WorkflowSchedule | null {
  const lines = yml.split('\n');
  const name = /^name:\s*(.+)$/m.exec(yml)?.[1].trim().replace(/^["']|["']$/g, '') ?? file;
  const start = lines.findIndex((l) => /^\s+schedule:\s*$/.test(l));
  if (start < 0) return null;
  const indent = lines[start].search(/\S/);
  const crons: WorkflowSchedule['crons'] = [];
  let note: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() && l.search(/\S/) <= indent) break;
    const c = /^\s*#\s?(.*)$/.exec(l);
    if (c) {
      note.push(c[1].trim());
      continue;
    }
    const cron = /-\s*cron:\s*["']([^"']+)["']/.exec(l);
    if (cron) {
      crons.push({ cron: cron[1], note: note.join(' ') });
      note = [];
    }
  }
  return crons.length ? { file, name, crons } : null;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const two = (n: number) => String(n).padStart(2, '0');

interface Fields {
  minute: string;
  hour: string;
  dom: string;
  month: string;
  dow: string;
}

function fields(expr: string): Fields | null {
  const p = expr.trim().split(/\s+/);
  if (p.length !== 5) return null;
  return { minute: p[0], hour: p[1], dom: p[2], month: p[3], dow: p[4] };
}

/** "Every 5 minutes", "Hourly at :41", "Daily at 09:17 UTC", "Weekly on Monday at 10:37 UTC"; the expression itself otherwise. */
export function describeCron(expr: string): string {
  const f = fields(expr);
  if (!f || f.dom !== '*' || f.month !== '*') return expr;
  const step = /^\*\/(\d+)$/.exec(f.minute);
  if (step && f.hour === '*' && f.dow === '*') return Number(step[1]) === 1 ? 'Every minute' : `Every ${Number(step[1])} minutes`;
  if (!/^\d+$/.test(f.minute)) return expr;
  const m = Number(f.minute);
  if (f.hour === '*' && f.dow === '*') return `Hourly at :${two(m)}`;
  if (!/^\d+$/.test(f.hour)) return expr;
  const at = `${two(Number(f.hour))}:${two(m)} UTC`;
  if (f.dow === '*') return `Daily at ${at}`;
  if (/^[0-6]$/.test(f.dow)) return `Weekly on ${DAYS[Number(f.dow)]} at ${at}`;
  return expr;
}

const matches = (field: string, value: number): boolean => {
  if (field === '*') return true;
  const step = /^\*\/(\d+)$/.exec(field);
  if (step) return value % Number(step[1]) === 0;
  return field.split(',').some((part) => {
    const range = /^(\d+)-(\d+)$/.exec(part);
    return range ? value >= Number(range[1]) && value <= Number(range[2]) : Number(part) === value;
  });
};

/** The first time after `from` (UTC) the cron fires, or null for an expression it cannot read. Looks up to 8 days ahead. */
export function nextCronRun(expr: string, from: Date): Date | null {
  const f = fields(expr);
  if (!f) return null;
  const t = new Date(from.getTime());
  t.setUTCSeconds(0, 0);
  for (let i = 0; i < 8 * 24 * 60; i++) {
    t.setUTCMinutes(t.getUTCMinutes() + 1);
    if (matches(f.minute, t.getUTCMinutes()) && matches(f.hour, t.getUTCHours()) && matches(f.dom, t.getUTCDate()) && matches(f.month, t.getUTCMonth() + 1) && matches(f.dow, t.getUTCDay())) return new Date(t);
  }
  return null;
}

/** "Every 15 minutes" for a job the five-minute Worker cron runs every N minutes. */
export const describeMinutes = (n: number): string => (n % 1440 === 0 ? (n === 1440 ? 'Daily' : `Every ${n / 1440} days`) : n % 60 === 0 ? (n === 60 ? 'Hourly' : `Every ${n / 60} hours`) : `Every ${n} minutes`);

/** The next Worker tick when a job that runs on ticks whose minute is a multiple of N (within the tick's five minutes) is due. */
export function nextIntervalRun(everyMin: number, from: Date): Date {
  const t = new Date(from.getTime());
  t.setUTCSeconds(0, 0);
  for (let i = 0; i < 2 * 1440; i++) {
    t.setUTCMinutes(t.getUTCMinutes() + 1);
    const minuteOfDay = t.getUTCHours() * 60 + t.getUTCMinutes();
    if (t.getUTCMinutes() % 5 === 0 && minuteOfDay % everyMin < 5) return new Date(t);
  }
  return t;
}
