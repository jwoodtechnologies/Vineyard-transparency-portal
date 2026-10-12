import { afterEach, describe, expect, it, vi } from 'vitest';
import { classifyOwner, deedYear, normalizeOwner, ownerDecision, propertyClass, type OwnerKind, type OwnerReason } from '../worker/lib/ownerFilter';
import { countyOwnerAtUrl, parcelCard } from '../worker/lib/mapLayers';
import { bboxOf, centroid, countyPageUrl, inPolygons, polygonsOf, SAMPLE, summarize } from '../scripts/owner-filter/lib.mjs';

/** [county owner text, shown kind] or [county owner text, withheld reason]. Placeholder names only. */
const SHOWN: Array<[string, OwnerKind]> = [
  // Required examples.
  ['DR HORTON INC', 'business'],
  ['EDGE HOMES', 'business'],
  ['CADENCE HOMES', 'business'],
  ['CORP OF PRES BISHOP', 'church'],
  ['VINEYARD CITY', 'government'],
  ['ANDERSON GENEVA LLC', 'business'],
  ['J AND M PROPERTIES LLC', 'business'],
  // Punctuation and spacing.
  ['D.R. Horton, Inc.', 'business'],
  ['D R HORTON INC', 'business'],
  ['Edge Homes Utah, L.L.C.', 'business'],
  ['GENEVA HOLDINGS L L C', 'business'],
  ['J & M PROPERTIES LLC', 'business'],
  ['J&M PROPERTIES, LLC', 'business'],
  ['  edge   homes  ', 'business'],
  ['VINEYARD STATION PARTNERS LP', 'business'],
  ['LAKEFRONT DEVELOPMENT LLC', 'business'],
  ['GENEVA ROCK PRODUCTS INC', 'business'],
  ['UTAH VALLEY INVESTMENTS LTD', 'business'],
  ['MOUNTAIN WEST BUILDERS INC', 'business'],
  ['SUMMIT CONSTRUCTION CO', 'business'],
  ['DOWNTOWN VINEYARD PARTNERSHIP', 'business'],
  ['OREM PROPERTIES LLLP PLLC', 'business'],
  ['CITY CREEK HOMES', 'business'],
  ['USA HOMES LLC', 'business'],
  ['1600 NORTH PARTNERS LLC', 'business'],
  ['UTAH COMMUNITY CREDIT UNION', 'business'],
  ['WASATCH BANK', 'business'],
  ['TIMPANOGOS FOUNDATION', 'business'],
  ['JOHN SMITH PROPERTIES LLC', 'business'],
  // Church corporations.
  ['CORPORATION OF THE PRESIDING BISHOP OF THE CHURCH OF JESUS CHRIST OF LATTER-DAY SAINTS', 'church'],
  ['CORP OF THE PRESIDING BISHOP', 'church'],
  ['CORP OF PRESIDING BISHOPRIC', 'church'],
  ['CORPORATION OF THE PRESIDENT OF THE CHURCH', 'church'],
  ['ROMAN CATHOLIC DIOCESE OF SALT LAKE CITY', 'church'],
  ['FIRST BAPTIST CHURCH OF OREM', 'church'],
  // Government.
  ['STATE OF UTAH', 'government'],
  ['UTAH DEPARTMENT OF TRANSPORTATION', 'government'],
  ['UDOT', 'government'],
  ['UTA', 'government'],
  ['UTAH TRANSIT AUTHORITY', 'government'],
  ['UNITED STATES OF AMERICA', 'government'],
  ['UTAH COUNTY', 'government'],
  ['ALPINE SCHOOL DISTRICT', 'government'],
  ['UTAH VALLEY UNIVERSITY', 'government'],
  ['UVU', 'government'],
  ['VINEYARD REDEVELOPMENT AGENCY', 'government'],
  ['CITY OF VINEYARD', 'government'],
  ['OREM CITY', 'government'],
  ['CENTRAL UTAH WATER CONSERVANCY DISTRICT', 'government'],
  ['STATE OF UTAH SCHOOL & INSTITUTIONAL TRUST LANDS ADMIN', 'government'],
  // HOA.
  ['VINEYARD TOWNHOMES OWNERS ASSOCIATION INC', 'hoa'],
  ['LAKEFRONT HOMEOWNERS ASSOCIATION', 'hoa'],
  ['GENEVA HOA', 'hoa'],
  ['WATERS EDGE MASTER ASSOCIATION', 'hoa'],
  // Utilities and railroad.
  ['UNION PACIFIC RAILROAD CO', 'utility'],
  ['ROCKY MOUNTAIN POWER', 'utility'],
  ['DOMINION ENERGY', 'utility'],
  ['QUESTAR GAS CO', 'utility'],
];

