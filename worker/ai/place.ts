/**
 * Parcel and place questions ("who owns the parcel at Vineyard Connector and Main Street", "what
 * is the zoning at 125 S Main St", "where is Grove Park") are answered with a card that opens the
 * portal map centered on that spot, not with document text.
 *
 * The spot comes only from the city's own GIS layers (the same allowlisted layers /map uses): two
 * named roads are looked up on the roads layer and the point where they meet is computed here; a
 * park or school from its layer; an address from the parcel layer's site address. The lookup layers
 * have no owner fields, so an answer never names an owner, for any parcel: the same sentence for every
 * owner question, which neither names nor hints at who owns a home. The map's parcel card shows an
 * entity owner (company, church, government, HOA) only when lib/ownerFilter.ts allows it.
 */
import { layerQueryUrl } from '../lib/mapLayers';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
type Pt = [number, number]; // [lng, lat]
type Line = Pt[];

export interface PlaceIntent {
  kind: 'intersection' | 'address' | 'place' | 'none';
  /** Asks who owns it. */
  owner: boolean;
  /** Asks about zoning. */
  zoning: boolean;
  /** Asks about a parcel, lot or property. */
  parcel: boolean;
  /** A "where is X" question. */
  where: boolean;
  streets?: [string, string];
  address?: string;
  place?: string;
}

