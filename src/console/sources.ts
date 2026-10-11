/** The Sources page list: outside systems only, by name. */
import type { SourceRegistryEntry } from '@/types/models';

/** Sources that are entries made on the portal itself, not outside systems. */
const PORTAL_OWN = new Set(['resident-submitted', 'portal-staff']);

/** Sources drawn on the map that produce no records of their own. */
export const MAP_ONLY = new Set(['utah-county-parcels']);

export function sourceRows(list: SourceRegistryEntry[]): SourceRegistryEntry[] {
  return list.filter((s) => !PORTAL_OWN.has(s.id) && (s.crawlEnabled || (s.documentCount ?? 0) > 0)).sort((a, b) => a.name.localeCompare(b.name));
}
