import type {
  Document,
  DocumentSummary,
  GovernmentBodyKind,
  GovernmentBody,
  MeetingMedia,
  MeetingSummary,
  RecordCurrency,
  SourceRegistryEntry,
  SourceType,
  CategoryId,
} from '../../src/types/models';
import { categoriesForType, normalizeType, toOcrStatus } from './taxonomy';
import { parseJsonArray } from './util';

export type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

const CURRENCIES: RecordCurrency[] = ['current', 'historical', 'superseded', 'amended', 'unknown'];
const currency = (v: unknown): RecordCurrency => (CURRENCIES.includes(v as RecordCurrency) ? (v as RecordCurrency) : 'unknown');

export const archiveUrlFor = (row: Row): string | null =>
  row.archive_status === 'archived' && row.archive_key ? `/api/documents/${String(row.id)}/file` : null;

function categories(row: Row): CategoryId[] {
  const stored = parseJsonArray<CategoryId>(row.categories_json);
  return stored.length ? stored : categoriesForType(normalizeType(row.document_type));
}

export function toDocumentSummary(row: Row): DocumentSummary {
  return {
    id: String(row.id),
    slug: String(row.slug),
    title: String(row.title),
    description: str(row.description),
    documentType: normalizeType(row.document_type),
    documentNumber: str(row.document_number),
    date: str(row.document_date),
    year: num(row.year),
    governmentBodyId: str(row.government_body_id),
    governmentBodyName: str(row.government_body_name),
    meetingId: str(row.meeting_id),
    sourceId: String(row.source_id),
    pageCount: num(row.page_count),
    mimeType: String(row.mime_type ?? 'application/octet-stream'),
    fileSize: num(row.file_size),
    categories: categories(row),
    currency: currency(row.currency),
  };
}

export function toDocument(row: Row): Document {
  const ocrStatus = toOcrStatus(row.ocr_status);
  return {
    ...toDocumentSummary(row),
    agendaItemId: str(row.agenda_item_id),
    originalUrl: str(row.original_url),
    archiveUrl: archiveUrlFor(row),
    fileName: String(row.original_filename ?? ''),
    checksum: str(row.sha256),
    checksumAlgorithm: 'sha256',
    extractedTextAvailable: Number(row.chunk_count ?? 0) > 0,
    ocrRequired: row.ocr_status === 'needed' || row.ocr_status === 'complete',
    ocrStatus,
    ocrConfidence: num(row.ocr_confidence),
    archivedAt: str(row.archived_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    tags: parseJsonArray<string>(row.tags_json),
    entities: [],
    currentVersion: Number(row.current_version ?? 1),
  };
}

const SOURCE_TYPES: SourceType[] = ['city_website', 'transparency_portal', 'meeting_portal', 'public_notice_system', 'financial_transparency', 'state_auditor', 'municipal_code', 'document_library', 'gis_portal', 'other'];

export function toSource(row: Row): SourceRegistryEntry {
  const status = String(row.status ?? 'unknown');
  return {
    id: String(row.id),
    name: String(row.name),
    baseUrl: String(row.base_url),
    sourceType: SOURCE_TYPES.includes(row.source_type as SourceType) ? (row.source_type as SourceType) : 'other',
    authority: String(row.authority),
    discoveredFrom: str(row.discovered_from),
    crawlEnabled: Number(row.crawl_enabled) === 1,
    archiveEnabled: Number(row.archive_enabled) === 1,
    documentDiscoveryEnabled: Number(row.document_discovery_enabled) === 1,
    lastChecked: str(row.last_checked_at),
    notes: String(row.notes ?? ''),
    description: str(row.description) ?? undefined,
    health: {
      status: (['active', 'degraded', 'unreachable', 'changed', 'authentication_required', 'blocked', 'unknown'].includes(status) ? status : 'unknown') as NonNullable<SourceRegistryEntry['health']>['status'],
      lastCheckedAt: str(row.last_checked_at),
      lastSuccessfulCheckAt: str(row.last_success_at),
      ...(row.status_message ? { message: String(row.status_message) } : {}),
    },
    documentCount: num(row.document_count),
  };
}

export function parseMedia(row: Row): MeetingMedia[] {
  return parseJsonArray<MeetingMedia>(row.media_json).filter((m) => m && typeof m === 'object' && typeof m.label === 'string');
}

export function toMeetingSummary(row: Row): MeetingSummary {
  const media = parseMedia(row);
  const meetingTypes = ['regular', 'special', 'work_session', 'emergency', 'hearing', 'other'];
  const statuses = ['scheduled', 'held', 'cancelled', 'postponed', 'unknown'];
  return {
    id: String(row.id),
    slug: String(row.slug),
    title: String(row.title),
    governmentBodyId: String(row.government_body_id ?? ''),
    governmentBodyName: String(row.government_body_name ?? ''),
    meetingType: (meetingTypes.includes(String(row.meeting_type)) ? row.meeting_type : 'other') as MeetingSummary['meetingType'],
    date: String(row.meeting_date ?? ''),
    startTime: str(row.start_time),
    location: str(row.location),
    status: (statuses.includes(String(row.status)) ? row.status : 'unknown') as MeetingSummary['status'],
    agendaDocumentId: str(row.agenda_document_id),
    packetDocumentId: str(row.packet_document_id),
    minutesDocumentId: str(row.minutes_document_id),
    minutesStatus: (['approved', 'draft', 'not_available'].includes(String(row.minutes_status)) ? row.minutes_status : 'not_available') as MeetingSummary['minutesStatus'],
    sourceIds: [String(row.source_id)],
    agendaItemCount: Number(row.agenda_item_count ?? 0),
    hasVideo: media.some((m) => m.kind === 'video'),
    hasAudio: media.some((m) => m.kind === 'audio'),
    hasTranscript: media.some((m) => m.kind === 'transcript'),
  };
}

const BODY_KINDS: GovernmentBodyKind[] = ['council', 'commission', 'agency', 'board', 'committee', 'department', 'other'];

export function toGovernmentBody(row: Row): GovernmentBody {
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    ...(row.short_name ? { shortName: String(row.short_name) } : {}),
    kind: BODY_KINDS.includes(row.kind as GovernmentBodyKind) ? (row.kind as GovernmentBodyKind) : 'other',
    description: String(row.description ?? ''),
    meetingCount: num(row.meeting_count),
    documentCount: num(row.document_count),
    firstRecordDate: str(row.first_record_date),
    lastRecordDate: str(row.last_record_date),
  };
}
