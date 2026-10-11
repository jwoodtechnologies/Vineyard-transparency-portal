import { describe, expect, it } from 'vitest';
import { MAP_LAYERS, UDOT_KEYWORDS, UDOT_WHERE } from '../worker/lib/mapLayers';
import { toSource } from '../worker/lib/mappers';
import { normalizeType, categoriesForType } from '../worker/lib/taxonomy';
import { MAP_ONLY, sourceRows } from '../src/console/sources';
import type { SourceRegistryEntry } from '../src/types/models';

// Loaded by path at run time: the module uses Worker types this test project does not compile.
const WORKER_MAP = '../worker/api/map';
type MapRoutes = { upstreamUrl: (layer: unknown, page: number) => string };

describe('sources registry', () => {
  it('maps the newest record time per source', () => {
    const s = toSource({ id: 'utah-county-tax-rates', name: 'Utah County tax rates', base_url: 'https://www.utahcounty.gov/', source_type: 'financial_transparency', authority: 'Utah County Treasurer', crawl_enabled: 1, archive_enabled: 0, document_discovery_enabled: 1, status: 'active', last_checked_at: '2026-10-11T09:20:00Z', last_success_at: '2026-10-11T09:20:00Z', document_count: 3, last_new_record_at: '2026-10-11T09:20:01Z' });
    expect(s.lastNewRecordAt).toBe('2026-10-11T09:20:01Z');
    expect(s.health?.status).toBe('active');
    expect(s.documentCount).toBe(3);
  });

  it('lists outside systems after their first successful run, newest record first, and leaves out portal entries', () => {
    const base = { baseUrl: 'https://x', sourceType: 'other', authority: 'A', discoveredFrom: null, archiveEnabled: false, documentDiscoveryEnabled: false, lastChecked: null, notes: '' } as const;
    const ok = (at: string) => ({ status: 'active', lastCheckedAt: at, lastSuccessfulCheckAt: at });
    const rows = sourceRows([
      { ...base, id: 'udot-projects', name: 'UDOT projects', crawlEnabled: true, health: ok('2026-10-11T09:00:00Z'), lastNewRecordAt: '2026-10-11T09:00:00Z' },
      { ...base, id: 'utah-auditor-reports', name: 'State Auditor', crawlEnabled: true },
      { ...base, id: 'resident-submitted', name: 'Residents', crawlEnabled: false, documentCount: 4 },
      { ...base, id: 'old', name: 'Old source', crawlEnabled: false, documentCount: 0 },
      { ...base, id: 'utah-county-parcels', name: 'Utah County parcels', crawlEnabled: true, health: ok('2026-10-11T08:00:00Z') },
      { ...base, id: 'utah-pmn-vineyard', name: 'Public notices', crawlEnabled: true, health: ok('2026-10-11T09:30:00Z'), lastNewRecordAt: '2026-10-11T09:30:00Z' },
    ] as SourceRegistryEntry[]);
    expect(rows.map((r) => r.id)).toEqual(['utah-pmn-vineyard', 'udot-projects', 'utah-county-parcels']);
    expect(MAP_ONLY.has('utah-county-parcels')).toBe(true);
  });

  it('knows the tax rate and election result record types', () => {
    expect(normalizeType('tax_rate')).toBe('tax_rate');
    expect(categoriesForType('tax_rate')).toContain('budgets_finance');
    expect(normalizeType('election_result')).toBe('election_result');
  });
});

describe('UDOT map layer', () => {
  const udot = MAP_LAYERS.find((l) => l.key === 'udot');
  it('serves public project fields only, from UDOT open data, around Vineyard', async () => {
    expect(udot).toBeDefined();
    expect(udot?.fields.some((f) => /pub_ctc|email|phone|_nm$/.test(f) && f !== 'pin_stat_nm')).toBe(false);
    const { upstreamUrl } = (await import(/* @vite-ignore */ WORKER_MAP)) as MapRoutes;
    const url = new URL(upstreamUrl(udot, 0));
    expect(url.origin + url.pathname).toBe('https://services.arcgis.com/pA2nEVnB6tquxgOW/arcgis/rest/services/Projects_as_Lines/FeatureServer/0/query');
    expect(url.searchParams.get('geometryType')).toBe('esriGeometryEnvelope');
    expect(url.searchParams.get('geometry')).toBe('-111.8,40.26,-111.69,40.345');
    expect(url.searchParams.get('outFields')).toBe('pin,pin_desc,pin_stat_nm,proj_loc,public_desc,planned_construction_year');
    expect(url.searchParams.get('where')).toBe(UDOT_WHERE);
  });
  it('leaves abandoned and finished projects off the map', () => {
    expect(UDOT_WHERE).toContain("pin_stat_nm NOT IN ('Abandoned', 'Closed', 'Close Out')");
    for (const k of UDOT_KEYWORDS) expect(UDOT_WHERE).toContain(`UPPER(pin_desc) LIKE '%${k}%'`);
  });
});
