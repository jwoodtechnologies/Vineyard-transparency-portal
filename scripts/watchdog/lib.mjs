/**
 * Watchdog logic (pure, no I/O): which jobs are failing, and what to do with the GitHub issues.
 * Used by scripts/watchdog/run.mjs and tested in tests/watchdog.test.ts.
 *
 * Items:
 *   - every scheduled check and source from GET /api/health/jobs: failing at 3 failures in a row,
 *     recovered below that (the counter only drops on a success);
 *   - the nightly chat suite (the newest scheduled run of chat-suite.yml): failing when it failed,
 *     recovered when it passed;
 *   - the nightly document check (the newest scheduled run of doc-check.yml): failing when it failed,
 *     recovered when it passed;
 *   - the scheduled ingest workflow (ingest.yml): failing after 3 failed scheduled runs in a row,
 *     recovered below that. Cancelled and skipped runs are not counted.
 * Issues: one open issue per failing item, found by label and exact title. A still-failing item gets at
 * most one comment a day; a recovered item's issue is closed with a comment.
 */

export const LABEL = 'watchdog';
export const THRESHOLD = 3;
export const NOTE_EVERY_MS = 24 * 3600_000;
export const MARKER = '<!-- watchdog -->';

/**
 * Checks that are expected to fail and are not watched: `civicclerk` is the Worker's hourly try at the
 * city's agenda portal, which refuses Cloudflare (403); the GitHub ingest reads that portal instead and is
 * watched as `ingest`. An open issue for one of these is closed.
 */
export const QUIET = new Set(['job:civicclerk', 'source:civicclerk']);

const FAILED = new Set(['failure', 'timed_out', 'startup_failure']);

