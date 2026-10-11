/**
 * Chat regression suite: the checks and the run loop, with no dependencies (Node 20).
 * scripts/chat-suite/run.mjs is the command line; tests/chat-suite.test.ts runs these on canned answers.
 *
 * Workers AI budget (worker/ai/meter.ts RATES, estimate = input characters / 3.5 at the input rate
 * plus max_tokens at the output rate):
 *   - a code-written answer (budget, tax rate, votes at a meeting, directory, schedule, map, catalog,
 *     off topic, small talk) uses no model: 0 Neurons;
 *   - a follow-up turn that is not an exact elliptical rewrite ("and parks?", "did anyone vote no that
 *     night?") first runs the conversation rewrite (qwen3-30b, ~1.4k character prompt, 200 tokens out): ~11;
 *   - a model answer runs the search plan (qwen3-30b, 220 tokens out: ~9), the reranker over up to 90
 *     passages (bge-reranker-base: ~11) and the answer (qwen3-30b, 6.4k character system prompt plus up to
 *     15.5k characters of sources, 900 tokens out: ~56): ~76, rounded to 80. When qwen fails and the
 *     llama-3.1-8b-fp8 fallback also runs, add ~40 (worst case 120).
 */

export const NEURONS = { modelTurn: 80, modelTurnWorst: 120, rewrite: 11 };
export const DAILY_CAP = 8000;
export const OFF_TOPIC_REPLY = 'This portal covers Vineyard city records only.';

const norm = (s) =>
  String(s ?? '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/ /g, ' ');

/** YYYY-MM-DD in Vineyard (America/Denver). */
export function utahToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** "2026-10-13" as "October 13, 2026". */
export function longDate(iso) {
  return new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/* ------------------------------------------------------------------------------------------------ */
/* Cases                                                                                            */
/* ------------------------------------------------------------------------------------------------ */

/** Every case as a list of turns, with its tier ("model" when any turn needs the answer model). */
export function normalizeCases(data) {
  return data.cases.map((c) => {
    const turns = c.turns ?? [{ question: c.question, mustContain: c.mustContain, mustNotContain: c.mustNotContain, expect: c.expect, live: c.live, checks: c.checks, elliptical: c.elliptical, needsRewrite: c.needsRewrite }];
    const model = turns.map((t) => t.ai === 'model' || (c.tier === 'model' && t.ai !== 'none'));
    const tier = model.some(Boolean) ? 'model' : 'deterministic';
    return { id: c.id, category: c.category, tier, conversation: c.conversation ?? [], turns: turns.map((t, i) => ({ ...t, model: model[i] })) };
  });
}

/** Neurons one turn is expected to use (and at worst), per the header of this file. */
export function turnCost(turn, index, staticConversation = false) {
  const followUp = index > 0 || staticConversation;
  const rewrite = followUp && !turn.elliptical ? NEURONS.rewrite : 0;
  return { expected: rewrite + (turn.model ? NEURONS.modelTurn : 0), worst: rewrite + (turn.model ? NEURONS.modelTurnWorst : 0) };
}

export function estimate(cases) {
  let expected = 0;
  let worst = 0;
  let requests = 0;
  let modelTurns = 0;
  let rewrites = 0;
  for (const c of cases)
    c.turns.forEach((t, i) => {
      const cost = turnCost(t, i, c.conversation.length > 0);
      expected += cost.expected;
      worst += cost.worst;
      requests += 1;
      if (t.model) modelTurns += 1;
      if ((i > 0 || c.conversation.length > 0) && !t.elliptical) rewrites += 1;
    });
  return { cases: cases.length, requests, modelTurns, rewrites, neurons: Math.round(expected), worstNeurons: Math.round(worst), shareOfCap: Math.round((expected / DAILY_CAP) * 1000) / 10 };
}

/**
 * Which cases to run. full: all. deploy: every deterministic case plus `sample` model cases, rotating
 * through the model cases by `seed` (the workflow passes its run number) so every model case is
 * covered across deploys.
 */
export function selectCases(cases, { mode = 'full', sample = 2, seed = 0, only = null } = {}) {
  if (only?.length) return cases.filter((c) => only.includes(c.id));
  if (mode === 'full') return cases;
  const det = cases.filter((c) => c.tier === 'deterministic');
  const model = cases.filter((c) => c.tier === 'model').sort((a, b) => a.id.localeCompare(b.id));
  const n = model.length;
  const take = Math.min(sample, n);
  const start = n ? (((seed * take) % n) + n) % n : 0;
  const picked = Array.from({ length: take }, (_, k) => model[(start + k) % n]);
  return [...det, ...picked];
}

/** The conversation the site sends with a question (src/console/ConsolePage.tsx history()). */
export function historyFor(done) {
  return done.slice(-3).flatMap(({ question, response }) => {
    const sources = [
      ...(response?.citations ?? []).map((c) => c.documentTitle),
      ...(response?.votes?.items ?? []).slice(0, 3).map((m) => m.item ?? m.motion),
      ...(response?.event ? [response.event.title] : []),
    ]
      .map((s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 200))
      .filter(Boolean);
    const uniq = [...new Set(sources)].slice(0, 6);
    return [
      { role: 'user', content: question },
      { role: 'assistant', content: String(response?.answer ?? '').slice(0, 900), ...(uniq.length ? { sources: uniq } : {}) },
    ];
  });
}

/* ------------------------------------------------------------------------------------------------ */
/* Global checks                                                                                    */
/* ------------------------------------------------------------------------------------------------ */

/** Links in the answer that open a page inside the portal (relative, or on vineyardportal.org). */
export function portalLinks(r) {
  const out = [];
  for (const c of r?.citations ?? []) if (c?.documentId) out.push(`/documents/${c.documentId}${c.page ? `?page=${c.page}` : ''}`);
  for (const d of r?.relatedDocuments ?? []) if (d?.id) out.push(`/documents/${d.id}`);
  if (r?.section?.path) out.push(r.section.path);
  if (r?.map?.href) out.push(r.map.href);
  if (r?.event) out.push(r.event.meetingId ? `/meetings/${r.event.meetingId}` : '/meetings');
  if (r?.votes?.items?.length) out.push('/votes');
  for (const p of r?.people ?? []) out.push(`/people/${p}`);
  if (r?.contact) out.push(`/people/${r.contact}`);
  for (const s of r?.series?.items ?? []) if (s?.id) out.push(`/documents/${s.id}`);
  for (const m of String(r?.answer ?? '').matchAll(/https?:\/\/(?:www\.)?vineyardportal\.org[^\s)\]]*/g)) out.push(m[0]);
  return out.filter((h) => h.startsWith('/') || /vineyardportal\.org/.test(h));
}

