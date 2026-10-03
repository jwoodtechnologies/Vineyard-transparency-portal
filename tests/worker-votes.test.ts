import { describe, expect, it } from 'vitest';
import { consentItems, headingAt, namesIn, parseMinutes } from '../worker/lib/votes';

const v = (m: { votes: Array<{ member: string; vote: string }> }) => Object.fromEntries(m.votes.map((x) => [x.member, x.vote]));

describe('names in a vote list', () => {
  it('strips titles and joins', () => {
    expect(namesIn('Council Members Holdaway, Lauret, McCumber, and Nair')).toEqual(['Holdaway', 'Lauret', 'McCumber', 'Nair']);
    expect(namesIn('MAYOR FULLMER, COUNCILMEMBERS FLAKE, RASMUSSEN, SIFUENTES, AND WELSH')).toEqual(['Fullmer', 'Flake', 'Rasmussen', 'Sifuentes', 'Welsh']);
    expect(namesIn('None')).toEqual([]);
  });
});

describe('2026 minutes', () => {
  const text = `NOTICE OF A REGULAR
CITY COUNCIL MEETING
August 11, 2026, at 4:00 PM
Present
Mayor Zack Stratton
Councilmember Jacob Holdaway
Councilmember David Lauret
Councilmember Parker McCumber
Councilmember Ravi Nair
Absent
Councilmember Jacob Wood
Staff Present: City Manager Brian Voeks
5. CONSENT ITEMS
MOTION: Council Member Lauret motioned to approve the Consent Items 5.1, 5.2, and 5.3 as presented. Council Member Nair seconded the motion. Vote Yes: Council Members Holdaway, Lauret, McCumber, and Nair No: None. Motion carried 4-0.
5.4. Approve Ordinance 2026-07 Amending Municipal Code for the Planning
112
Motion: Council Member Nair moved approve item 5.4 as presented. (Ordinance 2026-07)
Council Member McCumber seconded the motion. Roll Call Vote. Yes: Council Members
McCumber and Nair. No: Council Members Holdaway and Lauret. Tie Vote resolved by Mayor
Stratton’s vote of Yes. Motion Passed 3-2.
MOTION: Council Member McCumber motioned to go into a closed session to discuss pending litigation. Council Member Lauret seconded the motion. Roll Call Vote Yes: Nair, McCumber, and Lauret. No: None. Recused: Holdaway. Motion carried 3-0.`;
  const p = parseMinutes(text, '2026-08-11');
  it('reads attendance, date and body', () => {
    expect(p.present).toEqual(['Stratton', 'Holdaway', 'Lauret', 'McCumber', 'Nair']);
    expect(p.absent).toEqual(['Wood']);
    expect(p.date).toBe('2026-08-11');
    expect(p.body).toBe('city-council');
    expect(p.fullNames.Holdaway).toBe('Jacob Holdaway');
  });
  it('reads each motion exactly', () => {
    expect(p.motions).toHaveLength(3);
    const [a, b, c] = p.motions;
    expect(a).toMatchObject({ mover: 'Lauret', seconder: 'Nair', result: 'carried', tally: '4-0', item: 'Consent items', inferred: false });
    expect(v(a)).toEqual({ Holdaway: 'yes', Lauret: 'yes', McCumber: 'yes', Nair: 'yes' });
    expect(b).toMatchObject({ mover: 'Nair', seconder: 'McCumber', result: 'carried', tally: '3-2', tieBreak: true, refs: ['Ordinance 2026-07'] });
    expect(b.text).toBe('approve item 5.4 as presented. (Ordinance 2026-07)');
    expect(b.item).toMatch(/^5\.4 Approve Ordinance 2026-07/);
    expect(v(b)).toEqual({ McCumber: 'yes', Nair: 'yes', Holdaway: 'no', Lauret: 'no', Stratton: 'yes' });
    expect(v(c)).toEqual({ Nair: 'yes', McCumber: 'yes', Lauret: 'yes', Holdaway: 'recused' });
  });
});