/** "2026-10-11T07:41:12.345Z" as "2026-10-11 07:41 UTC". */
export function stamp(iso) {
  if (!iso) return 'never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`, 'g');

/** One line, no dashes that read as em or en dashes, at most 400 characters. */
export function clean(text) {
  const s = String(text ?? '').replace(DASHES, '-').replace(/\s+/g, ' ').trim();
  return s.length > 400 ? `${s.slice(0, 399)}...` : s;
}

/** Failed runs in a row, newest first, ignoring cancelled and skipped runs. */
export function failureStreak(runs) {
  let n = 0;
  for (const r of runs ?? []) {
    if (r.status && r.status !== 'completed') continue;
    if (r.conclusion === 'cancelled' || r.conclusion === 'skipped' || r.conclusion === 'neutral' || r.conclusion == null) continue;
    if (FAILED.has(r.conclusion)) n++;
    else break;
  }
  return n;
}

function rowItem(row, kind, base) {
  const title = kind === 'source' ? `Watchdog: source ${row.id} failing` : `Watchdog: ${row.id} failing`;
  const what = kind === 'source' ? `Source \`${row.id}\`${row.name && row.name !== row.id ? ` (${clean(row.name)})` : ''}` : `Scheduled check \`${row.id}\``;
  const n = Number(row.consecutiveFailures ?? 0);
  const lines = [
    `${what} has failed ${n} times in a row.`,
    '',
    `- Last error: ${row.lastError ? clean(row.lastError) : 'none recorded'}`,
    `- Last error at: ${stamp(row.lastErrorAt)}`,
    `- Last success: ${stamp(row.lastSuccessAt)}`,
    `- Last run: ${stamp(row.lastRunAt)}`,
    ...(row.status ? [`- Status: ${clean(row.status)}`] : []),
    `- Health: ${base}/api/health/jobs`,
  ];
  const key = `${kind}:${row.id}`;
  return { key, title, failing: !QUIET.has(key) && (row.failing === true || n >= THRESHOLD), details: lines.join('\n') };
}

/**
 * Every watched item. `health` is the /api/health/jobs body (null when it could not be read);
 * `chatRun` the newest completed scheduled chat suite run (null when unknown); `docRun` the same for the
 * document check; `ingestRuns` the
 * newest completed scheduled ingest runs, newest first (null when unknown).
 */
export function evaluate({ health, chatRun, docRun = null, ingestRuns, repo, base, server = 'https://github.com' }) {
  const items = [];
  if (health) {
    for (const row of health.jobs ?? []) items.push(rowItem(row, 'job', base));
    for (const row of health.sources ?? []) items.push(rowItem(row, 'source', base));
  }
  if (chatRun) {
    const failed = FAILED.has(chatRun.conclusion);
    const ok = chatRun.conclusion === 'success';
    items.push({
      key: 'chat-suite',
      title: 'Watchdog: chat suite failing',
      failing: failed ? true : ok ? false : null,
      details: [
        `The nightly chat suite run ${chatRun.id} ended with: ${clean(chatRun.conclusion)}.`,
        '',
        `- Run: ${chatRun.html_url ?? `${server}/${repo}/actions/runs/${chatRun.id}`}`,
        `- Started: ${stamp(chatRun.run_started_at ?? chatRun.created_at)}`,
        `- Results: ${server}/${repo}/blob/diagnostics/suite/${chatRun.id}/results.json`,
      ].join('\n'),
    });
  }
  if (docRun) {
    const failed = FAILED.has(docRun.conclusion);
    const ok = docRun.conclusion === 'success';
    items.push({
      key: 'doc-check',
      title: 'Watchdog: document check failing',
      failing: failed ? true : ok ? false : null,
      details: [
        `The nightly document check run ${docRun.id} ended with: ${clean(docRun.conclusion)}. A record page showed a blank, faint or unstyled viewer, page text that does not match the record, or a linked record that does not open.`,
        '',
        `- Run (summary lists each failing record): ${docRun.html_url ?? `${server}/${repo}/actions/runs/${docRun.id}`}`,
        `- Started: ${stamp(docRun.run_started_at ?? docRun.created_at)}`,
        `- Report: ${server}/${repo}/blob/diagnostics/doc-check/${docRun.id}/report.json`,
      ].join('\n'),
    });
  }
  if (ingestRuns) {
    const n = failureStreak(ingestRuns);
    const counted = ingestRuns.filter((r) => r.conclusion && !['cancelled', 'skipped', 'neutral'].includes(r.conclusion));
    const last = counted[0];
    const lastOk = counted.find((r) => r.conclusion === 'success');
    items.push({
      key: 'ingest',
      title: 'Watchdog: ingest workflow failing',
      failing: n >= THRESHOLD ? true : last ? false : null,
      details: [
        `The scheduled ingest workflow has failed ${n} runs in a row.`,
        '',
        ...(last ? [`- Last run: ${last.html_url ?? `${server}/${repo}/actions/runs/${last.id}`} (${stamp(last.run_started_at ?? last.created_at)})`] : []),
        `- Last success: ${lastOk ? stamp(lastOk.run_started_at ?? lastOk.created_at) : `not in the last ${ingestRuns.length} runs`}`,
      ].join('\n'),
    });
  }
  return items;
}

/**
 * The issue actions for `items`, given the open watchdog issues ({ number, title, lastNoteAt }, where
 * lastNoteAt is the newest watchdog comment, or the issue's creation time). `complete` says the item list
 * covers every job and source (the health endpoint was read), so an open issue for an item no longer
 * listed is closed.
 */
export function plan(items, openIssues, now = Date.now(), complete = true) {
  const actions = [];
  const byTitle = new Map(openIssues.map((i) => [i.title, i]));
  const seen = new Set();
  for (const item of items) {
    seen.add(item.title);
    const open = byTitle.get(item.title);
    if (item.failing === true) {
      if (!open) actions.push({ type: 'create', title: item.title, body: `${MARKER}\n${item.details}\n\nThis issue closes itself when the job recovers.` });
      else if (!open.lastNoteAt || now - Date.parse(open.lastNoteAt) >= NOTE_EVERY_MS) actions.push({ type: 'comment', number: open.number, title: item.title, body: `${MARKER}\nStill failing at ${stamp(new Date(now).toISOString())}.\n\n${item.details}` });
    } else if (item.failing === false && open) {
      actions.push({ type: 'close', number: open.number, title: item.title, body: `${MARKER}\nRecovered at ${stamp(new Date(now).toISOString())}.\n\n${item.details}` });
    }
  }
  if (complete) {
    for (const i of openIssues) {
      if (seen.has(i.title) || !/^Watchdog: (source )?\S+ failing$/.test(i.title) || /^Watchdog: (chat suite|document check|ingest workflow) failing$/.test(i.title)) continue;
      actions.push({ type: 'close', number: i.number, title: i.title, body: `${MARKER}\nNo longer listed at /api/health/jobs (${stamp(new Date(now).toISOString())}).` });
    }
  }
  return actions;
}

/** The newest watchdog note on an issue: its last comment carrying the marker, else when it was opened. */
export function lastNoteAt(issue, comments) {
  const mine = (comments ?? []).filter((c) => String(c.body ?? '').includes(MARKER));
  return mine.length ? mine[mine.length - 1].created_at : issue.created_at;
}
