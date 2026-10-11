#!/usr/bin/env node
/**
 * Chat regression suite for POST /api/ask (Node 20, no dependencies).
 *
 *   node scripts/chat-suite/run.mjs                       # full run against https://vineyardportal.org
 *   node scripts/chat-suite/run.mjs --mode deploy          # only the cases answered by code (0 Neurons)
 *   node scripts/chat-suite/run.mjs --dry-run              # print the selection and its Neuron estimate only
 *   node scripts/chat-suite/run.mjs --only budget-police,tax-rate-current
 *
 * Every request sends `x-vtp-suite: 1`, so the Worker bills it to the tests bucket (1,000 Neurons a UTC
 * day, worker/ai/meter.ts), never to residents. Before starting, the runner reads what is left of that
 * bucket from GET /api/health (aiNeurons.tests). A full run takes every deterministic case plus as many
 * model cases as fit in what is left, rotating by --seed so every model case runs within a few days.
 * The runner refuses to start (exit 2) when the bucket cannot cover the selected run.
 *
 * Options: --base URL, --cases FILE (tests/chat-suite/cases.json), --mode full|deploy,
 * --seed N (UTC day number), --delay MS between requests (7000; the Worker allows 10 questions a minute),
 * --out FILE (chat-suite-results.json), --max-neurons N (never plans above it; default the tests cap, 1000).
 * Exit code: 0 all passed, 1 a case failed (a dead-end answer such as "AI answers are temporarily unavailable"
 * fails, it is never skipped), 2 the run could not start.
 * Writes a Markdown summary to $GITHUB_STEP_SUMMARY when set. Budget numbers: see lib.mjs.
 */
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TESTS_CAP, estimate, normalizeCases, renderMarkdown, renderTable, runSuite, selectCases } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const base = String(opt('base', process.env.CHAT_SUITE_BASE || 'https://vineyardportal.org')).replace(/\/+$/, '');
const mode = opt('mode', 'full') === 'deploy' ? 'deploy' : 'full';
const casesPath = resolve(opt('cases', resolve(here, '../../tests/chat-suite/cases.json')));
const out = resolve(opt('out', 'chat-suite-results.json'));
const seed = Number(opt('seed', String(Math.floor(Date.now() / 86_400_000))));
const delayMs = Number(opt('delay', '7000'));
const only = opt('only', '') ? opt('only', '').split(',').map((s) => s.trim()).filter(Boolean) : null;
const maxNeurons = Number(opt('max-neurons', String(TESTS_CAP)));

const data = JSON.parse(readFileSync(casesPath, 'utf8'));
const all = normalizeCases(data);

/** What is left of today's tests bucket, from GET /api/health (null when the site does not report it). */
async function bucketLeft() {
  const res = await fetch(`${base}/api/health`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const t = (await res.json())?.aiNeurons?.tests;
  if (!t || typeof t.used !== 'number' || typeof t.cap !== 'number') return null;
  return { left: Math.max(0, t.cap - t.used), used: t.used, cap: t.cap };
}

let bucket = null;
if (!flag('dry-run')) {
  try {
    bucket = await bucketLeft();
  } catch (e) {
    console.error(`Run could not start: ${base}/api/health is not reachable (${e?.message ?? e})`);
    process.exit(2);
  }
}
const budget = Math.min(maxNeurons, bucket ? bucket.left : maxNeurons);
const cases = selectCases(all, { mode, seed, only, budget });
const est = estimate(cases);
console.log(`Chat suite: ${mode} run of ${est.cases} cases (${est.requests} requests) against ${base}`);
console.log(`Workers AI estimate: ${est.modelTurns} model answers and ${est.rewrites} follow-up rewrites, about ${est.neurons} Neurons (worst ${est.worstNeurons}), ${est.shareOfCap}% of the ${TESTS_CAP} Neuron tests bucket`);
console.log(bucket ? `Tests bucket today: ${Math.round(bucket.used)} of ${bucket.cap} used, ${Math.round(bucket.left)} left` : `Tests bucket not reported by ${base}/api/health; planning within --max-neurons ${maxNeurons}`);
if (mode === 'full' && !only) console.log(`Model cases this run: ${cases.filter((c) => c.tier === 'model').length} of ${all.filter((c) => c.tier === 'model').length}`);

if (flag('dry-run')) {
  for (const c of cases) console.log(`  ${c.tier.padEnd(13)} ${c.id}`);
  process.exit(0);
}
if (est.worstNeurons > budget) {
  console.error(`Refusing to run: the worst case estimate (${est.worstNeurons} Neurons) is above what the tests bucket can cover (${Math.round(budget)}).`);
  process.exit(2);
}

const startedAt = new Date().toISOString();
let run;
try {
  run = await runSuite({ base, cases, officials: data.officials, delayMs, log: (s) => console.log(s) });
} catch (e) {
  console.error(`Run could not start: ${e?.message ?? e}`);
  process.exit(2);
}
run = { ...run, mode, seed, startedAt, finishedAt: new Date().toISOString(), estimate: est };
writeFileSync(out, `${JSON.stringify(run, null, 2)}\n`);
console.log('');
console.log(renderTable(run));
console.log(`\nResults written to ${out}`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${renderMarkdown(run, `Chat suite (${mode})`)}\n`);
process.exit(run.summary.fail ? 1 : 0);
