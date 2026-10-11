/**
 * The topics on the records home (/records), each defined once, precisely, for the Worker's counts
 * (GET /api/records/topics), the filtered list (GET /api/documents?topic=) and search inside a topic
 * (GET /api/search?topic=). Pure, so the same definition is tested and used everywhere.
 *
 * A record is in a topic when it matches ANY of the topic's types, bodies, sources or title patterns,
 * and NONE of its exclusions. Resident submissions are only ever in their own topic. Title patterns
 * are SQL LIKE patterns (case-insensitive for ASCII, as SQLite's LIKE is).
 */

export interface RecordTopic {
  id: string;
  label: string;
  /** One short line under the tile. */
  hint: string;
  /** A label carried by every record in the topic (resident submissions). */
  notice?: string;
  types?: string[];
  bodies?: string[];
  sources?: string[];
  titles?: string[];
  excludeTypes?: string[];
  excludeBodies?: string[];
  excludeSources?: string[];
  excludeTitles?: string[];
  /** A numbered index by year for this topic (/records/<index>). */
  index?: 'ordinances' | 'resolutions' | 'rda-resolutions';
}

export const RESIDENT_SOURCE = 'resident-submitted';
export const SHERIFF_SOURCE = 'ucso-press-releases';

const MEETING_TYPES = ['agenda', 'agenda_packet', 'minutes', 'transcript', 'recording'];
const WATER_QUALITY = ['%water quality%', '%consumer confidence%'];

export const RECORD_TOPICS: RecordTopic[] = [
  { id: 'meetings', label: 'Agendas and minutes', hint: 'Every public meeting', types: MEETING_TYPES },
  { id: 'ordinances', label: 'Ordinances', hint: 'City laws, adopted and proposed', types: ['ordinance'], index: 'ordinances' },
  { id: 'resolutions', label: 'Resolutions', hint: 'City Council resolutions', types: ['resolution'], excludeBodies: ['redevelopment-agency'], index: 'resolutions' },
  { id: 'budgets', label: 'Budgets and audits', hint: 'Budgets, financial reports, audits', types: ['budget', 'financial_report', 'audit'] },
  { id: 'contracts', label: 'Contracts and agreements', hint: 'Contracts, interlocal agreements, bids', types: ['contract', 'interlocal_agreement', 'professional_services_agreement', 'procurement'] },
  {
    id: 'land-use',
    label: 'Development and land use',
    hint: 'Development agreements, site plans, zoning',
    types: ['development_agreement', 'staff_report', 'map'],
    titles: ['%site plan%', '%subdivision%', '%rezone%', '%zone change%', '%zoning map%', '%final plat%', '%preliminary plat%', '%plat amendment%', '%annexation%', '%general plan amendment%', '%conditional use%'],
    excludeTypes: [...MEETING_TYPES, 'municipal_code'],
  },
  { id: 'rda', label: 'RDA', hint: 'Redevelopment Agency records', bodies: ['redevelopment-agency'], index: 'rda-resolutions' },
  { id: 'plans', label: 'Plans and studies', hint: 'Master plans, studies, reports', types: ['plan', 'study'], excludeTitles: WATER_QUALITY },
  { id: 'water-quality', label: 'Water quality reports', hint: 'Annual drinking water reports', titles: WATER_QUALITY, excludeTypes: MEETING_TYPES },
  { id: 'elections', label: 'Elections', hint: 'Notices, results, disclosures', titles: ['%election%', '%canvass%', '%candidate%', '%ballot%'], excludeTypes: [...MEETING_TYPES, 'municipal_code'] },
  { id: 'fees', label: 'Fee schedule', hint: 'The consolidated fee schedule', titles: ['%fee schedule%'], excludeTypes: MEETING_TYPES },
  { id: 'notices', label: 'Public notices', hint: 'Hearings, meetings, notices', types: ['public_notice'], excludeSources: [SHERIFF_SOURCE] },
  { id: 'sheriff', label: 'Sheriff updates', hint: 'Utah County Sheriff releases', sources: [SHERIFF_SOURCE] },
  { id: 'resident', label: 'Resident submissions', hint: 'Added by residents', notice: 'Resident submitted. Not a city record.', sources: [RESIDENT_SOURCE] },
];

export const topicById = (id: string | null | undefined): RecordTopic | null => RECORD_TOPICS.find((t) => t.id === id) ?? null;

/**
 * The WHERE fragment (no leading AND) for a topic, against a table alias with the catalog's columns
 * (document_type, government_body_id, source_id, title). Works for the catalog (`doc`) and the
 * search shards' shard_documents (`d`).
 */
export function topicSql(topic: RecordTopic, alias: string): { sql: string; params: unknown[] } {
  const a = alias;
  const any: string[] = [];
  const params: unknown[] = [];
  const list = (col: string, values: string[] | undefined, out: string[], not = false) => {
    if (!values?.length) return;
    out.push(`${not ? `coalesce(${col}, '') NOT IN` : `${col} IN`} (SELECT value FROM json_each(?))`);
    params.push(JSON.stringify(values));
  };
  const likes = (values: string[] | undefined, out: string[], not = false) => {
    if (!values?.length) return;
    out.push(`${not ? 'NOT ' : ''}EXISTS (SELECT 1 FROM json_each(?) p WHERE ${a}.title LIKE p.value)`);
    params.push(JSON.stringify(values));
  };
  list(`${a}.document_type`, topic.types, any);
  list(`${a}.government_body_id`, topic.bodies, any);
  list(`${a}.source_id`, topic.sources, any);
  likes(topic.titles, any);
  const all: string[] = [any.length ? `(${any.join(' OR ')})` : '1 = 1'];
  list(`${a}.document_type`, topic.excludeTypes, all, true);
  list(`${a}.government_body_id`, topic.excludeBodies, all, true);
  const excludeSources = [...(topic.excludeSources ?? []), ...(topic.sources?.includes(RESIDENT_SOURCE) ? [] : [RESIDENT_SOURCE])];
  list(`${a}.source_id`, excludeSources, all, true);
  likes(topic.excludeTitles, all, true);
  return { sql: all.join(' AND '), params };
}

const likeToRegExp = (p: string) => new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.')}$`, 'is');

/** The same rule as topicSql, for one record in memory (tests and client-side checks). */
export function matchesTopic(topic: RecordTopic, doc: { documentType: string; governmentBodyId?: string | null; sourceId?: string | null; title: string }): boolean {
  const like = (pats: string[] | undefined) => (pats ?? []).some((p) => likeToRegExp(p).test(doc.title));
  const inList = (v: string | null | undefined, xs: string[] | undefined) => Boolean(xs?.length && xs.includes(v ?? ''));
  const any = inList(doc.documentType, topic.types) || inList(doc.governmentBodyId, topic.bodies) || inList(doc.sourceId, topic.sources) || like(topic.titles);
  if (!any) return false;
  if (inList(doc.documentType, topic.excludeTypes) || inList(doc.governmentBodyId, topic.excludeBodies) || inList(doc.sourceId, topic.excludeSources)) return false;
  if (doc.sourceId === RESIDENT_SOURCE && !topic.sources?.includes(RESIDENT_SOURCE)) return false;
  return !like(topic.excludeTitles);
}
