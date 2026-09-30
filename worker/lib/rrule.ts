/**
 * Minimal iCalendar recurrence expansion for the city calendar feed (pure, no platform types).
 * Supports DTSTART, RDATE, EXDATE and RRULE with FREQ DAILY/WEEKLY/MONTHLY/YEARLY, INTERVAL,
 * BYDAY (plain or with an ordinal like 3WE / -1FR), BYSETPOS, BYMONTHDAY, UNTIL and COUNT.
 * Times are local wall-clock values (no time zone), which is how the city publishes them.
 */

export interface LocalDateTime {
  y: number;
  m: number; // 1-12
  d: number;
  hh: number;
  mm: number;
}

const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function parseIcalDate(s: string): LocalDateTime | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?/.exec(s.trim());
  if (!m) return null;
  return { y: +m[1], m: +m[2], d: +m[3], hh: m[4] ? +m[4] : 0, mm: m[5] ? +m[5] : 0 };
}

export const isoLocal = (t: LocalDateTime) => `${t.y}-${pad(t.m)}-${pad(t.d)}T${pad(t.hh)}:${pad(t.mm)}:00`;
const dayKey = (t: LocalDateTime) => `${t.y}${pad(t.m)}${pad(t.d)}`;
const utcOf = (t: LocalDateTime) => Date.UTC(t.y, t.m - 1, t.d, t.hh, t.mm);
const fromUtc = (ms: number): LocalDateTime => {
  const d = new Date(ms);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), hh: d.getUTCHours(), mm: d.getUTCMinutes() };
};
const addDays = (t: LocalDateTime, n: number) => fromUtc(utcOf(t) + n * 86_400_000);
const weekday = (t: LocalDateTime) => new Date(Date.UTC(t.y, t.m - 1, t.d)).getUTCDay();
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

interface Rule {
  freq: string;
  interval: number;
  byday: Array<{ n: number | null; wd: number }>;
  bysetpos: number[];
  bymonthday: number[];
  until: LocalDateTime | null;
  count: number | null;
}

function parseRule(line: string): Rule | null {
  const parts = Object.fromEntries(
    line
      .replace(/^RRULE:/i, '')
      .split(';')
      .map((p) => p.split('=') as [string, string])
      .filter(([k, v]) => k && v != null)
      .map(([k, v]) => [k.toUpperCase(), v]),
  ) as Record<string, string>;
  if (!parts.FREQ) return null;
  const byday = (parts.BYDAY ?? '')
    .split(',')
    .filter(Boolean)
    .map((x) => {
      const m = /^([+-]?\d+)?([A-Z]{2})$/.exec(x.trim().toUpperCase());
      return m ? { n: m[1] ? Number(m[1]) : null, wd: DAYS.indexOf(m[2]) } : null;
    })
    .filter((x): x is { n: number | null; wd: number } => Boolean(x) && x!.wd >= 0);
  return {
    freq: parts.FREQ.toUpperCase(),
    interval: Math.max(1, Number(parts.INTERVAL) || 1),
    byday,
    bysetpos: (parts.BYSETPOS ?? '').split(',').filter(Boolean).map(Number),
    bymonthday: (parts.BYMONTHDAY ?? '').split(',').filter(Boolean).map(Number),
    until: parts.UNTIL ? parseIcalDate(parts.UNTIL) : null,
    count: parts.COUNT ? Number(parts.COUNT) : null,
  };
}

/** Candidate days in one month for a MONTHLY rule. */
function monthDays(y: number, m: number, rule: Rule, start: LocalDateTime): number[] {
  const n = daysInMonth(y, m);
  let days: number[] = [];
  if (rule.bymonthday.length) days = rule.bymonthday.map((d) => (d < 0 ? n + 1 + d : d)).filter((d) => d >= 1 && d <= n);
  else if (rule.byday.length) {
    for (const b of rule.byday) {
      const all: number[] = [];
      for (let d = 1; d <= n; d++) if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() === b.wd) all.push(d);
      if (b.n == null) days.push(...all);
      else {
        const pick = b.n > 0 ? all[b.n - 1] : all[all.length + b.n];
        if (pick) days.push(pick);
      }
    }
    days.sort((a, b) => a - b);
    if (rule.bysetpos.length) days = rule.bysetpos.map((p) => (p > 0 ? days[p - 1] : days[days.length + p])).filter((d): d is number => d != null);
  } else days = [Math.min(start.d, n)];
  return [...new Set(days)].sort((a, b) => a - b);
}