describe('roll call minutes (2016 to 2025)', () => {
  const text = `CITY COUNCIL MEETING MINUTES
December 13, 2023
Present: Mayor Julie Fullmer, Councilmember Tyce Flake, Councilmember Amber Rassmussen, Councilmember Mardi Sifuentes, Councilmember Cristy Welsh
Staff Present: Recorder
Mayor Fullmer called for a motion. Motion: COUNCILMEMBER RASMUSSEN MOVED TO APPROVE THE CONSENT ITEMS AS PRESENTED. COUNCILMEMBER WELSH SECONDED THE MOTION. ROLL CALL WENT AS FOLLOWS: MAYOR FULLMER, COUNCILMEMBERS FLAKE, RASMUSSEN, AND WELSH VOTED YES. COUNCILMEMBER SIFUENTES VOTED NO. THE MOTION CARRIED.`;
  const p = parseMinutes(text, '2023-12-13');
  it('reads yes and no from the roll call and fixes a misspelled name', () => {
    expect(p.motions).toHaveLength(1);
    expect(p.motions[0]).toMatchObject({ mover: 'Rasmussen', seconder: 'Welsh', result: 'carried', unanimous: false });
    expect(v(p.motions[0])).toEqual({ Fullmer: 'yes', Flake: 'yes', Rasmussen: 'yes', Welsh: 'yes', Sifuentes: 'no' });
    expect(p.present).toContain('Rasmussen');
    expect(p.motions[0].text).toBe('Approve the consent items as presented');
  });
});

describe('all in favor (older minutes)', () => {
  const text = `MINUTES OF THE VINEYARD TOWN COUNCIL MEETING
November 9, 2016 at 6:01 PM
Present Absent Mayor Randy Farnworth Councilmember Tyce Flake Councilmember Julie Fullmer Councilmember Nate Riley
Staff Present: Town Clerk
Mayor Farnworth called for a motion. Motion: COUNCILMEMBER FLAKE MOVED TO APPROVE THE CONSENT ITEM. COUNCILMEMBER RILEY SECONDED THE MOTION. ALL WERE IN FAVOR. MOTION CARRIED UNANIMOUSLY.`;
  it('marks the yes votes as taken from attendance', () => {
    const p = parseMinutes(text, '2016-11-09');
    expect(p.motions[0]).toMatchObject({ mover: 'Flake', seconder: 'Riley', result: 'carried', unanimous: true, inferred: true });
    expect(v(p.motions[0])).toEqual({ Farnworth: 'yes', Flake: 'yes', Fullmer: 'yes', Riley: 'yes' });
  });
});

describe('RDA minutes', () => {
  const text = `REDEVELOPMENT AGENCY BOARD MEETING
September 8, 2026
2.1. Approval of August 25, 2026, RDA Meeting Minutes
MOTION: Board Member McCumber motion to approve the minutes as presented. Board Member Lauret seconded the motion. Yes: Board Members Holdaway, Lauret, McCumber, and Wood. No: None. Motion carried 4-0.`;
  it('reads "motion to" and board members', () => {
    const p = parseMinutes(text, '2026-09-08');
    expect(p.body).toBe('redevelopment-agency');
    expect(p.motions[0]).toMatchObject({ mover: 'McCumber', seconder: 'Lauret', tally: '4-0', text: 'approve the minutes as presented' });
    expect(v(p.motions[0])).toEqual({ Holdaway: 'yes', Lauret: 'yes', McCumber: 'yes', Wood: 'yes' });
  });
});

describe('agenda item labels', () => {
  it('keeps the heading when it runs into a sentence', () => {
    const p = parseMinutes(`REDEVELOPMENT AGENCY
September 8, 2026
3.  CLOSED SESSION The Chair and Board, pursuant to Utah Code 52-4-205, may vote to go into a closed session.
MOTION: Board Member McCumber motion to go into a closed session. Board Member Lauret seconded the motion. Yes: Board Members Holdaway, Lauret, McCumber, and Wood. No: None. Motion carried 4-0.`, '2026-09-08');
    expect(p.motions[0].item).toBe('3 CLOSED SESSION');
  });
});

