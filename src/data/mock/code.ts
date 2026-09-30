/** DEMO MUNICIPAL CODE — a tiny sample tree showing current vs. superseded labeling and history. */
import type { CodeNode } from '@/types/models';

export const DEMO_CODE: CodeNode[] = [
  {
    id: 'demo-code-title-10',
    level: 'title',
    number: '10',
    heading: 'Demo Title 10 — Vehicles and Traffic (sample)',
    text: null,
    currency: 'current',
    effectiveDate: null,
    history: [],
    sourceUrl: null,
    sourceId: 'demo-source',
    isDemo: true,
    children: [
      {
        id: 'demo-code-10-4',
        level: 'chapter',
        number: '10-4',
        heading: 'Demo Chapter 10-4 — Parking (sample)',
        text: null,
        currency: 'current',
        effectiveDate: null,
        history: [],
        sourceUrl: null,
        sourceId: 'demo-source',
        isDemo: true,
        children: [
          {
            id: 'demo-code-10-4-020',
            level: 'section',
            number: '10-4-020',
            heading: 'Parking Restrictions (sample)',
            text:
              'A. No vehicle may be parked on a public street between 2:00 a.m. and 6:00 a.m. from November 1 through March 31 when snow-removal operations are posted.\nB. Vehicles displaying a valid residential permit may park in designated permit zones subject to posted restrictions.',
            currency: 'current',
            effectiveDate: '2026-05-27',
            sourceUrl: null,
            sourceId: 'demo-source',
            isDemo: true,
            history: [
              { date: '2024-10-08', action: 'enacted', ordinanceNumber: 'DEMO-ORD-2024-03', ordinanceDocumentId: 'demo-ord-2024-03-parking' },
              { date: '2026-05-12', action: 'amended', ordinanceNumber: 'DEMO-ORD-2026-01', ordinanceDocumentId: 'demo-ord-2026-01-parking' },
            ],
            children: [],
          },
          {
            id: 'demo-code-10-4-020-2024',
            level: 'section',
            number: '10-4-020 (2024 text)',
            heading: 'Parking Restrictions — superseded version (sample)',
            text:
              'No vehicle may be parked on a public street between 2:00 a.m. and 6:00 a.m. from December 1 through February 28.',
            currency: 'superseded',
            effectiveDate: '2024-10-23',
            sourceUrl: null,
            sourceId: 'demo-source',
            isDemo: true,
            history: [
              { date: '2024-10-08', action: 'enacted', ordinanceNumber: 'DEMO-ORD-2024-03', ordinanceDocumentId: 'demo-ord-2024-03-parking' },
              { date: '2026-05-12', action: 'amended', ordinanceNumber: 'DEMO-ORD-2026-01', ordinanceDocumentId: 'demo-ord-2026-01-parking', note: 'Superseded by amendment.' },
            ],
            children: [],
          },
        ],
      },
    ],
  },
];