/**
 * Occurrence start times for an iCal recurrence block, limited to [from, to] (local ISO dates)
 * and to at most `max` results.
 */
export function expandRecurrence(block: string, from: string, to: string, max = 400): string[] {
  const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const dtLine = lines.find((l) => /^DTSTART/i.test(l));
  const start = dtLine ? parseIcalDate(dtLine.split(':').pop() ?? '') : null;
  if (!start) return [];
  const rule = lines.map((l) => (/^RRULE/i.test(l) ? parseRule(l) : null)).find(Boolean) ?? null;
  const ex = new Set(
    lines
      .filter((l) => /^EXDATE/i.test(l))
      .flatMap((l) => (l.split(':').pop() ?? '').split(','))
      .map((v) => parseIcalDate(v))
      .filter((v): v is LocalDateTime => Boolean(v))
      .map(dayKey),
  );
  const extra = lines
    .filter((l) => /^RDATE/i.test(l))
    .flatMap((l) => (l.split(':').pop() ?? '').split(','))
    .map((v) => parseIcalDate(v))
    .filter((v): v is LocalDateTime => Boolean(v))
    .map((v) => ({ ...v, hh: v.hh || start.hh, mm: v.mm || start.mm }));

  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMs = Date.parse(`${to}T23:59:59Z`);
  const hardEnd = Math.min(toMs, rule?.until ? utcOf(rule.until) + 86_399_000 : Infinity, utcOf(start) + 3 * 366 * 86_400_000);
  const out = new Map<string, LocalDateTime>();
  let produced = 0;
  const emit = (t: LocalDateTime) => {
    produced++;
    const ms = utcOf(t);
    if (ms < utcOf(start) || ms > hardEnd) return;
    if (ex.has(dayKey(t))) return;
    if (ms >= fromMs && ms <= toMs) out.set(isoLocal(t), t);
  };
  const countOk = () => rule?.count == null || produced < rule.count;

  if (!rule) emit(start);
  else if (rule.freq === 'DAILY') {
    for (let t = start, i = 0; utcOf(t) <= hardEnd && countOk() && i < 5000; t = addDays(t, rule.interval), i++) emit(t);
  } else if (rule.freq === 'WEEKLY') {
    const wds = rule.byday.length ? rule.byday.map((b) => b.wd).sort((a, b) => a - b) : [weekday(start)];
    let weekStart = addDays(start, -weekday(start));
    for (let i = 0; utcOf(weekStart) <= hardEnd && countOk() && i < 2000; i++, weekStart = addDays(weekStart, 7 * rule.interval))
      for (const wd of wds) {
        if (!countOk()) break;
        const t = addDays(weekStart, wd);
        if (utcOf(t) >= utcOf(start)) emit({ ...t, hh: start.hh, mm: start.mm });
      }
  } else if (rule.freq === 'MONTHLY') {
    for (let i = 0, y = start.y, m = start.m; i < 600 && countOk(); i++) {
      if (Date.UTC(y, m - 1, 1) > hardEnd) break;
      for (const d of monthDays(y, m, rule, start)) {
        if (!countOk()) break;
        const t = { y, m, d, hh: start.hh, mm: start.mm };
        if (utcOf(t) >= utcOf(start)) emit(t);
      }
      m += rule.interval;
      while (m > 12) {
        m -= 12;
        y++;
      }
    }
  } else if (rule.freq === 'YEARLY') {
    for (let y = start.y, i = 0; i < 50 && countOk(); y += rule.interval, i++) {
      const t = { ...start, y, d: Math.min(start.d, daysInMonth(y, start.m)) };
      if (utcOf(t) > hardEnd) break;
      emit(t);
    }
  } else emit(start);

  for (const t of extra) {
    const ms = utcOf(t);
    if (!ex.has(dayKey(t)) && ms >= fromMs && ms <= toMs) out.set(isoLocal(t), t);
  }
  return [...out.keys()].sort().slice(0, max);
}
