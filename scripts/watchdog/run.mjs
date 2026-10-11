#!/usr/bin/env node
/**
 * Watchdog (Node 20, no dependencies): opens a GitHub issue when a scheduled job, a source, the nightly
 * chat suite or the scheduled ingest workflow is failing, comments at most once a day while it stays
 * failing, and closes the issue when it recovers. Run by .github/workflows/watchdog.yml with the
 * workflow's own GITHUB_TOKEN (issues: write, actions: read). No other secret.
 *
 *   node scripts/watchdog/run.mjs             # act on the issues
 *   node scripts/watchdog/run.mjs --dry-run   # print the actions only
 *
 * Environment: GITHUB_TOKEN, GITHUB_REPOSITORY (owner/repo), GITHUB_API_URL, GITHUB_SERVER_URL,
 * WATCHDOG_BASE (https://vineyardportal.org).
 */
import { LABEL, evaluate, lastNoteAt, plan } from './lib.mjs';

const dry = process.argv.includes('--dry-run');
const base = String(process.env.WATCHDOG_BASE || 'https://vineyardportal.org').replace(/\/+$/, '');
const repo = process.env.GITHUB_REPOSITORY || 'jwoodtechnologies/Vineyard-transparency-portal';
const api = String(process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, '');
const server = String(process.env.GITHUB_SERVER_URL || 'https://github.com').replace(/\/+$/, '');
const token = process.env.GITHUB_TOKEN || '';

async function gh(path, init = {}) {
  const res = await fetch(`${api}${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'vtp-watchdog',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });
  if (res.status === 404 && init.allow404) return null;
  if (!res.ok) throw new Error(`GitHub ${init.method ?? 'GET'} ${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? null : res.json();
}

async function readHealth() {
  try {
    const res = await fetch(`${base}/api/health/jobs`, { headers: { accept: 'application/json', 'user-agent': 'vtp-watchdog' }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.log(`::warning::Could not read ${base}/api/health/jobs: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

async function runs(file, perPage) {
  try {
    const r = await gh(`/repos/${repo}/actions/workflows/${file}/runs?event=schedule&status=completed&per_page=${perPage}`);
    return r?.workflow_runs ?? [];
  } catch (e) {
    console.log(`::warning::Could not list ${file} runs: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

async function ensureLabel() {
  const have = await gh(`/repos/${repo}/labels/${LABEL}`, { allow404: true });
  if (have || dry) return;
  await gh(`/repos/${repo}/labels`, { method: 'POST', body: JSON.stringify({ name: LABEL, color: 'cfd3d7', description: 'Opened and closed by the watchdog workflow' }) });
}

async function openIssues() {
  const list = (await gh(`/repos/${repo}/issues?labels=${LABEL}&state=open&per_page=100`)) ?? [];
  const issues = list.filter((i) => !i.pull_request);
  return Promise.all(
    issues.map(async (i) => {
      const comments = i.comments ? ((await gh(`/repos/${repo}/issues/${i.number}/comments?per_page=100${i.comments > 100 ? `&page=${Math.ceil(i.comments / 100)}` : ''}`)) ?? []) : [];
      return { number: i.number, title: i.title, lastNoteAt: lastNoteAt(i, comments) };
    }),
  );
}

async function main() {
  if (!token && !dry) throw new Error('GITHUB_TOKEN is not set.');
  const [health, chat, ingest] = await Promise.all([readHealth(), runs('chat-suite.yml', 1), runs('ingest.yml', 20)]);
  const items = evaluate({ health, chatRun: chat?.[0] ?? null, ingestRuns: ingest, repo, base, server });
  for (const i of items) if (i.failing) console.log(`Failing: ${i.title}`);
  await ensureLabel();
  const actions = plan(items, await openIssues(), Date.now(), Boolean(health));
  for (const a of actions) {
    console.log(`${dry ? '[dry run] ' : ''}${a.type} ${a.number ? `#${a.number} ` : ''}${a.title}`);
    if (dry) continue;
    if (a.type === 'create') await gh(`/repos/${repo}/issues`, { method: 'POST', body: JSON.stringify({ title: a.title, body: a.body, labels: [LABEL] }) });
    if (a.type === 'comment' || a.type === 'close') await gh(`/repos/${repo}/issues/${a.number}/comments`, { method: 'POST', body: JSON.stringify({ body: a.body }) });
    if (a.type === 'close') await gh(`/repos/${repo}/issues/${a.number}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed', state_reason: 'completed' }) });
  }
  if (!actions.length) console.log('No changes.');
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import('node:fs');
    const failing = items.filter((i) => i.failing).map((i) => `- ${i.title}`);
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Watchdog\n\n${failing.length ? failing.join('\n') : 'Nothing failing.'}\n\n${actions.map((a) => `- ${a.type}: ${a.title}`).join('\n')}\n`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
