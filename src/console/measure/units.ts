/** Units for the measure tool: how lengths, areas, bearings and travel times are written, and the choice kept per device. */

export type System = 'imperial' | 'metric';
export type AreaUnit = 'acres' | 'sqft' | 'sqmi' | 'ha';
export interface Units {
  system: System;
  area: AreaUnit;
}

export const DEFAULT_UNITS: Units = { system: 'imperial', area: 'acres' };
const KEY = 'vtp-measure-units';

const FT = 0.3048;
const MI = 1609.344;
const ACRE = 4046.8564224;
const SQFT = FT * FT;
const SQMI = MI * MI;
const HA = 10_000;

/** Walking at 3 miles an hour and biking at 12 miles an hour. */
export const WALK_MPS = (3 * MI) / 3600;
export const BIKE_MPS = (12 * MI) / 3600;

const n0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const fix = (v: number, d: number) =>
  new Intl.NumberFormat('en-US', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(v);

/** 412 ft, 1.24 mi; 126 m, 2.01 km. Short lengths in feet or meters, longer ones in miles or kilometers. */
export function fmtLength(m: number, system: System): string {
  if (system === 'metric') return m < 1000 ? `${m < 10 ? fix(m, 1) : n0.format(m)} m` : `${fix(m / 1000, 2)} km`;
  const ft = m / FT;
  return ft < 1000 ? `${ft < 10 ? fix(ft, 1) : n0.format(ft)} ft` : `${fix(m / MI, 2)} mi`;
}

/** A height: feet or meters, whole numbers. */
export function fmtHeight(m: number, system: System): string {
  return system === 'metric' ? `${n0.format(m)} m` : `${n0.format(m / FT)} ft`;
}

export const AREA_LABEL: Record<AreaUnit, string> = {
  acres: 'Acres',
  sqft: 'Square feet',
  sqmi: 'Square miles',
  ha: 'Hectares',
};

/** One area in one unit: 1.27 acres, 55,321 sq ft, 0.002 sq mi, 0.51 ha. */
export function fmtArea(m2: number, unit: AreaUnit): string {
  switch (unit) {
    case 'acres': {
      const v = m2 / ACRE;
      return `${fix(v, v < 10 ? 2 : 1)} ${v === 1 ? 'acre' : 'acres'}`;
    }
    case 'sqft':
      return `${n0.format(m2 / SQFT)} sq ft`;
    case 'sqmi': {
      const v = m2 / SQMI;
      return `${fix(v, v < 0.1 ? 4 : 2)} sq mi`;
    }
    case 'ha': {
      const v = m2 / HA;
      return `${fix(v, v < 10 ? 2 : 1)} ha`;
    }
  }
}

/** The area units the readout lists: the chosen one first, then the others. */
export function areaUnitsFor(u: Units): AreaUnit[] {
  const all: AreaUnit[] = u.system === 'metric' ? ['ha', 'acres', 'sqft', 'sqmi'] : ['acres', 'sqft', 'sqmi', 'ha'];
  return [u.area, ...all.filter((a) => a !== u.area)];
}

export const acresOf = (m2: number) => m2 / ACRE;

const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/** 47° NE: degrees clockwise from north and the nearest compass point. */
export function fmtBearing(deg: number): string {
  const d = Math.round(deg) % 360;
  return `${d}° ${POINTS[Math.round(deg / 22.5) % 16]}`;
}

/** 12 min, 1 hr 5 min; under a minute is "under 1 min". */
export function fmtDuration(seconds: number): string {
  const min = Math.round(seconds / 60);
  if (min < 1) return 'under 1 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r ? `${h} hr ${r} min` : `${h} hr`;
}

/** The choice kept on this device, or the default (storage can be missing or blocked). */
export function loadUnits(): Units {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Units> | null;
    const system = v?.system === 'metric' ? 'metric' : 'imperial';
    const area = v?.area && v.area in AREA_LABEL ? v.area : system === 'metric' ? 'ha' : 'acres';
    return { system, area };
  } catch {
    return DEFAULT_UNITS;
  }
}

export function saveUnits(u: Units): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(u));
  } catch {
    // Kept for this visit only.
  }
}
