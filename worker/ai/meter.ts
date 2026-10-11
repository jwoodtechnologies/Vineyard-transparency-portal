/**
 * Workers AI spend guard (zero overage). Every model call is estimated in Neurons before it runs,
 * using Cloudflare's published per-model rates and a conservative token estimate (input characters
 * / 3.5, output at the request's max_tokens), and counted per UTC day in quota_usage.ai_neurons.
 * When the next call would pass AI_NEURONS_PER_DAY the call is refused with a quota error, which
 * opens the answer breaker: Ask falls back to search results until the next UTC day.
 */

/** The parts of the Worker environment the meter needs (tests may pass only AI). */
type Stmt = { bind: (...v: unknown[]) => Stmt; run: () => Promise<unknown>; first: <T>() => Promise<T | null> };
type Db = { prepare: (sql: string) => Stmt };
export type MeterEnv = { AI?: unknown; CATALOG_DB?: Db | object; AI_NEURONS_PER_DAY?: string };

/** Neurons per million tokens [input, output] (Cloudflare Workers AI pricing). */
const RATES: Array<[RegExp, number, number]> = [
  [/qwen3-30b-a3b/, 4625, 30475],
  [/llama-3\.1-8b-instruct-fp8/, 4119, 34868],
  [/llama-3\.1-8b-instruct(?!-fp8)/, 25608, 75147],
  [/gpt-oss-120b/, 31818, 68182],
  [/gpt-oss-20b/, 18182, 27273],
  [/bge-reranker-base/, 283, 0],
];
const UNKNOWN: [number, number] = [70000, 140000];

export const DEFAULT_NEURONS_PER_DAY = 8000;

function intVar(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

let columnReady = false;
async function ensureColumn(db: Db): Promise<void> {
  if (columnReady) return;
  try {
    await db.prepare('ALTER TABLE quota_usage ADD COLUMN ai_neurons REAL NOT NULL DEFAULT 0').run();
  } catch {
    /* column already exists */
  }
  columnReady = true;
}

const day = () => new Date().toISOString().slice(0, 10);

function chars(v: unknown): number {
  if (typeof v === 'string') return v.length;
  if (Array.isArray(v)) return v.reduce((n, x) => n + chars(x), 0);
  if (v && typeof v === 'object') return Object.values(v as Record<string, unknown>).reduce<number>((n, x) => n + chars(x), 0);
  return 0;
}

export function estimateNeurons(model: string, input: Record<string, unknown>): number {
  const [inRate, outRate] = RATES.find(([re]) => re.test(model))?.slice(1) as [number, number] ?? UNKNOWN;
  const inTokens = Math.ceil(chars(input.messages ?? input.contexts ?? input.prompt ?? input) / 3.5) + (typeof input.query === 'string' ? Math.ceil(input.query.length / 3.5) : 0);
  const outTokens = Number(input.max_tokens ?? (outRate ? 400 : 0));
  return (inTokens * inRate + outTokens * outRate) / 1_000_000;
}

export async function neuronsUsedToday(env: MeterEnv): Promise<number> {
  if (!env.CATALOG_DB) return 0;
  const db = env.CATALOG_DB as Db;
  await ensureColumn(db);
  const r = await db.prepare('SELECT ai_neurons FROM quota_usage WHERE day = ?').bind(day()).first<{ ai_neurons: number }>();
  return Number(r?.ai_neurons ?? 0);
}

type AiRunner = { run: (model: string, input: unknown) => Promise<unknown> };

/** env.AI.run with the daily Neuron cap enforced before the call. */
export async function meteredRun(env: MeterEnv, model: string, input: Record<string, unknown>): Promise<unknown> {
  if (!env.CATALOG_DB) return (env.AI as unknown as AiRunner).run(model, input);
  const cost = estimateNeurons(model, input);
  const cap = intVar(env.AI_NEURONS_PER_DAY, DEFAULT_NEURONS_PER_DAY);
  const used = await neuronsUsedToday(env);
  if (used + cost > cap) throw new Error(`4006: daily neuron cap reached (${Math.round(used)} of ${cap})`);
  await (env.CATALOG_DB as Db).prepare(
    `INSERT INTO quota_usage (day, ai_neurons, updated_at) VALUES (?, ?, ?) ON CONFLICT(day) DO UPDATE SET ai_neurons = ai_neurons + excluded.ai_neurons, updated_at = excluded.updated_at`,
  )
    .bind(day(), cost, new Date().toISOString())
    .run();
  return (env.AI as unknown as AiRunner).run(model, input);
}
