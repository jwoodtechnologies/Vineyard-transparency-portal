import { describe, expect, it } from 'vitest';
import { cellMark, COUNCIL_SEATS, meetingRows, meetingsWithoutMinutes, PC_SEATS, recordedTally, seatLabel, type MeetingLite, type MotionRow } from '../src/console/votes';

const motion = (over: Partial<MotionRow>): MotionRow => ({
  id: 'm1',
  date: '2026-08-11',
  bodyId: 'city-council',
  bodyName: 'City Council',
  item: null,
  motion: 'approve item 5.4 as presented',
  mover: null,
  seconder: null,
  result: 'carried',
  tally: null,
  tieBreak: false,
  unanimous: false,
  inferred: false,
  refs: [],
  documentId: 'doc_x',
  page: null,
  votes: [],
  ...over,
});

// August 11, 2026 City Council minutes (doc_34ef709435ea7b2b), item 5.4: "Roll Call Vote. Yes: Council Members McCumber
// and Nair. No: Council Members Holdaway and Lauret. Tie Vote resolved by Mayor Stratton's vote of Yes. Motion Passed 3-2."
// Present: Stratton, Holdaway, Lauret, McCumber, Nair. Absent: Wood.
const ord202607 = motion({
  tally: '3-2',
  tieBreak: true,
  refs: ['Ordinance 2026-07'],
  votes: [
    { member: 'Ezra Nair', vote: 'yes' },
    { member: 'Parker McCumber', vote: 'yes' },
    { member: 'Zack Stratton', vote: 'yes' },
    { member: 'David Lauret', vote: 'no' },
    { member: 'Jacob Holdaway', vote: 'no' },
  ],
  attendance: { present: ['Zack Stratton', 'Jacob Holdaway', 'David Lauret', 'Parker McCumber', 'Ezra Nair'], absent: ['Jacob Wood'] },
});

describe('the recorded tally', () => {
  it('reads Ordinance 2026-07 as the minutes record it, the mayor breaking the tie', () => {
    expect(recordedTally(ord202607)).toBe('3 to 2 (Mayor breaks tie)');
  });
  it('counts a former member: the tally does not drop a vote when that member has no column', () => {
    const withoutNairColumn = motion({ votes: ord202607.votes, tally: null });
    expect(recordedTally(withoutNairColumn)).toBe('3 to 2');
  });
  it('keeps the printed total when the roll call leaves a voter out', () => {
    // June 23, 2026: "4-1" printed, four names read.
    const m = motion({ tally: '4-1', votes: ['Lauret', 'Nair', 'Holdaway', 'Wood'].map((member) => ({ member, vote: 'yes' })) });
    expect(recordedTally(m)).toBe('4 to 1');
  });
  it('adds abstentions to the count', () => {
    // September 15, 2026: "Yes: Lauret, McCumber, Nair, and Wood. No: None. Abstained: Holdaway. Motion Passed 4-0."
    const m = motion({ tally: '4-0', votes: [...['Lauret', 'McCumber', 'Nair', 'Wood'].map((member) => ({ member, vote: 'yes' })), { member: 'Holdaway', vote: 'abstain' }] });
    expect(recordedTally(m)).toBe('4 to 0, 1 abstained');
  });
  it('uses the names when the printed total is lower than the names on one side', () => {
    const m = motion({ tally: '2-0', votes: ['A B', 'C D', 'E F'].map((member) => ({ member, vote: 'yes' })) });
    expect(recordedTally(m)).toBe('3 to 0');
  });
  it('says Unanimous when the minutes say so and name nobody, and nothing when they record no count', () => {
    expect(recordedTally(motion({ unanimous: true }))).toBe('Unanimous');
    expect(recordedTally(motion({}))).toBeNull();
  });
  it('never prints an en or em dash', () => {
    for (const m of [ord202607, motion({ tally: '5-0' })]) expect(recordedTally(m)).not.toMatch(/[–—]/);
  });
});