const WITHHELD: Array<[unknown, OwnerReason]> = [
  // Required examples.
  ['SMITH JOHN A', 'no-entity-word'],
  ['SMITH FAMILY TRUST', 'trust-or-estate'],
  ['JOHN SMITH LLC', 'name-only'],
  // LAST, FIRST and FIRST LAST.
  ['SMITH, JOHN', 'no-entity-word'],
  ['JOHN A SMITH', 'no-entity-word'],
  ['SMITH, JOHN A & JANE B', 'joined-names'],
  ['SMITH JOHN AND JANE', 'joined-names'],
  ['ZYLSTRA QUENTIN', 'no-entity-word'],
  // Trusts, estates, families.
  ['SMITH JOHN A TRUSTEE', 'trust-or-estate'],
  ['SMITH JOHN TTEE', 'trust-or-estate'],
  ['JOHN SMITH LIVING TRUST', 'trust-or-estate'],
  ['SMITH REVOCABLE TRUST', 'trust-or-estate'],
  ['SMITH IRREVOCABLE TR', 'trust-or-estate'],
  ['ESTATE OF JOHN SMITH', 'trust-or-estate'],
  ['SMITH FAMILY LLC', 'trust-or-estate'],
  ['SMITH FAM PROPERTIES LLC', 'trust-or-estate'],
  ['GENEVA HOMES TRUST', 'trust-or-estate'],
  ['HEIRS OF JOHN SMITH', 'trust-or-estate'],
  ['VINEYARD SENIOR LIVING LLC', 'trust-or-estate'],
  // Et al, et ux, joint tenants.
  ['SMITH JOHN ET AL', 'et-al'],
  ['SMITH JOHN ETAL', 'et-al'],
  ['SMITH JOHN ET UX', 'et-al'],
  ['SMITH JOHN JT TEN', 'et-al'],
  // Generational suffixes.
  ['SMITH JOHN JR', 'generational-suffix'],
  ['JOHN SMITH SR PROPERTIES LLC', 'generational-suffix'],
  ['SMITH JOHN III', 'generational-suffix'],
  // Care of, titles.
  ['GENEVA HOLDINGS LLC C/O JOHN SMITH', 'care-of-or-title'],
  ['MRS JANE SMITH', 'care-of-or-title'],
  // Names joined by AND or &.
  ['SMITH AND JONES PROPERTIES LLC', 'joined-names'],
  ['JOHN & MARY PROPERTIES LLC', 'joined-names'],
  ['EDGE HOMES & SMITH JOHN', 'joined-names'],
  ['J AND MARY HOLDINGS LLC', 'joined-names'],
  // Name-only entity prefixes.
  ['SMITH LLC', 'name-only'],
  ['JOHN DOE LLC', 'name-only'],
  ['J AND M LLC', 'name-only'],
  ['DR JOHN SMITH INC', 'name-only'],
  ['JANE SMITH CORP', 'name-only'],
  ['CHURCH JOHN A', 'name-only'],
  ['POWER, JOHN', 'name-only'],
  ['WEST JOHN LLC', 'name-only'],
  ['ACME LLC', 'name-only'],
  ['SMITH 2 LLC', 'name-only'],
  // Several owners in one field.
  ['EDGE HOMES LLC; SMITH JOHN', 'no-entity-word'],
  ['EDGE HOMES LLC\nSMITH FAMILY TRUST', 'trust-or-estate'],
  ['EDGE HOMES LLC, SMITH JOHN', 'comma-name'],
  // Not a name at all.
  ['', 'empty'],
  ['   ', 'empty'],
  [null, 'empty'],
  [undefined, 'empty'],
  [42, 'empty'],
  [`GENEVA HOLDINGS LLC ${'X'.repeat(130)}`, 'too-long'],
];

describe('owner filter: names shown', () => {
  it.each(SHOWN)('%s is shown as %s', (name, kind) => {
    const r = classifyOwner(name);
    expect(r).toEqual({ show: true, name: name.replace(/\s+/g, ' ').trim(), kind });
  });
});

