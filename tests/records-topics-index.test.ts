import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RECORD_TOPICS, matchesTopic, topicById, topicSql } from '../src/lib/recordTopics';
import { adoptionMap, adoptionsFrom, type MotionRow } from '../worker/lib/adoptions';
import { buildIndex, type IndexDoc } from '../worker/lib/recordIndex';

const doc = (title: string, documentType: string, sourceId = 'vineyard-civicclerk-meetings', governmentBodyId: string | null = 'city-council') => ({ title, documentType, sourceId, governmentBodyId });
const inTopics = (d: ReturnType<typeof doc>) => RECORD_TOPICS.filter((t) => matchesTopic(t, d)).map((t) => t.id);

describe('record topics', () => {
  it('has the fourteen topics of the records home, each with a unique id', () => {
    expect(RECORD_TOPICS.map((t) => t.label)).toEqual([
      'Agendas and minutes', 'Ordinances', 'Resolutions', 'Budgets and audits', 'Contracts and agreements', 'Development and land use', 'RDA',
      'Plans and studies', 'Water quality reports', 'Elections', 'Fee schedule', 'Public notices', 'Sheriff updates', 'Resident submissions',
    ]);
    expect(new Set(RECORD_TOPICS.map((t) => t.id)).size).toBe(RECORD_TOPICS.length);
    for (const t of RECORD_TOPICS) for (const s of [t.label, t.hint, t.notice ?? '']) expect(s).not.toMatch(/[–—]/);
  });
  it.each([
    [doc('9.15.26 CC Agenda', 'agenda'), ['meetings']],
    [doc('2026-09 Amending Title 7', 'ordinance', 'vineyard-municipal-code'), ['ordinances']],
    [doc('RES 2026-35 Meeting Schedule', 'resolution'), ['resolutions']],
    [doc('RES U2025-01 Bid Award', 'resolution', 'vineyard-civicclerk-meetings', 'redevelopment-agency'), ['rda']],
    [doc('Resolution 2026-21 Consolidated Fee Schedule w Exhibit', 'resolution'), ['resolutions', 'fees']],
    [doc('Vineyard 2025 Water Quality Report', 'study', 'vineyard-city-website', null), ['water-quality']],
    [doc('Vineyard Parks IFA Report', 'study'), ['plans']],
    [doc('Certification of the 2025 General Election', 'other', 'vineyard-city-website', null), ['elections']],
    [doc('1600 N Site Plan', 'plan', 'vineyard-civicclerk-meetings', 'planning-commission'), ['land-use', 'plans']],
    [doc('First Amended Development Agreement', 'development_agreement'), ['land-use']],
    [doc('Zoning Code: 15.04 Definitions', 'municipal_code', 'vineyard-municipal-code'), []],
    [doc('City Council Meeting (public notice, 2026-10-13)', 'public_notice', 'utah-pmn-vineyard'), ['notices']],
    [doc('Deputies arrest suspect in Vineyard', 'public_notice', 'ucso-press-releases', null), ['sheriff']],
    [doc('Photo of the 400 South election sign', 'resident_submission', 'resident-submitted', null), ['resident']],
  ])('%o', (d, want) => {
    expect(inTopics(d)).toEqual(want);
  });
  it('builds one parameterized clause per topic, with resident submissions kept out of every other topic', () => {
    const t = topicSql(topicById('elections')!, 'doc');
    expect(t.sql).toContain('doc.title LIKE p.value');
    expect(t.params).toContain(JSON.stringify(['resident-submitted']));
    expect(topicSql(topicById('resident')!, 'd').sql).not.toContain('d.source_id, \'\') NOT IN');
    for (const topic of RECORD_TOPICS) expect((topicSql(topic, 'd').sql.match(/\?/g) ?? []).length).toBe(topicSql(topic, 'd').params.length);
  });
});

