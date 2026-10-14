/** Shapes and small helpers for the staff Records screen. */

export interface RecordType {
  key: string;
  label: string;
}

export interface RecordItem {
  id: string;
  document_id: string | null;
  kind: 'file' | 'note' | 'link' | 'project';
  title: string;
  doc_type: string;
  doc_date: string | null;
  body: string | null;
  url: string | null;
  status_text: string | null;
  location: string | null;
  meeting_id: string | null;
  project_id: string | null;
  file_name: string | null;
  file_size: number | null;
  index_status: string;
  created_at: string;
  added_by: string | null;
  meeting_title: string | null;
  meeting_date: string | null;
  typeKey: string | null;
}

export interface MeetingOption {
  id: string;
  title: string;
  meeting_date: string | null;
  government_body_name: string | null;
}

/** The biggest file the portal takes (the server holds the same limit). */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const FILE_ACCEPT = '.pdf,.png,.jpg,.jpeg,.txt,.csv,application/pdf,image/png,image/jpeg,text/plain,text/csv';

/** "2026-09-15" as "Sep 15, 2026" (no time zone shift). */
export function day(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!m) return '';
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export function sizeLabel(bytes: number | null | undefined): string {
  const n = Number(bytes ?? 0);
  if (!n) return '';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** "Sep 15, 2026 · City Council" for the meeting picker. */
export function meetingLabel(m: Pick<MeetingOption, 'title' | 'meeting_date' | 'government_body_name'>): string {
  const body = m.government_body_name || m.title;
  const d = day(m.meeting_date);
  return d ? `${d} · ${body}` : body;
}

const GUESSES: Array<[RegExp, string]> = [
  [/minute/, 'minutes'],
  [/agenda/, 'agenda'],
  [/staff[\s_-]*report/, 'staff_report'],
  [/ordinance/, 'ordinance'],
  [/resolution/, 'resolution'],
  [/\bbid\b|award/, 'bid_award'],
  [/contract|agreement/, 'contract'],
  [/budget/, 'budget'],
  [/notice/, 'notice'],
];

/** The record type a file name suggests, or "other". The person can change it. */
export function guessType(fileName: string, keys: string[]): string {
  const n = fileName.toLowerCase();
  for (const [re, key] of GUESSES) if (re.test(n) && keys.includes(key)) return key;
  return 'other';
}

/** A readable title from a file name ("water_rates_2026-09-29.pdf" becomes "Water rates 2026-09-29"). */
export function titleFromFile(fileName: string): string {
  const base = fileName
    .replace(/\.[A-Za-z0-9]{1,5}$/, '')
    .replace(/(\d)[_.](\d)/g, '$1-$2')
    .replace(/_+/g, ' ')
    .replace(/-+/g, (m, at: number, all: string) => (/\d/.test(all[at - 1] ?? '') && /\d/.test(all[at + m.length] ?? '') ? m : ' '))
    .replace(/\s+/g, ' ')
    .trim();
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : '';
}

export const KIND_LABEL: Record<RecordItem['kind'], string> = { file: 'File', note: 'Note', link: 'Link', project: 'Project' };

/**
 * Where a record added by staff stands: Processing while its text is still being read (the queue), then
 * Searchable and in the chat once it is indexed. A scan with no text, or one that could not be read, is saved
 * but not searchable.
 */
export function indexState(status: string | null | undefined): { label: string; tone: 'wait' | 'ok' | 'off'; settled: boolean } {
  if (status === 'done') return { label: 'Searchable and in the chat', tone: 'ok', settled: true };
  if (status === 'no_text') return { label: 'Saved, no text to search', tone: 'off', settled: true };
  if (status === 'failed') return { label: 'Saved, the text could not be read', tone: 'off', settled: true };
  return { label: 'Processing', tone: 'wait', settled: false };
}

export function statusNote(status: string): string {
  if (status === 'queued') return 'The text of this file is being read and will be searchable shortly.';
  if (status === 'no_text') return 'This file is a scan with no text to search. It is saved and can be opened.';
  return '';
}
