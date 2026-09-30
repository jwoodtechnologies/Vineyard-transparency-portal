/**
 * CivicClerk (Vineyard's meeting portal) mapping for the hourly check. Mirrors
 * ingest/adapters/civicclerk.py exactly (same ids, slugs, queue keys and metadata keys), so the
 * nightly Python crawl and this hourly check describe every meeting and file the same way.
 * Pure: no Cloudflare types, unit-testable.
 */
export const CC_TENANT = 'vineyardut';
export const CC_API = `https://${CC_TENANT}.api.civicclerk.com/v1`;
export const CC_PORTAL = `https://${CC_TENANT}.portal.civicclerk.com`;
export const CC_SOURCE = 'vineyard-civicclerk-meetings';

const FILE_TYPES: Record<string, [string, string, string]> = {
  agenda: ['agenda', 'agenda', 'MEETING_HAS_AGENDA'],
  'agenda packet': ['agenda_packet', 'packet', 'MEETING_HAS_PACKET'],
  minutes: ['minutes', 'minutes', 'MEETING_HAS_MINUTES'],
};

const BODY_KIND: Array<[string, string]> = [
  ['council', 'council'],
  ['commission', 'commission'],
  ['redevelopment', 'agency'],
  ['rda', 'agency'],
  ['board', 'board'],
  ['committee', 'committee'],
];

const TYPE_RULES: Array<[RegExp, string]> = [
  [/\bagenda\s*packet|\bpacket\b/, 'agenda_packet'],
  [/\bagenda\b/, 'agenda'],
  [/\bminutes\b/, 'minutes'],
  [/\bordinance\b|\bord\.?\s*\d/, 'ordinance'],
  [/\bresolution\b|\bres\.?\s*\d/, 'resolution'],
  [/\bproclamation\b/, 'proclamation'],
  [/development\s+agreement/, 'development_agreement'],
  [/interlocal/, 'interlocal_agreement'],
  [/professional\s+services/, 'professional_services_agreement'],
  [/\baudit\b|observations\s+and\s+recommendations/, 'audit'],
  [/annual\s+(comprehensive\s+)?financial\s+report|\bacfr\b|\bcafr\b|financial\s+statements?/, 'financial_report'],
  [/\bbudget\b|budget\s+amendment|citizen'?s\s+budget/, 'budget'],
  [/\brfp\b|\brfq\b|request\s+for\s+(proposals?|qualifications)|\bbid\b|procurement/, 'procurement'],
  [/\bcontract\b|\bagreement\b/, 'contract'],
  [/staff\s+report/, 'staff_report'],
  [/public\s+notice|notice\s+of\b|public\s+hearing\s+notice/, 'public_notice'],
  [/\bslides?\b|\bpresentation\b/, 'presentation'],
  [/\bmemo(randum)?\b/, 'memorandum'],
  [/\bmap\b/, 'map'],
  [/master\s+plan|general\s+plan|\bplan\b/, 'plan'],
  [/water\s+quality|consumer\s+confidence|\bccr\b|\bstudy\b|\breport\b|\banalysis\b/, 'study'],
];

export function classifyType(...texts: Array<string | null | undefined>): string {
  const blob = texts.filter(Boolean).join(' ').toLowerCase().replace(/_/g, ' ');
  for (const [re, kind] of TYPE_RULES) if (re.test(blob)) return kind;
  return 'other';
}

export function pySlug(text: string, fallback = 'body'): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || fallback;
}

export function bodyFor(category: string | null | undefined): { id: string; name: string; kind: string } | null {
  if (!category) return null;
  const name = category.trim();
  const kind = BODY_KIND.find(([needle]) => name.toLowerCase().includes(needle))?.[1] ?? 'other';
  return { id: pySlug(name), name, kind };
}

export const fileUrl = (fileId: number) => `${CC_API}/Meetings/GetMeetingFileStream(fileId=${Math.trunc(fileId)},plainText=false)`;

/** CivicClerk sends Vineyard wall-clock time with a "Z" suffix: treat the clock value as local. */
export function localParts(value: unknown): { date: string; time: string } | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(String(value ?? ''));
  return m ? { date: m[1], time: m[2] } : null;
}

/** Offset of America/Denver from UTC at a local wall-clock moment, in hours (6 or 7). */
function denverOffsetHours(date: string): number {
  const [y, mo, d] = date.split('-').map(Number);
  // DST in the US: second Sunday in March to first Sunday in November.
  const nthSunday = (month: number, n: number) => {
    const first = new Date(Date.UTC(y, month, 1)).getUTCDay();
    return 1 + ((7 - first) % 7) + (n - 1) * 7;
  };
  const start = Date.UTC(y, 2, nthSunday(2, 2));
  const end = Date.UTC(y, 10, nthSunday(10, 1));
  const t = Date.UTC(y, mo - 1, d);
  return t >= start && t < end ? 6 : 7;
}