const TITLE_BEFORE = /(Mayor(?: Pro Tem(?:p|pore)?)?|Council ?Members?|Councilmembers?|Council(?:wo)?man|Board Members?|Commissioner|Chair|Vice Chair|Member)\s*$/i;
const TITLE_IN_SENTENCE = /\b(Mayor|City Council|Council Member|Councilmember|Board Member|Redevelopment Agency board)\b/;

/**
 * Council members and the mayor are named by title and last name ("Council Member McCumber").
 * A full name passes only in a sentence that also gives the title (the directory's "Parker McCumber
 * is a member of the City Council"); a distinctive last name passes only right after a title.
 */
export function nameProblems(text, officials) {
  const t = norm(text);
  const problems = [];
  const sentences = t.split(/(?<=[.!?])\s+/);
  const sentenceAt = (i) => {
    let pos = 0;
    for (const s of sentences) {
      const at = t.indexOf(s, pos);
      if (i >= at && i < at + s.length) return s;
      pos = at + s.length;
    }
    return '';
  };
  const covered = [];
  for (const p of officials.people) {
    const re = new RegExp(`\\b${p.first}\\s+${p.last}\\b`, 'g');
    for (const m of t.matchAll(re)) {
      covered.push([m.index, m.index + m[0].length]);
      const before = t.slice(Math.max(0, m.index - 30), m.index);
      if (TITLE_BEFORE.test(before)) continue;
      if (TITLE_IN_SENTENCE.test(sentenceAt(m.index).replace(m[0], ''))) continue;
      problems.push(`"${m[0]}" named without a title (write "Council Member ${p.last}" or "Mayor ${p.last}")`);
    }
  }
  for (const last of officials.distinctiveLastNames ?? []) {
    for (const m of t.matchAll(new RegExp(`\\b${last}\\b`, 'g'))) {
      if (covered.some(([a, b]) => m.index >= a && m.index < b)) continue;
      const before = t.slice(Math.max(0, m.index - 30), m.index);
      if (TITLE_BEFORE.test(before)) continue;
      problems.push(`"${last}" named without a title`);
    }
  }
  return [...new Set(problems)];
}

