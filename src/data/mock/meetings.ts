/**
 * DEMO MEETINGS. Agendas, minutes, and agenda packets for these meetings are generated from this
 * structure by the mock database builder so page numbers, packet ranges, and citations line up.
 * Motion outcomes and vote records are explicit placeholders.
 */
import type { AgendaItem, MeetingType, MotionOutcome } from '@/types/models';

export interface RawMotion {
  description: string;
  outcome: MotionOutcome;
  voteRecord: string | null;
}

export interface RawAgendaItem {
  id: string;
  number: string;
  title: string;
  itemType: AgendaItem['itemType'];
  description?: string;
  documentIds: string[];
  motions?: RawMotion[];
}

export interface RawMeeting {
  id: string;
  title: string;
  bodyId: string;
  meetingType: MeetingType;
  date: string;
  startTime: string;
  location: string;
  status: 'held' | 'scheduled' | 'cancelled';
  minutesStatus: 'approved' | 'draft' | 'not_available';
  hasPacket: boolean;
  media: Array<{ kind: 'video' | 'audio' | 'transcript'; label: string; durationSeconds?: number; documentId?: string }>;
  items: RawAgendaItem[];
}

const LOCATION = 'Demo Council Chambers (sample location)';

export const RAW_MEETINGS: RawMeeting[] = [
  {
    id: 'demo-cc-2026-01-13',
    title: 'Demo City Council Regular Meeting',
    bodyId: 'demo-city-council',
    meetingType: 'regular',
    date: '2026-01-13',
    startTime: '18:00',
    location: LOCATION,
    status: 'held',
    minutesStatus: 'approved',
    hasPacket: true,
    media: [{ kind: 'video', label: 'Meeting video (demo placeholder)', durationSeconds: 5520 }],
    items: [
      { id: 'demo-cc-2026-01-13-1', number: '1', title: 'Call to Order and Pledge', itemType: 'other', documentIds: [] },
      { id: 'demo-cc-2026-01-13-2', number: '2', title: 'Public Comment', itemType: 'other', documentIds: [] },
      {
        id: 'demo-cc-2026-01-13-4b',
        number: '4b',
        title: 'Example Towing Services Agreement with Example Towing Co. (fictional vendor)',
        itemType: 'business',
        description: 'Consideration of a sample three-year rotational towing agreement.',
        documentIds: ['demo-sr-towing-agreement', 'demo-contract-towing-services'],
        motions: [
          {
            description: 'Motion to approve the Example Towing Services Agreement (sample motion).',
            outcome: 'approved',
            voteRecord: 'Demo vote record: 5–0 (placeholder)',
          },
        ],
      },
      { id: 'demo-cc-2026-01-13-9', number: '9', title: 'Adjournment', itemType: 'other', documentIds: [] },
    ],
  },
  {
    id: 'demo-pc-2026-02-04',
    title: 'Demo Planning Commission Regular Meeting',
    bodyId: 'demo-planning-commission',
    meetingType: 'regular',
    date: '2026-02-04',
    startTime: '18:00',
    location: LOCATION,
    status: 'held',
    minutesStatus: 'approved',
    hasPacket: false,
    media: [{ kind: 'audio', label: 'Meeting audio (demo placeholder)', durationSeconds: 3100 }],
    items: [
      {
        id: 'demo-pc-2026-02-04-2a',
        number: '2a',
        title: 'Work Session: Demo Harbor Crossing Concept Review',
        itemType: 'discussion',
        description: 'Sample concept discussion; no action taken.',
        documentIds: ['demo-application-harbor-crossing'],
        motions: [],
      },
    ],
  },
  {
    id: 'demo-cc-2026-03-10',
    title: 'Demo City Council Regular Meeting',
    bodyId: 'demo-city-council',
    meetingType: 'regular',
    date: '2026-03-10',
    startTime: '18:00',
    location: LOCATION,
    status: 'held',
    minutesStatus: 'approved',
    hasPacket: true,
    media: [
      { kind: 'video', label: 'Meeting video (demo placeholder)', durationSeconds: 6010 },
      { kind: 'audio', label: 'Meeting audio (demo placeholder)', durationSeconds: 6010 },
    ],
    items: [
      { id: 'demo-cc-2026-03-10-1', number: '1', title: 'Call to Order', itemType: 'other', documentIds: [] },
      {
        id: 'demo-cc-2026-03-10-3',
        number: '3',
        title: 'Proclamation: Example Public Records Awareness Week',
        itemType: 'presentation',
        documentIds: ['demo-proclamation-library-week'],
      },
      {
        id: 'demo-cc-2026-03-10-5a',
        number: '5a',
        title: 'Sample Resolution DEMO-RES-2026-04 — Example Residential Parking Permit Program',
        itemType: 'business',
        description: 'Consideration of a sample resolution adopting a residential parking permit program.',
        documentIds: ['demo-sr-parking-permit-program', 'demo-res-2026-04-parking-permits'],
        motions: [
          {
            description: 'Motion to adopt sample resolution DEMO-RES-2026-04 (sample motion).',
            outcome: 'approved',
            voteRecord: 'Demo vote record: 5–0 (placeholder)',
          },
        ],
      },
    ],
  },
  {
    id: 'demo-pc-2026-04-01',
    title: 'Demo Planning Commission Regular Meeting',
    bodyId: 'demo-planning-commission',
    meetingType: 'regular',
    date: '2026-04-01',
    startTime: '18:00',
    location: LOCATION,
    status: 'held',
    minutesStatus: 'approved',
    hasPacket: true,
    media: [],
    items: [
      {
        id: 'demo-pc-2026-04-01-2a',
        number: '2a',
        title: 'Public Hearing: Demo Harbor Crossing Zone Change',
        itemType: 'public_hearing',
        documentIds: ['demo-sr-harbor-crossing-rezone', 'demo-notice-harbor-crossing-hearing'],
        motions: [
          {
            description: 'Motion to forward a positive recommendation on the Demo Harbor Crossing zone change (sample motion).',
            outcome: 'approved',
            voteRecord: 'Demo vote record: 4–1 (placeholder)',
          },
        ],
      },
    ],
  },
  {
    id: 'demo-cc-2026-05-12',
    title: 'Demo City Council Regular Meeting',
    bodyId: 'demo-city-council',
    meetingType: 'regular',
    date: '2026-05-12',
    startTime: '18:00',
    location: LOCATION,
    status: 'held',
    minutesStatus: 'approved',
    hasPacket: true,
    media: [{ kind: 'video', label: 'Meeting video (demo placeholder)', durationSeconds: 7420 }],
    items: [
      {
        id: 'demo-cc-2026-05-12-6a',
        number: '6a',
        title: 'Public Hearing: Sample Ordinance DEMO-ORD-2026-01 — Parking Restrictions',
        itemType: 'public_hearing',
        documentIds: ['demo-notice-parking-hearing', 'demo-ord-2026-01-parking'],
        motions: [
          {
            description: 'Motion to adopt sample ordinance DEMO-ORD-2026-01 (sample motion).',
            outcome: 'approved',
            voteRecord: 'Demo vote record: 4–1 (placeholder)',
          },
        ],
      },
      {
        id: 'demo-cc-2026-05-12-6b',
        number: '6b',
        title: 'Presentation of the Example Tentative Budget, FY 2027',
        itemType: 'presentation',
        documentIds: ['demo-budget-fy2027-tentative'],
        motions: [
          {
            description: 'Motion to accept the tentative budget and set a budget hearing (sample motion).',
            outcome: 'approved',
            voteRecord: 'Demo vote record: 5–0 (placeholder)',
          },
        ],
      },
    ],
  },
  {
    id: 'demo-rda-2026-06-09',
    title: 'Demo Redevelopment Agency Board Meeting',
    bodyId: 'demo-redevelopment-agency',
    meetingType: 'regular',
    date: '2026-06-09',
    startTime: '17:30',
    location: LOCATION,
    status: 'held',
    minutesStatus: 'draft',
    hasPacket: false,
    media: [],
    items: [
      {
        id: 'demo-rda-2026-06-09-3a',
        number: '3a',
        title: 'Example Professional Services Agreement — Sample Lakeside Park Design',
        itemType: 'business',
        documentIds: ['demo-psa-sample-park-design'],
        motions: [
          {
            description: 'Motion to approve the sample park design agreement (sample motion).',
            outcome: 'approved',
            voteRecord: 'Demo vote record: 5–0 (placeholder)',
          },
        ],
      },
    ],
  },
  {
    id: 'demo-cc-2026-08-11',
    title: 'Demo City Council Regular Meeting',
    bodyId: 'demo-city-council',
    meetingType: 'regular',
    date: '2026-08-11',
    startTime: '18:00',
    location: LOCATION,
    status: 'held',
    minutesStatus: 'draft',
    hasPacket: true,
    media: [
      { kind: 'video', label: 'Meeting video (demo placeholder)', durationSeconds: 8130 },
      { kind: 'transcript', label: 'Machine transcript excerpt (demo)', documentId: 'demo-transcript-cc-2026-08-11' },
    ],
    items: [
      {
        id: 'demo-cc-2026-08-11-7a',
        number: '7a',
        title: 'Example Master Development Agreement — Demo Harbor Crossing (fictional)',
        itemType: 'business',
        documentIds: ['demo-da-example-mixed-use'],
        motions: [
          {
            description: 'Motion to approve the Demo Harbor Crossing development agreement (sample motion).',
            outcome: 'approved',
            voteRecord: 'Demo vote record: 3–2 (placeholder)',
          },
        ],
      },
    ],
  },
  {
    id: 'demo-cc-2026-10-13',
    title: 'Demo City Council Regular Meeting',
    bodyId: 'demo-city-council',
    meetingType: 'regular',
    date: '2026-10-13',
    startTime: '18:00',
    location: LOCATION,
    status: 'scheduled',
    minutesStatus: 'not_available',
    hasPacket: false,
    media: [],
    items: [
      { id: 'demo-cc-2026-10-13-1', number: '1', title: 'Call to Order', itemType: 'other', documentIds: [] },
      {
        id: 'demo-cc-2026-10-13-5',
        number: '5',
        title: 'Discussion: Example Traffic Calming Policy Update',
        itemType: 'discussion',
        documentIds: ['demo-policy-traffic-calming'],
      },
    ],
  },
];
