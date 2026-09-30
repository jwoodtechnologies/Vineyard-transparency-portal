/**
 * DEMO DOCUMENTS — synthetic records for interface development.
 *
 * Rules followed here (see README "Mock data"):
 *  - Every title carries DEMO / SAMPLE / EXAMPLE. Every number carries a DEMO- prefix.
 *  - Vendors, streets, parks, and developments are fictional ("Example Towing Co.", "Sample Avenue").
 *  - Dollar amounts are explicitly labeled placeholders.
 *  - Nothing here describes a real Vineyard decision, contract, vote, or figure.
 */
import type { CategoryId, DocumentEntity, DocumentType, RecordCurrency, RelationshipType, VersionChangeStatus } from '@/types/models';

export interface RawPage {
  section?: string;
  text: string;
}

export interface RawRelationship {
  type: RelationshipType;
  toKind: 'document' | 'meeting' | 'agenda_item' | 'code_section';
  toId: string;
  toTitle: string;
  basis: 'explicit_reference' | 'source_structure' | 'metadata_match' | 'manual' | 'ai_suggested';
  page?: number;
}

export interface RawVersion {
  versionNumber: number;
  retrievedAt: string;
  changeStatus: VersionChangeStatus;
  note?: string;
}

export interface RawDocument {
  id: string;
  title: string;
  documentType: DocumentType;
  documentNumber?: string | null;
  date: string;
  bodyId?: string | null;
  meetingId?: string | null;
  agendaItemId?: string | null;
  description: string;
  pages: RawPage[];
  tags: string[];
  entities?: DocumentEntity[];
  categories: CategoryId[];
  currency?: RecordCurrency;
  ocr?: { confidence: number };
  versions?: RawVersion[];
  relationships?: RawRelationship[];
  /** Simulates an original government URL that no longer resolves. */
  originalRemoved?: boolean;
  /** Simulates a record whose archived copy is not stored (link-only). */
  noArchivedCopy?: boolean;
  mimeType?: string;
}


