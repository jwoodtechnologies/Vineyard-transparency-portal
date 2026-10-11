/**
 * The 2026 numbered indexes from the archive as read on October 11, 2026 (tests/fixtures/records-live-2026-10-11.json:
 * the ordinance and resolution documents with their agenda item wording, the council and RDA motions with their recorded
 * roll calls, and page 1 of the linked ordinance copies), checked against the CivicClerk agenda titles.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { adoptionMap, motionNumbers, type MotionRow } from '../worker/lib/adoptions';
import { agendaTitle, buildIndex, captionDocs, fileish, ownTitle, type IndexDoc, type IndexLink, type IndexMotion } from '../worker/lib/recordIndex';
import { isBudgetAdoption } from '../worker/lib/projectMatch';
import { BUDGET_ADOPTION_ORDINANCE } from '../worker/lib/budgetData';

const LIVE = JSON.parse(readFileSync(new URL('./fixtures/records-live-2026-10-11.json', import.meta.url), 'utf8')) as {
  docs: IndexDoc[];
  motions: Array<IndexMotion & MotionRow>;
  firstPages: Record<string, string>;
};

function index(kind: 'ordinance' | 'resolution' | 'rda-resolution') {
  const body = kind === 'rda-resolution' ? 'redevelopment-agency' : 'city-council';
  const motions = LIVE.motions.filter((m) => m.body_id === body);
  const links: IndexLink[] = [];
  const budget = motions.find((m) => isBudgetAdoption({ date: m.meeting_date, result: String(m.result), item: m.item, motion: m.motion ?? '' }));
  if (kind === 'ordinance' && budget) links.push({ kind, number: BUDGET_ADOPTION_ORDINANCE.slice(-7), motionId: budget.id });
  const docs = LIVE.docs.filter((d) => d.document_type === (kind === 'ordinance' ? 'ordinance' : 'resolution'));
  const adoptions = [...adoptionMap(LIVE.motions).values()];
  const first = buildIndex(kind, 2026, docs, adoptions, [], motions, links);
  // As the Worker does: the caption printed on page 1 of each linked copy.
  const titles = new Map<string, string>();
  for (const id of captionDocs(first)) {
    const t = LIVE.firstPages[id] ? ownTitle(LIVE.firstPages[id]) : null;
    if (t) titles.set(id, t);
  }
  return buildIndex(kind, 2026, docs, adoptions, [], motions, links, titles);
}

describe('2026 ordinances as the index will read', () => {
  const idx = index('ordinance');
  const row = (n: string) => idx.rows.find((r) => r.number === n)!;

  it('reads every held row', () => {
    const shown = idx.rows.filter((r) => r.state !== 'absent').map((r) => [r.number, r.title, r.status, r.tally]);
    expect(shown).toEqual([
      ['2026-01', 'Amending the Vineyard Municipal Code Title 3 Chapter .02 Section 010(1)', 'adopted', '5-0'],
      ['2026-06', 'Flood Damage Prevention Ordinance', 'adopted', '4-0'],
      [
        '2026-07',
        'Amending the Vineyard Subdivision Code Sections 14.06.020(4)(j) Requirements for Preliminary Subdivision Applications, 14.80.030(4)(j) Requirements for Final Subdivision Applications, and 14.08.100 Final Subdivision Review Procedures',
        'adopted',
        '3-2',
      ],
      ['2026-08', 'Adopting the Final Budget for the Fiscal Year Beginning July 1, 2026, and Ending June 30, 2027', 'adopted', '3-1'],
      ['2026-09', 'Amending Title 7 of the Vineyard City Municipal Code by Adopting Chapter 7.08, Stormwater Management', 'adopted', '4-0'],
      ['2026-10', 'Amending the Vineyard City Budget for the 2026-2027 Fiscal Year', 'adopted', '4-1'],
      ['2026-11', 'Senate Bill 284/City Code Compliance', 'draft', null],
    ]);
  });

  it('2026-07 is never titled by the "July 28 Revision" draft file', () => {
    expect(row('2026-07')).toMatchObject({ adoptedOn: '2026-08-11', document: { id: 'doc_b6771ee4f809b3bb', status: 'adopted' } });
    for (const r of idx.rows) expect(fileish(r.title) && r.state !== 'absent').toBe(false);
  });

  it('2026-10 takes the August 25 roll call (4 yes, 1 no) when the minutes print no tally', () => {
    expect(row('2026-10')).toMatchObject({ adoptedOn: '2026-08-25', vote: 'carried', minutes: { documentId: 'doc_7a0b2b44683f4559', page: 5 } });
  });

  it('2026-01 takes the January 27 roll call on the motion brought back', () => {
    expect(row('2026-01')).toMatchObject({ adoptedOn: '2026-01-27', vote: 'carried', minutes: { documentId: 'doc_cf31e9aab11422d8', page: 3 } });
  });

  it('2026-11, the DADU draft at the Planning Commission on October 7, is a draft with no vote', () => {
    expect(row('2026-11')).toMatchObject({ status: 'draft', state: 'listed', vote: null, tally: null, adoptedOn: null, draft: { date: '2026-10-07', body: 'Planning Commission' } });
    expect(row('2026-11').document?.status).toBe('draft');
  });

  it('no title has a long dash', () => {
    for (const k of ['ordinance', 'resolution', 'rda-resolution'] as const) for (const r of index(k).rows) expect(r.title ?? '').not.toMatch(/[‒-―]/);
  });
});

describe('resolutions and RDA resolutions from the same rule', () => {
  it('a row is adopted only with a vote or the adopted copy; no title is file-ish', () => {
    for (const k of ['resolution', 'rda-resolution'] as const)
      for (const r of index(k).rows) {
        if (r.status === 'adopted') expect(r.vote === 'carried' || r.adoptedFrom === 'document').toBe(true);
        if (r.state !== 'absent' && r.title) expect(fileish(r.title)).toBe(false);
      }
  });
});

describe('titles from the records', () => {
  it.each([
    // Page 1 captions, as printed.
    ['doc_9dc25c362054d711', 'Amending the Vineyard City Budget for the 2026-2027 Fiscal Year'],
    ['doc_926f7f8f5e27e313', 'Amending the Vineyard Municipal Code Title 3 Chapter .02 Section 010(1)'],
    ['doc_19aa5d78c20c87ba', null],
  ])('caption of %s', (id, want) => {
    expect(ownTitle(LIVE.firstPages[id])).toBe(want);
  });

  it.each([
    // CivicClerk agenda item titles.
    ['Approve Ordinance 2026-07 Amending Municipal Code for the Planning Department (Anthony Fletcher)', 'Amending Municipal Code for the Planning Department'],
    ["Approve Ordinance 2026–10 Budget Amendments to the Fiscal Year 2026-2027 Budget, Including Municipal Executive Officers'<sub> </sub>Salaries.", "Budget Amendments to the Fiscal Year 2026-2027 Budget, Including Municipal Executive Officers' Salaries"],
    ['Senate Bill 284/City Code Compliance — Consideration of Ordinance No. 2026-11', 'Senate Bill 284/City Code Compliance'],
    ['Public Hearing – Senate Bill 284/City Code Compliance', 'Senate Bill 284/City Code Compliance'],
  ])('agenda %s', (input, want) => {
    expect(agendaTitle(input)).toBe(want);
  });

  it.each(['July 28 Revision', 'July 9 revision', 'v2', 'FINAL', 'Draft', 'Ordinance 2026-07.pdf', 'FY26 Budget Amendment #1 Executive Offic...', 'DADU (SB 284), Vineyard Attorney Reviewed', '06232026', '10.01.2026 DADU Ordinance', 'Utah DEM Model E Ordinance 2025 DRAFT', 'Ordinance 2026-07', ''])(
    'file-ish: %s',
    (t) => expect(fileish(t)).toBe(true),
  );

  it.each(['Senate Bill 284/City Code Compliance', 'Flood Damage Prevention Ordinance', 'Amending the Vineyard City Budget for the 2026-2027 Fiscal Year', 'Final Budget For FY 2026-2027', 'Amending Section 1.08.040(S) and Sections 14.06.020(4)(j)','Adopting the Draft Geneva Urban Renewal Project Area Plan'])('not file-ish: %s', (t) =>
    expect(fileish(t)).toBe(false),
  );

  it.each([
    ['Ordinance 2026-10', '2026-10'],
    ['Ordinance 2026 - 10', '2026-10'],
    ['Ord. 26-10', '2026-10'],
    ['Ordinance No. 2026-10', '2026-10'],
    ['ORDINANCE NO 2026–10', '2026-10'],
    ['Adopt Ordinance 202601 as amended', '2026-01'],
  ])('reads the number in %s', (text, want) => {
    expect(motionNumbers(text, 'city-council', 2026)).toEqual([{ kind: 'ordinance', number: want }]);
  });
});
