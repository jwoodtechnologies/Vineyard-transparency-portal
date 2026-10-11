/** Types for lib.mjs (owner filter diagnostics), so tests import it under strict TypeScript. */

export interface OwnerRow {
  owner: unknown;
  propType?: unknown;
  subName?: unknown;
}

export interface OwnerSummary {
  total: number;
  shown: number;
  withheld: number;
  withheldByReason: Record<string, number>;
  sample: Array<{ name: string; propertyType: string }>;
}

type Ring = number[][];
type Polygons = Ring[][];

export const COUNTY_LAYER: string;
export const CITY_PARCELS: string;
export const CITY_BOUNDARY: string;
export const AREA: [number, number, number, number];
export const PAGE: number;
export const SAMPLE: number;
export function countyPageUrl(page: number, box?: number[]): string;
export function cityPageUrl(page: number): string;
export function boundaryUrl(): string;
export function polygonsOf(geometry: unknown): Polygons;
export function inPolygons(pt: number[], polygons: Polygons): boolean;
export function centroid(geometry: unknown): [number, number] | null;
export function bboxOf(polygons: Polygons): [number, number, number, number] | null;
export function summarize(rows: OwnerRow[], rand?: () => number): OwnerSummary;
