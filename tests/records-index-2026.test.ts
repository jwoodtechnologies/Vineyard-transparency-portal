/**
 * The 2026 numbered indexes built from the archive as read on October 11, 2026: the council and RDA
 * motions (tests/fixtures/motions-2026.json, from GET /api/votes) and the numbered documents
 * (tests/fixtures/records-index-2026.json, from GET /api/records/<index> and GET /api/documents/<id>).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { adoptionMap, type MotionRow } from '../worker/lib/adoptions';
import { agendaTitle, buildIndex, captionDocs, ownTitle, type IndexDoc, type IndexLink, type IndexMotion } from '../worker/lib/recordIndex';
import { isBudgetAdoption } from '../worker/lib/projectMatch';
import { BUDGET_ADOPTION_ORDINANCE } from '../worker/lib/budgetData';

const read = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));
const MOTIONS: Array<IndexMotion & MotionRow> = read('motions-2026.json').motions;
const DOCS: IndexDoc[] = read('records-index-2026.json').docs;

// Page 1 of doc_db0abf3676eb246b ("Resolution RDA 2026-01"), as the archive holds it.
const RDA_01_TEXT = `VINEYARD CITY REDEVELOPMENT AGENCY

BOARD OF DIRECTORS

RESOLUTION NO. RDA-2026-01

A RESOLUTION OF THE BOARD OF DIRECTORS OF THE VINEYARD CITY REDEVELOPMENT

AGENCY ESTABLISHING MANDATORY FISCAL IMPACT FINDINGS AND COOPERATION

CONDITIONS FOR ALL RDA FINANCIAL PARTICIPATION, TAX INCREMENT REIMBURSEMENT
CERTIFICATIONS, HTRZ COOPERATION, PUBLIC INFRASTRUCTURE REIMBURSEMENT, AND

RELATED PUBLIC FINANCE ACTIVITIES WITHIN THE VINEYARD/GENEVA STEEL

REDEVELOPMENT PROJECT AREAS; AND ESTABLISHING RELATED PROCEDURES`;

function index(kind: 'ordinance' | 'resolution' | 'rda-resolution', titles = new Map<string, string>()) {
  const body = kind === 'rda-resolution' ? 'redevelopment-agency' : 'city-council';
  const motions = MOTIONS.filter((m) => m.body_id === body);
  const links: IndexLink[] = [];
  const budget = motions.find((m) => isBudgetAdoption({ date: m.meeting_date, result: String(m.result), item: m.item, motion: m.motion ?? '' }));
  if (kind === 'ordinance' && budget) links.push({ kind, number: BUDGET_ADOPTION_ORDINANCE.slice(-7), motionId: budget.id });
  const type = kind === 'ordinance' ? 'ordinance' : 'resolution';
  return buildIndex(kind, 2026, DOCS.filter((d) => d.document_type === type), [...adoptionMap(MOTIONS).values()], [], motions, links, titles);
}
const row = (idx: ReturnType<typeof index>, n: string) => idx.rows.find((r) => r.number === n)!;

describe('2026 ordinances', () => {
  const idx = index('ordinance');

  it('lists every number from 1 to the highest, the ones not held as plain absent rows', () => {
    expect(idx.rows.map((r) => r.number)).toEqual(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
    for (const n of ['2026-02', '2026-03', '2026-04', '2026-05']) expect(row(idx, n)).toMatchObject({ state: 'absent', title: null, document: null, minutes: null });
  });

  it('titles Ordinance 2026-07 from its agenda item, not its number', () => {
    expect(row(idx, '2026-07')).toMatchObject({ title: 'Amending Municipal Code for the Planning Department', tally: '3-2', adoptedOn: '2026-08-11', minutes: { documentId: 'doc_34ef709435ea7b2b', page: 3 } });
    for (const r of idx.rows) if (r.title) expect(r.title).not.toMatch(/^(?:RDA\s+)?(?:Ordinance|Resolution)\s+\S+$/);
  });

  it('fills 2026-06 from the consent motion on its agenda item (4-0, minutes page 2)', () => {
    expect(row(idx, '2026-06')).toMatchObject({ adoptedOn: '2026-06-23', tally: '4-0', unanimous: true, vote: 'carried', minutes: { documentId: 'doc_f7aa0533b44d693c', page: 2 } });
  });

  it('fills 2026-01 from the motion brought back and carried unanimously on January 27', () => {
    expect(row(idx, '2026-01')).toMatchObject({ adoptedOn: '2026-01-27', tally: null, unanimous: true, vote: 'carried', minutes: { documentId: 'doc_cf31e9aab11422d8', page: 3 } });
  });

  it('ties Ordinance 2026-08, the final FY 2026-2027 budget, to the June 23 budget vote (3-1, minutes page 3)', () => {
    expect(BUDGET_ADOPTION_ORDINANCE).toBe('Ordinance 2026-08');
    expect(row(idx, '2026-08')).toMatchObject({ title: 'Final Budget For FY 2026-2027', adoptedOn: '2026-06-23', tally: '3-1', minutes: { documentId: 'doc_f7aa0533b44d693c', page: 3 } });
  });

  it('a held number with no motion in the archive has no vote', () => {
    expect(row(idx, '2026-11')).toMatchObject({ state: 'listed', vote: null, tally: null, minutes: null });
  });
});

describe('2026 resolutions', () => {
  const idx = index('resolution');
  const council = new Set(idx.rows.filter((r) => r.state !== 'absent').map((r) => Number(r.number.slice(5))));

  it('holds every number the 2026 council agenda titles name (1, 2, 3, 5, 6, 8 to 15, 17, 19 to 21, 23 to 29, 31, 34, 35)', () => {
    for (const n of [1, 2, 3, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 17, 19, 20, 21, 23, 24, 25, 26, 27, 28, 29, 31, 34, 35]) expect(council.has(n)).toBe(true);
    expect(row(idx, '2026-30').state).toBe('absent');
  });

  it('a draft filed as "RES 2026-07" whose text is Ordinance 2026-07 is not Resolution 2026-07', () => {
    expect(row(idx, '2026-07')).toMatchObject({ state: 'absent', document: null });
  });

  it('Resolution 2026-15 (RDA audit, adopted by the council) is in the council series', () => {
    expect(row(idx, '2026-15')).toMatchObject({ state: 'adopted', title: 'RDA Audit Contract Extension', document: { id: 'doc_bb69356e14dced85' } });
    expect(index('rda-resolution').rows.some((r) => r.document?.id === 'doc_bb69356e14dced85')).toBe(false);
  });

  it('takes the vote on the agenda item that names the number', () => {
    expect(row(idx, '2026-34')).toMatchObject({ tally: '4-0', adoptedOn: '2026-08-11', minutes: { documentId: 'doc_34ef709435ea7b2b', page: 3 } });
    expect(row(idx, '2026-35')).toMatchObject({ tally: '5-0', adoptedOn: '2026-09-15', minutes: { documentId: 'doc_5f867130115b8be0', page: 5 } });
  });

  it('titles a draft held only by number from its agenda description', () => {
    expect(row(idx, '2026-25').title).toMatch(/^Establish an Infrastructure Phasing, Public Improvement Sequencing, and City Acceptance Policy/);
  });

  it('a motion that continues or strikes an item is not its vote', () => {
    expect(row(idx, '2026-23')).toMatchObject({ vote: null, tally: null });
    expect(row(idx, '2026-10')).toMatchObject({ vote: null });
  });
});

describe('2026 RDA resolutions', () => {
  it('drops the "U-2026-0X" placeholder and fills numbers 1 to 4', () => {
    const idx = index('rda-resolution');
    expect(idx.rows.map((r) => r.number)).toEqual(['2026-01', '2026-02', '2026-03', '2026-04']);
    expect(row(idx, '2026-03')).toMatchObject({ tally: '4-0', adoptedOn: '2026-06-23' });
  });

  it('a resolution with no agenda wording takes the title it prints', () => {
    const idx = index('rda-resolution');
    expect(captionDocs(idx)).toContain('doc_db0abf3676eb246b');
    const titled = index('rda-resolution', new Map([['doc_db0abf3676eb246b', ownTitle(RDA_01_TEXT)!]]));
    expect(row(titled, '2026-01').title).toMatch(/^Establishing Mandatory Fiscal Impact Findings and Cooperation Conditions for All RDA Financial Participation/);
    expect(row(titled, '2026-01')).toMatchObject({ state: 'listed', vote: null });
  });
});

describe('titles from agenda wording and from the text', () => {
  it.each([
    ['5.4 Approve Ordinance 2026\u201307 Amending Municipal Code for the Planning Department (Anthony Fletcher)', 'Amending Municipal Code for the Planning Department'],
    ['8.2 Vineyard Skate Park Budget Allocation (Resolution 2026-13)', 'Vineyard Skate Park Budget Allocation'],
    ['<strong>Adopt Resolution 2026-25 to Establish a Policy</strong>', 'Establish a Policy'],
    ['7.2 Ordinance 2026-06, Floodplain Ordinance Update', 'Floodplain Ordinance Update'],
  ])('%s', (input, want) => {
    expect(agendaTitle(input)).toBe(want);
  });

  it('reads the title an ordinance prints, without the preamble', () => {
    expect(ownTitle('ORDINANCE NO. 2026-08\n\nAN ORDINANCE OF THE CITY COUNCIL OF THE CITY OF VINEYARD, UTAH, ADOPTING THE\n\nFINAL BUDGET FOR THE FISCAL YEAR BEGINNING JULY 1, 2026, AND ENDING JUNE 30,\n\n2027.\n\nWHEREAS')).toBe(
      'Adopting the Final Budget for the Fiscal Year Beginning July 1, 2026, and Ending June 30, 2027',
    );
    expect(ownTitle('no title here')).toBeNull();
  });

  it('no title has a long dash', () => {
    for (const k of ['ordinance', 'resolution', 'rda-resolution'] as const) for (const r of index(k).rows) expect(r.title ?? '').not.toMatch(/[\u2012-\u2015]/);
  });
});