export interface CcEvent {
  id: number;
  eventName?: string;
  agendaName?: string;
  categoryName?: string;
  eventCategoryName?: string;
  startDateTime?: string;
  eventDate?: string;
  isDeleted?: boolean;
  isPublished?: string | null;
  externalMediaUrl?: string | null;
  youtubeVideoId?: string | null;
  eventLocation?: { address1?: string; city?: string; state?: string } | null;
  publishedFiles?: Array<{ fileId?: number; type?: string; name?: string; url?: string; publishOn?: string }>;
}

export interface MappedEvent {
  meeting: Record<string, unknown>;
  body: { id: string; name: string; kind: string } | null;
  files: Array<{ identifier: string; url: string; parentUrl: string; priority: number; metadata: Record<string, unknown> }>;
}

export function mapEvent(ev: CcEvent, now = new Date()): MappedEvent | null {
  if (ev.isDeleted || !(ev.isPublished == null || ev.isPublished === 'Published')) return null;
  const local = localParts(ev.startDateTime ?? ev.eventDate);
  const body = bodyFor(ev.categoryName ?? ev.eventCategoryName);
  const name = (ev.eventName ?? 'Meeting').trim() || 'Meeting';
  const agendaName = (ev.agendaName ?? '').trim();
  const label = `${name} ${agendaName}`.toLowerCase();
  const meetingType = label.includes('special') ? 'special' : label.includes('work session') ? 'work_session' : label.includes('emergency') ? 'emergency' : label.includes('regular') || label.includes('meeting') ? 'regular' : 'other';
  const meetingId = `mtg_cc_${Math.trunc(ev.id)}`;
  const media: Array<Record<string, unknown>> = [];
  if (ev.externalMediaUrl) media.push({ kind: 'video', label: 'Meeting video', url: ev.externalMediaUrl, sourceId: CC_SOURCE });
  if (ev.youtubeVideoId) media.push({ kind: 'video', label: 'Meeting video (YouTube)', url: `https://www.youtube.com/watch?v=${ev.youtubeVideoId}`, sourceId: CC_SOURCE });
  const loc = ev.eventLocation ?? {};
  const location = [loc.address1, loc.city, loc.state].filter(Boolean).join(', ') || null;
  const title = agendaName && agendaName.toLowerCase() !== name.toLowerCase() ? agendaName : name;
  let held = false;
  if (local) {
    const [hh, mm] = local.time.split(':').map(Number);
    const [y, mo, d] = local.date.split('-').map(Number);
    held = Date.UTC(y, mo - 1, d, hh + denverOffsetHours(local.date), mm) < now.getTime();
  }
  const parentUrl = `${CC_PORTAL}/event/${Math.trunc(ev.id)}/files`;
  const meeting = {
    id: meetingId,
    slug: [pySlug(title, 'body').slice(0, 100), local?.date, String(ev.id)].filter(Boolean).join('-'),
    title,
    governmentBodyId: body?.id ?? null,
    governmentBodyName: body?.name ?? null,
    meetingType,
    date: local?.date ?? null,
    startTime: local?.time ?? null,
    location,
    status: label.includes('cancel') ? 'cancelled' : held ? 'held' : 'scheduled',
    sourceId: CC_SOURCE,
    sourceUrl: parentUrl,
    externalId: String(ev.id),
    media,
  };
  const files: MappedEvent['files'] = [];
  for (const f of ev.publishedFiles ?? []) {
    if (!f.fileId) continue;
    const ftype = (f.type ?? '').trim().toLowerCase();
    const known = FILE_TYPES[ftype];
    const docType = known ? known[0] : ftype ? classifyType(f.name, ftype) : 'other';
    files.push({
      identifier: `civicclerk:${CC_TENANT}:file:${Math.trunc(f.fileId)}`,
      url: fileUrl(f.fileId),
      parentUrl,
      priority: known ? 50 : 80,
      metadata: {
        title: (f.name ?? `${title} ${f.type ?? 'file'}`).trim(),
        fileType: f.type ?? null,
        documentType: docType,
        documentDate: local?.date ?? null,
        meetingId,
        meetingTitle: title,
        meetingRole: known ? known[1] : null,
        relationship: known ? known[2] : null,
        governmentBodyId: body?.id ?? null,
        governmentBodyName: body?.name ?? null,
        publishedAt: f.publishOn ?? null,
        externalId: `civicclerk:file:${Math.trunc(f.fileId)}`,
        fileNameHint: (f.url ?? '').split('/').pop() ?? '',
      },
    });
  }
  return { meeting, body, files };
}
