/**
 * What a question means in time, resolved against today's date in Vineyard: "next year" is 2027
 * when today is in 2026, "this year" is 2026, "last month" is September 2026, "recently" is the
 * last six months. Pure and deterministic (no model, no Worker types), so it is exact and tested.
 */

export interface TimeFrame {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  label: string; // "2027", "September 2026", "the last six months"
  future: boolean; // the window is (partly) ahead of today
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const NAMES = MONTHS.map((m) => m[0].toUpperCase() + m.slice(1));

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const addDays = (s: string, n: number) => new Date(Date.parse(`${s}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Today in Vineyard (America/Denver, close enough with a fixed offset for date math). */
export function utahToday(now = Date.now()): string {
  return new Date(now - 6 * 3600_000).toISOString().slice(0, 10);
}

export function resolveTime(question: string, today: string): TimeFrame | null {
  const q = question.toLowerCase();
  const Y = Number(today.slice(0, 4));
  const M = Number(today.slice(5, 7));
  const year = (y: number): TimeFrame => ({ from: iso(y, 1, 1), to: iso(y, 12, 31), label: String(y), future: y > Y || (y === Y && false) });
  const month = (y: number, m: number): TimeFrame => ({ from: iso(y, m, 1), to: iso(y, m, lastDay(y, m)), label: `${NAMES[m - 1]} ${y}`, future: y > Y || (y === Y && m > M) });

  // Fiscal years run July 1 to June 30; FY2027 is July 2026 to June 2027.
  const fyNamed = q.match(/\b(?:fiscal year|fy)\s*'?(\d{2}|\d{4})(?:\s*-\s*\d{2,4})?\b/);
  if (fyNamed) {
    const n = Number(fyNamed[1]);
    const end = n < 100 ? 2000 + n : n;
    return { from: iso(end - 1, 7, 1), to: iso(end, 6, 30), label: `fiscal year ${end} (July ${end - 1} to June ${end})`, future: end - 1 > Y };
  }
  const fyEnd = M >= 7 ? Y + 1 : Y;
  if (/\b(this|current) fiscal year\b/.test(q)) return { from: iso(fyEnd - 1, 7, 1), to: iso(fyEnd, 6, 30), label: `fiscal year ${fyEnd} (July ${fyEnd - 1} to June ${fyEnd})`, future: false };
  if (/\bnext fiscal year\b/.test(q)) return { from: iso(fyEnd, 7, 1), to: iso(fyEnd + 1, 6, 30), label: `fiscal year ${fyEnd + 1} (July ${fyEnd} to June ${fyEnd + 1})`, future: true };
  if (/\blast fiscal year\b/.test(q)) return { from: iso(fyEnd - 2, 7, 1), to: iso(fyEnd - 1, 6, 30), label: `fiscal year ${fyEnd - 1} (July ${fyEnd - 2} to June ${fyEnd - 1})`, future: false };

  if (/\bnext year\b/.test(q)) return { ...year(Y + 1), future: true };
  if (/\b(last|previous|past) year\b/.test(q) && !/\bpast year of\b/.test(q)) return year(Y - 1);
  if (/\b(this|the current) year\b|\bso far this year\b|\byear to date\b|\bytd\b/.test(q)) return { ...year(Y), future: /\b(left|remaining|rest of|upcoming|will|still)\b/.test(q) };
  if (/\bnext month\b/.test(q)) return { ...month(M === 12 ? Y + 1 : Y, M === 12 ? 1 : M + 1), future: true };
  if (/\b(last|previous|past) month\b/.test(q)) return month(M === 1 ? Y - 1 : Y, M === 1 ? 12 : M - 1);
  if (/\bthis month\b/.test(q)) return month(Y, M);
  if (/\bnext week\b/.test(q)) return { from: addDays(today, 1), to: addDays(today, 14), label: 'the next two weeks', future: true };
  if (/\b(last|past|previous) week\b/.test(q)) return { from: addDays(today, -14), to: today, label: 'the last two weeks', future: false };
  if (/\bthis week\b/.test(q)) return { from: addDays(today, -3), to: addDays(today, 7), label: 'this week', future: true };
  if (/\b(recent|recently|lately|these days|nowadays)\b/.test(q)) return { from: addDays(today, -183), to: today, label: 'the last six months', future: false };

  // "between 2019 and 2022", "from 2010 to 2015", "since 2020", "before 2000"
  const range = q.match(/\b(?:between|from)\s+((?:19|20)\d{2})\s+(?:and|to|through|-)\s+((?:19|20)\d{2})\b/);
  if (range) {
    const a = Math.min(Number(range[1]), Number(range[2]));
    const b = Math.max(Number(range[1]), Number(range[2]));
    return { from: iso(a, 1, 1), to: iso(b, 12, 31), label: `${a} to ${b}`, future: b > Y };
  }
  const since = q.match(/\bsince\s+((?:19|20)\d{2})\b/);
  if (since) return { from: iso(Number(since[1]), 1, 1), to: today, label: `${since[1]} to today`, future: false };
  const before = q.match(/\bbefore\s+((?:19|20)\d{2})\b/);
  if (before) return { from: '1989-01-01', to: iso(Number(before[1]) - 1, 12, 31), label: `before ${before[1]}`, future: false };

  // "in March 2025", "March of 2025", or "in March" (the most recent March, or the next one for future questions)
  const mName = q.match(new RegExp(`\\b(${MONTHS.join('|')})(?:\\s+(?:of\\s+)?((?:19|20)\\d{2}))?\\b`));
  if (mName && !/\bmay (i|we|you|the|be|have|not)\b/.test(q)) {
    const m = MONTHS.indexOf(mName[1]) + 1;
    if (mName[2]) return month(Number(mName[2]), m);
    const futureQ = /\b(will|upcoming|next|coming|scheduled|planned)\b/.test(q);
    const y = futureQ ? (m >= M ? Y : Y + 1) : m <= M ? Y : Y - 1;
    return month(y, m);
  }

  // A single year named: "in 2019", "2019 budget"
  const years = [...q.matchAll(/\b((?:19[89]|20[0-4])\d)\b/g)].map((m) => Number(m[1]));
  if (years.length === 1) return year(years[0]);
  return null;
}

/** One line for the model: today's date and what the question's time words mean. */
export function timeNote(today: string, frame: TimeFrame | null): string {
  const d = new Date(`${today}T12:00:00Z`);
  const long = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const Y = d.getUTCFullYear();
  const M = d.getUTCMonth() + 1;
  const fy = M >= 7 ? Y + 1 : Y;
  const base = `Today is ${long}. This year is ${Y}, next year is ${Y + 1}, last year was ${Y - 1}. The city is in fiscal year ${fy} (July ${fy - 1} to June ${fy}).`;
  return frame ? `${base} In this question the time asked about is ${frame.label} (${frame.from} to ${frame.to}); answer only about that time.` : base;
}