const GENERATED = /\bGenerated (by|with|using|on|at|from)\b|\bAI[- ]generated\b|^\s*Generated\b/im;

/** Checks every answer gets: no em or en dashes, titled names, a portal link, no "Generated" boilerplate. */
export function globalChecks(r, checks = {}, officials = { people: [], distinctiveLastNames: [] }) {
  const fails = [];
  const answer = String(r?.answer ?? '');
  if (!answer.trim()) fails.push('empty answer');
  if (/[–—]/.test(answer)) fails.push('answer has an em or en dash');
  if (checks.titles !== false) for (const p of nameProblems(answer, officials)) fails.push(p);
  if (checks.portalLink !== false && !portalLinks(r).length) fails.push('no card or citation opens a page inside the portal');
  if (GENERATED.test(answer) || GENERATED.test(String(r?.notice ?? ''))) fails.push('"Generated" boilerplate in the answer');
  return fails;
}

/* ------------------------------------------------------------------------------------------------ */
/* Per-turn checks                                                                                  */
/* ------------------------------------------------------------------------------------------------ */

function matcher(item) {
  if (typeof item === 'string') return { label: JSON.stringify(item), test: (t) => t.includes(norm(item)) };
  if (item.regex) {
    const re = new RegExp(item.regex, item.flags ?? '');
    return { label: `/${item.regex}/${item.flags ?? ''}`, test: (t) => re.test(t) };
  }
  if (item.anyOf) return { label: `any of ${JSON.stringify(item.anyOf)}`, test: (t) => item.anyOf.some((x) => t.includes(norm(x))) };
  return { label: JSON.stringify(item.text), test: (t) => t.includes(norm(item.text)) };
}

/** First meeting of a body on or after today (and the one after, when the first is today). */
export function nextMeetingDates(items, today) {
  const ok = (m) => m?.date && m.date.slice(0, 10) >= today && !/cancel/i.test(`${m.title ?? ''} ${m.status ?? ''}`) && m.status !== 'unconfirmed';
  const dates = [...new Set(items.filter(ok).map((m) => m.date.slice(0, 10)))].sort();
  return dates[0] === today ? dates.slice(0, 2) : dates.slice(0, 1);
}

/** The rows of the construction "at a glance" table the answer must list (Project, Location). */
export function constructionLines(glance, filter = 'all') {
  const rows = glance?.rows ?? [];
  const pick = (r, re) => {
    const k = Object.keys(r).find((h) => re.test(h));
    return k ? String(r[k]).trim() : '';
  };
  return rows
    .filter((r) => filter === 'all' || Object.values(r).some((v) => String(v).toLowerCase().includes(String(filter).toLowerCase())))
    .map((r) => [pick(r, /project/i) || String(Object.values(r)[0] ?? ''), pick(r, /location/i)].filter(Boolean).join(', '));
}

