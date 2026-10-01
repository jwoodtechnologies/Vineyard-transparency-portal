import type { AskResponse, Citation, SearchFilters, SearchResponse, SearchResult, SearchSort } from '@/types/models';

import type { AnswerEvent } from './EventCard';

export interface AnswerSeries {
  label: string;
  items: Array<{ id: string; title: string; date: string | null; year: number | null }>;
}

export type ConsoleAnswer = AskResponse & { mode?: 'conversation'; event?: AnswerEvent; series?: AnswerSeries; people?: string[]; contact?: string };

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
  /** Model text as it streams in (display only; replaced by the checked answer). */
  draft: string;
  phase: 'searching' | 'writing';
}

export type Preview = { kind: 'citation'; citation: Citation; query: string } | { kind: 'result'; result: SearchResult; query: string };
