/** Types for lib.mjs (the watchdog), so tests import it under strict TypeScript. */

export interface HealthRow {
  id: string;
  name?: string;
  kind?: 'job' | 'source';
  consecutiveFailures: number;
  failing: boolean;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  status?: string;
}

export interface Health {
  generatedAt?: string;
  threshold?: number;
  jobs: HealthRow[];
  sources: HealthRow[];
}

export interface Run {
  id: number;
  status?: string;
  conclusion: string | null;
  html_url?: string;
  created_at?: string;
  run_started_at?: string;
}

export interface Item {
  key: string;
  title: string;
  failing: boolean | null;
  details: string;
}

export interface OpenIssue {
  number: number;
  title: string;
  lastNoteAt: string | null;
}

export type Action = { type: 'create'; title: string; body: string; number?: undefined } | { type: 'comment' | 'close'; number: number; title: string; body: string };

export const LABEL: string;
export const THRESHOLD: number;
export const NOTE_EVERY_MS: number;
export const MARKER: string;
export function stamp(iso: string | null | undefined): string;
export function clean(text: unknown): string;
export function failureStreak(runs: Run[] | null | undefined): number;
export function evaluate(input: { health: Health | null; chatRun: Run | null; docRun?: Run | null; ingestRuns: Run[] | null; repo: string; base: string; server?: string }): Item[];
export function plan(items: Item[], openIssues: OpenIssue[], now?: number, complete?: boolean): Action[];
export function lastNoteAt(issue: { created_at: string }, comments: Array<{ body?: string; created_at: string }> | null | undefined): string;