// Motions as the votes table holds them, from the 2026 City Council and RDA minutes.
const MOTIONS: MotionRow[] = [
  // Ordinance 2026-09: June 23, 2026 City Council minutes (doc_f7aa0533b44d693c, page 2), carried 4-0.
  { body_id: 'city-council', meeting_date: '2026-06-23', motion: 'approve Ordinance 2026-09, Stormwater Management Code Update as presented', result: 'carried', tally: '4-0', document_id: 'doc_f7aa0533b44d693c', page: 2 },
  { body_id: 'city-council', meeting_date: '2026-06-23', motion: 'approve the consentitems as presented', items: '["5.1 Minutes"]', result: 'carried', tally: '4-0', document_id: 'doc_f7aa0533b44d693c', page: 2 },
  { body_id: 'city-council', meeting_date: '2026-08-25', motion: "adopt Ordinance 2026-10 amending the Fiscal Year 2026-2027 budget, including approval of municipal executive officers' salaries as presented", result: 'carried', tally: null, unanimous: 1, document_id: 'doc_7a0b2b44683f4559', page: 5 },
  { body_id: 'city-council', meeting_date: '2026-03-24', motion: 'Adopt Resolution 202618 adopting a travel and reimbursement policy', result: 'carried', document_id: 'doc_965360a52383e70e', page: 6 },
  { body_id: 'city-council', meeting_date: '2026-03-10', motion: 'Continue the item until the meeting on march 24th. Resolution 2026-13', result: 'carried', document_id: 'doc_2cad57c277953f4b', page: 4 },
  { body_id: 'city-council', meeting_date: '2026-01-27', motion: 'Adopt Ordinance 202601 as amended. the motion was tabled', result: 'unknown', document_id: 'doc_cf31e9aab11422d8', page: 3 },
  { body_id: 'redevelopment-agency', meeting_date: '2026-07-14', motion: 'Adopt resolution u202604 authorizing the rda director to trigger tax increment financing', result: 'carried', document_id: 'doc_125e390e8b99472b', page: 2 },
  { body_id: 'planning-commission', meeting_date: '2026-09-02', motion: 'recommend approval of Ordinance 2026-11 to the City Council', result: 'carried', document_id: 'doc_pc', page: 3 },
  { body_id: 'city-council', meeting_date: '2026-05-26', motion: 'Approve the consent items as presented', items: '["8.3 Resolution 2026-29 City Manager"]', result: 'carried', document_id: 'doc_43974cc0eb8e88f5', page: 3 },
];

describe('adoptions from motions', () => {
  const map = adoptionMap(MOTIONS);
  it('Ordinance 2026-09 was adopted June 23, 2026 (minutes doc_f7aa0533b44d693c, page 2)', () => {
    expect(map.get('ordinance|2026-09')).toMatchObject({ date: '2026-06-23', tally: '4-0', documentId: 'doc_f7aa0533b44d693c', page: 2, consent: false });
  });
  it('reads numbers written without a hyphen, and RDA numbers', () => {
    expect(map.get('resolution|2026-18')?.date).toBe('2026-03-24');
    expect(map.get('rda-resolution|2026-04')?.date).toBe('2026-07-14');
    expect(map.get('resolution|2026-29')).toMatchObject({ consent: true, date: '2026-05-26' });
  });
  it('never counts a continuance, a motion that did not carry, or a recommendation', () => {
    expect(map.has('resolution|2026-13')).toBe(false);
    expect(map.has('ordinance|2026-01')).toBe(false);
    expect(map.has('ordinance|2026-11')).toBe(false);
    expect(adoptionsFrom({ body_id: 'city-council', meeting_date: '2026-02-10', motion: 'Strike the item from the agenda, Resolution 2026-08', result: 'carried', document_id: 'x', page: 1 })).toEqual([]);
  });
});