export const RAW_DOCUMENTS: RawDocument[] = [
  /* ---------------------------------------------------------------- Parking */
  {
    id: 'demo-res-2026-04-parking-permits',
    title: 'SAMPLE RESOLUTION DEMO-RES-2026-04 — Adopting an Example Residential Parking Permit Program',
    documentType: 'resolution',
    documentNumber: 'DEMO-RES-2026-04',
    date: '2026-03-10',
    bodyId: 'demo-city-council',
    meetingId: 'demo-cc-2026-03-10',
    agendaItemId: 'demo-cc-2026-03-10-5a',
    description:
      'Sample resolution used to demonstrate how adopted resolutions, their meeting, and their supporting staff report are linked.',
    categories: ['resolutions'],
    tags: ['parking', 'parking permits', 'residential parking', 'parking enforcement'],
    entities: [
      { type: 'program', name: 'Example Residential Parking Permit Program' },
      { type: 'street', name: 'Sample Avenue' },
    ],
    pages: [
      {
        section: 'Recitals',
        text: 'SAMPLE RESOLUTION DEMO-RES-2026-04. A demo resolution of the Demo City Council adopting an Example Residential Parking Permit Program. WHEREAS, the demo staff report describes recurring on-street parking congestion near Sample Avenue during weekday evenings; and WHEREAS, the Demo City Council held a public discussion of parking enforcement options at its demo meeting of March 10, 2026; and WHEREAS, the program is intended to prioritize on-street parking for residents of designated demo permit zones.',
      },
      {
        section: 'Section 1. Program Adopted',
        text: 'NOW, THEREFORE, BE IT RESOLVED by the Demo City Council as follows. Section 1. The Example Residential Parking Permit Program described in Exhibit A is adopted. Permits are issued per household in designated demo zones. Section 2. Parking enforcement within permit zones begins after a 60-day education period during which warnings, not citations, are issued. Section 3. The permit fee is set at $12.34 per year (placeholder amount — demo data).',
      },
      {
        section: 'Section 4. Effective Date',
        text: 'Section 4. This sample resolution takes effect upon adoption. PASSED AND ADOPTED by the Demo City Council on March 10, 2026 (demo date). Demo vote record: approved 5–0 (placeholder). This is a DEMO DOCUMENT created for interface development and is not a record of any government action.',
      },
    ],
    relationships: [
      { type: 'ADOPTED_DURING', toKind: 'meeting', toId: 'demo-cc-2026-03-10', toTitle: 'Demo City Council Regular Meeting — March 10, 2026', basis: 'source_structure' },
      { type: 'RELATED_TO', toKind: 'document', toId: 'demo-sr-parking-permit-program', toTitle: 'DEMO STAFF REPORT — Example Residential Parking Permit Program', basis: 'explicit_reference', page: 1 },
    ],
  },
  {
    id: 'demo-sr-parking-permit-program',
    title: 'DEMO STAFF REPORT — Example Residential Parking Permit Program',
    documentType: 'staff_report',
    date: '2026-03-03',
    bodyId: 'demo-city-council',
    meetingId: 'demo-cc-2026-03-10',
    agendaItemId: 'demo-cc-2026-03-10-5a',
    description: 'Sample staff report recommending a residential parking permit program; used to demonstrate citations to specific pages.',
    categories: ['reports_studies', 'transportation'],
    tags: ['parking', 'parking enforcement', 'staff report', 'residential parking'],
    entities: [
      { type: 'program', name: 'Example Residential Parking Permit Program' },
      { type: 'street', name: 'Sample Avenue' },
    ],
    pages: [
      {
        section: 'Summary',
        text: 'DEMO STAFF REPORT. Subject: Example Residential Parking Permit Program. Meeting: Demo City Council, March 10, 2026. Summary: Demo staff received recurring comments about evening on-street parking congestion along Sample Avenue and adjacent demo streets. This report evaluates three parking management options and recommends a residential permit program with a 60-day education period.',
      },
      {
        section: 'Options Considered',
        text: 'Options considered. Option 1: time-limited parking signage only. Option 2: a residential parking permit program in designated zones. Option 3: no change. Demo staff observed that signage alone does not prioritize residents, while a permit program can be enforced consistently. The demo parking enforcement approach would begin with warnings during an education period.',
      },
      {
        section: 'Fiscal Impact',
        text: 'Fiscal impact. Estimated first-year signage and permit printing cost: $4,321.00 (placeholder amount — demo data). Permit fees are expected to offset a portion of administration costs. Staff recommendation: adopt the Example Residential Parking Permit Program by sample resolution DEMO-RES-2026-04.',
      },
    ],
  },
  {
    id: 'demo-ord-2026-01-parking',
    title: 'SAMPLE ORDINANCE DEMO-ORD-2026-01 — Amending Demo Code Section 10-4-020 (Parking Restrictions)',
    documentType: 'ordinance',
    documentNumber: 'DEMO-ORD-2026-01',
    date: '2026-05-12',
    bodyId: 'demo-city-council',
    meetingId: 'demo-cc-2026-05-12',
    agendaItemId: 'demo-cc-2026-05-12-6a',
    description: 'Sample ordinance amending a demo code section. Demonstrates current vs. superseded legislation and code history.',
    categories: ['ordinances', 'transportation'],
    tags: ['parking', 'ordinance', 'municipal code', 'overnight parking', 'snow removal'],
    currency: 'current',
    entities: [{ type: 'topic', name: 'Parking restrictions' }],
    pages: [
      {
        section: 'Title and Purpose',
        text: 'SAMPLE ORDINANCE DEMO-ORD-2026-01. An ordinance of the Demo City Council amending Demo Code Section 10-4-020 regarding parking restrictions. Purpose: to clarify overnight parking limits during snow-removal operations and to align enforcement language with the Example Residential Parking Permit Program.',
      },
      {
        section: 'Amendment',
        text: 'Section 10-4-020 is amended to read: A. No vehicle may be parked on a public street between 2:00 a.m. and 6:00 a.m. from November 1 through March 31 when snow-removal operations are posted. B. Vehicles displaying a valid residential permit may park in designated permit zones subject to posted restrictions. This amendment supersedes the language adopted by sample ordinance DEMO-ORD-2024-03.',
      },
      {
        section: 'Effective Date',
        text: 'This sample ordinance takes effect fifteen days after posting (demo). PASSED by the Demo City Council on May 12, 2026 (demo date). Demo vote record: approved 4–1 (placeholder). DEMO DOCUMENT — not a government record.',
      },
    ],
    relationships: [
      { type: 'AMENDS', toKind: 'code_section', toId: 'demo-code-10-4-020', toTitle: 'Demo Code § 10-4-020 Parking Restrictions', basis: 'explicit_reference', page: 2 },
      { type: 'SUPERSEDES', toKind: 'document', toId: 'demo-ord-2024-03-parking', toTitle: 'SAMPLE ORDINANCE DEMO-ORD-2024-03 — Establishing Demo Overnight Parking Restrictions', basis: 'explicit_reference', page: 2 },
      { type: 'ADOPTED_DURING', toKind: 'meeting', toId: 'demo-cc-2026-05-12', toTitle: 'Demo City Council Regular Meeting — May 12, 2026', basis: 'source_structure' },
    ],
  },
  {
    id: 'demo-ord-2024-03-parking',
    title: 'SAMPLE ORDINANCE DEMO-ORD-2024-03 — Establishing Demo Overnight Parking Restrictions',
    documentType: 'ordinance',
    documentNumber: 'DEMO-ORD-2024-03',
    date: '2024-10-08',
    bodyId: 'demo-city-council',
    description: 'Sample historical ordinance later superseded by DEMO-ORD-2026-01. Demonstrates the “superseded” label.',
    categories: ['ordinances', 'transportation'],
    tags: ['parking', 'ordinance', 'overnight parking', 'historical'],
    currency: 'superseded',
    ocr: { confidence: 0.87 },
    entities: [{ type: 'topic', name: 'Parking restrictions' }],
    pages: [
      {
        section: 'Enactment',
        text: 'SAMPLE ORDINANCE DEMO-ORD-2024-03. An ordinance establishing Demo Code Section 10-4-020, overnight parking restrictions. No vehicle may be parked on a public street between 2:00 a.m. and 6:00 a.m. from December 1 through February 28. This demo record was scanned; its text was produced by OCR and may contain recognition errors.',
      },
      {
        section: 'Adoption',
        text: 'PASSED by the Demo City Council on October 8, 2024 (demo date). This sample language was later superseded by sample ordinance DEMO-ORD-2026-01. DEMO DOCUMENT — not a government record.',
      },
    ],
    relationships: [
      { type: 'SUPERSEDED_BY', toKind: 'document', toId: 'demo-ord-2026-01-parking', toTitle: 'SAMPLE ORDINANCE DEMO-ORD-2026-01 — Amending Demo Code Section 10-4-020 (Parking Restrictions)', basis: 'explicit_reference' },
    ],
    originalRemoved: true,
  },
  {
    id: 'demo-notice-parking-hearing',
    title: 'DEMO PUBLIC NOTICE — Public Hearing on Example Parking Code Amendment',
    documentType: 'public_notice',
    date: '2026-04-27',
    bodyId: 'demo-city-council',
    meetingId: 'demo-cc-2026-05-12',
    description: 'Sample statutory-style notice. Demonstrates public notices linked to the meeting where the hearing occurs.',
    categories: ['public_notices'],
    tags: ['public hearing', 'parking', 'notice'],
    pages: [
      {
        section: 'Notice',
        text: 'DEMO NOTICE OF PUBLIC HEARING. The Demo City Council will hold a public hearing on May 12, 2026 (demo date) at 6:00 p.m. to consider sample ordinance DEMO-ORD-2026-01 amending demo parking restrictions in Demo Code Section 10-4-020. Interested persons may comment at the demo hearing. This notice is sample data and was not published by any government.',
      },
    ],
  },

  /* ---------------------------------------------------------------- Towing */
  {
    id: 'demo-contract-towing-services',
    title: 'EXAMPLE CONTRACT — Towing Services Agreement with Example Towing Co. (fictional vendor)',
    documentType: 'contract',
    documentNumber: 'DEMO-CON-2026-011',
    date: '2026-01-13',
    bodyId: 'demo-city-council',
    meetingId: 'demo-cc-2026-01-13',
    agendaItemId: 'demo-cc-2026-01-13-4b',
    description: 'Sample rotational towing agreement with a fictional vendor. Demonstrates contracts attached to agenda items.',
    categories: ['contracts', 'procurement'],
    tags: ['towing', 'contract', 'vendor', 'police', 'impound'],
    entities: [{ type: 'organization', name: 'Example Towing Co.' }],
    pages: [
      {
        section: 'Parties and Term',
        text: 'EXAMPLE CONTRACT DEMO-CON-2026-011. Towing Services Agreement between the demo city and Example Towing Co., a fictional vendor. Term: January 15, 2026 through January 14, 2029 (demo dates), with two optional one-year renewals. Scope: non-consensual towing, impound storage, and roadside clearance requested by demo public-safety personnel.',
      },
      {
        section: 'Rates and Response Times',
        text: 'Rates. Standard light-duty tow: $98.76 (placeholder amount — demo data). Daily storage: $12.34 (placeholder amount — demo data). The vendor must respond to towing requests within 30 minutes, 24 hours a day. The vendor maintains a secure impound lot and publishes rates at the lot entrance.',
      },
      {
        section: 'Insurance and Termination',
        text: 'Insurance. Example Towing Co. shall maintain general liability and garage keepers insurance at the limits in Exhibit B. Termination. Either party may terminate on 60 days written notice. Approved by the Demo City Council on January 13, 2026 (demo date). DEMO DOCUMENT — not a government record.',
      },
    ],
    relationships: [
      { type: 'ATTACHED_TO', toKind: 'agenda_item', toId: 'demo-cc-2026-01-13-4b', toTitle: 'Item 4b — Example Towing Services Agreement', basis: 'source_structure' },
      { type: 'RELATED_TO', toKind: 'document', toId: 'demo-rfp-towing', toTitle: 'DEMO RFP — Request for Proposals: Rotational Towing Services', basis: 'explicit_reference' },
    ],
  },
  {
    id: 'demo-rfp-towing',
    title: 'DEMO RFP — Request for Proposals: Rotational Towing Services',
    documentType: 'procurement',
    documentNumber: 'DEMO-RFP-2025-07',
    date: '2025-10-20',
    description: 'Sample request for proposals. Demonstrates procurement records that precede a contract.',
    categories: ['procurement'],
    tags: ['towing', 'rfp', 'procurement', 'bid'],
    pages: [
      {
        section: 'Overview',
        text: 'DEMO REQUEST FOR PROPOSALS DEMO-RFP-2025-07. Rotational Towing Services. The demo city seeks proposals from qualified towing providers for non-consensual towing and impound storage. Proposals are due November 17, 2025 at 3:00 p.m. (demo date).',
      },
      {
        section: 'Evaluation Criteria',
        text: 'Evaluation criteria: response time (30 points), rates (25 points), storage facility security (20 points), experience and references (15 points), insurance and compliance (10 points). This procurement document is sample data for interface development.',
      },
    ],
  },
  {
    id: 'demo-sr-towing-agreement',
    title: 'DEMO STAFF REPORT — Example Towing Services Agreement',
    documentType: 'staff_report',
    date: '2026-01-06',
    bodyId: 'demo-city-council',
    meetingId: 'demo-cc-2026-01-13',
    agendaItemId: 'demo-cc-2026-01-13-4b',
    description: 'Sample staff report summarizing proposals received for towing services.',
    categories: ['reports_studies', 'contracts'],
    tags: ['towing', 'staff report', 'procurement'],
    entities: [{ type: 'organization', name: 'Example Towing Co.' }],
    pages: [
      {
        section: 'Background',
        text: 'DEMO STAFF REPORT. Subject: Example Towing Services Agreement. Three proposals were received in response to demo RFP DEMO-RFP-2025-07. The evaluation committee scored Example Towing Co. highest based on response time and storage facility security. Staff recommends approval of a three-year agreement with two optional renewals.',
      },
    ],
  },

  /* ---------------------------------------------------------------- Parks */
  {
    id: 'demo-psa-sample-park-design',
    title: 'EXAMPLE AGREEMENT — Professional Services Agreement for Sample Lakeside Park Design',
    documentType: 'professional_services_agreement',
    documentNumber: 'DEMO-PSA-2026-003',
    date: '2026-06-09',
    bodyId: 'demo-redevelopment-agency',
    meetingId: 'demo-rda-2026-06-09',
    agendaItemId: 'demo-rda-2026-06-09-3a',
    description: 'Sample design agreement with a fictional consultant for a fictional park.',
    categories: ['contracts'],
    tags: ['parks', 'park design', 'trails', 'professional services', 'playground'],
    entities: [
      { type: 'organization', name: 'Sample Design Group' },
      { type: 'place', name: 'Sample Lakeside Park' },
    ],
    pages: [
      {
        section: 'Scope of Services',
        text: 'EXAMPLE PROFESSIONAL SERVICES AGREEMENT DEMO-PSA-2026-003. Consultant: Sample Design Group (fictional). Project: Sample Lakeside Park design. Scope: site analysis, public engagement, schematic design of a playground, pavilion, restrooms, and a lakeside trail connection, followed by construction documents.',
      },
      {
        section: 'Compensation and Schedule',
        text: 'Compensation not to exceed $234,567.00 (placeholder amount — demo data). Schedule: schematic design within 120 days of notice to proceed; construction documents within 240 days. Parks spending in this sample agreement is funded from a demo parks capital fund. DEMO DOCUMENT — not a government record.',
      },
    ],
  },
  {
    id: 'demo-parks-master-plan',
    title: 'DEMO PLAN — Example Parks, Trails & Open Space Master Plan',
    documentType: 'plan',
    date: '2025-09-16',
    bodyId: 'demo-parks-board',
    description: 'Sample long-range parks plan. Demonstrates multi-page plans and section-level citations.',
    categories: ['planning_land_use', 'reports_studies'],
    tags: ['parks', 'trails', 'open space', 'master plan', 'recreation'],
    entities: [{ type: 'place', name: 'Sample Lakeside Park' }],
    pages: [
      {
        section: 'Chapter 1 — Purpose',
        text: 'DEMO PARKS, TRAILS & OPEN SPACE MASTER PLAN. Chapter 1. Purpose. This sample plan inventories demo parks and trails, identifies service gaps, and recommends a ten-year capital program. It is fictional content used to demonstrate long document navigation.',
      },
      {
        section: 'Chapter 2 — Inventory',
        text: 'Chapter 2. Inventory. The demo inventory includes four neighborhood parks, one regional park site (Sample Lakeside Park), and 5.6 miles of paved trail (placeholder figure). Residents in the demo survey most frequently requested shade structures, restrooms, and continuous lakeside trail connections.',
      },
      {
        section: 'Chapter 3 — Recommendations',
        text: 'Chapter 3. Recommendations. Priority 1: design Sample Lakeside Park improvements. Priority 2: complete trail gaps along Demo Parkway. Priority 3: add shade structures to existing playgrounds. Estimated ten-year parks capital need: $9,876,543.00 (placeholder amount — demo data).',
      },
      {
        section: 'Chapter 4 — Funding',
        text: 'Chapter 4. Funding. Potential funding sources for parks spending include impact fees, grants, and a demo parks capital fund. Any budget figures here are placeholders and do not represent actual appropriations.',
      },
    ],
  },

  /* ---------------------------------------------------------------- Development */
  {
    id: 'demo-da-example-mixed-use',
    title: 'EXAMPLE DEVELOPMENT AGREEMENT — Demo Harbor Crossing Mixed-Use Project (fictional)',
    documentType: 'development_agreement',
    documentNumber: 'DEMO-DA-2026-02',
    date: '2026-08-11',
    bodyId: 'demo-city-council',
    meetingId: 'demo-cc-2026-08-11',
    agendaItemId: 'demo-cc-2026-08-11-7a',
    description: 'Sample master development agreement for a fictional project. Anchor record for the demo timeline.',
    categories: ['development_agreements', 'planning_land_use'],
    tags: ['development agreement', 'mixed use', 'housing', 'open space', 'infrastructure'],
    entities: [
      { type: 'project', name: 'Demo Harbor Crossing' },
      { type: 'organization', name: 'Demo Development Partners LLC' },
      { type: 'street', name: 'Demo Parkway' },
    ],
    pages: [
      {
        section: 'Recitals',
        text: 'EXAMPLE MASTER DEVELOPMENT AGREEMENT DEMO-DA-2026-02 between the demo city and Demo Development Partners LLC (fictional) for the Demo Harbor Crossing mixed-use project. The project area is a fictional 40-acre site along Demo Parkway. The Demo Planning Commission forwarded a positive recommendation on the related zoning on April 1, 2026 (demo date).',
      },
      {
        section: 'Development Standards',
        text: 'Development standards. Maximum residential units: 600 (placeholder figure). Minimum open space: 15 percent of the gross project area. Commercial frontage is required along Demo Parkway. Building heights are limited to five stories adjacent to existing neighborhoods.',
      },
      {
        section: 'Public Improvements',
        text: 'Public improvements. The developer shall construct a signalized intersection at Demo Parkway and Sample Avenue, a 10-foot multi-use trail, and a public plaza before the 200th certificate of occupancy (placeholder threshold). Infrastructure reimbursement, if any, is governed by Exhibit D.',
      },
      {
        section: 'Term and Default',
        text: 'Term. This agreement remains in effect for fifteen years (demo). Default and cure provisions are in Section 12. Approved by the Demo City Council on August 11, 2026 (demo date). DEMO DOCUMENT — not a government record.',
      },
    ],
    relationships: [
      { type: 'ADOPTED_DURING', toKind: 'meeting', toId: 'demo-cc-2026-08-11', toTitle: 'Demo City Council Regular Meeting — August 11, 2026', basis: 'source_structure' },
      { type: 'RELATED_TO', toKind: 'document', toId: 'demo-sr-harbor-crossing-rezone', toTitle: 'DEMO STAFF REPORT — Demo Harbor Crossing Zone Change Application', basis: 'explicit_reference' },
    ],
    versions: [
      { versionNumber: 1, retrievedAt: '2026-08-05T16:12:00Z', changeStatus: 'original', note: 'Draft attached to the published agenda packet.' },
      { versionNumber: 2, retrievedAt: '2026-08-12T09:40:00Z', changeStatus: 'replaced', note: 'Executed version posted after approval; checksum changed.' },
    ],
  },
  {
    id: 'demo-sr-harbor-crossing-rezone',
    title: 'DEMO STAFF REPORT — Demo Harbor Crossing Zone Change Application',
    documentType: 'staff_report',
    date: '2026-03-25',
    bodyId: 'demo-planning-commission',
    meetingId: 'demo-pc-2026-04-01',
    agendaItemId: 'demo-pc-2026-04-01-2a',
    description: 'Sample planning staff report for a fictional zone change.',
    categories: ['planning_land_use', 'reports_studies'],
    tags: ['zoning', 'rezone', 'land use', 'mixed use', 'planning commission'],
    entities: [
      { type: 'project', name: 'Demo Harbor Crossing' },
      { type: 'organization', name: 'Demo Development Partners LLC' },
    ],
    pages: [
      {
        section: 'Request',
        text: 'DEMO PLANNING STAFF REPORT. Application: zone change from demo agricultural zoning to a demo mixed-use zone for the Demo Harbor Crossing project. Applicant: Demo Development Partners LLC (fictional). The application was submitted January 20, 2026 (demo date).',
      },
      {
        section: 'Analysis',
        text: 'Analysis. The request is consistent with the demo general plan land-use map, which designates the area for mixed use. Traffic impacts are addressed in the Demo Parkway Corridor Study. Staff recommends the Demo Planning Commission forward a positive recommendation to the Demo City Council, subject to a development agreement.',
      },
    ],
  },
  {
    id: 'demo-application-harbor-crossing',
    title: 'DEMO APPLICATION — Demo Harbor Crossing Land Use Application (fictional applicant)',
    documentType: 'other',
    date: '2026-01-20',
    description: 'Sample land-use application cover sheet. First event in the demo timeline.',
    categories: ['planning_land_use'],
    tags: ['land use application', 'zoning', 'development'],
    entities: [{ type: 'project', name: 'Demo Harbor Crossing' }],
    pages: [
      {
        section: 'Application Summary',
        text: 'DEMO LAND USE APPLICATION. Project: Demo Harbor Crossing. Request: zone change and master development agreement. Received January 20, 2026 (demo date). Applicant: Demo Development Partners LLC, a fictional entity. This sample application exists only to demonstrate timeline evidence.',
      },
    ],
  },
  {
    id: 'demo-notice-harbor-crossing-hearing',
    title: 'DEMO PUBLIC NOTICE — Planning Commission Hearing on Demo Harbor Crossing Zone Change',
    documentType: 'public_notice',
    date: '2026-03-20',
    bodyId: 'demo-planning-commission',
    meetingId: 'demo-pc-2026-04-01',
    description: 'Sample hearing notice.',
    categories: ['public_notices', 'planning_land_use'],
    tags: ['public hearing', 'zoning', 'notice'],
    entities: [{ type: 'project', name: 'Demo Harbor Crossing' }],
    pages: [
      {
        section: 'Notice',
        text: 'DEMO NOTICE OF PUBLIC HEARING. The Demo Planning Commission will hold a public hearing on April 1, 2026 (demo date) regarding the Demo Harbor Crossing zone change application. This notice is sample data and was not published by any government.',
      },
    ],
    noArchivedCopy: true,
  },

  /* ---------------------------------------------------------------- Transportation */
  {
    id: 'demo-study-demo-parkway-corridor',
    title: 'DEMO STUDY — Demo Parkway Corridor Transportation Study',
    documentType: 'study',
    date: '2025-11-18',
    description: 'Sample traffic study. Demonstrates long studies, traffic-safety topics, and cross-document references.',
    categories: ['transportation', 'reports_studies'],
    tags: ['traffic', 'traffic safety', 'transportation', 'corridor study', 'crosswalk', 'signal'],
    entities: [
      { type: 'street', name: 'Demo Parkway' },
      { type: 'street', name: 'Sample Avenue' },
      { type: 'organization', name: 'Example Engineering Associates' },
    ],
    pages: [
      {
        section: 'Executive Summary',
        text: 'DEMO CORRIDOR STUDY. Prepared by Example Engineering Associates (fictional). This sample study evaluates traffic operations and traffic safety along Demo Parkway. Key finding: the Demo Parkway and Sample Avenue intersection operates at a poor level of service during the evening peak (demo finding).',
      },
      {
        section: 'Safety Analysis',
        text: 'Traffic safety analysis. The demo crash review identified rear-end collisions as the most common crash type near Sample Avenue. Recommended countermeasures: a traffic signal, high-visibility crosswalks, and a pedestrian refuge island near the school walking route.',
      },
      {
        section: 'Recommendations',
        text: 'Recommendations. Short term: restripe crosswalks and add speed feedback signs. Medium term: install a traffic signal at Demo Parkway and Sample Avenue. Long term: widen Demo Parkway to include a multi-use trail. Estimated cost: $3,210,000.00 (placeholder amount — demo data).',
      },
    ],
  },
  {
    id: 'demo-policy-traffic-calming',
    title: 'DEMO POLICY — Example Neighborhood Traffic Calming Policy',
    documentType: 'memorandum',
    date: '2026-02-17',
    bodyId: 'demo-city-council',
    description: 'Sample administrative policy on traffic calming requests.',
    categories: ['transportation'],
    tags: ['traffic calming', 'traffic safety', 'speed humps', 'policy'],
    pages: [
      {
        section: 'Policy',
        text: 'DEMO TRAFFIC CALMING POLICY. Residents may request traffic calming on local streets. Eligibility requires a speed study showing an 85th-percentile speed at least 5 mph over the posted limit (demo criterion). Tools include speed feedback signs, speed cushions, and curb extensions. This sample policy is not an adopted government policy.',
      },
    ],
  },

  /* ---------------------------------------------------------------- Finance */
  {
    id: 'demo-budget-fy2027-tentative',
    title: 'DEMO BUDGET — Example Tentative Budget, Fiscal Year 2027',
    documentType: 'budget',
    documentNumber: 'DEMO-FY2027-TB',
    date: '2026-05-12',
    bodyId: 'demo-city-council',
    meetingId: 'demo-cc-2026-05-12',
    agendaItemId: 'demo-cc-2026-05-12-6b',
    description: 'Sample tentative budget. All figures are placeholders.',
    categories: ['budgets_finance'],
    tags: ['budget', 'fy2027', 'fy 2027', 'general fund', 'parks', 'finance', 'revenue'],
    pages: [
      {
        section: 'Budget Message',
        text: 'DEMO TENTATIVE BUDGET, FISCAL YEAR 2027 (FY 2027). This sample budget message describes a demo general fund, a demo parks capital fund, and a demo transportation fund. ALL FIGURES IN THIS DOCUMENT ARE PLACEHOLDERS and do not represent real appropriations, revenues, or spending.',
      },
      {
        section: 'General Fund Summary',
        text: 'General fund summary (placeholder figures). Property tax revenue: $1,111,111.00 (placeholder amount — demo data). Sales tax revenue: $2,222,222.00 (placeholder amount — demo data). Public safety expenditures: $3,333,333.00 (placeholder amount — demo data).',
      },
      {
        section: 'Capital Projects',
        text: 'Capital projects (placeholder figures). Parks capital fund: Sample Lakeside Park design, $234,567.00 (placeholder amount — demo data). Transportation fund: Demo Parkway crosswalk restriping, $45,678.00 (placeholder amount — demo data). Budget hearings are scheduled in June (demo).',
      },
    ],
  },
  {
    id: 'demo-afr-fy2025',
    title: 'DEMO FINANCIAL REPORT — Example Annual Financial Report, Fiscal Year 2025',
    documentType: 'financial_report',
    date: '2025-12-15',
    description: 'Sample annual financial report. Demonstrates State Auditor–style records; figures are placeholders.',
    categories: ['budgets_finance', 'audits'],
    tags: ['annual financial report', 'finance', 'fy2025', 'financial statements', 'revenue'],
    pages: [
      {
        section: 'Management Discussion',
        text: 'DEMO ANNUAL FINANCIAL REPORT, FISCAL YEAR 2025. Management discussion and analysis (sample). Total governmental revenues were $12,345,678.00 (placeholder amount — demo data). All figures are placeholders used to demonstrate how financial answers must cite the underlying report.',
      },
      {
        section: 'Statement of Net Position',
        text: 'Statement of net position (placeholder). Total assets: $98,765,432.00 (placeholder amount — demo data). Total liabilities: $8,765,432.00 (placeholder amount — demo data). Notes to the financial statements begin on page 3 of the demo report.',
      },
      {
        section: 'Notes',
        text: 'Notes to the demo financial statements. Note 1 describes the demo reporting entity. Note 2 describes demo cash and investments. This DEMO DOCUMENT is not a filed financial report.',
      },
    ],
  },
  {
    id: 'demo-audit-fy2025',
    title: 'DEMO AUDIT — Example Independent Auditor’s Report, Fiscal Year 2025',
    documentType: 'audit',
    date: '2026-01-05',
    description: 'Sample independent audit report.',
    categories: ['audits', 'budgets_finance'],
    tags: ['audit', 'fy2025', 'internal control', 'finance'],
    pages: [
      {
        section: 'Opinion',
        text: 'DEMO INDEPENDENT AUDITOR’S REPORT. In this sample opinion, the fictional audit firm states that the demo financial statements present fairly, in all material respects, the demo financial position. This is sample content used to demonstrate audit records.',
      },
      {
        section: 'Findings',
        text: 'Demo findings. Finding DEMO-2025-001: purchase approvals were not consistently documented for small purchases (sample finding). Management response: procurement procedures will be updated (sample response). DEMO DOCUMENT — not an actual audit.',
      },
    ],
  },

  /* ---------------------------------------------------------------- Other */
  {
    id: 'demo-ila-shared-dispatch',
    title: 'EXAMPLE INTERLOCAL AGREEMENT — Shared Emergency Dispatch Services (demo)',
    documentType: 'interlocal_agreement',
    documentNumber: 'DEMO-ILA-2025-09',
    date: '2025-09-09',
    bodyId: 'demo-city-council',
    description: 'Sample interlocal agreement between fictional agencies.',
    categories: ['contracts'],
    tags: ['interlocal agreement', 'dispatch', 'public safety', '911'],
    pages: [
      {
        section: 'Purpose',
        text: 'EXAMPLE INTERLOCAL COOPERATION AGREEMENT DEMO-ILA-2025-09 for shared emergency dispatch services among fictional member agencies. Cost allocation is based on call volume (demo formula). This sample agreement is not a real interlocal agreement.',
      },
    ],
  },
  {
    id: 'demo-proclamation-library-week',
    title: 'DEMO PROCLAMATION — Example Public Records Awareness Week',
    documentType: 'proclamation',
    date: '2026-03-10',
    bodyId: 'demo-city-council',
    meetingId: 'demo-cc-2026-03-10',
    description: 'Sample proclamation.',
    categories: ['other'],
    tags: ['proclamation', 'public records'],
    pages: [
      {
        section: 'Proclamation',
        text: 'DEMO PROCLAMATION. WHEREAS, access to public records supports an informed community; NOW, THEREFORE, the Demo City Council proclaims an Example Public Records Awareness Week (sample). This proclamation is demo data.',
      },
    ],
  },
  {
    id: 'demo-map-zoning',
    title: 'DEMO MAP — Example Zoning Map (sample layers)',
    documentType: 'map',
    date: '2026-04-15',
    description: 'Sample map record. Demonstrates non-text records that require OCR / have limited extracted text.',
    categories: ['maps', 'planning_land_use'],
    tags: ['map', 'zoning', 'land use'],
    ocr: { confidence: 0.42 },
    pages: [
      {
        section: 'Map Legend',
        text: 'DEMO ZONING MAP legend (OCR, low confidence). Demo mixed use. Demo residential. Demo commercial. Demo open space. Demo Parkway. Sample Avenue. Text extracted from this sample map image may be incomplete.',
      },
    ],
  },
  {
    id: 'demo-transcript-cc-2026-08-11',
    title: 'DEMO TRANSCRIPT — Demo City Council Regular Meeting, August 11, 2026 (excerpt)',
    documentType: 'transcript',
    date: '2026-08-11',
    bodyId: 'demo-city-council',
    meetingId: 'demo-cc-2026-08-11',
    description: 'Sample machine transcript excerpt. Demonstrates transcripts attached to meetings.',
    categories: ['meetings'],
    tags: ['transcript', 'development agreement', 'public comment'],
    entities: [{ type: 'project', name: 'Demo Harbor Crossing' }],
    mimeType: 'text/plain',
    pages: [
      {
        section: 'Item 7a',
        text: 'DEMO TRANSCRIPT EXCERPT (machine-generated sample). [01:12:04] Presiding officer: We are on item 7a, the Demo Harbor Crossing development agreement. [01:12:30] Demo staff: The agreement requires a signalized intersection at Demo Parkway and Sample Avenue and 15 percent open space. [01:20:11] Presiding officer: Is there a motion? A motion to approve is made and seconded (sample). Transcripts are automated and may contain errors.',
      },
    ],
  },
];