const SUFFIX = 'street|st|road|rd|drive|dr|lane|ln|way|avenue|ave|boulevard|blvd|parkway|pkwy|connector|circle|cir|court|ct|loop|highway|hwy|trail|place|pl';
const DIR = 'north|south|east|west|n|s|e|w';
const OWNER = /\b(own|owns|owner|owners|ownership|owned|belongs? to)\b/i;
const ZONING = /\bzon(e|ed|es|ing)\b/i;
const PARCEL = /\b(parcels?|lots?|property|properties|land|acreage|plat)\b/i;
const WHERE = /^\s*where(?:'s|\s+is|\s+are)\s+(?:the\s+)?(.+?)\s*\??\s*$/i;
/** "Where is the next meeting", "where is the agenda": not places on the map. */
const NOT_PLACE = /\b(meeting|meetings|agenda|minutes|hearing|session|vote|budget|money|report|form|application|document|record|file|link|page|office hours|election|ballot)\b/i;

const clean = (s: string) =>
  s
    .replace(/^\s*(the|a)\s+/i, '')
    .replace(/\s+(in|of)\s+vineyard(,?\s*utah)?\s*$/i, '')
    .replace(/[?.!,;:]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const streetLike = (s: string) => new RegExp(`\\b(${SUFFIX})\\.?$`, 'i').test(s) || new RegExp(`^\\d{2,5}\\s+(${DIR})\\.?$`, 'i').test(s);
const shortName = (s: string) => s.split(/\s+/).length <= 4 && /^[A-Za-z0-9][A-Za-z0-9 .'-]*$/.test(s);

/** The two streets of "the corner of A and B", "the intersection of A and B", "at A and B", "A & B". */
export function streetsIn(q: string): [string, string] | null {
  const tries = [
    /\b(?:corner|intersection|crossing)\s+of\s+(.+?)\s+(?:and|&|with)\s+(.+?)(?=[?.!,;]|\s+in\s+vineyard\b|$)/i,
    /\b(?:at|near|on|by)\s+(?:the\s+)?(.+?)\s+(?:and|&)\s+(.+?)(?=[?.!,;]|\s+in\s+vineyard\b|$)/i,
    /^(.+?)\s+(?:and|&)\s+(.+?)(?=[?.!,;]|$)/i,
  ];
  for (const [i, re] of tries.entries()) {
    const m = q.match(re);
    if (!m) continue;
    const a = clean(m[1].replace(/^.*\b(?:at|near|on|of)\s+/i, ''));
    const b = clean(m[2]);
    if (!shortName(a) || !shortName(b)) continue;
    // "the corner of" names streets; "at A and B" must look like streets on at least one side.
    if (i === 0 ? true : streetLike(a) || streetLike(b)) {
      if (i === 2 && !(streetLike(a) && streetLike(b))) continue;
      return [a, b];
    }
  }
  return null;
}

/** A street address: house number, direction, then a numbered or named street ("125 S Main St", "1234 N 600 W"). */
export function addressIn(q: string): string | null {
  const m = q.match(new RegExp(`\\b(\\d{1,5}\\s+(?:${DIR})\\.?\\s+(?:\\d{1,5}\\s+(?:${DIR})\\b\\.?|[A-Za-z]+(?:\\s+[A-Za-z]+){0,2}\\s+(?:${SUFFIX})\\b\\.?))`, 'i'));
  return m ? m[1].replace(/\s+/g, ' ').replace(/\.$/, '').trim() : null;
}

/** What a parcel, zoning or "where is" question asks about, or null when it is not one. */
export function placeIntent(q: string): PlaceIntent | null {
  const owner = OWNER.test(q);
  const zoning = ZONING.test(q);
  const parcel = PARCEL.test(q);
  const whereM = q.match(WHERE);
  const where = Boolean(whereM) && !NOT_PLACE.test(q) && !/^\s*where\s+(do|can|should|would|will)\b/i.test(q);
  const streets = streetsIn(q);
  const address = addressIn(q);
  const landish = owner || zoning || parcel;
  if (streets && (landish || where || /\b(intersection|corner)\b/i.test(q))) return { kind: 'intersection', owner, zoning, parcel, where, streets };
  if (address && (landish || where)) return { kind: 'address', owner, zoning, parcel, where, address };
  if (where && whereM) {
    const place = clean(whereM[1]);
    if (place.length >= 3 && place.split(/\s+/).length <= 6) return { kind: 'place', owner, zoning, parcel, where, place };
  }
  // "Who owns the parcel at the Forge?": a land question about a spot, even one that cannot be found.
  // Questions about decisions or rules ("zoning changes approved on 10/2") are records questions.
  if ((owner || zoning) && (parcel || /\b(at|on|near)\s+[A-Z0-9]/.test(q)) && !/\b(vote[sd]?|approv\w*|decid\w*|meetings?|ordinances?|resolutions?|changes?|rezon\w*|amend\w*|code|rules?|allowed|permitted|tax\w*)\b/i.test(q)) {
    const at = q.match(/\b(?:at|on|near)\s+(?:the\s+)?(.+?)(?=[?.!,;]|$)/i);
    return { kind: at ? 'place' : 'none', owner, zoning, parcel, where, ...(at ? { place: clean(at[1]) } : {}) };
  }
  return null;
}

/* ----------------------------------------------------------------------------------------------- */
/* Road names and geometry                                                                          */
/* ----------------------------------------------------------------------------------------------- */

const ABBR: Record<string, string> = { STREET: 'ST', ROAD: 'RD', DRIVE: 'DR', LANE: 'LN', AVENUE: 'AVE', BOULEVARD: 'BLVD', PARKWAY: 'PKWY', CIRCLE: 'CIR', COURT: 'CT', HIGHWAY: 'HWY', PLACE: 'PL', NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W' };

/** A road name in the roads layer's own form ("Main Street" is "MAIN ST", "400 North" is "400 N"). */
export function roadKey(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => ABBR[w] ?? w)
    .join(' ');
}

/** The roads layer name without a leading direction ("N MAIN ST" is "MAIN ST"). */
const core = (fullName: string) => roadKey(fullName).replace(/^[NSEW] (?=\D)/, '');

/** True when a layer road name is the road asked for. */
export function sameRoad(fullName: string, asked: string): boolean {
  const k = roadKey(asked);
  const c = core(fullName);
  if (!k) return false;
  if (c === k || roadKey(fullName) === k) return true;
  // "Vineyard Connector" asked, "VINEYARD CONNECTOR" stored with no suffix change; "Main" asked for "MAIN ST".
  return !/\b(ST|RD|DR|LN|AVE|BLVD|PKWY|CIR|CT|HWY|PL|CONNECTOR|WAY|LOOP|TRAIL)$/.test(k) && new RegExp(`^${k} [A-Z]+$`).test(c);
}

type Geo = { type: string; coordinates: unknown } | null | undefined;

function linesOf(g: Geo): Line[] {
  if (!g) return [];
  if (g.type === 'LineString') return [g.coordinates as Line];
  if (g.type === 'MultiLineString') return g.coordinates as Line[];
  return [];
}

function pointsOf(g: Geo): Pt[] {
  if (!g) return [];
  const c = g.coordinates as unknown;
  if (g.type === 'Point') return [c as Pt];
  if (g.type === 'MultiPoint' || g.type === 'LineString') return c as Pt[];
  if (g.type === 'Polygon' || g.type === 'MultiLineString') return (c as Pt[][]).flat();
  if (g.type === 'MultiPolygon') return (c as Pt[][][]).flat(2);
  return [];
}

/** The center of a shape's bounding box. */
export function centerOf(g: Geo): Pt | null {
  const pts = pointsOf(g).filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

/** Local flat projection in meters around a latitude (accurate to well under a meter across a city). */
const M_PER_DEG = 111_320;
const toXY = (p: Pt, k: number): [number, number] => [p[0] * M_PER_DEG * k, p[1] * M_PER_DEG];
const toPt = (x: number, y: number, k: number): Pt => [x / (M_PER_DEG * k), y / M_PER_DEG];

function segHit(a: Pt, b: Pt, c: Pt, d: Pt, k: number): Pt | null {
  const [ax, ay] = toXY(a, k);
  const [bx, by] = toXY(b, k);
  const [cx, cy] = toXY(c, k);
  const [dx, dy] = toXY(d, k);
  const den = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
  if (Math.abs(den) < 1e-9) return null;
  const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / den;
  const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / den;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return toPt(ax + t * (bx - ax), ay + t * (by - ay), k);
}

function nearestOnSeg(p: Pt, a: Pt, b: Pt, k: number): { q: Pt; d: number } {
  const [px, py] = toXY(p, k);
  const [ax, ay] = toXY(a, k);
  const [bx, by] = toXY(b, k);
  const vx = bx - ax;
  const vy = by - ay;
  const len = vx * vx + vy * vy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len)) : 0;
  const qx = ax + t * vx;
  const qy = ay + t * vy;
  return { q: toPt(qx, qy, k), d: Math.hypot(px - qx, py - qy) };
}

/**
 * Where two roads meet: the crossing point of their center lines, or, when the lines stop just short
 * of each other (a T junction drawn with a gap), the midpoint of their closest approach within
 * `maxGapM` meters. Null when they do not meet.
 */
export function meetingPoint(a: Line[], b: Line[], maxGapM = 60): { point: Pt; exact: boolean } | null {
  const all = [...a.flat(), ...b.flat()];
  if (!a.length || !b.length || !all.length) return null;
  const k = Math.cos(((all.reduce((s, p) => s + p[1], 0) / all.length) * Math.PI) / 180);
  const hits: Pt[] = [];
  for (const la of a) for (let i = 1; i < la.length; i++) for (const lb of b) for (let j = 1; j < lb.length; j++) {
    const h = segHit(la[i - 1], la[i], lb[j - 1], lb[j], k);
    if (h) hits.push(h);
  }
  if (hits.length) {
    // Two roads can cross more than once (a loop): the first crossing, with any duplicates at the same spot merged.
    const first = hits[0];
    const near = hits.filter((h) => Math.hypot(...toXY([h[0] - first[0], h[1] - first[1]] as Pt, k)) < 25);
    const lng = near.reduce((s, h) => s + h[0], 0) / near.length;
    const lat = near.reduce((s, h) => s + h[1], 0) / near.length;
    return { point: [lng, lat], exact: true };
  }
  let best: { p: Pt; q: Pt; d: number } | null = null;
  const scan = (from: Line[], to: Line[]) => {
    for (const lf of from) for (const p of lf) for (const lt of to) for (let j = 1; j < lt.length; j++) {
      const n = nearestOnSeg(p, lt[j - 1], lt[j], k);
      if (!best || n.d < best.d) best = { p, q: n.q, d: n.d };
    }
  };
  scan(a, b);
  scan(b, a);
  const found = best as { p: Pt; q: Pt; d: number } | null;
  if (!found || found.d > maxGapM) return null;
  return { point: [(found.p[0] + found.q[0]) / 2, (found.p[1] + found.q[1]) / 2], exact: false };
}

/* ----------------------------------------------------------------------------------------------- */
/* Lookups on the city's layers                                                                     */
/* ----------------------------------------------------------------------------------------------- */

type FC = { features?: Array<{ properties?: Record<string, unknown> | null; geometry?: Geo }>; error?: unknown };

const safe = (s: string) => s.toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

async function query(fetchFn: FetchLike, key: string, where: string, fields: string[]): Promise<FC['features']> {
  const url = layerQueryUrl(key, where, fields);
  if (!url) return [];
  const res = await fetchFn(url, { headers: { accept: 'application/geo+json, application/json', 'user-agent': 'VineyardTransparencyPortal/1.0 (+https://vineyardportal.org)' }, cf: { cacheTtl: 43200, cacheEverything: true } } as RequestInit);
  if (!res.ok) throw new Error(`map layer ${key}: ${res.status}`);
  const j = (await res.json()) as FC;
  if (j.error || !Array.isArray(j.features)) throw new Error(`map layer ${key}: error`);
  return j.features;
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\b(N|S|E|W)\b/gi, (d) => d.toUpperCase());

/** A road's center lines from the roads layer, with the name the layer gives it. */
async function road(fetchFn: FetchLike, asked: string): Promise<{ name: string; lines: Line[] } | null> {
  const k = roadKey(asked);
  if (k.length < 2) return null;
  // The leading direction ("N MAIN ST") and the suffix vary in the layer, so the core words are searched.
  const words = safe(k.replace(/^[NSEW] (?=\D)/, '')).replace(/ (ST|RD|DR|LN|AVE|BLVD|PKWY|CIR|CT|HWY|PL)$/, '');
  if (words.length < 2) return null;
  const feats = (await query(fetchFn, 'roads', `UPPER(FULLNAME) LIKE '%${words}%'`, ['FULLNAME'])) ?? [];
  const match = feats.filter((f) => sameRoad(String(f.properties?.FULLNAME ?? ''), asked));
  if (!match.length) return null;
  return { name: titleCase(core(String(match[0].properties?.FULLNAME ?? asked))), lines: match.flatMap((f) => linesOf(f.geometry)) };
}

export interface ResolvedPlace {
  lat: number;
  lng: number;
  /** The name the city's layer gives the spot. */
  label: string;
  /** Which layer it came from. */
  layer: 'roads' | 'parks' | 'schools' | 'parcels';
  /** A whole road rather than one spot: the map frames it ("road:400 N"). */
  focus?: string;
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

/** Where the question's spot is, from the city's layers; null when it cannot be found. */
export async function resolvePlace(intent: PlaceIntent, fetchFn: FetchLike = fetch): Promise<ResolvedPlace | null> {
  if (intent.kind === 'intersection' && intent.streets) {
    const [a, b] = await Promise.all(intent.streets.map((s) => road(fetchFn, s)));
    if (!a || !b) return null;
    const m = meetingPoint(a.lines, b.lines);
    if (!m) return null;
    return { lng: round(m.point[0]), lat: round(m.point[1]), label: `${a.name} and ${b.name}`, layer: 'roads' };
  }
  if (intent.kind === 'address' && intent.address) {
    const addr = roadKey(intent.address);
    const num = addr.split(' ')[0];
    const street = addr.replace(/ (ST|RD|DR|LN|AVE|BLVD|PKWY|CIR|CT|HWY|PL)$/, '');
    const feats = (await query(fetchFn, 'parcels', `UPPER(SITE_FULL_ADDRESS) LIKE '${safe(street)}%'`, ['SITE_FULL_ADDRESS'])) ?? [];
    const f = feats.find((x) => roadKey(String(x.properties?.SITE_FULL_ADDRESS ?? '')).startsWith(`${num} `));
    const c = f ? centerOf(f.geometry) : null;
    if (!f || !c) return null;
    return { lng: round(c[0]), lat: round(c[1]), label: titleCase(String(f.properties?.SITE_FULL_ADDRESS ?? intent.address)), layer: 'parcels' };
  }
  if (intent.kind === 'place' && intent.place && streetLike(intent.place)) {
    const r = await road(fetchFn, intent.place);
    const c = r ? centerOf({ type: 'MultiLineString', coordinates: r.lines }) : null;
    return r && c ? { lng: round(c[0]), lat: round(c[1]), label: r.name, layer: 'roads', focus: `road:${r.name}` } : null;
  }
  if (intent.kind === 'place' && intent.place) {
    const name = safe(intent.place.replace(/\b(park|school|elementary|the)\b/gi, ' '));
    if (name.length < 3) return null;
    const isSchool = /\b(school|elementary|junior|high|academy)\b/i.test(intent.place);
    const order: Array<['parks' | 'schools', string]> = isSchool ? [['schools', 'Name'], ['parks', 'NAME']] : [['parks', 'NAME'], ['schools', 'Name']];
    for (const [key, field] of order) {
      const feats = (await query(fetchFn, key, `UPPER(${field}) LIKE '%${name}%'`, [field])) ?? [];
      const f = feats[0];
      const c = f ? centerOf(f.geometry) : null;
      if (f && c) return { lng: round(c[0]), lat: round(c[1]), label: String(f.properties?.[field] ?? intent.place), layer: key };
    }
  }
  return null;
}

/** The portal map link: centered on the spot, zoomed in, with the layers that answer the question. */
export function mapHref(p: ResolvedPlace | null, intent: PlaceIntent): string {
  const layers = [...(intent.zoning ? ['zoning'] : []), ...(intent.owner || intent.parcel || intent.zoning || intent.kind !== 'place' ? ['parcels'] : []), ...(p && p.layer !== 'roads' && p.layer !== 'parcels' ? [p.layer] : [])];
  const q = new URLSearchParams();
  if (p?.focus) q.set('focus', p.focus);
  else if (p) {
    q.set('lat', String(p.lat));
    q.set('lng', String(p.lng));
    q.set('z', '17');
    q.set('label', p.label);
  }
  if (layers.length) q.set('layers', layers.join(','));
  const s = q.toString();
  return s ? `/map?${s}` : '/map';
}

export interface PlaceAnswer {
  text: string;
  map: { href: string; label: string; hint: string };
}

/**
 * The one owner sentence, the same for every parcel: the chat never names an owner and never says
 * whether a particular parcel's owner is shown (that would hint that a home's owner is a person).
 */
export const OWNER_NOTE = 'The portal does not show owners of homes or individuals. For land held by a company, church or government, tap the parcel on the map to see the owner from the Utah County parcel records.';

/** The answer: where the map is centered and what it shows, and never an owner. */
export function placeAnswer(intent: PlaceIntent, p: ResolvedPlace | null): PlaceAnswer {
  const parts: string[] = [];
  const shows = intent.zoning ? 'zoning and parcel outlines' : intent.owner || intent.parcel || intent.kind !== 'place' ? 'parcel outlines' : '';
  if (p) {
    if (p.focus) parts.push(`The map below shows ${p.label}${shows ? `, with ${shows} shown` : ''}.`);
    else if (p.layer === 'roads') parts.push(`The map below is centered where ${p.label} meet${shows ? `, with ${shows} shown` : ''}.`);
    else if (p.layer === 'parcels') parts.push(`The map below is centered on the parcel at ${p.label}${shows ? `, with ${shows} shown` : ''}.`);
    else parts.push(`${p.label} is shown on the map below${shows ? `, with ${shows}` : ''}.`);
    if (intent.zoning) parts.push(`Tap ${p.focus ? 'a spot' : 'the spot'} on the map to see its zoning district.`);
  } else {
    parts.push(`That location could not be found on the city's map layers. The portal map below shows ${shows || 'the city layers'}.`);
  }
  if (intent.owner) parts.push(OWNER_NOTE);
  return { text: parts.join(' '), map: { href: mapHref(p, intent), label: p ? p.label : 'Open the city map', hint: p ? 'Open on map' : 'Portal map' } };
}
