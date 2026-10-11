/** Types for lib.mjs (the nightly document check), so tests import it under strict TypeScript. */
export interface PixelStats {
  dark: number;
  ink: number;
  samples: number;
}
export interface View {
  error?: string | null;
  state?: string | null;
  toolbar?: { styled: boolean; why?: string } | null;
  pixels?: PixelStats | null;
  text?: string;
}
export const LIMITS: { minDark: number; minInk: number; minOverlap: number };
export function recordIds(text: unknown): string[];
export function rng(seed: number): () => number;
export function pick<T>(items: T[], n: number, random: () => number): T[];
export function words(text: unknown): Set<string>;
export function overlap(a: unknown, b: unknown, min?: number): number | null;
export function pixelStats(data: ArrayLike<number>, step?: number): PixelStats;
export function judge(view: View, apiText: string, expectPdf: boolean): string[];
