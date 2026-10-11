/**
 * Workers AI spend guard (zero overage). Every model call is estimated in Neurons before it runs,
 * using Cloudflare's published per-model rates and a conservative token estimate (input characters
 * / 3.5, output at the request's max_tokens), and counted per UTC day in quota_usage.
 *
 * The account includes 10,000 Neurons a day (Workers Paid, shared with other projects; anything
 * above is billed, so the total never passes DAILY_ALLOWANCE). The day is split between spenders,
 * each with its own cap:
 *   - public: residents asking questions, and anything else without the suite header
 *     (AI_NEURONS_PUBLIC_PER_DAY, default 9,000);
 *   - tests: requests carrying `x-vtp-suite: 1`, which the chat regression suite sends
 *     (AI_NEURONS_TESTS_PER_DAY, default 1,000). Spoofing the header only spends this small bucket.
 * The public cap is clamped to DAILY_ALLOWANCE minus the tests cap, so the sum never passes 10,000.
 * Nothing else in the Worker calls a model (ingest and indexing use none), so there is no third bucket.
 *
 * Columns: quota_usage.ai_neurons (all spenders) and quota_usage.ai_neurons_tests; public is the
 * difference. A call reserves its estimate with one conditional UPDATE, so concurrent requests cannot
 * pass a cap together. Over the public cap the call is refused with a 4006 quota error, which opens the
 * answer breaker (Ask answers from the records until the next UTC day). Over the tests cap the error
 * does not look like a quota error, so it never opens the breaker: only that test answer goes without
 * the model and residents are unaffected.
 *
 * The day ends at 00:00 UTC: 6 PM Mountain in daylight time, 5 PM in standard time (aiResumesAt).
 */

/** The parts of the Worker environment the meter needs (tests may pass only AI). */
type Stmt = { bind: (...v: unknown[]) => Stmt; run: () => Promise<unknown>; first: <T>() => Promise<T | null> };
type Db = { prepare: (sql: string) => Stmt };
export type MeterEnv = {
  AI?: unknown;
  CATALOG_DB?: Db | object;
  AI_NEURONS_PUBLIC_PER_DAY?: string;
  AI_NEURONS_TESTS_PER_DAY?: string;
  /** Set per request by spenderEnv (never in wrangler config): who pays for this request's model calls. */
  AI_SPENDER?: string;
  AI_ENABLED?: string;
};

export type Spender = 'public' | 'tests';
export const SPENDERS: readonly Spender[] = ['public', 'tests'];

/** Header the chat suite runner sends on every request (scripts/chat-suite/lib.mjs). */
export const SUITE_HEADER = 'x-vtp-suite';

/** Neurons included per account per day. The meter never lets the total pass this. */
export const DAILY_ALLOWANCE = 10_000;
export const DEFAULT_CAPS: Record<Spender, number> = { public: 9000, tests: 1000 };

/** Neurons per million tokens [input, output] (Cloudflare Workers AI pricing). */
const RATES: Array<[RegExp, number, number]> = [
  [/qwen3-30b-a3b/, 4625, 30475],
  [/llama-3\.1-8b-instruct-fp8/, 4119, 34868],
  [/llama-3\.1-8b-instruct(?!-fp8)/, 25608, 75147],
  [/gpt-oss-120b/, 31818, 68182],
  [/gpt-oss-20b/, 18182, 27273],
  [/granite-4\.0-h-micro/, 1542, 10158],
  [/llama-3\.2-1b-instruct/, 2457, 18252],
  [/bge-reranker-base/, 283, 0],
];
const UNKNOWN: [number, number] = [70000, 140000];

function intVar(value: string | undefined, fallback: number): number {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/** Each spender's daily cap, clamped so tests + public never pass DAILY_ALLOWANCE. */
export function neuronCaps(env: MeterEnv): Record<Spender, number> & { total: number } {
  const tests = Math.min(intVar(env.AI_NEURONS_TESTS_PER_DAY, DEFAULT_CAPS.tests), DAILY_ALLOWANCE);
  const pub = Math.min(intVar(env.AI_NEURONS_PUBLIC_PER_DAY, DEFAULT_CAPS.public), DAILY_ALLOWANCE - tests);
  return { public: pub, tests, total: pub + tests };
}

export function spenderOf(env: MeterEnv): Spender {
  return env.AI_SPENDER === 'tests' ? 'tests' : 'public';
}

/** 'tests' when the request carries the suite header, else 'public'. */
export function requestSpender(request: Request): Spender {
  return request.headers.get(SUITE_HEADER)?.trim() === '1' ? 'tests' : 'public';
}

/** Runs `fn`; when a meter column is missing (first use on a database), adds the columns and runs it again. */
async function withColumns<T>(db: Db, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!/no such column|has no column/i.test(String((e as Error)?.message ?? e))) throw e;
    for (const col of ['ai_neurons', 'ai_neurons_tests']) {
      try {
        await db.prepare(`ALTER TABLE quota_usage ADD COLUMN ${col} REAL NOT NULL DEFAULT 0`).run();
      } catch {
        /* column already exists */
      }
    }
    return fn();
  }
}

