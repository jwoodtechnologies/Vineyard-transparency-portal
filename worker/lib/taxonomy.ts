import type { Category, CategoryId, DocumentType, OcrStatus, RelationshipType } from '../../src/types/models';

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  agenda: 'Agenda',
  agenda_packet: 'Agenda packet',
  minutes: 'Minutes',
  ordinance: 'Ordinance',
  resolution: 'Resolution',
  proclamation: 'Proclamation',
  contract: 'Contract',
  development_agreement: 'Development agreement',
  interlocal_agreement: 'Interlocal agreement',
  professional_services_agreement: 'Professional services agreement',
  procurement: 'Procurement',
  staff_report: 'Staff report',
  financial_report: 'Financial report',
  budget: 'Budget',
  audit: 'Audit',
  public_notice: 'Public notice',
  map: 'Map',
  study: 'Study / report',
  plan: 'Plan',
  presentation: 'Presentation',
  exhibit: 'Exhibit',
  memorandum: 'Memorandum',
  correspondence: 'Correspondence',
  transcript: 'Transcript',
  recording: 'Recording',
  municipal_code: 'Municipal code',
  other: 'Other record',
};

export const DOCUMENT_TYPES = Object.keys(DOCUMENT_TYPE_LABELS) as DocumentType[];

export const CATEGORY_DEFS: Array<Omit<Category, 'documentCount'> & { id: CategoryId }> = [
  { id: 'meetings', label: 'Meetings', description: 'Agendas, packets, minutes and meeting records.', documentTypes: ['agenda', 'agenda_packet', 'minutes', 'transcript', 'recording'] },
  { id: 'agendas', label: 'Agendas', description: 'Published meeting agendas.', documentTypes: ['agenda'] },
  { id: 'agenda_packets', label: 'Agenda packets', description: 'Full packets distributed with meeting agendas.', documentTypes: ['agenda_packet'] },
  { id: 'minutes', label: 'Minutes', description: 'Meeting minutes.', documentTypes: ['minutes'] },
  { id: 'ordinances', label: 'Ordinances', description: 'Ordinances.', documentTypes: ['ordinance'] },
  { id: 'resolutions', label: 'Resolutions', description: 'Resolutions.', documentTypes: ['resolution'] },
  { id: 'contracts', label: 'Contracts & agreements', description: 'Contracts, interlocal and professional services agreements.', documentTypes: ['contract', 'interlocal_agreement', 'professional_services_agreement'] },
  { id: 'development_agreements', label: 'Development agreements', description: 'Development agreements.', documentTypes: ['development_agreement'] },
  { id: 'budgets_finance', label: 'Budgets & finance', description: 'Budgets, amendments and financial reports.', documentTypes: ['budget', 'financial_report'] },
  { id: 'audits', label: 'Audits', description: 'Independent and state audits.', documentTypes: ['audit'] },
  { id: 'planning_land_use', label: 'Planning & land use', description: 'Plans, staff reports and land-use records.', documentTypes: ['plan', 'staff_report'] },
  { id: 'public_notices', label: 'Public notices', description: 'Published public notices.', documentTypes: ['public_notice'] },
  { id: 'reports_studies', label: 'Reports & studies', description: 'Studies, reports, memoranda and presentations.', documentTypes: ['study', 'memorandum', 'presentation'] },
  { id: 'procurement', label: 'Procurement', description: 'Bids, RFPs and procurement records.', documentTypes: ['procurement'] },
  { id: 'maps', label: 'Maps', description: 'Maps.', documentTypes: ['map'] },
  { id: 'other', label: 'Other records', description: 'Records not in another collection.', documentTypes: ['other', 'correspondence', 'exhibit', 'proclamation', 'municipal_code'] },
];

export function categoriesForType(type: DocumentType): CategoryId[] {
  return CATEGORY_DEFS.filter((c) => c.documentTypes.includes(type)).map((c) => c.id);
}

export function typesForCategories(ids: string[]): DocumentType[] {
  const out = new Set<DocumentType>();
  for (const c of CATEGORY_DEFS) if (ids.includes(c.id)) c.documentTypes.forEach((t) => out.add(t));
  return [...out];
}

export function normalizeType(value: unknown): DocumentType {
  return typeof value === 'string' && (DOCUMENT_TYPES as string[]).includes(value) ? (value as DocumentType) : 'other';
}

/** Internal ocr_status vocabulary (needed/complete/failed/not_required) to the frontend OcrStatus. */
export function toOcrStatus(value: unknown): OcrStatus {
  if (value === 'needed') return 'pending';
  if (value === 'complete' || value === 'failed' || value === 'not_required') return value;
  return 'not_required';
}

/** Internal relationship vocabulary → frontend RelationshipType, with a readable reason. */
export const RELATIONSHIP_MAP: Record<string, { type: RelationshipType; reason: string }> = {
  MEETING_HAS_AGENDA: { type: 'RECORD_OF', reason: 'Agenda for this meeting.' },
  MEETING_HAS_MINUTES: { type: 'RECORD_OF', reason: 'Minutes of this meeting.' },
  MEETING_HAS_PACKET: { type: 'RECORD_OF', reason: 'Agenda packet for this meeting.' },
  AGENDA_ITEM_HAS_ATTACHMENT: { type: 'ATTACHED_TO', reason: 'Attached to an agenda item.' },
  RESOLUTION_CONSIDERED_AT: { type: 'RELATED_TO', reason: 'Resolution considered at this meeting.' },
  ORDINANCE_CONSIDERED_AT: { type: 'RELATED_TO', reason: 'Ordinance considered at this meeting.' },
  DOCUMENT_RELATED_TO: { type: 'RELATED_TO', reason: 'Related record.' },
  DOCUMENT_SUPERSEDES: { type: 'SUPERSEDES', reason: 'Supersedes this record.' },
  DOCUMENT_VERSION_OF: { type: 'RELATED_TO', reason: 'Another version of this record.' },
};
