import { describe, expect, it } from 'vitest';
import { namesIn, parseMinutes } from '../worker/lib/votes';

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
