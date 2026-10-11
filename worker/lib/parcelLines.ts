/**
 * The prebuilt parcel line sets /map draws from zoom 12 to 15 (ingest/parcel_lines.py builds them
 * weekly from Utah County's parcel polygons). Geometry only: no parcel numbers, no owner data, no
 * strings at all besides the format, level, version and build date. Pure, so tests can use it.
 *
 * Kept in R2 under map/ (outside the archive's stored_bytes accounting), gzipped.
 */

export const PARCEL_LINE_LEVELS = ['low', 'mid'] as const;
export type ParcelLineLevel = (typeof PARCEL_LINE_LEVELS)[number];
export const PARCEL_LINES_FORMAT = 'vtp-parcel-lines/1';
/** Largest upload accepted (the whole city is about 0.3 MB per level). */
export const PARCEL_LINES_MAX_BYTES = 4 * 1024 * 1024;
const MAX_INTS = 1_500_000;

export const isParcelLineLevel = (v: unknown): v is ParcelLineLevel => typeof v === 'string' && (PARCEL_LINE_LEVELS as readonly string[]).includes(v);
export const parcelLinesKey = (level: ParcelLineLevel) => `map/parcel-lines-${level}.json.gz`;

export interface ParcelLineSet {
  format: typeof PARCEL_LINES_FORMAT;
  level: ParcelLineLevel;
  version: string;
  built: string;
  scale: number;
  origin: [number, number];
  area: [number, number, number, number];
  count: number;
  /** Each line: first point (relative to origin) then deltas, in 1/scale degrees. */
  lines: number[][];
}

const KEYS = ['format', 'level', 'version', 'built', 'scale', 'origin', 'area', 'count', 'lines'];
const int = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && Math.abs(v) < 2 ** 31;

/** The line set rebuilt from an upload, field by field, or an error message. Nothing else gets through. */
export function checkParcelLines(body: unknown, level: ParcelLineLevel): ParcelLineSet | string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'Expected a JSON object.';
  const b = body as Record<string, unknown>;
  const extra = Object.keys(b).filter((k) => !KEYS.includes(k));
  if (extra.length) return `Unexpected fields: ${extra.slice(0, 5).join(', ')}.`;
  if (b.format !== PARCEL_LINES_FORMAT) return 'Unknown format.';
  if (b.level !== level) return 'Level does not match the address.';
  if (typeof b.version !== 'string' || !/^[0-9a-f]{16}$/.test(b.version)) return 'Bad version.';
  if (typeof b.built !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.built)) return 'Bad build date.';
  if (b.scale !== 100000 && b.scale !== 1000000) return 'Bad scale.';
  if (!Array.isArray(b.origin) || b.origin.length !== 2 || !b.origin.every(int)) return 'Bad origin.';
  if (!Array.isArray(b.area) || b.area.length !== 4 || !b.area.every((v) => typeof v === 'number' && Number.isFinite(v))) return 'Bad area.';
  const [w, s, e, n] = b.area as number[];
  // Vineyard and its surroundings only.
  if (!(w >= -112.0 && e <= -111.5 && s >= 40.1 && n <= 40.5 && w < e && s < n)) return 'Area is not Vineyard.';
  if (!Array.isArray(b.lines) || !b.lines.length) return 'No lines.';
  let ints = 0;
  for (const l of b.lines) {
    if (!Array.isArray(l) || l.length < 4 || l.length % 2 || !l.every(int)) return 'Each line must be an even list of at least 4 integers.';
    ints += l.length;
    if (ints > MAX_INTS) return 'Too many points.';
  }
  if (b.count !== b.lines.length) return 'Count does not match.';
  return {
    format: PARCEL_LINES_FORMAT,
    level,
    version: b.version,
    built: b.built,
    scale: b.scale,
    origin: [b.origin[0], b.origin[1]] as [number, number],
    area: [w, s, e, n],
    count: b.lines.length,
    lines: b.lines as number[][],
  };
}