describe('marks: absent, not yet seated, no vote recorded', () => {
  const council = ['Zack Stratton', 'Jacob Holdaway', 'David Lauret', 'Parker McCumber', 'Chip Price', 'Jacob Wood'].map((n) => COUNCIL_SEATS[n.toLowerCase()] ?? { name: n });
  const marks = (m: MotionRow) => council.map((s) => cellMark(m, s, s.name === 'Zack Stratton'));
  it('marks Ordinance 2026-07 row by row: the mayor yes, Wood absent, Price blank (not yet seated)', () => {
    expect(marks(ord202607)).toEqual(['yes', 'no', 'no', 'yes', 'unseated', 'absent']);
  });
  it('leaves the mayor empty when there was no tie', () => {
    const m = motion({ votes: ['Holdaway', 'Lauret'].map((member) => ({ member, vote: 'yes' })), attendance: { present: ['Zack Stratton', 'Jacob Holdaway', 'David Lauret'], absent: [] } });
    expect(cellMark(m, { name: 'Zack Stratton' }, true)).toBe('nonvoting');
  });
  it("blanks Price's column through September 15, 2026, the day the council chose him", () => {
    expect(COUNCIL_SEATS['chip price'].from).toBe('2026-09-16');
    expect(cellMark(motion({ date: '2026-09-15' }), COUNCIL_SEATS['chip price'])).toBe('unseated');
    expect(cellMark(motion({ date: '2026-10-13', votes: [{ member: 'Price', vote: 'yes' }] }), COUNCIL_SEATS['chip price'])).toBe('yes');
  });
  it('says no vote recorded for a seated member the minutes list as present but leave out of the roll call', () => {
    const m = motion({ votes: [{ member: 'Lauret', vote: 'yes' }], attendance: { present: ['Jacob Holdaway', 'David Lauret'], absent: ['Jacob Wood'] } });
    expect(cellMark(m, { name: 'Jacob Holdaway' })).toBe('unrecorded');
  });
  it('does not read absence from a present list that misses someone the roll call names', () => {
    const m = motion({ votes: ['Lauret', 'McCumber'].map((member) => ({ member, vote: 'yes' })), attendance: { present: ['David Lauret', 'Jacob Wood'], absent: [] } });
    expect(cellMark(m, { name: 'Jacob Holdaway' })).toBe('unrecorded');
  });
  it('a vote the minutes record as absent ("was not in attendance during the vote") is absent', () => {
    expect(cellMark(motion({ votes: [{ member: 'Holdaway', vote: 'absent' }] }), { name: 'Jacob Holdaway' })).toBe('absent');
  });
});

describe('Planning Commission seats from the 2026 records', () => {
  const seat = (n: string) => PC_SEATS.find((s) => s.name.endsWith(n))!;
  // March 4, 2026 minutes (doc_87f4b9c0a818e65b p. 1) list only who was present.
  const mar4 = motion({
    date: '2026-03-04',
    bodyId: 'planning-commission',
    votes: ['David Pearce', 'Graden Ostler', 'Jordan Christensen', 'Martina Huntington'].map((member) => ({ member, vote: 'yes' })),
    attendance: { present: ['Martina Huntington', 'Jordan Christensen', 'Graden Ostler', 'David Pearce'], absent: [] },
  });
  const may6 = motion({
    date: '2026-05-06',
    bodyId: 'planning-commission',
    votes: ['Brad Fagg', 'Daria Evans', 'David Pearce', 'Graden Ostler', 'Martina Huntington', 'Nathan Steele'].map((member) => ({ member, vote: 'yes' })),
    attendance: { present: ['Nathan Steele', 'David Pearce', 'Graden Ostler', 'Martina Huntington', 'Brad Fagg', 'Daria Evans'], absent: [] },
  });
  it('has Ostler and Fagg as alternates, and no column for Rhoton or Harbin', () => {
    expect(seatLabel(seat('Ostler'))).toBe('Ostler (Alt.)');
    expect(seatLabel(seat('Fagg'))).toBe('Fagg (Alt.)');
    expect(seatLabel(seat('Evans'))).toBe('Evans');
    expect(PC_SEATS.some((s) => /rhoton|harbin/i.test(s.name))).toBe(false);
  });
  it('blanks Evans before her March 24, 2026 oath, and marks a seated commissioner missing from the present list absent', () => {
    expect(cellMark(mar4, seat('Evans'))).toBe('unseated');
    expect(cellMark(mar4, seat('Steele'))).toBe('absent');
    expect(cellMark(mar4, seat('Huntington'))).toBe('yes');
    expect(cellMark(may6, seat('Evans'))).toBe('yes');
    expect(cellMark(may6, seat('Christensen'))).toBe('absent');
  });
});