/** Failures for one answer against its turn spec. ctx: { today, live: { meetings: {body: items}, construction }, officials }. */
export function evalTurn(spec, r, ctx) {
  const fails = [];
  const answer = norm(r?.answer ?? '');
  for (const item of spec.mustContain ?? []) {
    if (typeof item === 'object' && item.until && ctx.today > item.until) continue;
    const m = matcher(item);
    if (!m.test(answer)) fails.push(`missing ${m.label}`);
  }
  for (const item of spec.mustNotContain ?? []) {
    const m = matcher(item);
    if (m.test(answer)) fails.push(`must not contain ${m.label}`);
  }
  const e = spec.expect ?? {};
  const engine = String(r?.engine ?? '');
  if (e.engine && !(engine === e.engine || engine.startsWith(`${e.engine} `))) fails.push(`engine "${engine}", expected "${e.engine}"`);
  if (e.exact != null && answer.trim() !== norm(e.exact)) fails.push(`answer is not exactly ${JSON.stringify(e.exact)}`);
  if (e.mode && r?.mode !== e.mode) fails.push(`mode "${r?.mode}", expected "${e.mode}"`);
  for (const c of e.citations ?? []) {
    const hit = (r?.citations ?? []).some((x) => x.documentId === c.documentId && (c.page == null || x.page === c.page));
    if (!hit) fails.push(`no citation of ${c.documentId}${c.page != null ? ` page ${c.page}` : ''}`);
  }
  const has = { votes: Boolean(r?.votes?.items?.length), event: Boolean(r?.event), map: Boolean(r?.map?.href), section: Boolean(r?.section?.path), people: Boolean(r?.people?.length), series: Boolean(r?.series?.items?.length), contact: Boolean(r?.contact) };
  for (const card of e.cards ?? []) if (!has[card]) fails.push(`no ${card} card`);
  for (const part of e.mapHref ?? []) if (!String(r?.map?.href ?? '').includes(part)) fails.push(`map link "${r?.map?.href ?? ''}" lacks "${part}"`);
  if (e.sectionPath && r?.section?.path !== e.sectionPath) fails.push(`section card "${r?.section?.path ?? ''}", expected "${e.sectionPath}"`);
  for (const slug of e.people ?? []) if (!(r?.people ?? []).includes(slug)) fails.push(`no person card for ${slug}`);
  const live = spec.live ?? {};
  if (live.nextMeeting) {
    const items = ctx.live?.meetings?.[live.nextMeeting];
    if (!items) fails.push(`live meeting list for ${live.nextMeeting} unavailable`);
    else {
      const dates = nextMeetingDates(items, ctx.today);
      if (!dates.length) fails.push(`no upcoming ${live.nextMeeting} meeting in /api/meetings to check against`);
      else if (!dates.some((d) => answer.includes(longDate(d)))) fails.push(`answer lacks the next ${live.nextMeeting} meeting date ${dates.map(longDate).join(' or ')}`);
    }
  }
  if (live.construction) {
    const c = ctx.live?.construction;
    if (!c?.available) fails.push('live construction page unavailable');
    else {
      if (!/As of /.test(answer)) fails.push('construction answer lacks "As of" date');
      for (const line of constructionLines(c.glance, live.construction)) if (!answer.includes(norm(line))) fails.push(`construction answer lacks "${line}"`);
    }
  }
  return [...fails, ...globalChecks(r, spec.checks ?? {}, ctx.officials)];
}

/* ------------------------------------------------------------------------------------------------ */
/* Running                                                                                          */
/* ------------------------------------------------------------------------------------------------ */

