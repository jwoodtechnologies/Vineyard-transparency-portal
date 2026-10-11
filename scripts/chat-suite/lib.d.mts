/** Types for lib.mjs (the chat regression suite), so tests import it under strict TypeScript. */

export interface Officials {
  people: Array<{ first: string; last: string }>;
  distinctiveLastNames?: string[];
}

export type Expected = string | { text?: string; regex?: string; flags?: string; anyOf?: string[]; until?: string; kind?: string; source?: unknown };

export interface TurnSpec {
  question: string;
  mustContain?: Expected[];
  mustNotContain?: Expected[];
  expect?: {
    engine?: string;
    exact?: string;
    mode?: string;
    citations?: Array<{ documentId: string; page?: number | null }>;
    cards?: string[];
    mapHref?: string[];
    sectionPath?: string;
    people?: string[];
  };
  live?: { nextMeeting?: string; construction?: string };
  checks?: { portalLink?: boolean; titles?: boolean; why?: string };
  elliptical?: boolean;
  /** A follow-up that names its own subject with a code path: no rewrite model call. */
  standalone?: boolean;
  needsRewrite?: boolean;
  ai?: string;
  model?: boolean;
}

export interface SuiteCase {
  id: string;
  category: string;
  tier: 'model' | 'deterministic';
  conversation: Array<{ role: string; content: string }>;
  turns: TurnSpec[];
}

export type AskLike = Record<string, unknown>;

export interface LiveData {
  meetings: Record<string, Array<Record<string, unknown>> | null>;
  construction: { available?: boolean; glance?: { rows: Array<Record<string, string>> } | null } | null;
}

export interface EvalContext {
  today: string;
  live?: Partial<LiveData>;
  officials: Officials;
}

export interface Estimate {
  cases: number;
  requests: number;
  modelTurns: number;
  rewrites: number;
  neurons: number;
  worstNeurons: number;
  shareOfCap: number;
}

export interface TurnResult {
  turn: number;
  question: string;
  engine: string;
  ms: number;
  failures: string[];
  answer: string;
  citations: Array<{ documentId: string; page: number | null }>;
}

export interface CaseResult {
  id: string;
  category: string;
  tier: string;
  status: 'pass' | 'fail' | 'skip';
  reason?: string | null;
  turns: TurnResult[];
}

export interface SuiteRun {
  base: string;
  today: string;
  health: { ai: boolean | null; status: string | null; error: string | null };
  summary: { total: number; pass: number; fail: number; skip: number };
  results: CaseResult[];
  estimate?: Estimate;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export const NEURONS: { modelTurn: number; modelTurnWorst: number; rewrite: number };
export const DAILY_CAP: number;
export const OFF_TOPIC_REPLY: string;
export function utahToday(now?: Date): string;
export function longDate(iso: string): string;
export function normalizeCases(data: { cases: Array<Record<string, unknown>> }): SuiteCase[];
export function turnCost(turn: TurnSpec, index: number, staticConversation?: boolean): { expected: number; worst: number };
export function estimate(cases: SuiteCase[]): Estimate;
export function selectCases(cases: SuiteCase[], opts?: { mode?: 'full' | 'deploy'; sample?: number; seed?: number; only?: string[] | null }): SuiteCase[];
export function historyFor(done: Array<{ question: string; response: AskLike | null }>): Array<{ role: string; content: string; sources?: string[] }>;
export function portalLinks(r: AskLike | null): string[];
export function nameProblems(text: string, officials: Officials): string[];
export const DEAD_END: RegExp;
export function globalChecks(r: AskLike | null, checks?: TurnSpec['checks'], officials?: Officials): string[];
export function nextMeetingDates(items: Array<Record<string, unknown>>, today: string): string[];
export function constructionLines(glance: { rows: Array<Record<string, string>> } | null | undefined, filter?: string): string[];
export function evalTurn(spec: TurnSpec, r: AskLike | null, ctx: EvalContext): string[];
export function ask(fetchFn: FetchLike, base: string, body: Record<string, unknown>, opts?: { sleep?: (ms: number) => Promise<void>; timeoutMs?: number }): Promise<AskLike>;
export function loadLive(fetchFn: FetchLike, base: string, cases: SuiteCase[]): Promise<LiveData>;
export function runSuite(opts: { base: string; cases: SuiteCase[]; officials: Officials; fetchFn?: FetchLike; sleep?: (ms: number) => Promise<void>; delayMs?: number; now?: Date; log?: (line: string) => void }): Promise<SuiteRun>;
export function renderTable(run: SuiteRun): string;
export function renderMarkdown(run: SuiteRun, title?: string): string;