const utcDay = (now: Date) => now.toISOString().slice(0, 10);

/** When the next metering day starts (00:00 UTC), and that time in Vineyard ("6 PM Mountain"). */
export function aiResumesAt(now: Date = new Date()): { iso: string; mountainLabel: string } {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(next);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const minute = get('minute');
  const time = `${get('hour')}${minute && minute !== '00' ? `:${minute}` : ''} ${get('dayPeriod').toUpperCase()}`;
  return { iso: next.toISOString(), mountainLabel: `${time} Mountain` };
}

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

export type NeuronUsage = {
  day: string;
  public: { used: number; cap: number };
  tests: { used: number; cap: number };
  total: { used: number; cap: number; allowance: number };
  resetsAt: string;
  resetsAtMountain: string;
};

/** Today's Neurons by spender, each cap, and when the day resets. Numbers only. */
export async function neuronUsage(env: MeterEnv, now: Date = new Date()): Promise<NeuronUsage> {
  const caps = neuronCaps(env);
  let total = 0;
  let tests = 0;
  if (env.CATALOG_DB) {
    const db = env.CATALOG_DB as Db;
    const r = await withColumns(db, () => db.prepare('SELECT ai_neurons, ai_neurons_tests FROM quota_usage WHERE day = ?').bind(utcDay(now)).first<{ ai_neurons: number; ai_neurons_tests: number }>());
    total = Number(r?.ai_neurons ?? 0);
    tests = Number(r?.ai_neurons_tests ?? 0);
  }
  const round = (n: number) => Math.round(n * 10) / 10;
  const reset = aiResumesAt(now);
  return {
    day: utcDay(now),
    public: { used: round(total - tests), cap: caps.public },
    tests: { used: round(tests), cap: caps.tests },
    total: { used: round(total), cap: caps.total, allowance: DAILY_ALLOWANCE },
    resetsAt: reset.iso,
    resetsAtMountain: reset.mountainLabel,
  };
}

/** Neurons used today by every spender together. */
export async function neuronsUsedToday(env: MeterEnv): Promise<number> {
  return (await neuronUsage(env)).total.used;
}

/** The refusal for a spent tests bucket. Deliberately free of "4006", "neuron" and "quota" so the answer breaker stays shut for residents. */
export const TESTS_SPENT = 'suite allowance spent for today';

type AiRunner = { run: (model: string, input: unknown) => Promise<unknown> };

/** env.AI.run with the spender's daily Neuron cap (and the account total) enforced before the call. */
export async function meteredRun(env: MeterEnv, model: string, input: Record<string, unknown>, now: Date = new Date()): Promise<unknown> {
  if (!env.CATALOG_DB) return (env.AI as unknown as AiRunner).run(model, input);
  const db = env.CATALOG_DB as Db;
  const cost = estimateNeurons(model, input);
  const caps = neuronCaps(env);
  const spender = spenderOf(env);
  const testCost = spender === 'tests' ? cost : 0;
  const day = utcDay(now);
  const at = now.toISOString();
  await db.prepare('INSERT INTO quota_usage (day, updated_at) VALUES (?, ?) ON CONFLICT(day) DO NOTHING').bind(day, at).run();
  // One conditional write: the reservation happens only if every cap still holds after it.
  const res = (await withColumns(db, () =>
    db
      .prepare(
        `UPDATE quota_usage SET ai_neurons = ai_neurons + ?, ai_neurons_tests = ai_neurons_tests + ?, updated_at = ?
         WHERE day = ? AND ai_neurons + ? <= ? AND ai_neurons - ai_neurons_tests + ? <= ? AND ai_neurons_tests + ? <= ?`,
      )
      .bind(cost, testCost, at, day, cost, caps.total, cost - testCost, caps.public, testCost, caps.tests)
      .run(),
  )) as { meta?: { changes?: number } } | undefined;
  if (!(Number(res?.meta?.changes ?? 0) > 0)) {
    const u = await neuronUsage(env, now);
    if (spender === 'tests') throw new Error(`${TESTS_SPENT} (${Math.round(u.tests.used)} of ${u.tests.cap})`);
    throw new Error(`4006: daily neuron cap reached (${Math.round(u.public.used)} of ${u.public.cap})`);
  }
  return (env.AI as unknown as AiRunner).run(model, input);
}

/**
 * The environment one POST /api/ask runs with: a copy carrying the request's spender (the shared env is
 * never changed). A suite request whose bucket is already spent also gets AI_ENABLED=false, so it takes
 * the no-AI path at once without opening the breaker for residents.
 */
export async function spenderEnv<E extends MeterEnv>(env: E, request: Request, now: Date = new Date()): Promise<E> {
  const spender = requestSpender(request);
  if (spender === 'public') return env;
  const u = await neuronUsage(env, now).catch(() => null);
  const spent = u != null && u.tests.used >= u.tests.cap;
  return { ...env, AI_SPENDER: spender, ...(spent ? { AI_ENABLED: 'false' } : {}) };
}
