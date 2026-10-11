/**
 * Cases from the October 2026 accuracy audit (docs/audits/2026-10-accuracy.md). Each one is a value the
 * portal showed that did not match the source document text; the text below is copied from that document.
 */
import { describe, expect, it } from 'vitest';
import { motionPages, parseMinutes } from '../worker/lib/votes';
import { eventAddress } from '../worker/lib/civicclerk';
import { GENERAL, PROJECTS, REVENUE, REVENUE_GROUPS } from '../worker/lib/budgetData';

const HEAD = `CITY COUNCIL MEETING MINUTES
April 14, 2026
Present
Mayor Zack Stratton
Council Member Jacob Holdaway
Council Member David Lauret
Council Member Parker McCumber
Council Member Ezra Nair
Council Member Jacob Wood
`;

describe('seconders written with a colon', () => {
  // April 14, 2026 City Council minutes (doc_750d956cc3d5a4a2), pages 3 and 6.
  const text = `${HEAD}
Motion: Council Member Nair motioned to continue items 5.1, 5.3, 5.4, 5.5, 5.6, 5.7, and 6.1to a work meeting. Second: Council Member Wood. Yes: Council Members, Holdaway, Lauret, McCumber, Nair, and Wood. No: None. Motion passed 5-0.
Mayor Stratton called for a Mayor Pro Tem. He had another commitment to attend.
Motion: Council Member Nair motioned, in honor of Council Member McCumber’s new son, that Council Member Parker McCumber should be Mayor Pro Tem. Second: Council Member Wood. Yes: Council Members, Holdaway, Lauret, McCumber, Nair, and Wood. No: None. Motion passed 5-0.
5.2. Adopt Resolution 2026-23 to Establish a Complete Land Use Application and Applicant Vesting Control Policy.
Motion: Council Member Wood motioned to move Agenda item 5.2 to the next meeting. Seconded: David Lauret No: None Yes: Council Members Holdaway, Lauret, McCumber, Nair, and Wood. Motion Passed 5-0
`;
  const r = parseMinutes(text, '2026-04-14');

  it('reads "Second: Council Member Wood" and "Seconded: David Lauret"', () => {
    expect(r.motions.map((m) => [m.mover, m.seconder, m.tally])).toEqual([
      ['Nair', 'Wood', '5-0'],
      ['Nair', 'Wood', '5-0'],
      ['Wood', 'Lauret', '5-0'],
    ]);
  });

  it('keeps the wording of a motion with a comma after the verb', () => {
    expect(r.motions[1].text).toMatch(/^in honor of Council Member McCumber's new son, that Council Member Parker McCumber should be Mayor Pro Tem$/);
    expect(r.motions[0].text).not.toMatch(/second/i);
  });
});

describe('movers a scan or a typo hides', () => {
  it('reads "Board Member Lauret.motioned" (June 9, 2026 RDA minutes, doc_aa7cce8288e53fef, page 3)', () => {
    const text = `REDEVELOPMENT AGENCY BOARD MEETING MINUTES
Present Board Member Jacob Holdaway Board Member David Lauret Board Member Parker McCumber Board Member Ezra Nair Board Member Jacob Wood
4.3. Approve the appointment of Jared Tamez to serve as an RDA Advisor.
Motion: Board Member Lauret.motioned toapprove the hiring of Jared Tamez as an RDA adyisor. Board Member Wood seconded the motion. Yes: Board Members Holdaway, Lauret, McCumiber, and Wood. No: Board Member Nair. Motion Passed 4-1.
`;
    const m = parseMinutes(text, '2026-06-09').motions[0];
    expect([m.mover, m.seconder, m.tally]).toEqual(['Lauret', 'Wood', '4-1']);
  });

  it('reads "COMISSIONER" and "COMMISSIONERR" (March 4, 2026 Planning Commission minutes, doc_87f4b9c0a818e65b, pages 1 and 2)', () => {
    const text = `PLANNING COMMISSION MEETING MINUTES
Motion: COMISSIONER JORDAN CHRISTENSEN MOTIONED TO ELECT COMMISSIONER DAVID PEARCE AS CHAIR TEMPORE FOT THIS MEETING AT 6:00PM. COMMISSIONER GRADEN OSTLER SECONDED. ALL IN FAVOR SAID YES: HUNTINGTON, PEARCE, CHRISTENSEN, AND OSTLER. THE MOTION CARRIED UNANIMOUSLY.
Motion: COMMISSIONERR CHRISTENSEN MOTIONED TO MOVE ITEMS 5.3. AND 5.4. TO THE MARCH 18TH PLANNING COMMISSION MEETING AT 6:11PM. COMMISSIONER HUNTINGTON SECONDED. ALL IN FAVOR VOTED YES: HUNTINGTON, PEARCE, CHRISTENSEN, AND OSTLER. THE VOTE CARRIED UNANIMOUSLY.
`;
    const ms = parseMinutes(text, '2026-03-04').motions;
    expect(ms.map((m) => [m.mover, m.seconder])).toEqual([
      ['Christensen', 'Ostler'],
      ['Christensen', 'Huntington'],
    ]);
  });

  it('names the member whose motion was brought back (January 27, 2026 minutes, doc_cf31e9aab11422d8, page 3)', () => {
    const text = `${HEAD}
Motion: MAYOR PRO TEMPORE LAURET BROUGHT BACK THE ORIGINAL MOTION PRESENTED BY COUNCILMEMBER MCCUMBER. COUNCILMEMBER HOLDAWAY SECONDED. THE ROLL CALL WAS AS FOLLOWS: MAYOR PRO TEMPORE LAURET AND COUNCILMEMBERS NAIR, WOOD, HOLDAWAY AND MCCUMBER VOTED IN FAVOR. THE MOTION PASSED UNANIMOUSLY.
`;
    const m = parseMinutes(text, '2026-01-27').motions[0];
    expect([m.mover, m.seconder, m.result]).toEqual(['McCumber', 'Holdaway', 'carried']);
    expect(m.text.length).toBeGreaterThan(10);
  });
});

describe('the page of a motion', () => {
  it('is the page where the motion starts, not the page whose item heading repeats its wording', () => {
    // September 15, 2026 City Council minutes (doc_5f867130115b8be0): the 7.1 heading ends page 3, the motion is on page 4.
    const chunks = [
      { pageStart: 3, text: '7.1. Approve the First Amendment to the Holdaway Fields Development Agreement with Cadence Homes and Goodboro Homes (Developers)\n111 112 Councilmember Wood reviewed the proposed amendment' },
      { pageStart: 4, text: '125 126 Motion: Council Member Wood motioned to approve the First Amendment to the Holdaway agreement with the discussed changes. Council Member Lauret seconded the motion.' },
    ];
    const text = chunks.map((c) => c.text).join('\n\n');
    const motions = parseMinutes(text, '2026-09-15').motions;
    expect(motionPages(chunks, motions)).toEqual([4]);
  });

  it('is found for a motion whose wording the reader could not take apart', () => {
    const chunks = [
      { pageStart: 3, text: 'Motion: MAYOR PRO TEMPORE LAURET BROUGHT BACK THE ORIGINAL' },
      { pageStart: 4, text: 'MOTION PRESENTED BY COUNCILMEMBER MCCUMBER. COUNCILMEMBER HOLDAWAY SECONDED.' },
    ];
    expect(motionPages(chunks, [{ lead: 'Motion: MAYOR PRO TEMPORE LAURET BROUGHT BACK THE ORIGINAL MOTION PRESENTED BY', text: '' }])).toEqual([3]);
  });

  it('puts two motions with the same wording on their own pages', () => {
    const chunks = [
      { pageStart: 1, text: 'Motion: Council Member Lauret motioned to approve the consent items as presented. Yes: all.' },
      { pageStart: 2, text: 'Motion: Council Member Lauret motioned to approve the consent items as presented. Yes: all.' },
    ];
    const lead = 'Motion: Council Member Lauret motioned to approve the consent items as presented.';
    expect(motionPages(chunks, [{ lead, text: 'approve the consent items' }, { lead, text: 'approve the consent items' }])).toEqual([1, 2]);
  });
});

describe('meeting places from CivicClerk', () => {
  it('keeps the second address line (events 1706, 1710 and 1660)', () => {
    expect(eventAddress({ address1: 'City Council Chambers', address2: '125 South Main Street', city: 'Vineyard', state: 'UT' })).toBe('City Council Chambers, 125 South Main Street, Vineyard, UT');
    expect(eventAddress({ address1: '707 E Mill Road, ', address2: 'HBA Building Suite 202,', city: 'Vineyard', state: 'UT' })).toBe('707 E Mill Road, HBA Building Suite 202, Vineyard, UT');
    expect(eventAddress({ address1: 'City Council Conference Room, ', address2: ' 56 N State Street', city: 'Orem', state: 'UT' })).toBe('City Council Conference Room, 56 N State Street, Orem, UT');
    expect(eventAddress({ address1: 'City Council Chambers, 125 South Main Street', address2: null, city: null, state: null })).toBe('City Council Chambers, 125 South Main Street');
    expect(eventAddress({})).toBeNull();
  });
});

describe('FY2027 General Fund revenue lines', () => {
  const amount = (n: string) => REVENUE.find((r) => r.name === n)?.amount;

  it('has interest earnings 815,000 and fines 500 (budget book page 4; slides page 2)', () => {
    expect(amount('Interest')).toBe(815_000);
    expect(amount('Fines')).toBe(500);
  });

  it('adds up to total revenue before transfers, and every line is in one group', () => {
    expect(REVENUE.reduce((s, r) => s + r.amount, 0)).toBe(GENERAL.revenueBeforeTransfers);
    const grouped = REVENUE_GROUPS.flatMap((g) => g.lines);
    for (const r of REVENUE) expect(grouped.filter((n) => n === r.name)).toHaveLength(1);
  });

  it('prints the department the slide prints for the hydrant aprons (slides page 5)', () => {
    expect(PROJECTS.find((p) => p.name === 'Concrete aprons around hydrants')?.dept).toBe('Public Works');
  });
});
