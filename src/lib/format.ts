const TZ = 'America/Denver';

function parseCalendarDate(date: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "September 8, 2026" for calendar dates (never shifted by the viewer's timezone). */
export function formatDate(date: string | null | undefined, style: 'long' | 'medium' | 'short' = 'long'): string {
  if (!date) return 'Undated';
  const d = parseCalendarDate(date);
  if (!d) return date;
  const opts: Intl.DateTimeFormatOptions =
    style === 'long'
      ? { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }
      : style === 'medium'
        ? { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }
        : { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC' };
  return new Intl.DateTimeFormat('en-US', opts).format(d);
}

export function formatMonthYear(date: string): string {
  const d = parseCalendarDate(date);
  if (!d) return date;
  return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(d);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: TZ,
    timeZoneName: 'short',
  }).format(d);
}

export function formatTime(time: string | null | undefined): string | null {
  if (!time) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!m) return time;
  const h = Number(m[1]);
  const suffix = h >= 12 ? 'p.m.' : 'a.m.';
  return `${((h + 11) % 12) + 1}:${m[2]} ${suffix}`;
}

export function formatRelative(iso: string, now = Date.now()): string {
  const diff = (now - new Date(iso).getTime()) / 1000;
  if (!Number.isFinite(diff)) return '';
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} d ago`;
  return formatDate(new Date(iso).toISOString().slice(0, 10), 'medium');
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return 'Unknown';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

export function formatNumber(n: number | null | undefined): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-US').format(n);
}

export function formatDuration(seconds: number | null | undefined): string | null {
  if (!seconds) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h ? `${h} hr ${m} min` : `${m} min`;
}

export function pluralize(n: number, singular: string, plural = `${singular}s`): string {
  return `${formatNumber(n)} ${n === 1 ? singular : plural}`;
}

export function shortChecksum(checksum: string | null | undefined): string {
  if (!checksum) return 'Not recorded';
  return `${checksum.slice(0, 12)}…${checksum.slice(-6)}`;
}
