/** Human-readable discovery summary (printed to the terminal and written next to the JSON). */
import { SYSTEM_KIND_LABELS } from './discover';
import type { DiscoveryManifest, SourceSystemKind } from './types';

export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

export function formatDiscoverySummary(manifest: DiscoveryManifest, outPath: string | null): string {
  const s = manifest.summary;
  const lines: string[] = [];
  lines.push('Vineyard source discovery complete.');
  lines.push('');
  lines.push(`${plural(s.sourceSystems, 'source system')} identified.`);
  lines.push(`${plural(s.directDocumentLinks, 'direct document link')} identified.`);
  lines.push(`${plural(s.meetingOrPublicNoticeSystems, 'meeting/public-notice system')} identified.`);
  lines.push(`${plural(s.financialReportingSystems, 'financial-reporting system')} identified.`);
  lines.push(`${plural(s.municipalCodeSystems, 'municipal-code system')} identified.`);
  lines.push('');
  lines.push(`Seed: ${manifest.seed}`);
  lines.push(`Generated: ${manifest.generatedAt}`);
  lines.push(
    `Pages fetched: ${manifest.stats.pagesFetched} (max depth ${manifest.options.maxDepth}); failed: ${manifest.stats.pagesFailed}; ` +
      `links seen: ${manifest.stats.linksSeen} (${manifest.stats.uniqueLinks} unique)`,
  );
  lines.push(
    `Skipped: ${manifest.stats.skippedDenied} denied-domain, ${manifest.stats.skippedNotRelevant} not-relevant, ` +
      `${manifest.stats.skippedDepth} beyond depth, ${manifest.stats.skippedRobots} robots.txt, ${manifest.stats.skippedTrap} trap/skip-pattern`,
  );
  lines.push(`Document libraries: ${s.documentLibraries}; media links: ${manifest.stats.mediaLinks}; document probes: ${manifest.stats.documentProbes}`);
  lines.push('');
  lines.push('Source systems:');
  const kinds = Object.keys(manifest.sources).sort() as SourceSystemKind[];
  if (!kinds.length) lines.push('  (none)');
  for (const kind of kinds) {
    for (const src of manifest.sources[kind] ?? []) {
      const flags = [src.reviewStatus === 'needs_review' ? 'NEEDS REVIEW' : 'configured', src.reached ? 'reached' : 'linked', src.hostApproved ? 'approved host' : 'unapproved host'];
      lines.push(`  [${SYSTEM_KIND_LABELS[kind]}] ${src.name}`);
      lines.push(`      ${src.baseUrl}  (${flags.join(', ')}; ${src.linkCount} links, ${src.documentLinkCount} documents)`);
      if (src.discoveredFrom) lines.push(`      discovered from ${src.discoveredFrom}`);
    }
  }
  if (manifest.configuredSeedsNotObserved.length) {
    lines.push('');
    lines.push(`Configured seeds not linked from crawled pages this run: ${manifest.configuredSeedsNotObserved.join(', ')}`);
  }
  const byKind = new Map<string, number>();
  for (const d of manifest.documents) byKind.set(d.fileKind ?? 'unknown', (byKind.get(d.fileKind ?? 'unknown') ?? 0) + 1);
  if (byKind.size) {
    lines.push('');
    lines.push(`Documents by file kind: ${[...byKind.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')}`);
  }
  const byType = new Map<string, number>();
  for (const d of manifest.documents) if (d.documentTypeHint) byType.set(d.documentTypeHint, (byType.get(d.documentTypeHint) ?? 0) + 1);
  if (byType.size) {
    lines.push(`Document type hints (URL/link-text heuristics): ${[...byType.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')}`);
  }
  lines.push('');
  lines.push(`Redirects recorded: ${manifest.redirects.length}`);
  lines.push(`Errors: ${manifest.errors.length}`);
  for (const e of manifest.errors.slice(0, 10)) lines.push(`  - [${e.kind}] ${e.url}: ${e.message}`);
  if (manifest.errors.length > 10) lines.push(`  ... ${manifest.errors.length - 10} more in the JSON output`);
  if (outPath) {
    lines.push('');
    lines.push(`Output: ${outPath}`);
  }
  return lines.join('\n');
}
