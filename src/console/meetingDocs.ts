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


export interface DraftMinutes {
  documentId: string;
  title: string;
  date: string | null;
  page: number;
}

/**
 * The draft minutes of a held meeting whose minutes are not posted yet. Until the council approves them they are
 * printed inside the next meeting's agenda packet; the server finds that page. Null while loading or when none.
 */
export function useDraftMinutes(m: { date: string; governmentBodyName: string | null; minutesDocumentId: string | null }, held: boolean): DraftMinutes | null {
  const want = held && !m.minutesDocumentId && m.governmentBodyName;
  const load = useJson<{ draft: DraftMinutes | null }>(want ? `/api/draft-minutes?date=${m.date}&body=${encodeURIComponent(m.governmentBodyName as string)}` : null);
  return load.status === 'done' ? load.data.draft : null;
}