describe('owner filter: names withheld', () => {
  it.each(WITHHELD)('%j is withheld (%s)', (name, reason) => {
    expect(classifyOwner(name)).toEqual({ show: false, reason });
  });

  it('has at least 80 cases covering every reason', () => {
    expect(SHOWN.length + WITHHELD.length).toBeGreaterThanOrEqual(80);
    const reasons = new Set(WITHHELD.map(([, r]) => r));
    for (const r of ['empty', 'too-long', 'trust-or-estate', 'et-al', 'generational-suffix', 'care-of-or-title', 'joined-names', 'comma-name', 'no-entity-word', 'name-only'] as OwnerReason[]) expect(reasons.has(r)).toBe(true);
  });

  it('a withheld result carries no name', () => {
    for (const [name] of WITHHELD) expect(JSON.stringify(classifyOwner(name))).not.toMatch(/SMITH|JOHN|JONES|MARY|DOE/);
  });
});

describe('owner filter: normalizing', () => {
  it('drops punctuation, joins spaced legal forms and splits &', () => {
    expect(normalizeOwner('D.R. Horton, Inc.')).toBe('DR HORTON INC');
    expect(normalizeOwner('Geneva L L C')).toBe('GENEVA LLC');
    expect(normalizeOwner('Geneva P.L.L.C.')).toBe('GENEVA PLLC');
    expect(normalizeOwner('J&M')).toBe('J & M');
    expect(normalizeOwner('Acme c/o Someone')).toBe('ACME C O SOMEONE');
  });
});

describe('residential rule', () => {
  const RES: Array<[unknown, unknown, ReturnType<typeof propertyClass>]> = [
    ['RESIDENTIAL', null, 'residential'],
    ['Residential', null, 'residential'],
    ['SINGLE FAMILY RESIDENCE', null, 'residential'],
    ['CONDO', null, 'residential'],
    ['CONDOMINIUM UNIT', null, 'residential'],
    ['TOWNHOUSE', null, 'residential'],
    ['TOWNHOME', null, 'residential'],
    ['PUD', null, 'residential'],
    ['DUPLEX', null, 'residential'],
    ['MULTI-FAMILY', null, 'residential'],
    ['MOBILE HOME', null, 'residential'],
    ['RES-SFR', null, 'residential'],
    ['COMMERCIAL', 'GENEVA CONDOMINIUMS PHASE 2', 'residential'],
    ['COMMERCIAL', null, 'other'],
    ['EXEMPT', null, 'other'],
    ['INDUSTRIAL', null, 'other'],
    ['VACANT', null, 'other'],
    ['VACANT RESIDENTIAL LOT', null, 'other'],
    ['AGRICULTURAL', null, 'other'],
    [null, null, 'unknown'],
    ['', 'SOME SUBDIVISION', 'unknown'],
  ];
  it.each(RES)('type %j (subdivision %j) is %s', (t, sub, want) => {
    expect(propertyClass(t, sub)).toBe(want);
  });

  it('withholds a business owner on a home, or when the type is unknown', () => {
    expect(ownerDecision({ owner: 'GENEVA HOLDINGS LLC', propType: 'RESIDENTIAL' })).toEqual({ show: false, reason: 'residential' });
    expect(ownerDecision({ owner: 'EDGE HOMES', propType: 'CONDO' })).toEqual({ show: false, reason: 'residential' });
    expect(ownerDecision({ owner: 'CORP OF PRES BISHOP', propType: 'SINGLE FAMILY' })).toEqual({ show: false, reason: 'residential' });
    expect(ownerDecision({ owner: 'GENEVA HOLDINGS LLC', propType: null })).toEqual({ show: false, reason: 'type-unknown' });
    expect(ownerDecision({ owner: 'GENEVA HOLDINGS LLC', propType: 'COMMERCIAL', subName: 'LAKEFRONT CONDOMINIUM' })).toEqual({ show: false, reason: 'residential' });
  });

  it('shows a government or HOA owner on a home, and an entity on other land', () => {
    expect(ownerDecision({ owner: 'VINEYARD CITY', propType: 'RESIDENTIAL' })).toMatchObject({ show: true, kind: 'government' });
    expect(ownerDecision({ owner: 'LAKEFRONT HOMEOWNERS ASSOCIATION', propType: 'PUD' })).toMatchObject({ show: true, kind: 'hoa' });
    expect(ownerDecision({ owner: 'UTAH COUNTY', propType: null })).toMatchObject({ show: true, kind: 'government' });
    expect(ownerDecision({ owner: 'DR HORTON INC', propType: 'VACANT' })).toEqual({ show: true, name: 'DR HORTON INC', kind: 'business' });
    expect(ownerDecision({ owner: 'CORP OF PRES BISHOP', propType: 'EXEMPT' })).toMatchObject({ show: true, kind: 'church' });
  });

  it('applies the name rules before the residential rule', () => {
    expect(ownerDecision({ owner: 'SMITH FAMILY TRUST', propType: 'COMMERCIAL' })).toEqual({ show: false, reason: 'trust-or-estate' });
    expect(ownerDecision({ owner: 'SMITH JOHN A', propType: 'RESIDENTIAL' })).toEqual({ show: false, reason: 'no-entity-word' });
  });
});

