import { describe, expect, it } from 'vitest';
import { PROJECTS } from '../worker/lib/budgetData';
import {
  bestProject,
  budgetBlock,
  cleanLabel,
  findProject,
  fundedProjects,
  glanceStatus,
  isBudgetAdoption,
  motionNumber,
  nameMatch,
  projectVotes,
  searchPhrases,
  type MotionLike,
} from '../worker/lib/projectMatch';
import { dayLabel, pagesLabel, projectDetailUrl, voteOutcome } from '../src/console/projects';

const key = (text: string) => bestProject(text)?.key ?? null;
const plan = (gis: string) => findProject({ gis })!;

describe('funded projects', () => {
  it('holds every budget line exactly once', () => {
    const lines = fundedProjects().flatMap((p) => p.lines.map((l) => `${l.fund}|${l.name}`));
    expect(new Set(lines).size).toBe(lines.length);
    expect(lines.sort()).toEqual(PROJECTS.map((l) => `${l.fund}|${l.name}`).sort());
  });

  it('finds a project by its exact map name or its exact budget line, and nothing else', () => {
    expect(findProject({ gis: 'Skate Park & Pump Track' })?.key).toBe('plan-31');
    expect(findProject({ fund: 'water', name: 'Public Works building improvements' })?.key).toBe('plan-25');
    expect(findProject({ fund: 'water', name: 'Backflow software' })?.key).toBe('line-water-backflow-software');
    expect(findProject({ gis: 'Skate Park' })).toBeNull();
    expect(findProject({ fund: 'general', name: 'Backflow software' })).toBeNull();
    expect(findProject({})).toBeNull();
  });

  it('builds the budget block from the slide lines', () => {
    const b = budgetBlock(plan('Public Works Building Expansion & Improvements'), 'doc_slides');
    expect(b.total).toBe(300_000 + 250_000 + 250_000 + 400_000);
    expect(b.lines.map((l) => l.page).sort()).toEqual([4, 5, 5, 6]);
    expect(b.documentId).toBe('doc_slides');
    expect(b.adopted).toBe('2026-06-23');
  });
});

describe('conservative name matching', () => {
  it('ties the city construction table rows to the right signal only', () => {
    expect(key('Traffic signal 600 North & Main Street')).toBe('plan-14');
    expect(key('Traffic signal 400 North & Mill Road')).toBe('plan-4');
    // 400 South is not 400 North; the Holdaway Road work is not the bike boulevard study.
    expect(key('Traffic signal 400 South at Lakeside Park')).toBeNull();
    expect(key('Road and trail improvements 400 South & Holdaway Road')).toBeNull();
    expect(key('HAWK pedestrian crossing Center Street & Holdaway Road')).toBeNull();
  });

  it('matches document titles that name one project', () => {
    expect(key('Skate Park Construction Contract')).toBe('plan-31');
    expect(key('Vineyard Skate Park Budget Allocation (Resolution 2026-13)')).toBe('plan-31');
    expect(key('Sewer System Improvements Bid Award')).toBe('plan-92');
    expect(key('Lift Station 2 Upgrade Contract')).toBe('plan-38');
    expect(key('Lift Station 2 Storage Building Bid Tabulation')).toBe('plan-39');
    expect(key('1200 North Overpass Bridge Design Agreement')).toBe('plan-1');
    expect(key('7.3 Approval of Central Utah Water Conservancy District (CuWwcD) CWP Water Supply Agreement and Takedown Schedule')).toBe('line-water-central-utah-water-conservancy-district-take-down-fee');
    expect(key('Purchase of 22 Lake Bottom water shares from Orem')).toBe('line-water-22-lake-bottom-water-shares-from-orem');
  });

  it('leaves out records that only share a word or two', () => {
    expect(key('Sewer System Master Plan')).toBeNull();
    expect(key('Grove Park and City Hall landscaping')).toBeNull();
    expect(key('Water Conservation Plan')).toBeNull();
    expect(key('Lift Station 3 Rehabilitation')).toBeNull();
    expect(key('Impact Fee Facilities Plan')).toBeNull();
    expect(key('City Council Minutes')).toBeNull();
    expect(key('Public Works Department Budget')).toBeNull();
    expect(key('1200 North Overpass')).toBeNull();
  });

  it('gives a record that names two projects equally to neither', () => {
    // "Lift Station 2" and "Lift Station 4" both score three.
    expect(key('Lift Station 4 and Lift Station 2')).toBeNull();
  });

  it('needs the whole phrase for a two word name and every number for a longer one', () => {
    expect(nameMatch('Water shares', 'Water share purchase agreement')).toBe(2);
    expect(nameMatch('Water shares', 'Shares of water')).toBe(0);
    expect(nameMatch('Traffic signal at 600 North and Main Street', 'Traffic signal on Main Street')).toBe(0);
  });

  it('searches titles by adjacent words of each name', () => {
    expect(searchPhrases(plan('Skate Park & Pump Track'))).toEqual(expect.arrayContaining(['skate park', 'pump track']));
    expect(searchPhrases(plan('Traffic Signal – 600 N & Main'))).toContain('signal 600 north');
  });
});