describe('Planning Commission attendance', () => {
  it('reads a list of names with no titles', () => {
    const p = parseMinutes(`PLANNING COMMISSION MINUTES
May 6, 2026
Present: Daria Evans, Brad Fagg, Martina Huntington, Graden Ostler, David Pearce, and Nathan Steele. Staff Present: Planner Anthony Fletcher.
NOMINATION: Commissioner David Pearce nominated Commissioner Nathan Steele. Commissioner Brad Fagg seconded the motion. Yes: Commissioners Evans, Fagg, Huntington, Ostler, Pearce, and Steele. No: None. Motion carried 6-0.`, '2026-05-06');
    expect(p.present).toEqual(['Evans', 'Fagg', 'Huntington', 'Ostler', 'Pearce', 'Steele']);
    expect(p.fullNames.Evans).toBe('Daria Evans');
    expect(p.body).toBe('planning-commission');
  });
  it('reads COMMISSIONERS PRESENT', () => {
    const p = parseMinutes(`ATTENDANCE: COMMISSIONERS PRESENT: David Pearce, Graden Ostler, Jordan Christensen, and Martina Huntington STAFF PRESENT: Cache Hancey, Senior Planner`, '2026-03-04');
    expect(p.present).toEqual(['Pearce', 'Ostler', 'Christensen', 'Huntington']);
    expect(p.fullNames.Christensen).toBe('Jordan Christensen');
  });
});

describe('board roster from minutes', () => {
  it('reads chair, vice chair, alternate and members', async () => {
    const { rosterFrom } = await import('../worker/lib/votes');
    const r = rosterFrom('NOTICE OF A REGULAR ARCH COMMISSION MEETING February 19, 2026, at 6:00 PM Present Absent Chair Jarom Sidwell Vice-Chair Elisabeth Shelley Commissioner Daniel George Commissioner Alternate Brooke Meyer Commissioner Sherrie-Kaye Miller Commissioner Bronson Tatton Staff Present Parks and Recreation Director Brian Vawdrey');
    expect(r).toEqual([
      { name: 'Jarom Sidwell', role: 'Chair' },
      { name: 'Elisabeth Shelley', role: 'Vice Chair' },
      { name: 'Daniel George', role: 'Member' },
      { name: 'Brooke Meyer', role: 'Alternate' },
      { name: 'Sherrie-Kaye Miller', role: 'Member' },
      { name: 'Bronson Tatton', role: 'Member' },
    ]);
  });
});

describe('consent items', () => {
  it('lists the items a consent motion approved', async () => {
    const { consentItems } = await import('../worker/lib/votes');
    const before = `4. PUBLIC COMMENT\nNone.\n5. CONSENT ITEMS\n5.1 Approval of the July 14, 2026 City Council Minutes\n5.2 Resolution 2026-30 Interlocal Agreement for Dispatch Services (Brian Voeks)\n5.3 Appoint Steffani Winder to the Library Board\n`;
    expect(consentItems(before, 'approve the Consent Items 5.1, 5.2, and 5.3 as presented')).toEqual(['5.1 Approval of the July 14, 2026 City Council Minutes', '5.2 Resolution 2026-30 Interlocal Agreement for Dispatch Services', '5.3 Appoint Steffani Winder to the Library Board']);
    expect(consentItems(before, 'approve the consent items as presented with the removal of item 5.2')).toEqual(['5.1 Approval of the July 14, 2026 City Council Minutes', '5.3 Appoint Steffani Winder to the Library Board']);
  });
});