describe('deed year', () => {
  it('reads the year of a county document number, and nothing else', () => {
    expect(deedYear('123456:2021')).toBe(2021);
    expect(deedYear('98765-2019')).toBe(2019);
    expect(deedYear('123')).toBeNull();
    expect(deedYear('ABC:2021')).toBeNull();
    expect(deedYear('1:2999')).toBeNull();
    expect(deedYear(null)).toBeNull();
  });
});

/* ----------------------------------------------------------------------------------------------- */
/* Card and route                                                                                    */
/* ----------------------------------------------------------------------------------------------- */

const square = { type: 'Polygon', coordinates: [[[-111.74, 40.3], [-111.739, 40.3], [-111.739, 40.301], [-111.74, 40.301], [-111.74, 40.3]]] };
const countyFC = (no: string | number) => ({ features: [{ type: 'Feature', geometry: square, properties: { PARCEL_NO: no, SITE_FULL_ADDRESS: '100 N MAIN ST', OWNER_NAME: 'LEAKED IF SEEN', OWN_FULL_ADDRESS: '1 MAILING WAY' } }] });
const cityFC = (no: string | number, type: string | null) => ({ features: [{ properties: { PARCEL_NO: no, PROP_TYPE_DESCR: type, GLA_WEIGHTED_YRBLT: 2019 } }] });
const ownerFC = (no: string | number, name: string, doc = '123456:2021') => ({ features: [{ type: 'Feature', geometry: null, properties: { PARCEL_NO: no, OWNER_NAME: name, VESTING_DOC: doc, OWN_FULL_ADDRESS: '1 MAILING WAY' } }] });

describe('parcel card owner line', () => {
  it('asks the county for the owner field only, never the mailing address, with no shape', () => {
    const u = new URL(countyOwnerAtUrl(-111.74, 40.3));
    expect(u.searchParams.get('outFields')).toBe('PARCEL_NO,OWNER_NAME,VESTING_DOC');
    expect(u.searchParams.get('returnGeometry')).toBe('false');
    expect(u.toString()).not.toMatch(/OWN_FULL_ADDRESS/);
  });

  it('adds an allowed entity owner with the record date and deed year', () => {
    const card = parcelCard(countyFC('1'), cityFC('1', 'COMMERCIAL'), ownerFC('1', 'GENEVA HOLDINGS LLC'), '2026-10-11');
    expect(card.owner).toEqual({ name: 'GENEVA HOLDINGS LLC', asOf: '2026-10-11', deedYear: 2021 });
    expect(JSON.stringify(card)).not.toMatch(/MAILING|LEAKED|OWNER_NAME|VESTING_DOC|123456/);
  });

  it('leaves the owner out entirely for a person, a home, an unknown type or another parcel number', () => {
    const cases: Array<[unknown, unknown]> = [
      [cityFC('1', 'COMMERCIAL'), ownerFC('1', 'SMITH JOHN A')],
      [cityFC('1', 'COMMERCIAL'), ownerFC('1', 'SMITH FAMILY TRUST')],
      [cityFC('1', 'RESIDENTIAL'), ownerFC('1', 'GENEVA HOLDINGS LLC')],
      [cityFC('2', 'COMMERCIAL'), ownerFC('1', 'GENEVA HOLDINGS LLC')],
      [cityFC('1', 'COMMERCIAL'), ownerFC('2', 'GENEVA HOLDINGS LLC')],
      [null, ownerFC('1', 'GENEVA HOLDINGS LLC')],
      [cityFC('1', 'COMMERCIAL'), null],
      [cityFC('1', 'COMMERCIAL'), { features: [...ownerFC('1', 'GENEVA HOLDINGS LLC').features, ...ownerFC('1', 'EDGE HOMES').features] }],
    ];
    for (const [city, owner] of cases) {
      const card = parcelCard(countyFC('1'), city, owner, '2026-10-11');
      expect(card.found).toBe(true);
      expect('owner' in card).toBe(false);
      expect(JSON.stringify(card)).not.toMatch(/SMITH|GENEVA HOLDINGS|EDGE HOMES|Owner|owner/);
    }
  });

  it('matches numeric county parcel numbers', () => {
    expect(parcelCard(countyFC(380490001), cityFC('380490001', 'EXEMPT'), ownerFC(380490001, 'VINEYARD CITY'), '2026-10-11').owner?.name).toBe('VINEYARD CITY');
  });
});