const motion = (o: Partial<MotionLike> & { id: string }): MotionLike => ({
  date: '2026-06-23',
  bodyId: 'city-council',
  bodyName: 'City Council',
  item: null,
  motion: '',
  result: 'carried',
  tally: null,
  items: [],
  documentId: 'doc_min',
  page: 3,
  votes: [],
  ...o,
});

// As recorded in the June 23, 2026 minutes (OCR spelling kept).
const COUNCIL_BUDGET = motion({
  id: 'cc-budget',
  item: '3.2 Bb Accept the Final FY 2026-2027 Budget (Evan Smith)',
  motion: "to-approve the Fiscal' Year 2026-2027 Budget with an amendment for the road project suggested by Couricil Member Lauret",
  documentId: 'doc_f7aa0533b44d693c',
  votes: [
    { member: 'David Lauret', vote: 'yes' },
    { member: 'Jacob Holdaway', vote: 'yes' },
    { member: 'Jacob Wood', vote: 'yes' },
    { member: 'Ezra Nair', vote: 'no' },
  ],
});
const RDA_BUDGET = motion({
  id: 'rda-budget',
  bodyId: 'redevelopment-agency',
  bodyName: 'Redevelopment Agency',
  item: '4.1 Approve Resolution RDA-2026-03 for the RDA Budget for FY 2026-2027',
  motion: "approve Resolution RDA-2026-03 for the RDA Budget for Fiscal Year 2026-2027 with amendments to remove the line items'for-eonsulting services",
  documentId: 'doc_be4c84e576f5fcd4',
  page: 1,
});
const SKATE = motion({ id: 'skate', date: '2026-03-10', item: '8.2 Vineyard Skate Park Budget Allocation (Resolution 2026-13)', motion: 'Adopt Resolution 202613', documentId: 'doc_2cad57c277953f4b', page: 4 });
const CONSENT = motion({ id: 'consent', item: '7.2 Ordinance 2026-06, Floodplain Ordinance Update', motion: 'approve the consentitems as presented' });
const TENTATIVE = motion({ id: 'tent', date: '2026-05-12', item: '6.1 Tentative 2026-2027 Fiscal Year Budget', motion: 'accept the tentative budget as presented' });
const AMEND = motion({ id: 'amend', date: '2026-08-25', item: '8.1 Approve Ordinance 2026-10 Budget Amendments to the Fiscal Year 2026-2027 Budget', motion: 'adopt Ordinance 2026-10 amending the Fiscal Year 2026-2027 budget' });
const ALL = [COUNCIL_BUDGET, RDA_BUDGET, SKATE, CONSENT, TENTATIVE, AMEND];

describe('the votes behind a project', () => {
  it('finds only the June 23 adoption votes', () => {
    expect(ALL.filter(isBudgetAdoption).map((m) => m.id)).toEqual(['cc-budget', 'rda-budget']);
  });

  it('reads the resolution number from the item, never a guess', () => {
    expect(motionNumber(RDA_BUDGET)).toBe('Resolution RDA-2026-03');
    expect(motionNumber(SKATE)).toBe('Resolution 2026-13');
    expect(motionNumber(COUNCIL_BUDGET)).toBeNull();
    expect(motionNumber({ item: 'Resolution 2026-01', motion: 'adopt Resolution 2026-02' })).toBeNull();
    expect(cleanLabel(SKATE.item!)).toBe('Vineyard Skate Park Budget Allocation');
    expect(cleanLabel('8.1 Approve Ordinance 2026–10 Budget Amendments')).toBe('Approve Ordinance 2026-10 Budget Amendments');
    expect(cleanLabel('Install Street Lights – 170 South')).toBe('Install Street Lights - 170 South');
    expect(motionNumber({ item: '8.1 Approve Ordinance 2026–10', motion: '' })).toBe('Ordinance 2026-10');
  });

  it('uses the council vote for city funds and the RDA vote for the RDA fund', () => {
    const water = projectVotes(plan('Secondary Water Master Plan'), ALL);
    expect(water.map((v) => [v.kind, v.label, v.number])).toEqual([['budget', 'Approved the FY 2027 budget', null]]);
    expect(water[0].votes).toHaveLength(4);
    expect(water[0].documentId).toBe('doc_f7aa0533b44d693c');
    const rda = projectVotes(plan('400 North & Mill Road Traffic Signal'), ALL);
    expect(rda.map((v) => [v.label, v.number, v.body])).toEqual([['Approved the RDA budget for FY 2027', 'Resolution RDA-2026-03', 'Redevelopment Agency']]);
    const both = projectVotes(plan('Public Works Building Expansion & Improvements'), ALL);
    expect(both.map((v) => v.body).sort()).toEqual(['City Council', 'Redevelopment Agency']);
  });

  it('adds a motion on the project itself after the budget vote', () => {
    const v = projectVotes(plan('Skate Park & Pump Track'), ALL);
    expect(v.map((x) => [x.kind, x.label, x.number, x.date])).toEqual([
      ['budget', 'Approved the FY 2027 budget', null, '2026-06-23'],
      ['project', 'Vineyard Skate Park Budget Allocation', 'Resolution 2026-13', '2026-03-10'],
    ]);
  });

  it('takes the consent item that names the project as the label', () => {
    const c = motion({ id: 'c2', date: '2026-09-08', item: 'Consent items', motion: 'approve the consent items', items: ['5.1 Minutes of August 25', '5.2 Award the Lift Station 2 Upgrade Contract to Acme'] });
    const v = projectVotes(plan('Lift Station 2 Upgrade'), [c]);
    expect(v.map((x) => x.label)).toEqual(['Award the Lift Station 2 Upgrade Contract to Acme']);
    expect(projectVotes(plan('Storage Building - Lift Station 2'), [c])).toEqual([]);
  });
});

