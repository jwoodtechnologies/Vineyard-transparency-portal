import { bodyChip, displayTitle, recordStatus, type RecordStatus } from '@/lib/recordTitle';
import { TYPE_LABEL, formatDate } from './format';

export interface LabelSource {
  title: string;
  documentType: string;
  date: string | null;
  year?: number | null;
  documentNumber?: string | null;
  governmentBodyId?: string | null;
  governmentBodyName?: string | null;
  sourceId?: string | null;
  displayTitle?: string;
  agendaItemNumber?: string | null;
  status?: RecordStatus | null;
  adoption?: { date: string | null; minutesDocumentId: string; page: number | null } | null;
}

export interface Labels {
  title: string;
  type: string;
  body: string | null;
  /** The record's date, else the date the minutes record its adoption, else its year alone. */
  date: string | null;
  item: string | null;
  status: RecordStatus | null;
}

/**
 * How a record reads in a list: the short title and chips the API sends (src/lib/recordTitle.ts),
 * worked out here too when a response does not carry them yet.
 */
export function labelsOf(d: LabelSource): Labels {
  const input = { title: d.title, documentType: d.documentType, date: d.date, documentNumber: d.documentNumber ?? null, governmentBodyId: d.governmentBodyId ?? null, governmentBodyName: d.governmentBodyName ?? null, sourceId: d.sourceId ?? null };
  const shown = d.displayTitle ? null : displayTitle(input);
  const status = d.status !== undefined ? d.status : recordStatus(input, false, shown ?? displayTitle(input));
  const attachedOnly = Boolean(shown ? shown.attached && !shown.namesMeasure : false);
  const legislative = d.documentType === 'ordinance' || d.documentType === 'resolution';
  // A packet file filed under an ordinance or resolution item that is not the measure itself reads as an attachment.
  const type = legislative && !status && (attachedOnly || (d.agendaItemNumber && !/\b(ordinance|resolution|ord|res)\b/i.test(d.title.replace(/_/g, ' ')))) ? 'Attachment' : (TYPE_LABEL[d.documentType as keyof typeof TYPE_LABEL] ?? 'Record');
  return {
    title: d.displayTitle ?? shown!.title,
    type,
    body: bodyChip(d.governmentBodyName),
    date: formatDate(d.date) ?? formatDate(d.adoption?.date) ?? (d.year ? String(d.year) : null),
    item: d.agendaItemNumber !== undefined ? d.agendaItemNumber : (shown?.item ?? null),
    status,
  };
}