// The 2026 Planning Commission calendar as CivicClerk lists it (read October 11, 2026), as the portal's /api/meetings returns it.
const pc = (id: number, date: string, title: string, status: string): MeetingLite => ({ id: `mtg_cc_${id}`, title, date, status, governmentBodyId: 'planning-commission', governmentBodyName: 'Planning Commission' });
const calendar: MeetingLite[] = [
  pc(1518, '2026-12-02', 'Planning Commission', 'scheduled'),
  pc(1517, '2026-11-04', 'Planning Commission', 'scheduled'),
  pc(1516, '2026-10-07', 'Planning Commission Regular Meeting - 10/07/2026', 'scheduled'),
  pc(1515, '2026-09-02', 'Planning Commission Regular Meeting - 09/02/2026', 'held'),
  pc(1564, '2026-08-19', 'CANCELED Planning Commission', 'cancelled'),
  pc(1514, '2026-08-05', 'August 05, 2026 Planning Commission', 'held'),
  pc(1563, '2026-07-15', 'Planning Commission Regular Meeting - 07/15/2026', 'held'),
  pc(1636, '2026-06-17', 'CANCELED Planning Commission - June 17, 2026', 'cancelled'),
  pc(1562, '2026-06-17', 'Planning Commission', 'held'),
  pc(1512, '2026-06-03', 'CANCELED Planning Commission', 'cancelled'),
  pc(1561, '2026-05-20', 'CANCELED Planning Commission', 'cancelled'),
  pc(1599, '2026-05-06', 'Public Notice of Public Hearing and Public Comment Period for the Floodplain Ordinance', 'held'),
  pc(1511, '2026-05-06', 'Planning Commission Meeting', 'held'),
  pc(1493, '2026-04-15', 'CANCELED Planning Commission Meeting', 'cancelled'),
  pc(1492, '2026-04-01', 'Planning Commission Meeting Cancelation', 'cancelled'),
  pc(1477, '2026-03-18', 'Planning Commission Meeting', 'held'),
  pc(1474, '2026-03-04', 'Planning Commission Meeting', 'held'),
  pc(1461, '2026-02-18', 'Planning Commission Meeting Cancelation', 'cancelled'),
  pc(1460, '2026-02-04', 'Planning Commission Meeting Cancelation', 'cancelled'),
  pc(1298, '2026-01-21', 'Planning Commission Meeting Cancelation', 'cancelled'),
  pc(1286, '2026-01-07', 'Planning Commission Meeting', 'held'),
];
const read = [
  { date: '2026-03-04', bodyId: 'planning-commission' },
  { date: '2026-05-06', bodyId: 'planning-commission' },
];

describe('the Planning Commission meeting list', () => {
  const rows = meetingRows(calendar, read, '2026-10-11', { voted: new Set(['planning-commission|2026-03-04', 'planning-commission|2026-05-06']) });
  const by = (status: string) => rows.filter((r) => r.status === status).map((r) => r.m.date);
  it('lists every meeting held without minutes, the October 7 meeting the calendar still calls scheduled included', () => {
    expect(by('pending')).toEqual(['2026-10-07', '2026-09-02', '2026-08-05', '2026-07-15', '2026-03-18', '2026-01-07']);
    expect(rows.filter((r) => r.status === 'pending').every((r) => r.title === 'Minutes not yet posted')).toBe(true);
  });
  it('lists the canceled meetings, June 17 once', () => {
    expect(by('canceled')).toEqual(['2026-08-19', '2026-06-17', '2026-06-03', '2026-05-20', '2026-04-15', '2026-04-01', '2026-02-18', '2026-02-04', '2026-01-21']);
    expect(rows.find((r) => r.m.date === '2026-06-17')?.m.meetingId).toBe('mtg_cc_1636');
    expect(rows.filter((r) => r.status === 'canceled').every((r) => r.title === 'Meeting canceled')).toBe(true);
  });
  it('gives meetings with minutes no extra row, and lists no future meeting', () => {
    expect(rows.some((r) => ['2026-03-04', '2026-05-06', '2026-11-04', '2026-12-02'].includes(r.m.date ?? ''))).toBe(false);
  });
  it('names the later packet that prints draft minutes', () => {
    const drafts = { 'planning-commission|2026-07-15': { documentId: 'doc_b154bcf34dcf40be', title: 'Planning Commission Agenda Packet - August 5, 2026', date: '2026-08-05', page: 4 } };
    const r = meetingRows(calendar, read, '2026-10-11', { drafts }).find((x) => x.m.date === '2026-07-15')!;
    expect(r.title).toBe('Draft minutes in Aug 5 packet');
    expect(r.m.documentId).toBe('doc_b154bcf34dcf40be');
    expect(r.m.page).toBe(4);
  });
  it('gives a meeting whose minutes record no vote a row of its own', () => {
    const r = meetingRows(calendar, read, '2026-10-11', { voted: new Set(['planning-commission|2026-05-06']) });
    expect(r.find((x) => x.m.date === '2026-03-04')?.title).toBe('No votes recorded');
  });
  it('looks for draft minutes only for meetings held without minutes', () => {
    expect(meetingsWithoutMinutes(calendar, read, '2026-10-11').map((x) => x.date)).toEqual(['2026-10-07', '2026-09-02', '2026-08-05', '2026-07-15', '2026-03-18', '2026-01-07']);
  });
  it('never uses an en or em dash in a row title', () => {
    expect(rows.every((r) => !/[–—]/.test(r.title))).toBe(true);
  });
});
