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
}

export type Preview = { kind: 'citation'; citation: Citation; query: string } | { kind: 'result'; result: SearchResult; query: string };
