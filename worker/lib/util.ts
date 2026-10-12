/** Small shared helpers: time, ids, parsing, query parameters. */

export const nowIso = (): string => new Date().toISOString();
export const utcDay = (): string => new Date().toISOString().slice(0, 10);

export function parseJsonArray<T = string>(value: unknown): T[] {
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function parseJsonObject<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function clampInt(value: string | null, fallback: number, min: number, max: number): number {
  if (value === null || value.trim() === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/** A real calendar day written YYYY-MM-DD (February 30 is not one). */
export const isIsoDate = (s: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
};

/** Identifiers accepted in path segments. Anything else is rejected before it reaches SQL. */
export const isSafeId = (s: string): boolean => /^[A-Za-z0-9_.:-]{1,128}$/.test(s);

export function randomId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `${prefix}_${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export function toBool(v: unknown): boolean | null {
  if (v === null || v === undefined) return null;
  return Number(v) === 1;
}

export function chunked<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
