/**
 * The order of one meeting's records, shared by the API (worker/api/trail.ts) and the record page: the agenda,
 * the packet and the minutes first, then every file attached to an agenda item in agenda order (item 4 before
 * 4.1 before 5 before 10), the measure itself first within its item, then anything else.
 */
import { ingestSuffix } from './recordTitle';

export interface OrderDoc {
  id: string;
  title: string;
  documentType: string;
  description?: string | null;
  agendaItemId?: string | null;
}

const MAIN: Record<string, number> = { agenda: 0, agenda_packet: 1, minutes: 2 };

/** The agenda item number a file was filed under ("5.1"), from the "(meeting, date, item 5.1)" the ingest adds. */
export function itemNumberOf(d: Pick<OrderDoc, 'title'>): string | null {
  return ingestSuffix(d.title)?.item ?? null;
}

/** True for a file attached to an agenda item (it carries the ingest's "(meeting, date, ...)" ending, or an item id). */
export function isAttachment(d: Pick<OrderDoc, 'title' | 'agendaItemId'>): boolean {
  if (d.agendaItemId) return true;
  const s = ingestSuffix(d.title);
  return Boolean(s && (s.item || s.meeting));
}

/**
 * Which agenda item a file belongs to: its item id, else its item number, else the item's name (the ingest stores
 * it as the description). Null for the agenda, packet, minutes and anything not filed under an item.
 */
export function itemKeyOf(d: OrderDoc): string | null {
  if (d.agendaItemId) return `id:${d.agendaItemId}`;
  if (!isAttachment(d)) return null;
  const n = itemNumberOf(d);
  if (n) return `n:${n.toLowerCase()}`;
  const desc = d.description?.trim();
  return desc ? `d:${desc.toLowerCase()}` : null;
}

/** "4" < "4.1" < "4.2" < "5" < "10"; "8.a" < "8.b". */
export function compareOutline(a: string, b: string): number {
  const pa = a.toLowerCase().split(/[.\s)-]+/).filter(Boolean);
  const pb = b.toLowerCase().split(/[.\s)-]+/).filter(Boolean);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] === undefined) return -1;
    if (pb[i] === undefined) return 1;
    const na = /^\d+$/.test(pa[i]) ? Number(pa[i]) : NaN;
    const nb = /^\d+$/.test(pb[i]) ? Number(pb[i]) : NaN;
    if (!Number.isNaN(na) && !Number.isNaN(nb)) {
      if (na !== nb) return na - nb;
    } else if (pa[i] !== pb[i]) return pa[i].localeCompare(pb[i], undefined, { numeric: true });
  }
  return 0;
}

const MEASURE = /\b(ordinance|resolution)\b/i;
const byTitle = (a: OrderDoc, b: OrderDoc) => a.title.localeCompare(b.title, undefined, { numeric: true });

/**
 * One meeting's records in agenda order. `itemSort` gives an agenda item's position by id (the agenda_items
 * table) when the archive has it; otherwise the item numbers decide.
 */
export function orderMeetingDocs<T extends OrderDoc>(docs: T[], itemSort?: Map<string, number>): T[] {
  const rank = (d: T): [number, number | string, number, string] => {
    const key = itemKeyOf(d);
    if (!key) return MAIN[d.documentType] !== undefined ? [0, MAIN[d.documentType], 0, d.title] : [3, 0, 0, d.title];
    const measure = (d.documentType === 'ordinance' || d.documentType === 'resolution') && MEASURE.test(d.title) ? 0 : 1;
    if (d.agendaItemId && itemSort?.has(d.agendaItemId)) return [1, itemSort.get(d.agendaItemId)!, measure, d.title];
    const n = itemNumberOf(d);
    return n ? [1, n, measure, d.title] : [2, key, measure, d.title];
  };
  const ranked = docs.map((d) => ({ d, r: rank(d) }));
  ranked.sort((x, y) => {
    if (x.r[0] !== y.r[0]) return x.r[0] - y.r[0];
    const [a, b] = [x.r[1], y.r[1]];
    const c = typeof a === 'number' && typeof b === 'number' ? a - b : compareOutline(String(a), String(b));
    if (c) return c;
    if (x.r[2] !== y.r[2]) return x.r[2] - y.r[2];
    return byTitle(x.d, y.d);
  });
  return ranked.map((x) => x.d);
}
