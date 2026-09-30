/** Loading and ordering the records of one meeting. */
import { useJson, type DocLite } from './api';

const FIRST: Record<string, number> = { agenda: 0, agenda_packet: 1, minutes: 2 };

export function sortMeetingDocs(docs: DocLite[]): DocLite[] {
  return [...docs].sort((a, b) => (FIRST[a.documentType] ?? 9) - (FIRST[b.documentType] ?? 9) || a.title.localeCompare(b.title, undefined, { numeric: true }));
}

export function useMeetingDocs(meetingId: string | null | undefined) {
  const load = useJson<{ items: DocLite[]; total: number }>(meetingId ? `/api/documents?meeting=${encodeURIComponent(meetingId)}&pageSize=100` : null);
  return load.status === 'done' ? { status: 'done' as const, docs: sortMeetingDocs(load.data.items), total: load.data.total } : { status: load.status, docs: [] as DocLite[], total: 0 };
}

