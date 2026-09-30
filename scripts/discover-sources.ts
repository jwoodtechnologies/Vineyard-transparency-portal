/**
 * npm run discover-sources [-- --seed <url>] [--max-depth N] [--max-pages N] [--out file]
 *                             [--dry-run] [--no-probe] [--allow-host host]... [--delay-ms N] [--verbose]
 *
 * Crawls the PRIMARY SOURCE SEED (config/source-seeds.json → primarySourceSeed) and writes:
 *   data/discovered-sources.json         machine-readable manifest (sources grouped, documents, redirects, errors)
 *   data/discovered-sources.summary.txt  the human-readable summary printed below
 *
 * Exit codes: 0 success, 1 usage/config error, 2 the seed could not be retrieved (nothing written).
 * See docs/SOURCE_DISCOVERY.md.
 */
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadSeedsConfig, userAgentWarning } from './lib/config';
import { discover } from './lib/discover';
import { httpOptionsFromPolicy, PoliteHttpClient } from './lib/http';
import { PATHS } from './lib/paths';
import { formatDiscoverySummary } from './lib/summary';
import { parsePositiveInt, relativeToCwd, runCli, writeJsonAtomic, writeTextAtomic } from './lib/cli';
import { hostOf } from './lib/url';

const HELP = `Usage: npm run discover-sources -- [options]

  --seed <url>        Start URL (default: primarySourceSeed from config/source-seeds.json)
  --max-depth <n>     Maximum link depth from the seed (default: crawlPolicy.defaultMaxDepth)
  --max-pages <n>     Maximum HTML pages fetched (default: crawlPolicy.maxPagesPerRun)
  --out <file>        Output JSON path (default: data/discovered-sources.json)
  --config <file>     Seeds config (default: config/source-seeds.json)
  --dry-run           Print the summary but do not write any files
  --no-probe          Do not HEAD/GET-probe document links for content type/length
  --allow-host <h>    Treat host as approved for crawling (repeatable; for local testing)
  --delay-ms <n>      Override the per-host request delay (default: crawlPolicy.requestDelayMs)
  --verbose           Log each request
  --help              Show this help`;

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      seed: { type: 'string' },
      'max-depth': { type: 'string' },
      'max-pages': { type: 'string' },
      out: { type: 'string' },
      config: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      'no-probe': { type: 'boolean', default: false },
      'allow-host': { type: 'string', multiple: true },
      'delay-ms': { type: 'string' },
      verbose: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    strict: true,
  });
  if (values.help) {
    console.log(HELP);
    return 0;
  }

  const config = loadSeedsConfig(values.config ?? PATHS.sourceSeeds);
  const seed = values.seed ?? config.primarySourceSeed;
  const out = path.resolve(values.out ?? PATHS.discoveredSources);
  const summaryOut = out.replace(/\.json$/i, '') + '.summary.txt';
  const delay = parsePositiveInt(values['delay-ms'], 'delay-ms');
  const extraAllowedHosts = values['allow-host'] ?? [];

  const uaWarning = userAgentWarning(config);
  if (uaWarning) console.warn(`Warning: ${uaWarning}\n`);

  const http = new PoliteHttpClient(
    httpOptionsFromPolicy(config.crawlPolicy, {
      requestDelayMs: delay ?? config.crawlPolicy.requestDelayMs,
      log: values.verbose ? (m) => console.log(m) : undefined,
    }),
  );

  console.log(`Discovering public-record sources from ${seed}`);
  console.log(`(robots.txt respected; ${delay ?? config.crawlPolicy.requestDelayMs} ms between requests per host)\n`);

  const manifest = await discover({
    config,
    http,
    seed,
    maxDepth: parsePositiveInt(values['max-depth'], 'max-depth'),
    maxPages: parsePositiveInt(values['max-pages'], 'max-pages'),
    probeDocuments: !values['no-probe'],
    extraAllowedHosts,
    log: values.verbose ? (m) => console.log(m) : undefined,
  });

  if (!manifest.seedReachable) {
    const seedErrors = manifest.errors.filter((e) => e.url === seed || manifest.pages.length === 0);
    console.error('Vineyard source discovery FAILED: the seed page could not be retrieved.\n');
    console.error(`Seed: ${seed}`);
    for (const e of seedErrors.slice(0, 5)) console.error(`Reason: [${e.kind}] ${e.message}${e.status ? ` (HTTP ${e.status})` : ''}`);
    console.error('');
    const policyBlocked = manifest.errors.some((e) => e.kind === 'blocked_by_network_policy');
    if (policyBlocked) {
      console.error(
        `The response came from a network egress policy/proxy on this machine, not from ${hostOf(seed)}.\n` +
          `Allow outbound HTTPS to ${hostOf(seed)} (and the other hosts in config/source-seeds.json → approvedDomains)\n` +
          'or run discovery from a machine with normal internet access.',
      );
    } else {
      console.error(
        `Check that this machine can reach ${hostOf(seed)} (network access, DNS, firewall/proxy allowlist).\n` +
          'If your network requires an HTTP proxy, recent Node.js releases can use it via NODE_USE_ENV_PROXY=1 with HTTPS_PROXY set.',
      );
    }
    console.error('\nNothing was written. No discovery results were fabricated.');
    console.error('Re-run with: npm run discover-sources');
    return 2;
  }

  const summary = formatDiscoverySummary(manifest, values['dry-run'] ? null : relativeToCwd(out));
  if (!values['dry-run']) {
    writeJsonAtomic(out, manifest);
    writeTextAtomic(summaryOut, summary);
  }
  console.log(summary);
  if (values['dry-run']) console.log('\n(dry run: no files written)');
  return 0;
}

runCli(main);
