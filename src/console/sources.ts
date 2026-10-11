/** The Sources page list: outside systems that have completed a successful run, newest record first. */
import type { SourceRegistryEntry } from '@/types/models';

/** Sources that are entries made on the portal itself, not outside systems. */
const PORTAL_OWN = new Set(['resident-submitted', 'portal-staff']);

/** Sources drawn on the map that produce no records of their own. */
export const MAP_ONLY = new Set(['utah-county-parcels']);

export function sourceRows(list: SourceRegistryEntry[]): SourceRegistryEntry[] {
  const ran = (s: SourceRegistryEntry) => Boolean(s.health?.lastSuccessfulCheckAt) || (s.documentCount ?? 0) > 0;
  const when = (s: SourceRegistryEntry) => s.lastNewRecordAt ?? s.health?.lastSuccessfulCheckAt ?? '';
  return list
    .filter((s) => !PORTAL_OWN.has(s.id) && (s.crawlEnabled || (s.documentCount ?? 0) > 0) && ran(s))
    .sort((a, b) => when(b).localeCompare(when(a)) || a.name.localeCompare(b.name));
}
