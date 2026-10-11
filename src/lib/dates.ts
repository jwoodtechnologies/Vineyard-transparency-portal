/**
 * The one date format (docs/DESIGN.md): "Oct 13, 2026". Every visible date goes through these helpers.
 * Plain ISO days (2026-10-13) are read as calendar days with no timezone drift; full timestamps are read in
 * Vineyard time (America/Denver).
 */
const TZ = 'America/Denver';
const DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const DAY_TZ = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: TZ });
const DAY_TIME = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: TZ });
const WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const MONTH_DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const MONTH_YEAR = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A calendar day (UTC midnight) from "2026-10-13" or the date part of a longer ISO string. */
function day(iso: string): Date | null {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "Oct 13, 2026". A full timestamp is read in Vineyard time. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  if (ISO_DAY.test(iso.slice(0, 10)) && (iso.length === 10 || !/T\d{2}:\d{2}/.test(iso))) {
    const d = day(iso);
    return d ? DAY.format(d) : '';
  }
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? '' : DAY_TZ.format(t);
}

/** "Oct 11, 2026, 4:15 AM" in Vineyard time, for checked and updated stamps. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? '' : DAY_TIME.format(t);
}

/** "Tue, Oct 13, 2026": only where a calendar needs the weekday. */
export function formatWeekdayDate(iso: string | null | undefined): string {
  const d = iso ? day(iso) : null;
  return d ? WEEKDAY.format(d) : '';
}

/** "Oct 13": only inside a grid already labeled with its year. */
export function formatMonthDay(iso: string | null | undefined): string {
  const d = iso ? day(iso) : null;
  return d ? MONTH_DAY.format(d) : '';
}

/** "October 2026", from "2026-10" or a full ISO day. */
export function formatMonthYear(ym: string | null | undefined): string {
  if (!ym) return '';
  const d = day(ym.length === 7 ? `${ym}-01` : ym);
  return d ? MONTH_YEAR.format(d) : '';
}

function dayText(all: string, year: number, mm: number, dd: number): string {
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return all;
  const dt = new Date(Date.UTC(year, mm - 1, dd));
  return dt.getUTCMonth() === mm - 1 ? DAY.format(dt) : all;
}

/**
 * Rewrites dates in copied text into the one format, "Oct 5, 2026": 10/5/2026, 10/05/26, 11-05-2026 and
 * 2026-10-13 (a record number such as 2026-10 has no day and is left alone).
 */
export function normalizeDatesInText(text: string): string {
  return text
    .replace(/(?<![\d-])(\d{4})-(\d{2})-(\d{2})(?![\d-])/g, (all, y: string, m: string, d: string) => dayText(all, Number(y), Number(m), Number(d)))
    .replace(/(?<![\d/-])(\d{1,2})([/-])(\d{1,2})\2(\d{4}|\d{2})(?![\d/-])/g, (all, m: string, sep: string, d: string, y: string) => {
      if (sep === '-' && y.length === 2) return all;
      return dayText(all, y.length === 2 ? 2000 + Number(y) : Number(y), Number(m), Number(d));
    });
}
