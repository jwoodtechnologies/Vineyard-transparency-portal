/** Pure types shared by the search repository, the Ask pipeline and tests. */
import type { DocumentType, RecordCurrency } from '../../src/types/models';

export interface ShardFilters {
  documentTypes?: DocumentType[];
  categories?: string[];
  years?: number[];
  dateFrom?: string;
  dateTo?: string;
  governmentBodyIds?: string[];
  sourceIds?: string[];
  meetingId?: string;
  currency?: RecordCurrency[];
}

export interface ChunkHit {
  shard: number;
  chunkId: string;
  documentId: string;
  pageStart: number | null;
  pageEnd: number | null;
  sectionTitle: string | null;
  /** Higher is better (negated bm25). */
  score: number;
  excerpt: string;
  highlights: Array<[number, number]>;
  text?: string;
  title: string;
  documentType: string;
  documentNumber: string | null;
  documentDate: string | null;
  year: number | null;
  governmentBodyId: string | null;
  sourceId: string;
  categoriesJson: string;
}

export interface ChunkInput {
  id: string;
  pageStart: number | null;
  pageEnd: number | null;
  sectionTitle: string | null;
  text: string;
  ocr?: boolean;
}

export interface ShardDocumentInput {
  documentId: string;
  title: string;
  documentType: string;
  documentNumber: string | null;
  documentDate: string | null;
  year: number | null;
  governmentBodyId: string | null;
  sourceId: string;
  meetingId: string | null;
  categories: string[];
  currency: string;
}