describe('numbered index', () => {
  const docs: IndexDoc[] = [
    { id: 'doc_code_0209', title: '2026-09 Amending Title 7 By Adopting Chapter 7.08, Stormwater Management', document_type: 'ordinance', document_number: '2026-09', document_date: null, year: 2026, government_body_id: 'city-council', government_body_name: 'City Council', source_id: 'vineyard-municipal-code', agenda_item_id: null },
    { id: 'doc_packet_0209', title: 'ORDINANCE NO 2026-09 Stormwater (City Council, 2026-06-23, item 1)', document_type: 'ordinance', document_number: null, document_date: '2026-06-23', year: 2026, government_body_id: 'city-council', government_body_name: 'City Council', source_id: 'vineyard-civicclerk-meetings', agenda_item_id: null },
    { id: 'doc_draft_0211', title: 'Draft DADU Ordinance 2026-11 - Senate Bill 284 09.03.2026 (City Council, 2026-09-08, item 1)', document_type: 'ordinance', document_number: null, document_date: '2026-09-08', year: 2026, government_body_id: 'city-council', government_body_name: 'City Council', source_id: 'vineyard-civicclerk-meetings', agenda_item_id: null },
    { id: 'doc_code_2508', title: '2025-08 Wastewater Master Plan', document_type: 'ordinance', document_number: '2025-08', document_date: null, year: 2025, government_body_id: 'city-council', government_body_name: 'City Council', source_id: 'vineyard-municipal-code', agenda_item_id: null },
  ];
  const adoptions = [...adoptionMap(MOTIONS).values()];
  const idx = buildIndex('ordinance', 2026, docs, adoptions, [{ number: '2026-07', date: '2026-08-11', documentId: 'doc_34ef709435ea7b2b', page: 3 }]);

  it('lists the year by number with adoption dates from the minutes', () => {
    expect(idx.year).toBe(2026);
    expect(idx.years).toEqual([{ year: 2026, count: 4 }, { year: 2025, count: 1 }]);
    expect(idx.rows.map((r) => [r.number, r.state])).toEqual([['2026-07', 'missing'], ['2026-09', 'adopted'], ['2026-10', 'adopted'], ['2026-11', 'listed']]);
    const r09 = idx.rows.find((r) => r.number === '2026-09')!;
    expect(r09).toMatchObject({ adoptedOn: '2026-06-23', adoptedFrom: 'minutes', tally: '4-0', minutes: { documentId: 'doc_f7aa0533b44d693c', page: 2 } });
    // The adopted copy from the code books is the one linked, not the packet copy.
    expect(r09.document?.id).toBe('doc_code_0209');
    expect(r09.title).toBe('Amending Title 7 By Adopting Chapter 7.08, Stormwater Management');
  });
  it('shows an adopted number with no document from the motion, and a draft as a draft', () => {
    const r10 = idx.rows.find((r) => r.number === '2026-10')!;
    expect(r10.document).toBeNull();
    expect(r10.unanimous).toBe(true);
    expect(r10.title).toMatch(/^Adopt Ordinance 2026-10/);
    const r11 = idx.rows.find((r) => r.number === '2026-11')!;
    expect(r11).toMatchObject({ adoptedOn: null, state: 'listed', document: { id: 'doc_draft_0211', status: 'draft' } });
  });
  it('a number cited in the minutes but held nowhere is "not in the archive", and an unknown number is not invented', () => {
    expect(idx.rows.find((r) => r.number === '2026-07')).toMatchObject({ state: 'missing', document: null, minutes: { documentId: 'doc_34ef709435ea7b2b', page: 3 } });
    expect(idx.rows.some((r) => r.number === '2026-08')).toBe(false);
  });
});

describe('the shared modules stay free of long dashes in what they show', () => {
  it.each(['src/lib/recordTopics.ts', 'src/console/RecordsHome.tsx', 'src/console/RecordsIndexPage.tsx', 'src/console/RecordChips.tsx'])('%s', (f) => {
    expect(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')).not.toMatch(/[–—]/);
  });
});
