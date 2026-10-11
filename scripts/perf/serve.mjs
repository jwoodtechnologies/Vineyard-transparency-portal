#!/usr/bin/env node
/**
 * Local stand-in for the portal for performance runs: serves a built dist/ (hashed assets immutable,
 * index.html no-cache, SPA fallback, gzip) and answers /api/* from saved API responses, with a fixed
 * server delay per API call (the Worker plus D1 on an edge miss).
 *
 *   node scripts/perf/serve.mjs --dist dist --fixtures <dir> [--port 4173] [--delay 300] [--draft-delay 1200] [--construction-delay 600]
 *        [--lines <dir with parcel-lines-low.json and parcel-lines-mid.json>]
 *
 * <dir>/index.txt lists saved responses as the Diagnostics workflow writes them
 * ("<file> <status> <bytes> <url>"). The aggregated page endpoints (/api/pages/*) are composed from the
 * same saved responses, the way worker/api/pages.ts composes them from the same handlers.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']] : acc), []),
);
const DIST = resolve(args.dist ?? 'dist');
const FIX = resolve(args.fixtures ?? 'fixtures');
const PORT = Number(args.port ?? 4173);
const DELAY = Number(args.delay ?? 300);
/** Slower handlers on an edge miss: draft minutes run eight full-text searches; the construction page parses up to twelve stored copies. */
const SLOW = [
  [/^\/api\/draft-minutes/, Number(args['draft-delay'] ?? 1200)],
  [/^\/api\/construction$/, Number(args['construction-delay'] ?? 600)],
];
const delayFor = (path) => SLOW.find(([re]) => re.test(path))?.[1] ?? DELAY;

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain', '.png': 'image/png' };

/** Saved responses keyed by path + sorted query (without the client's `_` marker). */
const keyOf = (u) => {
  const url = new URL(u, 'http://x');
  url.searchParams.delete('_');
  url.searchParams.sort();
  return `${url.pathname.replace(/\/+$/, '')}?${url.searchParams.toString()}`;
};
const saved = new Map();
for (const line of readFileSync(join(FIX, 'index.txt'), 'utf8').split('\n')) {
  const [file, status, , url] = line.trim().split(/\s+/);
  if (!url || status !== '200' || !url.includes('/api/')) continue;
  saved.set(keyOf(url.slice(url.indexOf('/api/'))), join(FIX, file));
}
const load = (path) => {
  const f = saved.get(keyOf(path));
  return f ? JSON.parse(readFileSync(f, 'utf8')) : null;
};
const lite = (items) => (items ?? []).map((m) => ({ id: m.id, title: m.title, date: m.date, status: m.status, governmentBodyId: m.governmentBodyId || null, governmentBodyName: m.governmentBodyName || null, meetingType: m.meetingType }));

/** The aggregated endpoints, from the same saved responses. */
function page(name, url) {
  const year = url.searchParams.get('year') ?? '2026';
  const body = name === 'planning' ? 'planning-commission' : url.searchParams.get('body') ?? '';
  if (name === 'construction') return { version: 1, construction: load('/api/construction'), projects: load('/api/map/layers/projects?page=0&v=5') };
  const bq = body ? `&body=${body}` : '';
  const bodies = body ? [body] : ['city-council', 'redevelopment-agency'];
  const out = {
    version: 1,
    kind: body === 'planning-commission' ? 'planning' : body ? 'rda' : 'council',
    years: load(`/api/votes/years?scope=current${bq}`)?.years ?? [],
    year: Number(year),
    motions: load(`/api/votes?scope=current${bq}&year=${year}&pageSize=400`) ?? { items: [], total: 0 },
    meetings: bodies.flatMap((b) => lite(load(`/api/meetings?year=${year}&body=${b}&pageSize=100&sort=date_desc`)?.items)),
    read: load(`/api/votes/meetings?year=${year}${bq}`)?.meetings ?? [],
    people: load('/api/people')?.people ?? [],
  };
  if (out.kind === 'planning') {
    out.attendance = load('/api/votes/attendance');
    out.drafts = {};
  }
  return out;
}

function api(req, url) {
  const path = url.pathname.replace(/\/+$/, '');
  if (req.method === 'POST') return [204, null];
  const m = /^\/api\/pages\/(votes|planning|construction)$/.exec(path);
  if (m) return [200, page(m[1], url)];
  if (path === '/api/draft-minutes') return [200, { draft: null }];
  const hit = load(`${path}${url.search}`) ?? (path === '/api/map/layers' ? load('/api/map/layers') : null);
  if (hit) return [200, hit];
  if (path.startsWith('/api/map/layers/')) return [200, { type: 'FeatureCollection', features: [] }];
  return [404, { error: { kind: 'not_found', message: 'Not saved.' } }];
}

const gz = new Map();
function send(req, res, status, type, buf, cache) {
  const headers = { 'content-type': type, 'cache-control': cache };
  if (/gzip/.test(req.headers['accept-encoding'] ?? '') && buf.length > 512 && /text|json|javascript|svg|manifest/.test(type)) {
    headers['content-encoding'] = 'gzip';
    headers.vary = 'accept-encoding';
    buf = buf.__path ? gz.get(buf.__path) ?? gz.set(buf.__path, gzipSync(buf)).get(buf.__path) : gzipSync(buf);
  }
  res.writeHead(status, { ...headers, 'content-length': buf.length });
  res.end(req.method === 'HEAD' ? undefined : buf);
}

/** Parcel line sets (ingest/parcel_lines.py output), served gzipped like the Worker serves them from R2. */
const LINES = args.lines ? resolve(args.lines) : null;
function lines(req, res, url) {
  const level = url.searchParams.get('level');
  const file = LINES && /^(low|mid)$/.test(level ?? '') ? join(LINES, `parcel-lines-${level}.json`) : null;
  setTimeout(() => {
    if (!file || !existsSync(file)) return void res.writeHead(404, { 'content-type': 'application/json' }).end('{}');
    const buf = gz.get(file) ?? gz.set(file, gzipSync(readFileSync(file), { level: 9 })).get(file);
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-encoding': 'gzip', 'cache-control': 'public, max-age=3600, stale-while-revalidate=604800', 'content-length': buf.length });
    res.end(buf);
  }, DELAY);
}

createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === '/api/map/parcel-lines') return lines(req, res, url);
  if (url.pathname.startsWith('/api/')) {
    const [status, body] = api(req, url);
    setTimeout(() => {
      if (body === null) return void res.writeHead(status).end();
      send(req, res, status, 'application/json; charset=utf-8', Buffer.from(JSON.stringify(body)), status === 200 ? 'public, max-age=60' : 'no-store');
    }, delayFor(url.pathname));
    return;
  }
  let file = join(DIST, decodeURIComponent(url.pathname));
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  const buf = readFileSync(file);
  buf.__path = file;
  const cache = url.pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : file.endsWith('index.html') ? 'no-cache' : 'public, max-age=300';
  send(req, res, 200, TYPES[extname(file)] ?? 'application/octet-stream', buf, cache);
}).listen(PORT, () => console.log(`perf stand-in on http://localhost:${PORT} (dist ${DIST}, ${saved.size} saved API responses, ${DELAY} ms per API call)`));
