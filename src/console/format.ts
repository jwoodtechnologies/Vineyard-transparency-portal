import type { DocumentType } from '@/types/models';

export const TYPE_LABEL: Record<DocumentType, string> = {
  agenda: 'Agenda',
  agenda_packet: 'Agenda packet',
  minutes: 'Minutes',
  ordinance: 'Ordinance',
  resolution: 'Resolution',
  proclamation: 'Proclamation',
  contract: 'Contract',
  development_agreement: 'Development agreement',
  interlocal_agreement: 'Interlocal agreement',
  professional_services_agreement: 'Services agreement',
  procurement: 'Procurement',
  staff_report: 'Staff report',
  financial_report: 'Financial report',
  budget: 'Budget',
  audit: 'Audit',
  public_notice: 'Public notice',
  map: 'Map',
  study: 'Report',
  plan: 'Plan',
  presentation: 'Presentation',
  exhibit: 'Exhibit',
  memorandum: 'Memo',
  correspondence: 'Correspondence',
  transcript: 'Transcript',
  recording: 'Recording',
  municipal_code: 'Municipal code',
  project: 'Project',
  note: 'Note',
  web_link: 'Link',
  resident_submission: 'Resident submission',
  tax_rate: 'Tax rates',
  election_result: 'Election results',
  other: 'Record',
};

/** Records added on the portal carry a label wherever they are shown; city records carry none. */
export const RESIDENT_LABEL = 'Resident submitted. Not a city record.';
export const STAFF_LABEL = 'Added by portal staff';
export function sourceLabel(sourceId: string | null | undefined): string | null {
  return sourceId === 'resident-submitted' ? RESIDENT_LABEL : sourceId === 'portal-staff' ? STAFF_LABEL : null;
}

const DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : DATE.format(d);
}

/** Splits text into plain and highlighted runs from [start, end) ranges. Never produces HTML. */
export function highlightRuns(text: string, ranges: Array<[number, number]>): Array<{ text: string; mark: boolean }> {
  const sorted = [...ranges].filter(([a, b]) => b > a && a >= 0 && b <= text.length).sort((x, y) => x[0] - y[0]);
  const out: Array<{ text: string; mark: boolean }> = [];
  let at = 0;
  for (const [a, b] of sorted) {
    if (a < at) continue;
    if (a > at) out.push({ text: text.slice(at, a), mark: false });
    out.push({ text: text.slice(a, b), mark: true });
    at = b;
  }
  if (at < text.length) out.push({ text: text.slice(at), mark: false });
  return out;
}