describe('public sign-in list', () => {
  const minutes = `NOTICE OF A REDEVELOPMENT\n\nAGENCY BOARD MEETING\n\nMay 12, 2026, at 6:00 PM\n\nAGENDA\n\nMayor Zack Stratton\n\nRDA Board Member Jacob Holdaway\n\nRDA Board Member David Lauret\n\nRDA Board Member Parker McCumber\n\nRDA Board Member Ezra Nair\n\nRDA Board Member Jacob Wood\n\nStaff Present: Administrative Director David Herring; City Recorder Robin Bond; RDA Director Josh Daniels.\n\nAlso Attending: Daria Evans, Karen Cornelius, Emmeline McCumber, Trinity Ewing, and\nothers who did not sign in.\n\n1. CALL TO ORDER\n\nMotion: Board Member Lauret motioned to continue Resolution 2026-03 for two weeks. Second: Board Member Holdaway. Yes: Board\n\nMembers, Holdaway, Lauret, McCumber, Nair, and Wood. Motion Passed 5-0.\n`;

  it('does not count staff or visitors as present', () => {
    const r = parseMinutes(minutes, '2026-05-12');
    expect(r.present).toEqual([]);
  });

  it('keeps the titled member when a visitor shares the last name', () => {
    const r = parseMinutes(minutes, '2026-05-12');
    expect(r.fullNames.McCumber).toBe('Parker McCumber');
    expect(r.motions[0].votes.map((v) => v.member).sort()).toEqual(['Holdaway', 'Lauret', 'McCumber', 'Nair', 'Wood']);
    expect(r.motions[0].tally).toBe('5-0');
  });
});

describe('agenda headings that wrap onto the next line', () => {
  it('joins the rest of a long heading and leaves short ones alone', () => {
    const lines = [
      '5.4. Approve Ordinance 2026-07 Amending Municipal Code for the Planning',
      '',
      'Department (Anthony Fletcher)',
      '',
      'Items 5.4 and 5.5 were removed from the Consent Items and discussed by Council.',
    ];
    expect(headingAt(lines, 0)).toBe('5.4. Approve Ordinance 2026-07 Amending Municipal Code for the Planning Department (Anthony Fletcher)');
    expect(headingAt(['8.3. Adopt Resolution 2026-29 City Manager', 'Responsibilities and Duties (Mayor Stratton)'], 0)).toBe('8.3. Adopt Resolution 2026-29 City Manager Responsibilities and Duties (Mayor Stratton)');
    expect(headingAt(['3.2. Travel Policy Review', 'Administrative Director David Kyle presented the proposed travel policy to the council.'], 0)).toBe('3.2. Travel Policy Review');
    expect(headingAt(['3.3. Municipal Waste Water Planning Program (MWPP) Survey Review', 'Councilmember Holdaway was excused at 12:58pm.'], 0)).toBe('3.3. Municipal Waste Water Planning Program (MWPP) Survey Review');
    expect(headingAt(['8.1. Approve Ordinance 2026-09, Stormwater Management Code Update (Naseem', 'Ghandour)'], 0)).toBe('8.1. Approve Ordinance 2026-09, Stormwater Management Code Update (Naseem Ghandour)');
    expect(headingAt(['4.1. Amend the Consolidated Fee Schedule for the Transportation Utility Fee and', 'Vineyard Days. Allow the Mayor the power to lower Fees.'], 0)).toBe('4.1. Amend the Consolidated Fee Schedule for the Transportation Utility Fee and Vineyard Days');
    expect(headingAt(['8.1. Approval of the February 12th 2026, City Council Special Session Meeting', 'Minutes', '8.2. Next item'], 0)).toBe('8.1. Approval of the February 12th 2026, City Council Special Session Meeting Minutes');
  });
  it('names the item in full for a motion that follows it', () => {
    const text = `NOTICE OF A REGULAR
CITY COUNCIL MEETING
August 11, 2026, at 4:00 PM
Present
Mayor Zack Stratton
Councilmember Jacob Holdaway
Councilmember David Lauret
Councilmember Parker McCumber
Staff Present: City Manager Brian Voeks
5.4. Approve Ordinance 2026-07 Amending Municipal Code for the Planning

Department (Anthony Fletcher)

Council Member Lauret asked for clarification.
Motion: Council Member Lauret moved to approve item 5.4 as presented. Council Member McCumber seconded the motion. Roll Call Vote. Yes: Council Members Holdaway, Lauret, and McCumber. No: None. Motion Passed 3-0.`;
    const p = parseMinutes(text, '2026-08-11');
    expect(p.motions).toHaveLength(1);
    expect(p.motions[0].item).toBe('5.4 Approve Ordinance 2026-07 Amending Municipal Code for the Planning Department (Anthony Fletcher)');
  });
});

