/**
 * Classification. Deterministic rules run first (scripts/lib/metadata.ts); an optional AI
 * classifier may ADD suggestions afterwards. The default is a no-op.
 *
 * AI output rules (enforced by the pipeline, not by the model):
 *  - never overrides a document number, date, or type that was read deterministically
 *  - never invents entities about private individuals (DocumentEntity kinds are public-record
 *    subjects only)
 *  - relationships it proposes are stored with basis "ai_suggested"
 */
import type { CategoryId, DocumentType } from '../../src/types/models';

export interface ClassificationInput {
  title: string;
  documentType: DocumentType;
  firstPageText: string;
  url: string;
}

export interface ClassificationSuggestion {
  documentType?: DocumentType;
  tags?: string[];
  confidence: number;
}

export interface DocumentClassifier {
  readonly id: string;
  classify(input: ClassificationInput): Promise<ClassificationSuggestion | null>;
}

export class NoopClassifier implements DocumentClassifier {
  readonly id = 'deterministic-only';
  async classify(): Promise<ClassificationSuggestion | null> {
    return null;
  }
}

/** Deterministic mapping from document type to browse collections. */
export function categoriesForType(type: DocumentType): CategoryId[] {
  switch (type) {
    case 'agenda':
      return ['meetings', 'agendas'];
    case 'agenda_packet':
      return ['meetings', 'agenda_packets'];
    case 'minutes':
      return ['meetings', 'minutes'];
    case 'transcript':
    case 'recording':
      return ['meetings'];
    case 'ordinance':
      return ['ordinances'];
    case 'resolution':
      return ['resolutions'];
    case 'contract':
    case 'interlocal_agreement':
    case 'professional_services_agreement':
      return ['contracts'];
    case 'development_agreement':
      return ['development_agreements', 'planning_land_use'];
    case 'budget':
    case 'financial_report':
      return ['budgets_finance'];
    case 'audit':
      return ['audits', 'budgets_finance'];
    case 'public_notice':
      return ['public_notices'];
    case 'procurement':
      return ['procurement'];
    case 'map':
      return ['maps'];
    case 'study':
    case 'plan':
    case 'staff_report':
      return ['reports_studies'];
    default:
      return ['other'];
  }
}
