#!/usr/bin/env node
/**
 * Chat regression suite for POST /api/ask (Node 20, no dependencies).
 *
 *   node scripts/chat-suite/run.mjs                       # full suite against https://vineyardportal.org
 *   node scripts/chat-suite/run.mjs --mode deploy --seed 7 # deterministic cases plus 2 rotating model cases
 *   node scripts/chat-suite/run.mjs --dry-run              # print the selection and its Neuron estimate only
 *   node scripts/chat-suite/run.mjs --only budget-police,tax-rate-current
 *
 * Options: --base URL, --cases FILE (tests/chat-suite/cases.json), --mode full|deploy, --sample N (2),
 * --seed N (UTC day number), --delay MS between requests (7000; the Worker allows 10 questions a minute),
 * --out FILE (chat-suite-results.json), --max-neurons N (refuses to start above it; 2600 full, 600 deploy).
 * Exit code: 0 all passed (skips allowed), 1 a case failed, 2 the run could not start.
 * Writes a Markdown summary to $GITHUB_STEP_SUMMARY when set. Budget numbers: see lib.mjs.
 */
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { estimate, normalizeCases, renderMarkdown, renderTable, runSuite, selectCases } from './lib.mjs';

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
const sample = Number(opt('sample', '2'));
const seed = Number(opt('seed', String(Math.floor(Date.now() / 86_400_000))));
const delayMs = Number(opt('delay', '7000'));
const only = opt('only', '') ? opt('only', '').split(',').map((s) => s.trim()).filter(Boolean) : null;
const maxNeurons = Number(opt('max-neurons', mode === 'full' ? '2600' : '600'));

const data = JSON.parse(readFileSync(casesPath, 'utf8'));
const cases = selectCases(normalizeCases(data), { mode, sample, seed, only });
const est = estimate(cases);
console.log(`Chat suite: ${mode} run of ${est.cases} cases (${est.requests} requests) against ${base}`);
console.log(`Workers AI estimate: ${est.modelTurns} model answers and ${est.rewrites} follow-up rewrites, about ${est.neurons} Neurons (worst ${est.worstNeurons}), ${est.shareOfCap}% of the 8,000 daily cap`);

if (flag('dry-run')) {
  for (const c of cases) console.log(`  ${c.tier.padEnd(13)} ${c.id}`);
  process.exit(0);
}
if (est.neurons > maxNeurons) {
  console.error(`Refusing to run: the estimate (${est.neurons} Neurons) is above --max-neurons ${maxNeurons}.`);
  process.exit(2);
}

const startedAt = new Date().toISOString();
try {
  const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
} catch (e) {
  console.error(`Run could not start: ${base}/api/health is not reachable (${e?.message ?? e})`);
  process.exit(2);
}
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
