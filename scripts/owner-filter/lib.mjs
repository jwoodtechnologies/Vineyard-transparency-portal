/**
 * Owner filter diagnostics (pure parts): which Vineyard parcels would show an owner on the map card.
 *
 * Uses the Worker's own classifier (worker/lib/ownerFilter.ts, imported as is: Node 24 strips the
 * types), so the counts are exactly what the parcel card would do. The summary holds counts by
 * reason and a random sample of SHOWN names only; a withheld name is never put in it.
 */
import { ownerDecision } from '../../worker/lib/ownerFilter.ts';

export const COUNTY_LAYER = 'https://maps200.utahcounty.gov/arcgis/rest/services/Parcels/Parcel_TaxParcelPUMA/MapServer/2/query';
export const CITY_PARCELS = 'https://services.arcgis.com/QdlehUncXjEmQYtI/arcgis/rest/services/VNY_CA_Parcels_2025/FeatureServer/446/query';
export const CITY_BOUNDARY = 'https://services.arcgis.com/QdlehUncXjEmQYtI/arcgis/rest/services/Vineyard_City_Boundary/FeatureServer/0/query';
/** Vineyard's city limits with a margin (as ingest/parcel_lines.py AREA), if the boundary cannot be read. */
export const AREA = [-111.775, 40.276, -111.731, 40.335];
export const PAGE = 2000;
export const SAMPLE = 30;

/** One page of county parcels in a box: number, owner, subdivision name and shape (no mailing address). */
export function countyPageUrl(page, box = AREA) {
  const q = new URLSearchParams({
    geometry: box.map((v) => v.toFixed(6)).join(','),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    where: '1=1',
    outFields: 'PARCEL_NO,OWNER_NAME,SUB_NAME',
    returnGeometry: 'true',
    outSR: '4326',
    geometryPrecision: '6',
    orderByFields: 'OBJECTID',
    resultOffset: String(page * PAGE),
    resultRecordCount: String(PAGE),
    f: 'geojson',
  });
  return `${COUNTY_LAYER}?${q}`;
}

/** One page of the city's 2025 parcel layer: parcel number and property type only. */
export function cityPageUrl(page) {
  const q = new URLSearchParams({ where: '1=1', outFields: 'PARCEL_NO,PROP_TYPE_DESCR', returnGeometry: 'false', orderByFields: 'OBJECTID', resultOffset: String(page * PAGE), resultRecordCount: String(PAGE), f: 'json' });
  return `${CITY_PARCELS}?${q}`;
}

export function boundaryUrl() {
  return `${CITY_BOUNDARY}?${new URLSearchParams({ where: '1=1', outFields: 'NAME', returnGeometry: 'true', outSR: '4326', geometryPrecision: '6', f: 'geojson' })}`;
}

/** Outer and inner rings of a Polygon or MultiPolygon, as a list of polygons (each a list of rings). */
export function polygonsOf(geometry) {
  if (!geometry || typeof geometry !== 'object') return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates ?? []];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates ?? [];
  return [];
}

function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** True when a point is inside any of the polygons (holes respected). */
export function inPolygons(pt, polygons) {
  return polygons.some((rings) => rings.length > 0 && inRing(pt, rings[0]) && !rings.slice(1).some((h) => inRing(pt, h)));
}

/** The area-weighted centroid of a parcel's largest outer ring, or null. */
export function centroid(geometry) {
  let best = null;
  for (const rings of polygonsOf(geometry)) {
    const r = rings[0];
    if (!Array.isArray(r) || r.length < 4) continue;
    let a = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const f = r[j][0] * r[i][1] - r[i][0] * r[j][1];
      a += f;
      cx += (r[j][0] + r[i][0]) * f;
      cy += (r[j][1] + r[i][1]) * f;
    }
    if (!a) continue;
    const c = { area: Math.abs(a / 2), pt: [cx / (3 * a), cy / (3 * a)] };
    if (!best || c.area > best.area) best = c;
  }
  return best ? best.pt : null;
}

/** [west, south, east, north] around the polygons, or null. */
export function bboxOf(polygons) {
  const pts = polygons.flatMap((rings) => rings[0] ?? []);
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/**
 * The summary: counts, withheld counts by reason, and SAMPLE random shown names with their property
 * type. `rows` are { owner, propType, subName }; `rand` returns [0, 1).
 */
export function summarize(rows, rand = Math.random) {
  const withheldByReason = {};
  const shown = [];
  for (const r of rows) {
    const d = ownerDecision({ owner: r.owner, propType: r.propType, subName: r.subName });
    if (d.show) shown.push({ name: d.name, propertyType: typeof r.propType === 'string' && r.propType.trim() ? r.propType.trim() : 'unknown' });
    else withheldByReason[d.reason] = (withheldByReason[d.reason] ?? 0) + 1;
  }
  // Partial Fisher-Yates: SAMPLE distinct shown parcels.
  const pool = shown.slice();
  const n = Math.min(SAMPLE, pool.length);
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rand() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const sorted = Object.fromEntries(Object.entries(withheldByReason).sort((a, b) => b[1] - a[1]));
  return { total: rows.length, shown: shown.length, withheld: rows.length - shown.length, withheldByReason: sorted, sample: pool.slice(0, n) };
}