describe('status from the city construction table', () => {
  const rows = [
    { Project: 'Traffic signal', Location: '400 South at Lakeside Park', Status: 'In preparation', 'Expected completion': 'Early November' },
    { Project: 'Traffic signal', Location: '600 North & Main Street', Status: 'Materials being prepared', 'Expected completion': 'Early November' },
    { Project: 'Traffic signal', Location: '400 North & Mill Road', Status: 'Awaiting delivery date', 'Expected completion': 'TBD' },
  ];
  it('takes the row that names the project, with the date the page was read', () => {
    expect(glanceStatus(plan('Traffic Signal – 600 N & Main'), rows, '2026-10-11T05:15:45Z', 'https://city')).toEqual({
      label: 'Materials being prepared',
      completion: 'Early November',
      asOf: '2026-10-11T05:15:45Z',
      source: 'construction',
      sourceUrl: 'https://city',
      documentId: null,
    });
    expect(glanceStatus(plan('400 North & Mill Road Traffic Signal'), rows, 'x', null)?.completion).toBeNull();
    expect(glanceStatus(plan('Holdaway Fields 400 S Extension'), rows, 'x', null)).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------ API shape

type Handler = (env: never, url: URL) => Promise<Response>;
// Loaded by path at run time: the module uses Worker types this test project does not compile.
const WORKER_PROJECTS = '../worker/api/projects';
const loadHandler = async () => ((await import(/* @vite-ignore */ WORKER_PROJECTS)) as { getProjectDetail: Handler }).getProjectDetail;

const row = (m: MotionLike, seq: number) => ({
  id: m.id,
  document_id: m.documentId,
  meeting_id: null,
  body_id: m.bodyId,
  meeting_date: m.date,
  seq,
  item: m.item,
  motion: m.motion,
  mover: null,
  seconder: null,
  result: m.result,
  tally: null,
  tie_break: 0,
  unanimous: 0,
  inferred: 0,
  refs: null,
  items: null,
  page: m.page,
});

function env(withSearch: boolean) {
  const snapshot = {
    url: 'https://www.vineyardutah.gov/government/construction_projects.php',
    retrieved_at: '2026-10-11T05:15:45.905Z',
    heading: 'Construction Projects',
    text: 'At a glance',
    tables_json: JSON.stringify([{ caption: 'AT A GLANCE', heading: null, headers: ['Project', 'Location', 'Status', 'Expected completion'], rows: [['Skate park', 'South of City Hall', 'Under construction', 'Spring 2027']] }]),
    links_json: '[]',
  };
  const docs = [
    { id: 'doc_c1', slug: 'c1', title: 'Skate Park Construction Contract', document_type: 'contract', document_date: '2026-04-02', source_id: 's' },
    { id: 'doc_c2', slug: 'c2', title: 'Grove Park Restroom Contract', document_type: 'contract', document_date: '2026-05-01', source_id: 's' },
  ];
  const db = {
    prepare(sql: string) {
      const stmt = {
        bind: () => stmt,
        run: async () => ({}),
        first: async () => (/count\(\*\)/.test(sql) ? { n: ALL.length } : null),
        all: async () => {
          if (/FROM people/.test(sql)) return { results: [{ name: 'David Lauret' }, { name: 'Jacob Holdaway' }, { name: 'Jacob Wood' }, { name: 'Parker McCumber' }] };
          if (/SELECT m\.\* FROM motions/.test(sql)) return { results: ALL.map(row) };
          if (/FROM motion_votes WHERE motion_id IN/.test(sql)) return { results: COUNCIL_BUDGET.votes.map((v) => ({ motion_id: 'cc-budget', ...v })) };
          if (/GROUP BY member HAVING/.test(sql)) return { results: [{ member: 'Ezra Nair' }] };
          if (/FROM page_snapshots/.test(sql)) return { results: [snapshot] };
          if (/FROM documents WHERE id IN/.test(sql)) return { results: docs };
          return { results: [] };
        },
      };
      return stmt;
    },
    batch: async () => [],
  };
  const search = {
    prepare() {
      const stmt = { bind: () => stmt, all: async () => ({ results: docs.map((d, i) => ({ chunk_id: `k${i}`, document_id: d.id, title: d.title, document_type: d.document_type, rank: -1 })) }) };
      return stmt;
    },
  };
  return (withSearch ? { CATALOG_DB: db, SEARCH_DB_0: search } : { CATALOG_DB: db }) as never;
}

describe('GET /api/projects/detail', () => {
  it('returns budget, votes, documents and status for a map project', async () => {
    const get = await loadHandler();
    const res = await get(env(true), new URL('https://x/api/projects/detail?gis=Skate%20Park%20%26%20Pump%20Track'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toMatch(/max-age=600/);
    const body = (await res.json()) as Record<string, unknown> & { budget: { total: number; lines: unknown[]; documentId: string }; votes: Array<Record<string, unknown>>; documents: Array<Record<string, unknown>>; status: Record<string, unknown> };
    expect(Object.keys(body).sort()).toEqual(['budget', 'documents', 'key', 'name', 'status', 'votes']);
    expect(body.key).toBe('plan-31');
    expect(body.budget.total).toBe(1_420_000);
    expect(body.budget.documentId).toBe('doc_4d69a97b95e87bea');
    expect(body.votes.map((v) => v.kind)).toEqual(['budget', 'project']);
    expect(body.votes[0].votes).toEqual([
      { member: 'David Lauret', vote: 'yes' },
      { member: 'Jacob Holdaway', vote: 'yes' },
      { member: 'Jacob Wood', vote: 'yes' },
      { member: 'Ezra Nair', vote: 'no' },
    ]);
    expect(body.documents).toEqual([{ id: 'doc_c1', title: 'Skate Park Construction Contract', type: 'contract', typeLabel: 'Contract', date: '2026-04-02' }]);
    expect(body.status).toMatchObject({ label: 'Under construction', completion: 'Spring 2027', source: 'construction', asOf: '2026-10-11T05:15:45.905Z' });
  });

  it('falls back to the budget status and no documents when search is unavailable', async () => {
    const get = await loadHandler();
    const res = await get(env(false), new URL('https://x/api/projects/detail?fund=water&name=Backflow%20software'));
    const body = (await res.json()) as { documents: unknown[]; status: Record<string, unknown>; votes: Array<{ kind: string }> };
    expect(body.documents).toEqual([]);
    expect(body.status).toMatchObject({ source: 'budget', asOf: '2026-06-23', documentId: 'doc_2c248c52cbadfa22' });
    expect(body.votes.map((v) => v.kind)).toEqual(['budget']);
  });

  it('is a 404 for a name that is not a funded project', async () => {
    const get = await loadHandler();
    await expect(get(env(false), new URL('https://x/api/projects/detail?gis=Nope'))).rejects.toMatchObject({ status: 404 });
  });
});

describe('how the detail block labels things', () => {
  it('formats pages, dates, outcomes and the request', () => {
    expect(pagesLabel([4])).toBe('p. 4');
    expect(pagesLabel([6, 4, 5, 5])).toBe('pages 4, 5 and 6');
    expect(dayLabel('2026-06-23')).toBe('Jun 23, 2026');
    expect(dayLabel('2026-10-11T05:15:45.905Z')).toBe('Oct 10, 2026');
    expect(voteOutcome({ result: 'carried', votes: COUNCIL_BUDGET.votes })).toBe('Passed 3-1');
    expect(voteOutcome({ result: 'carried', votes: [] })).toBe('Passed');
    expect(voteOutcome({ result: 'unknown', votes: [] })).toBeNull();
    expect(projectDetailUrl({ gis: 'Skate Park & Pump Track' })).toBe('/api/projects/detail?gis=Skate+Park+%26+Pump+Track');
    expect(projectDetailUrl({ fund: 'water', name: 'Water shares' })).toBe('/api/projects/detail?fund=water&name=Water+shares');
  });

  it('never puts an en or em dash in a vote label', () => {
    const labels = fundedProjects().flatMap((p) => projectVotes(p, ALL).map((v) => v.label));
    expect(labels.length).toBeGreaterThan(0);
    for (const l of labels) expect(l).not.toMatch(/[–—]/);
  });
});
