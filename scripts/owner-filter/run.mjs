#!/usr/bin/env node
/**
 * Owner filter diagnostics (Node 24, no dependencies): pages through every Utah County parcel in
 * Vineyard (county layer 2, parcels whose centroid is inside the city boundary), joins the property
 * type from the city's 2025 parcel layer by parcel number (as the parcel card does), runs the Worker's
 * own owner filter (worker/lib/ownerFilter.ts) and writes ONLY:
 *
 *   total, shown, withheld, withheldByReason (counts, no names), and 30 random shown names with
 *   their property type.
 *
 * Withheld names are never printed or written: stdout carries counts only, and every error message is
 * a fixed text with a status code (never a response body or a parsed value).
 *
 *   node scripts/owner-filter/run.mjs --out diag/<run id>/owner-filter.json
 *
 * Run by .github/workflows/diagnostics.yml (task: owner-filter).
 */
import { writeFileSync } from 'node:fs';
import { AREA, PAGE, bboxOf, boundaryUrl, centroid, cityPageUrl, countyPageUrl, inPolygons, polygonsOf, summarize } from './lib.mjs';

const UA = 'VineyardTransparencyPortal/1.0 (+https://vineyardportal.org; owner filter diagnostics)';
const MAX_PAGES = 40;
const argOut = process.argv.indexOf('--out');
const out = argOut > 0 ? process.argv[argOut + 1] : 'owner-filter.json';

/** A fixed-text failure: never carries a response body. */
class SafeError extends Error {}

async function getJson(label, url) {
  let last = `${label}: request failed`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': UA }, signal: AbortSignal.timeout(120_000) });
      if (!res.ok) {
        last = `${label}: HTTP ${res.status}`;
        void res.body?.cancel();
      } else {
        let data = null;
        try {
          data = JSON.parse(await res.text());
        } catch {
          last = `${label}: response was not JSON`;
        }
        if (data && typeof data === 'object' && !data.error) return data;
        if (data) last = `${label}: service returned an error`;
      }
    } catch {
      last = `${label}: request failed`;
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
  throw new SafeError(last);
}

async function main() {
  // The city boundary (the county parcels are kept when their centroid is inside it).
  let polygons = [];
  try {
    const b = await getJson('city boundary', boundaryUrl());
    polygons = (b.features ?? []).flatMap((f) => polygonsOf(f.geometry));
  } catch {
    polygons = [];
  }
  const box = bboxOf(polygons) ?? AREA;
  const inside = (pt) => (polygons.length ? inPolygons(pt, polygons) : pt[0] >= AREA[0] && pt[0] <= AREA[2] && pt[1] >= AREA[1] && pt[1] <= AREA[3]);

  // Property type by parcel number, from the city's 2025 parcel layer.
  const types = new Map();
  for (let page = 0; page < MAX_PAGES; page++) {
    const d = await getJson(`city parcels page ${page}`, cityPageUrl(page));
    const feats = Array.isArray(d.features) ? d.features : [];
    for (const f of feats) {
      const a = f.attributes ?? f.properties ?? {};
      types.set(String(a.PARCEL_NO ?? '').trim(), a.PROP_TYPE_DESCR);
    }
    if (feats.length < PAGE && !d.exceededTransferLimit) break;
  }

  // Every county parcel in Vineyard, once per parcel number.
  const rows = new Map();
  for (let page = 0; page < MAX_PAGES; page++) {
    const d = await getJson(`county parcels page ${page}`, countyPageUrl(page, box));
    const feats = Array.isArray(d.features) ? d.features : [];
    for (const f of feats) {
      const p = f.properties ?? {};
      const no = String(p.PARCEL_NO ?? '').trim();
      const c = centroid(f.geometry);
      if (!no || !c || !inside(c) || rows.has(no)) continue;
      rows.set(no, { owner: p.OWNER_NAME, propType: types.get(no), subName: p.SUB_NAME });
    }
    const more = d.exceededTransferLimit || d.properties?.exceededTransferLimit;
    if (feats.length < PAGE && !more) break;
  }
  if (!rows.size) throw new SafeError('no Vineyard parcels were read');

  const s = summarize([...rows.values()]);
  writeFileSync(out, `${JSON.stringify({ generatedAt: new Date().toISOString(), ...s }, null, 2)}\n`);
  // Counts only on stdout.
  console.log(`total ${s.total}, shown ${s.shown}, withheld ${s.withheld}`);
  for (const [reason, n] of Object.entries(s.withheldByReason)) console.log(`  withheld ${reason}: ${n}`);
  console.log(`sample of ${s.sample.length} shown names written to ${out}`);
}

// Nothing unexpected is printed as is: an error or rejection becomes one fixed line.
const fail = (e) => {
  const msg = e instanceof SafeError ? e.message : 'unexpected error';
  console.error(`owner filter diagnostics failed: ${msg}`);
  try {
    writeFileSync(out, `${JSON.stringify({ generatedAt: new Date().toISOString(), error: msg }, null, 2)}\n`);
  } catch {
    /* nothing more to do */
  }
  process.exit(1);
};
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
main().catch(fail);
