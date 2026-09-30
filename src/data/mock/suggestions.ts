import type { SuggestedQuery } from '@/types/models';

/**
 * Sample prompts. These are prompts only — answers always come from retrieval. Several deliberately
 * reference real-world topics that are NOT in the demo archive, so demo mode shows the honest
 * "could not verify" path rather than inventing an answer.
 */
export const DEMO_SUGGESTIONS: SuggestedQuery[] = [
  { id: 's1', text: 'What contracts mention towing?', mode: 'ask', category: 'Contracts' },
  { id: 's2', text: 'What did the council decide about residential parking permits?', mode: 'ask', category: 'Parking' },
  { id: 's3', text: 'What happened with the Demo Harbor Crossing project?', mode: 'ask', category: 'Development' },
  { id: 's4', text: 'Find records about 300 West.', mode: 'ask', category: 'Streets' },
  { id: 's5', text: 'What records discuss parks spending?', mode: 'ask', category: 'Finance' },
  { id: 's6', text: 'Show me ordinances adopted in 2026.', mode: 'ask', category: 'Ordinances' },
  { id: 's7', text: '"parking enforcement"', mode: 'search' },
  { id: 's8', text: 'DEMO-RES-2026-04', mode: 'search' },
  { id: 's9', text: 'traffic safety', mode: 'search' },
  { id: 's10', text: 'FY 2027', mode: 'search' },
];
