import { describe, expect, it } from 'vitest';
import { pastMember } from '../worker/api/votes';
import { decidingMotion, measureRefIn } from '../worker/ai/measureVotes';
import { bodyClarify, latestMinutesDate, minutesOf, monthClarify, personClarify } from '../worker/ai/lookups';
import { postedReplacesRepeat } from '../worker/ai/schedule';
import { taxRateSentences } from '../worker/ai/taxRateAnswer';

// Pure parts of the fixes for chat suite run 38155123085 (October 11, 2026). Every title, date and figure is
// as the live API listed it that day (Diagnostics runs 38119479182, 38138542665, 38152760553 and 38155469308).

describe('a former member named by last name only', () => {
  const past = ['Ezra Nair', 'David Lauret', 'Nair'];
  it('is the one former member with that last name', () => {
    expect(pastMember('Nair', past)).toBe('Ezra Nair');
    expect(pastMember('Ezra Nair', past)).toBe('Ezra Nair');
    expect(pastMember('Il', past)).toBeNull();
    expect(pastMember('Fullmer', ['Fullmer'])).toBe('Fullmer');
    expect(pastMember('Smith', ['Ann Smith', 'Bob Smith'])).toBeNull();
  });
});

describe('the motion that decided a measure', () => {
  const ref = measureRefIn('Ordinance 2026-09')!;
  // June 23, 2026 minutes (doc_f7aa0533b44d693c): the consent motion was stored with Ordinance 2026-09 among its references.
  const consent = { item: '7.2 Ordinance 2026-06, Floodplain Ordinance Update', motion: 'approve the consentitems as presented', refs: ['Ordinance 2026-09'], result: 'carried', votes: [{ member: 'Jacob Wood', vote: 'yes' }], seconder: 'Jacob Wood' };
  const own = { item: '8.1 Approve Ordinance 2026-09, Stormwater Management Code Update', motion: 'approve Ordinance 2026-09, Stormwater Management Code Update as presented', refs: ['Ordinance 2026-09'], result: 'carried', votes: [{ member: 'David Lauret', vote: 'yes' }], seconder: 'David Lauret' };
  it('is the motion that names it, before one that only lists it', () => {
    expect(decidingMotion([consent, own], ref)?.seconder).toBe('David Lauret');
    expect(decidingMotion([consent], ref)?.seconder).toBe('Jacob Wood');
    expect(decidingMotion([], ref)).toBeNull();
  });
});

describe('the minutes of a meeting', () => {
  it('are the ones titled with its date, wherever they are filed', () => {
    const sep8 = [
      { id: 'doc_7a0b2b44683f4559', title: '8.25.26 CC Minutes - Draft (City Council, 2026-09-08, item 1)', inMeeting: true },
      { id: 'doc_87aac14fa329d527', title: '9.8.26 APPROVED CC Minutes', inMeeting: true },
    ];
    expect(minutesOf('2026-09-08', sep8)?.id).toBe('doc_87aac14fa329d527');
    expect(minutesOf('2026-09-08', sep8.slice(0, 1))).toBeNull();
    const aug11 = [
      { id: 'doc_bc79640f38810ade', title: '7.14.26 CC Minutes - Draft (City Council, 2026-08-11, item 2)', inMeeting: true },
      { id: 'doc_34ef709435ea7b2b', title: '8.11.26 CC APPROVED Minutes', inMeeting: true },
      { id: 'doc_draft811', title: '8.11.26 CC Minutes - Draft (City Council, 2026-08-25, item 1)', inMeeting: false },
    ];
    expect(minutesOf('2026-08-11', aug11)?.id).toBe('doc_34ef709435ea7b2b');
    const rdaSep15 = [
      { id: 'doc_f90799c6e8f89b75', title: '9.8.26 DRAFT RDA Minutes (Redevelopment Agency Board Meeting, 2026-09-15, item 1)', inMeeting: true },
      { id: 'doc_65bbcb853249cc0d', title: '9.15.26 DRAFT RDA Minutes FIN (Redevelopment Agency Board Meeting, 2026-10-13, item 1)', inMeeting: false },
      { id: 'doc_29fa094146ef6037', title: 'RDA September 2026 Advisor Report-Jared Tamez (Redevelopment Agency Board Meeting, 2026-10-13, item 1)', inMeeting: false },
    ];
    expect(minutesOf('2026-09-15', rdaSep15)?.id).toBe('doc_65bbcb853249cc0d');
    // A record without a date in its title counts only when filed under the meeting as minutes of its own.
    expect(minutesOf('2026-01-14', [{ id: 'a', title: '121025 RDA Meeting Minutes - Draft (Redevelopment Agency Board Meeting, 2026-01-14, item 1)', inMeeting: true }])).toBeNull();
    expect(minutesOf('2026-01-14', [{ id: 'b', title: 'RDA Meeting Minutes', inMeeting: true }])?.id).toBe('b');
  });

  it('of the newest meeting are the newest date a minutes title names', () => {
    expect(latestMinutesDate(['9.15.26 DRAFT RDA Minutes FIN (Redevelopment Agency Board Meeting, 2026-10-13, item 1)', '9.8.26 APPROVED RDA Minutes', '10.13.26 RDA Agenda'], '2026-10-11')).toBe('2026-09-15');
    expect(latestMinutesDate(['RDA September 2026 Advisor Report'], '2026-10-11')).toBeNull();
  });
});