// Loaded by path at run time: the module uses Worker types this test project does not compile.
const WORKER_MAP = '../worker/api/map';
const getParcelAt = async (url: URL) => ((await import(/* @vite-ignore */ WORKER_MAP)) as { getParcelAt: (u: URL) => Promise<Response> }).getParcelAt(url);

describe('parcel route owner privacy', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** A fetch that answers the card, city and owner queries, recording each request's options. */
  const stub = (type: string | null, owner: string) => {
    const calls: Array<{ url: string; init: RequestInit & { cf?: unknown } }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (u: string, init: RequestInit) => {
        calls.push({ url: u, init });
        const url = new URL(u);
        const fields = url.searchParams.get('outFields') ?? '';
        if (!u.includes('utahcounty')) return new Response(JSON.stringify(cityFC('7', type)));
        return new Response(JSON.stringify(fields.includes('OWNER_NAME') ? ownerFC('7', owner) : countyFC('7')));
      }),
    );
    return calls;
  };
  const tap = () => getParcelAt(new URL('https://x/api/map/parcel?lng=-111.74&lat=40.3'));

  it('shows an entity on non-residential land, and reads the owner with no upstream cache', async () => {
    const calls = stub('COMMERCIAL', 'DR HORTON INC');
    const res = await tap();
    const body = (await res.json()) as { owner?: { name: string; deedYear?: number } };
    expect(body.owner).toMatchObject({ name: 'DR HORTON INC', deedYear: 2021 });
    const ownerCall = calls.find((c) => (new URL(c.url).searchParams.get('outFields') ?? '').includes('OWNER_NAME'));
    expect(ownerCall?.init.cache).toBe('no-store');
    expect(ownerCall?.init.cf).toBeUndefined();
    // The cached card and city queries never ask for the owner.
    for (const c of calls.filter((x) => x !== ownerCall)) expect(c.url).not.toMatch(/OWNER_NAME|OWN_FULL_ADDRESS/);
  });

  it.each([
    ['COMMERCIAL', 'SMITH JOHN A'],
    ['COMMERCIAL', 'SMITH FAMILY TRUST'],
    ['COMMERCIAL', 'JOHN SMITH LLC'],
    ['RESIDENTIAL', 'GENEVA HOLDINGS LLC'],
    ['CONDO', 'EDGE HOMES'],
    [null, 'GENEVA HOLDINGS LLC'],
  ])('never sends a withheld owner (%s, %s)', async (type, owner) => {
    stub(type, owner);
    const res = await tap();
    const text = await res.text();
    expect(text).not.toContain(owner);
    expect(text).not.toMatch(/owner|OWNER|MAILING|LEAKED|VESTING|123456/i);
    expect(JSON.parse(text)).toMatchObject({ found: true });
  });

  it('a failed owner query leaves the card without an owner and logs nothing', async () => {
    const log = vi.spyOn(console, 'log');
    const err = vi.spyOn(console, 'error');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (u: string) => {
        const fields = new URL(u).searchParams.get('outFields') ?? '';
        if (fields.includes('OWNER_NAME')) return new Response('SMITH JOHN A not json', { status: 200 });
        return new Response(JSON.stringify(u.includes('utahcounty') ? countyFC('7') : cityFC('7', 'COMMERCIAL')));
      }),
    );
    const text = await (await tap()).text();
    expect(text).not.toMatch(/SMITH|owner/i);
    expect(log).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
    log.mockRestore();
    err.mockRestore();
  });
});