const QUOTA = /4006|neuron cap|daily allowance|quota/i;
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(fetchFn, url) {
  const res = await fetchFn(url, { headers: { accept: 'application/json', 'user-agent': 'VineyardPortalChatSuite/1.0' } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/** POST /api/ask with stream false; retries a 429 (after Retry-After) and one network or 5xx error. */
export async function ask(fetchFn, base, body, { sleep = sleepMs, timeoutMs = 90_000 } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    let res;
    try {
      res = await fetchFn(`${base}/api/ask`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': 'VineyardPortalChatSuite/1.0' },
        body: JSON.stringify({ ...body, stream: false }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      lastErr = e;
      if (attempt >= 1) break;
      await sleep(10_000);
      continue;
    }
    if (res.status === 429) {
      const wait = Math.max(10, Number(res.headers.get('retry-after')) || 30);
      await sleep(wait * 1000);
      continue;
    }
    if (res.status >= 500 && attempt < 1) {
      await sleep(10_000);
      continue;
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    return JSON.parse(text);
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? 'rate limited'));
}

/** The live data time-dependent cases are checked against. */
export async function loadLive(fetchFn, base, cases) {
  const live = { meetings: {}, construction: null };
  const bodies = new Set();
  let construction = false;
  for (const c of cases)
    for (const t of c.turns) {
      if (t.live?.nextMeeting) bodies.add(t.live.nextMeeting);
      if (t.live?.construction) construction = true;
    }
  for (const b of bodies) live.meetings[b] = await getJson(fetchFn, `${base}/api/meetings?body=${encodeURIComponent(b)}&pageSize=40`).then((r) => r.items ?? []).catch(() => null);
  if (construction) live.construction = await getJson(fetchFn, `${base}/api/construction`).catch(() => null);
  return live;
}

/**
 * Runs the cases one request at a time with `delayMs` between requests (the Worker allows 10
 * questions a minute per address). Model cases are skipped, not failed, when the site reports AI
 * answers unavailable (daily Neuron cap reached) before or during the run.
 */
export async function runSuite({ base, cases, officials, fetchFn = fetch, sleep = sleepMs, delayMs = 7000, now = new Date(), log = () => {} }) {
  const today = utahToday(now);
  const health = await getJson(fetchFn, `${base}/api/health`).catch((e) => ({ error: String(e?.message ?? e) }));
  let aiAvailable = health.ai !== false && !health.error;
  const live = await loadLive(fetchFn, base, cases);
  const ctx = { today, live, officials };
  const results = [];
  let first = true;
  for (const c of cases) {
    const needsAi = c.turns.some((t) => t.model || t.needsRewrite);
    if (needsAi && !aiAvailable) {
      results.push({ id: c.id, category: c.category, tier: c.tier, status: 'skip', reason: 'AI answers unavailable (daily Neuron cap or breaker)', turns: [] });
      log(`skip  ${c.id} (AI unavailable)`);
      continue;
    }
    const done = [];
    const turns = [];
    let status = 'pass';
    let reason = null;
    for (const [i, t] of c.turns.entries()) {
      if (!first) await sleep(delayMs);
      first = false;
      const conversation = [...c.conversation, ...historyFor(done)];
      const started = Date.now();
      let r = null;
      let fails;
      try {
        r = await ask(fetchFn, base, { question: t.question, ...(conversation.length ? { conversation } : {}) }, { sleep });
        fails = evalTurn(t, r, ctx);
      } catch (e) {
        fails = [`request failed: ${String(e?.message ?? e)}`];
      }
      const engine = String(r?.engine ?? '');
      if ((t.model || t.needsRewrite) && QUOTA.test(engine)) {
        aiAvailable = false;
        status = 'skip';
        reason = `AI quota reached during the run (${engine.slice(0, 120)})`;
      } else if (fails.length) status = 'fail';
      turns.push({ turn: i + 1, question: t.question, engine, ms: Date.now() - started, failures: fails, answer: String(r?.answer ?? '').slice(0, 1500), citations: (r?.citations ?? []).map((x) => ({ documentId: x.documentId, page: x.page ?? null })) });
      done.push({ question: t.question, response: r });
      if (status === 'skip') break;
    }
    results.push({ id: c.id, category: c.category, tier: c.tier, status, reason, turns });
    log(`${status.padEnd(5)} ${c.id}${status === 'fail' ? `: ${turns.flatMap((x) => x.failures.map((f) => `[turn ${x.turn}] ${f}`)).join('; ')}` : ''}`);
  }
  const count = (s) => results.filter((r) => r.status === s).length;
  return { base, today, health: { ai: health.ai ?? null, status: health.status ?? null, error: health.error ?? null }, summary: { total: results.length, pass: count('pass'), fail: count('fail'), skip: count('skip') }, results };
}

/* ------------------------------------------------------------------------------------------------ */
/* Reports                                                                                          */
/* ------------------------------------------------------------------------------------------------ */

export function renderTable(run) {
  const rows = run.results.map((r) => [r.status.toUpperCase(), r.id, r.category, r.tier, r.turns.map((t) => t.engine.split(' ')[0] || '-').join(' > ') || '-', String(r.turns.reduce((n, t) => n + t.ms, 0))]);
  const head = ['STATUS', 'CASE', 'CATEGORY', 'TIER', 'ENGINE', 'MS'];
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (r) => r.map((x, i) => x.padEnd(w[i])).join('  ');
  const fails = run.results.filter((r) => r.status === 'fail').flatMap((r) => r.turns.flatMap((t) => t.failures.map((f) => `  ${r.id} [turn ${t.turn}] ${f}`)));
  return [line(head), ...rows.map(line), '', `pass ${run.summary.pass}, fail ${run.summary.fail}, skip ${run.summary.skip} of ${run.summary.total}`, ...(fails.length ? ['', 'Failures:', ...fails] : [])].join('\n');
}

export function renderMarkdown(run, title = 'Chat suite') {
  const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const out = [`## ${title}: ${run.summary.fail ? `${run.summary.fail} failing` : 'all passing'}`, '', `${run.base}, ${run.today}. pass ${run.summary.pass}, fail ${run.summary.fail}, skip ${run.summary.skip} of ${run.summary.total}.${run.estimate ? ` Estimated Workers AI use: ${run.estimate.neurons} Neurons (worst ${run.estimate.worstNeurons}) of the ${DAILY_CAP} daily cap.` : ''}`, ''];
  const bad = run.results.filter((r) => r.status !== 'pass');
  if (bad.length) {
    out.push('| Case | Status | Turn | Problem | Answer |', '| --- | --- | --- | --- | --- |');
    for (const r of bad) {
      if (r.status === 'skip') out.push(`| ${esc(r.id)} | skip | | ${esc(r.reason ?? '')} | |`);
      for (const t of r.turns) for (const f of t.failures) out.push(`| ${esc(r.id)} | ${r.status} | ${t.turn} | ${esc(f)} | ${esc(t.answer.slice(0, 220))} |`);
    }
  }
  return out.join('\n');
}