describe('clarifying questions name the choices', () => {
  it('names the bodies, the officials and the dates', () => {
    expect(bodyClarify('Find the minutes for the September 15, 2026 meeting', '2026-09-15', ['city-council', 'redevelopment-agency'])?.prompt).toBe('The City Council and the Redevelopment Agency both met on September 15, 2026. Which meeting do you mean?');
    expect(bodyClarify('Show me the agenda for the September 8, 2026 meeting', '2026-09-08', ['city-council', 'redevelopment-agency', 'planning-commission'])?.prompt).toBe(
      'The City Council, the Redevelopment Agency and the Planning Commission all met on September 8, 2026. Which meeting do you mean?',
    );
    const officials = [{ name: 'Jacob Holdaway', title: 'Council Member' }, { name: 'Jacob Wood', title: 'Council Member' }];
    expect(personClarify('How did Jacob vote on Ordinance 2026-07?', officials)?.prompt).toBe('Two officials are named Jacob: Council Member Holdaway and Council Member Wood. Which one do you mean?');
    // City Council motions in March 2026 with a vote to show: March 10, 24 and 31 (GET /api/votes, Diagnostics run 38152760553, extra_1).
    const c = monthClarify('City Council', 'March 2026', ['2026-03-10', '2026-03-24', '2026-03-31']);
    expect(c.prompt).toBe('The City Council recorded votes at 3 meetings in March 2026: March 10, 2026; March 24, 2026; and March 31, 2026. Which meeting do you mean?');
    expect(c.choices.map((x) => x.question)).toEqual([
      'What did the City Council vote on at the March 10, 2026 meeting?',
      'What did the City Council vote on at the March 24, 2026 meeting?',
      'What did the City Council vote on at the March 31, 2026 meeting?',
    ]);
    expect(monthClarify('Redevelopment Agency', 'September 2026', ['2026-09-08', '2026-09-15']).prompt).toBe('The Redevelopment Agency recorded votes at 2 meetings in September 2026: September 8, 2026 and September 15, 2026. Which meeting do you mean?');
  });
});

describe('a monthly meeting the meeting portal has posted for another day', () => {
  // The city calendar repeats "ARCH Commission Meeting" on the third Thursday (entry 215); CivicClerk event 1711,
  // created October 9, 2026, is the ARCH Commission meeting of October 29, 2026.
  const arch = ['2026-10-15', '2026-11-19', '2026-12-17'].map((d) => ({ id: `city-215-${d}`, start: `${d}T18:00:00` }));
  it('is held on the posted day', () => {
    expect(postedReplacesRepeat(arch[0], arch, '2026-10-29')).toBe(true);
    expect(postedReplacesRepeat(arch[0], arch, '2026-10-15')).toBe(false);
    expect(postedReplacesRepeat(arch[0], arch, '2026-11-19')).toBe(false);
  });
  it('is not moved by a one-time entry or a body that meets twice a month', () => {
    const once = { id: 'city-214-2026-09-24', start: '2026-09-24T18:00:00' };
    expect(postedReplacesRepeat(once, [once], '2026-09-30')).toBe(false);
    const council = ['2026-10-13', '2026-10-27', '2026-11-10'].map((d) => ({ id: `city-12-${d}`, start: `${d}T18:00:00` }));
    expect(postedReplacesRepeat(council[0], council, '2026-10-20')).toBe(false);
  });
});

describe('a bare year in a tax rate question', () => {
  // Utah County Treasurer, tax year 2026 (doc_de0686a2ff89b87b p. 1): "Vineyard City rate (tax unit VINE) ...: 0.003460".
  // Fiscal 2026: June 25, 2025 minutes (doc_1ef855677abe2a0b p. 9): "CERTIFIED TAX RATE OF .003796".
  const county = { id: 'doc_de0686a2ff89b87b', title: 'Utah County tax rates 2026, Vineyard tax areas', date: 'tax year 2026', documentType: 'tax_rate', fiscalYear: 2027, rate: '0.003460', page: 1, taxYear: 2026, readOn: '2026-10-11' };
  it('gives the tax year rate and the fiscal year rate, each with its label', () => {
    const s = taxRateSentences({ kind: 'year', fiscalYear: 2026, calendar: true }, '2026-10-11', county);
    expect(s.map((x) => x.text)).toEqual([
      '2026 has two rates: the tax year 2026 rate and the fiscal 2026 rate.',
      "Vineyard City's property tax rate for tax year 2026 is 0.003460, the rate for the city's fiscal 2027 (Utah County Treasurer tax rates, read October 11, 2026).",
      "Vineyard's certified tax rate for fiscal 2026 (July 1, 2025 to June 30, 2026) is 0.003796 (adopted June 25, 2025; minutes page 9).",
    ]);
    expect(s.flatMap((x) => x.cite.map((c) => c.id))).toEqual(['doc_de0686a2ff89b87b', 'doc_1ef855677abe2a0b']);
    for (const x of s) expect(x.text).not.toMatch(/[–—]/);
  });
  it('keeps one rate when the records hold only one for that year', () => {
    expect(taxRateSentences({ kind: 'year', fiscalYear: 2025, calendar: true }, '2026-10-11', county).map((x) => x.text)).toEqual([
      'The rate adopted in 2025 is the fiscal 2026 rate (July 1, 2025 to June 30, 2026).',
      "Vineyard's certified tax rate for fiscal 2026 is 0.003796 (adopted June 25, 2025; minutes page 9).",
    ]);
    expect(taxRateSentences({ kind: 'year', fiscalYear: 2026, calendar: false }, '2026-10-11', county).map((x) => x.text)).toEqual(["Vineyard's certified tax rate for fiscal 2026 is 0.003796 (adopted June 25, 2025; minutes page 9)."]);
  });
});
