import type { AskResponse, Citation, SearchFilters, SearchResponse, SearchResult, SearchSort } from '@/types/models';

export type ConsoleAnswer = AskResponse & { mode?: 'conversation' };

export interface Turn {
  id: string;
  question: string;
  status: 'loading' | 'done' | 'error';
  answer: ConsoleAnswer | null;
  error: string | null;
  filters: SearchFilters;
  sort: SearchSort;
  pageSize: number;
  records: SearchResponse | null;
  recordsStatus: 'idle' | 'loading' | 'done' | 'error';
  /** The records list is open (it starts collapsed behind "Browse records"). */
  showRecords: boolean;
  /** Fetch the record count eagerly (false for chats restored from history until opened). */
  wantRecords: boolean;
}

export type Preview = { kind: 'citation'; citation: Citation; query: string } | { kind: 'result'; result: SearchResult; query: string };
