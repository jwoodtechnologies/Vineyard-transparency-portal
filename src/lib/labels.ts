import type { CategoryId, DocumentType, RecordCurrency, RelationshipType, RetrievalStatus, SourceHealthStatus, SourceType } from '@/types/models';

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  agenda: 'Agenda',
  agenda_packet: 'Agenda Packet',
  minutes: 'Minutes',
  ordinance: 'Ordinance',
  resolution: 'Resolution',
  proclamation: 'Proclamation',
  contract: 'Contract',
  development_agreement: 'Development Agreement',
  interlocal_agreement: 'Interlocal Agreement',
  professional_services_agreement: 'Professional Services Agreement',
  procurement: 'Procurement',
  staff_report: 'Staff Report',
  financial_report: 'Financial Report',
  budget: 'Budget',
  audit: 'Audit',
  public_notice: 'Public Notice',
  map: 'Map',
  study: 'Study',
  plan: 'Plan',
  presentation: 'Presentation',
  exhibit: 'Exhibit',
  memorandum: 'Memorandum',
  correspondence: 'Correspondence',
  transcript: 'Transcript',
  recording: 'Recording',
  municipal_code: 'Municipal Code',
  other: 'Other Record',
};

export const CATEGORY_LABELS: Record<CategoryId, string> = {
  meetings: 'Meetings',
  agendas: 'Agendas',
  minutes: 'Minutes',
  agenda_packets: 'Agenda Packets',
  ordinances: 'Ordinances',
  resolutions: 'Resolutions',
  contracts: 'Contracts',
  development_agreements: 'Development Agreements',
  budgets_finance: 'Budgets & Finance',
  audits: 'Audits',
  planning_land_use: 'Planning & Land Use',
  transportation: 'Transportation',
  public_notices: 'Public Notices',
  reports_studies: 'Reports & Studies',
  procurement: 'Procurement',
  maps: 'Maps',
  other: 'Other Records',
};

export const CATEGORY_DESCRIPTIONS: Record<CategoryId, string> = {
  meetings: 'Meeting records, recordings, and transcripts.',
  agendas: 'Published meeting agendas.',
  minutes: 'Approved and draft meeting minutes.',
  agenda_packets: 'Full packets with staff reports and exhibits.',
  ordinances: 'Adopted ordinances and code amendments.',
  resolutions: 'Adopted resolutions.',
  contracts: 'Contracts, service agreements, and interlocal agreements.',
  development_agreements: 'Development and master development agreements.',
  budgets_finance: 'Budgets, financial reports, and statements.',
  audits: 'Independent audits and State Auditor filings.',
  planning_land_use: 'Zoning, general plans, and land-use records.',
  transportation: 'Streets, traffic, parking, and transit.',
  public_notices: 'Statutory notices and public hearings.',
  reports_studies: 'Staff reports, studies, and analyses.',
  procurement: 'RFPs, RFQs, and bid documents.',
  maps: 'Maps and geographic exhibits.',
  other: 'Records that do not fit another collection.',
};

export const CURRENCY_LABELS: Record<RecordCurrency, string> = {
  current: 'Current',
  historical: 'Historical record',
  superseded: 'Superseded',
  amended: 'Amended',
  unknown: 'Status not determined',
};

export const RELATIONSHIP_LABELS: Record<RelationshipType | 'SIMILAR', string> = {
  ADOPTED_DURING: 'Adopted during',
  ATTACHED_TO: 'Attached to',
  AMENDS: 'Amends',
  AMENDED_BY: 'Amended by',
  SUPERSEDES: 'Supersedes',
  SUPERSEDED_BY: 'Superseded by',
  RELATED_TO: 'Related to',
  RECORD_OF: 'Record of',
  REFERENCES: 'References',
  EXHIBIT_OF: 'Exhibit of',
  PART_OF: 'Part of',
  DUPLICATE_OF: 'Duplicate of',
  SIMILAR: 'Similar content',
};

export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  city_website: 'City website',
  transparency_portal: 'Transparency portal',
  meeting_portal: 'Meeting portal',
  public_notice_system: 'Public notice system',
  financial_transparency: 'Financial transparency',
  state_auditor: 'State Auditor reporting',
  municipal_code: 'Municipal code',
  document_library: 'Document library',
  gis_portal: 'GIS portal',
  other: 'Other',
};

export const HEALTH_LABELS: Record<SourceHealthStatus, string> = {
  active: 'Active',
  degraded: 'Degraded',
  unreachable: 'Unreachable',
  changed: 'Changed',
  authentication_required: 'Authentication required',
  blocked: 'Blocked',
  unknown: 'Not yet checked',
};

export const RETRIEVAL_STATUS_LABELS: Record<RetrievalStatus, string> = {
  grounded: 'Grounded in records',
  partial: 'Partially supported',
  no_results: 'Not verified',
  ai_unavailable: 'AI unavailable — search results',
  search_only: 'Search results',
};

export function documentTypeLabel(type: DocumentType | string): string {
  return DOCUMENT_TYPE_LABELS[type as DocumentType] ?? type;
}

export function categoryLabel(id: CategoryId | string): string {
  return CATEGORY_LABELS[id as CategoryId] ?? id;
}