describe('items named by the resolution a motion adopts', () => {
  const text = `NOTICE OF A REGULAR
CITY COUNCIL MEETING
January 20, 2026, at 6:00 PM
Present
Mayor Zack Stratton
Councilmember Jacob Holdaway
Councilmember David Lauret
Staff Present: City Manager Brian Voeks
2.1. City Council Listening Session for Vineyard Interfaith and Non-Profit Organizations
5.1. Approve Resolution 2026-03 Supporting Interfaith Partnerships (Jane Doe)
Motion: Council Member Lauret moved to Adopt Resolution 202603 with the proposed amendments. Council Member Holdaway seconded the motion. Roll Call Vote. Yes: Council Members Holdaway and Lauret. No: None. Motion Passed 2-0.`;
  it('finds the heading that carries the resolution number', () => {
    const p = parseMinutes(text, '2026-01-20');
    expect(p.motions[0].item).toBe('5.1 Approve Resolution 2026-03 Supporting Interfaith Partnerships (Jane Doe)');
  });
});

describe('consent lists', () => {
  it('reads the numbered list under the consent heading, not a later sentence about it', () => {
    const before = `5. CONSENT ITEMS
5.1. Approval of the July 7, 2026, City Council Meeting Minutes
5.2. Approve Resolution 2026-30 Updating the Records Retention Schedule (Jane Doe)
Items 5.4 and 5.5 were removed from the Consent Items and discussed by Council.
`;
    expect(consentItems(before, 'approve the Consent Items 5.1 and 5.2 as presented')).toEqual([
      '5.1 Approval of the July 7, 2026, City Council Meeting Minutes',
      '5.2 Approve Resolution 2026-30 Updating the Records Retention Schedule',
    ]);
  });
});

describe('sub-item numbers set on their own line', () => {
  const vote = (n: string) => `Motion: COUNCILMEMBER NAIR MOVED TO ADOPT ${n}. COUNCILMEMBER LAURET SECONDED. COUNCILMEMBERS NAIR AND LAURET VOTED IN FAVOR. THE MOTION PASSED UNANIMOUSLY.`;

  it('names the item from the line below the number', () => {
    const minutes = `Present: Councilmember Nair, Councilmember Lauret\n10. BUSINESS ITEMS\n\n10.1.\n\nAmending The Travel Policy\n\n${vote('RESOLUTION 2026-18')}\n\n10.2.\n\nARCH Commission RAP Tax Grant Awards (Resolution 2026-06)\n\nThe council discussed the amended suggestions.\n${vote('RESOLUTION 2026-06 WITH ADJUSTMENTS')}`;
    const motions = parseMinutes(minutes, '2026-03-24').motions;
    expect(motions[0]?.item).toBe('10.1 Amending The Travel Policy');
    expect(motions[1]?.item).toMatch(/^10\.2 ARCH Commission RAP Tax Grant Awards/);
  });

  it('takes the title above the number when a description follows it', () => {
    const minutes = `Present: Councilmember Nair, Councilmember Lauret\n10. BUSINESS ITEMS\n\nApprove ARCH Grant Extension Request (Brian Vawdrey)\n\n10.1.\n\nThe Council considered a request related to arts grants approved in the prior\nfiscal year. Mr. Vawdrey explained that certain projects requested deadline extensions.\n${vote('THE ARTS GRANT EXTENSION')}`;
    expect(parseMinutes(minutes, '2026-06-09').motions[0]?.item).toBe('10.1 Approve ARCH Grant Extension Request (Brian Vawdrey)');
  });

  it('joins a title that runs through the number', () => {
    const minutes = `Present: Councilmember Nair, Councilmember Lauret\n10. BUSINESS ITEMS\n\nApprove Holdaway Fields Development Agreement Amendment (Anthony\n\n10.2. Fletcher and David Herring)\n\nThe Council considered a proposed amendment.\n${vote('THE AMENDMENT')}`;
    expect(parseMinutes(minutes, '2026-06-09').motions[0]?.item).toBe('10.2 Approve Holdaway Fields Development Agreement Amendment (Anthony Fletcher and David Herring)');
  });
});