describe('owner filter diagnostics (scripts/owner-filter)', () => {
  it('counts with the same classifier and samples shown names only', () => {
    const rows = [
      ...Array.from({ length: 40 }, (_, i) => ({ owner: `GENEVA HOLDINGS ${i} LLC`, propType: 'COMMERCIAL' })),
      { owner: 'SMITH JOHN A', propType: 'COMMERCIAL' },
      { owner: 'SMITH FAMILY TRUST', propType: 'COMMERCIAL' },
      { owner: 'EDGE HOMES', propType: 'RESIDENTIAL' },
      { owner: 'VINEYARD CITY', propType: 'RESIDENTIAL' },
      { owner: 'GENEVA HOLDINGS LLC', propType: undefined },
    ];
    const s = summarize(rows, () => 0.5);
    // Parity: the same decisions as the Worker's ownerDecision.
    const shownByWorker = rows.filter((r) => ownerDecision(r).show).length;
    expect(s).toMatchObject({ total: 45, shown: shownByWorker, withheld: 45 - shownByWorker });
    expect(s.shown).toBe(41);
    expect(s.withheldByReason).toEqual({ 'no-entity-word': 1, 'trust-or-estate': 1, residential: 1, 'type-unknown': 1 });
    expect(s.sample).toHaveLength(SAMPLE);
    expect(new Set(s.sample.map((x) => x.name)).size).toBe(SAMPLE);
    expect(JSON.stringify(s)).not.toMatch(/SMITH|EDGE HOMES|"GENEVA HOLDINGS LLC"/);
    for (const x of s.sample) expect(ownerDecision({ owner: x.name, propType: x.propertyType })).toMatchObject({ show: true });
  });

  it('keeps county parcels by centroid inside the city boundary', () => {
    const city = polygonsOf({ type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]] });
    expect(centroid({ type: 'Polygon', coordinates: [[[1, 1], [3, 1], [3, 3], [1, 3], [1, 1]]] })).toEqual([2, 2]);
    expect(inPolygons([2, 2], city)).toBe(true);
    expect(inPolygons([5, 5], city)).toBe(false);
    expect(inPolygons([12, 2], city)).toBe(false);
    expect(bboxOf(city)).toEqual([0, 0, 10, 10]);
    const u = new URL(countyPageUrl(1));
    expect(u.searchParams.get('outFields')).toBe('PARCEL_NO,OWNER_NAME,SUB_NAME,SITE_FULL_ADDRESS,ACREAGE');
    expect(u.searchParams.get('resultOffset')).toBe('2000');
  });
});

describe('shown names are tidy', () => {
  it('drops stray punctuation at the ends of a county name', async () => {
    const { classifyOwner } = await import('../worker/lib/ownerFilter');
    const r = classifyOwner("TOWN OF VINEYARD'");
    expect(r.show && r.name).toBe('TOWN OF VINEYARD');
  });
});

describe('tax-exempt land: an institutional word stands in for a legal form', () => {
  it('shows a charter school or an HOA on exempt land, never a person', async () => {
    const { ownerDecision } = await import('../worker/lib/ownerFilter');
    const ex = (owner: string) => ownerDecision({ owner, propType: 'EXEMPT' });
    expect(ex('FRANKLIN DISCOVERY ACADEMY')).toMatchObject({ show: true });
    expect(ex('WATERS EDGE MASTER ASSN')).toMatchObject({ show: true });
    expect(ex('SMITH JOHN A')).toMatchObject({ show: false });
    expect(ex('SMITH FAMILY TRUST')).toMatchObject({ show: false });
    expect(ex('JOHN SMITH ACADEMY TRUST')).toMatchObject({ show: false });
    expect(ex('JOHN AND MARY SMITH')).toMatchObject({ show: false });
    expect(ex('JOHN SMITH')).toMatchObject({ show: false });
    // Not exempt: the old rule (a legal form or listed entity word) still applies.
    expect(ownerDecision({ owner: 'FRANKLIN DISCOVERY ACADEMY', propType: 'VACANT' })).toMatchObject({ show: false, reason: 'no-entity-word' });
  });
});
