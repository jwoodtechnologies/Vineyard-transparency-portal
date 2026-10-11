/**
 * "What is the property tax rate?", "Vineyard's certified tax rate", "mill levy": answered by code
 * from the certified rate table (worker/lib/taxRates.ts) and, when the archive holds one, a newer tax
 * rate record (a Utah County tax rate record, source 'utah-county-tax-rates', document type
 * 'tax_rate', or a city resolution adopting the certified tax rate). The rate, its fiscal year and its
 * date are always written by code and cited to the record that states them; never the model's
 * wording, and never a figure from an unrelated record such as a project fiscal analysis.
 */
import type { Env } from '../env';
import type { AskResponse, Citation, DocumentType } from '../../src/types/models';
import { SearchRepository } from '../search/SearchRepository';
import type { ChunkHit } from '../search/types';
import { CERTIFIED_TAX_RATES, fiscalYearOf, newestCertifiedRate, rateFiscalYear, type CertifiedTaxRate } from '../lib/taxRates';
import { longDate } from './budgetAnswer';

export const COUNTY_TAX_SOURCE = 'utah-county-tax-rates';

/** A question about Vineyard's property tax rate (any year). */
const RATE_Q = /\b(property[\s-]+tax(es)?[\s-]+rates?|certified[\s-]+(property[\s-]+)?tax[\s-]+rates?|tax[\s-]+rates?|mill[\s-]+levy|millage(\s+rates?)?|property[\s-]+tax[\s-]+levy|tax[\s-]+levy)\b/i;
/** Other taxes, other governments, and revenue questions: not the city's property tax rate. */
const OTHER_TAX = /\b(sales|transportation|rap|tourism|transient|room|hotel|motel|franchise|energy|telecom\w*|utility|utilities|gas|resort|increment|tif|school|state|income|federal|cable|restaurant|food|prepared\s+food|tax\s+revenue|bring\s+in|brings\s+in|collect\w*)\b|\bcounty'?s?\s+(own\s+)?(property\s+)?tax\s+rate/i;
/** Questions the table cannot settle exactly: changes, reasons, comparisons, votes. */
const NOT_A_LOOKUP = /\b(why|raise[ds]?|raising|increase[ds]?|increasing|decrease[ds]?|lower(ed|ing)?|cut|hike[ds]?|go(ing|ne)?\s+up|went\s+up|go(ing)?\s+down|went\s+down|change[ds]?|compare[ds]?|comparison|versus|vs|truth\s+in\s+taxation|hearing|vote[ds]?|voting|history|historical|trend|over\s+the\s+years|each\s+year|every\s+year|average|neighbou?r\w*|other\s+cities|orem|lindon|provo|lehi|pay|owe|bill|calculate|my\s+(home|house|property))\b/i;

export type TaxRateIntent = { kind: 'current' } | { kind: 'year'; fiscalYear: number; calendar: boolean };

/** Is this a question about Vineyard's property tax rate at all (for the records-search guard)? */
export function isTaxRateQuestion(question: string): boolean {
  const q = question.replace(/[‘’]/g, "'");
  return RATE_Q.test(q) && !OTHER_TAX.test(q);
}

/** The tax rate lookup a question asks for, or null when it is not one this path answers exactly. */
export function taxRateIntent(question: string): TaxRateIntent | null {
  const q = question.replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
  if (!isTaxRateQuestion(q) || NOT_A_LOOKUP.test(q)) return null;
  const full = (x: string) => Number(x.length === 2 ? `20${x}` : x);
  const years: Array<{ y: number; calendar: boolean }> = [];
  let rest = q.replace(/\b((?:19|20)\d{2})\s*[-/]\s*((?:19|20)?\d{2})\b/g, (_, a: string, b: string) => {
    const end = full(b.length === 2 ? `${a.slice(0, 2)}${b}` : b);
    years.push({ y: end - Number(a) === 1 ? end : -1, calendar: false });
    return ' ';
  });
  rest = rest.replace(/\bfy\s?'?(\d{2}(?:\d{2})?)\b/gi, (_, y: string) => (years.push({ y: full(y), calendar: false }), ' '));
  rest = rest.replace(/\bfiscal\s+(?:year\s+)?(\d{2,4})\b/gi, (_, y: string) => (years.push({ y: full(y), calendar: false }), ' '));
  for (const m of rest.matchAll(/\b(?:19|20)\d{2}\b/g)) years.push({ y: Number(m[0]), calendar: true });
  if (!years.length) return { kind: 'current' };
  if (years.length > 1 || years[0].y < 0) return null;
  return { kind: 'year', fiscalYear: years[0].y, calendar: years[0].calendar };
}

/** A tax rate record newer than the table, as found in the archive. */
export interface NewerRateRecord {
  id: string;
  title: string;
  date: string;
  documentType: string;
  fiscalYear: number;
  /** The rate read from the record's text, with the page it is on; null when it could not be read exactly. */
  rate: string | null;
  page: number | null;
}

/** One sentence and the records it cites. */
export interface RateSentence {
  text: string;
  cite: Array<{ id: string; title: string; date: string | null; type: DocumentType; page: number | null }>;
}

const plainRate = (r: string) => (r.startsWith('.') ? `0${r}` : r);

function tableCite(e: CertifiedTaxRate): RateSentence['cite'][number] {
  return { id: e.docId, title: e.docTitle, date: e.adopted, type: e.docKind, page: e.page };
}

/** "0.003796 for fiscal 2026 (adopted June 25, 2025; minutes page 9)". */
function tableRate(e: CertifiedTaxRate): string {
  return `${e.rate} for fiscal ${e.fiscalYear} (adopted ${longDate(e.adopted)}; ${e.docKind} page ${e.page})`;
}

/** The answer's sentences, every figure and date taken from the table or the newer record. */
export function taxRateSentences(intent: TaxRateIntent, today: string, newer: NewerRateRecord | null): RateSentence[] {
  const out: RateSentence[] = [];
  const current = fiscalYearOf(today);
  const top = newestCertifiedRate();
  const withResolution = (e: CertifiedTaxRate) => {
    if (e.resolution) out.push({ text: `Resolution ${e.resolution.number} adopted it.`, cite: [{ id: e.resolution.docId, title: e.resolution.docTitle, date: e.adopted, type: 'resolution', page: e.resolution.page }] });
  };
  const newerFirst = (n: NewerRateRecord) => {
    const date = longDate(n.date) ?? n.date;
    const cite = [{ id: n.id, title: n.title, date: /^\d{4}-/.test(n.date) ? n.date : null, type: (n.documentType === 'tax_rate' ? 'other' : n.documentType) as DocumentType, page: n.page }];
    if (n.rate) out.push({ text: `The newest certified tax rate on file for Vineyard is ${n.rate} for fiscal ${n.fiscalYear} (${n.title}, ${date}${n.page ? `, page ${n.page}` : ''}).`, cite });
    else {
      out.push({ text: `A fiscal ${n.fiscalYear} tax rate record is in the archive: ${n.title}, ${date}. Open it for the rate.`, cite });
      out.push({ text: `The newest certified tax rate the portal has read is ${tableRate(top)}.`, cite: [tableCite(top)] });
      withResolution(top);
    }
  };

  if (intent.kind === 'current') {
    if (newer && newer.fiscalYear > top.fiscalYear) {
      newerFirst(newer);
      if (newer.rate) out.push({ text: `The fiscal ${top.fiscalYear} rate was ${top.rate} (adopted ${longDate(top.adopted)}; ${top.docKind} page ${top.page}).`, cite: [tableCite(top)] });
      if (newer.fiscalYear < current) out.push({ text: `The fiscal ${current} rate is not in the archive yet.`, cite: [] });
      return out;
    }
    out.push({ text: `The newest certified tax rate on file for Vineyard is ${tableRate(top)}.`, cite: [tableCite(top)] });
    withResolution(top);
    if (top.fiscalYear < current) out.push({ text: `The fiscal ${current} rate is not in the archive yet.`, cite: [] });
    return out;
  }

  // A named year. A bare calendar year is the year the rate was adopted ("the 2025 tax rate" is the
  // rate adopted June 2025, for fiscal 2026); a fiscal year is matched as written.
  const fy = intent.calendar ? intent.fiscalYear + 1 : intent.fiscalYear;
  const say = intent.calendar ? `The rate adopted in ${intent.fiscalYear} is the fiscal ${fy} rate (July 1, ${fy - 1} to June 30, ${fy}).` : null;
  if (newer && newer.fiscalYear === fy && newer.rate) {
    if (say) out.push({ text: say, cite: [] });
    newerFirst(newer);
    return out;
  }
  const e = CERTIFIED_TAX_RATES.find((x) => x.fiscalYear === fy);
  if (e) {
    if (say) out.push({ text: say, cite: [] });
    out.push({ text: `Vineyard's certified tax rate for fiscal ${e.fiscalYear} is ${e.rate} (adopted ${longDate(e.adopted)}; ${e.docKind} page ${e.page}).`, cite: [tableCite(e)] });
    withResolution(e);
    return out;
  }
  if (fy > top.fiscalYear && fy <= current + 1) {
    if (newer && newer.fiscalYear === fy) {
      newerFirst(newer);
      return out;
    }
    out.push({ text: `The fiscal ${fy} rate is not in the archive yet.`, cite: [] });
    out.push({ text: `The newest certified tax rate on file for Vineyard is ${tableRate(top)}.`, cite: [tableCite(top)] });
    withResolution(top);
    return out;
  }
  // An older year the table does not hold: the records search answers it, from tax rate records only.
  return [];
}

/** Titles of city records that adopt or set the property tax rate. */
const RATE_TITLE = /certified\s+tax\s+rate|property\s+tax\s+rate|tax\s+rate/i;
const OTHER_TITLE = /\b(sales|transient|room|energy|franchise|telecom\w*|resort|fiscal\s+(analysis|impact)|economic|market|feasibility|study)\b/i;

/** The rate a record's text states for Vineyard, with its page; null when no rate can be read exactly. */
export function rateInText(chunks: Array<{ pageStart: number | null; text: string }>, countyRecord: boolean): { rate: string; page: number | null } | null {
  const pats = countyRecord
    ? [/\bvineyard\s+(?:city|town)\b[^\n]{0,80}?(?:^|[\s:$])(0?\.\d{4,6})\b/i, /\bvineyard\b(?![^\n]{0,40}\b(?:rda|redevelopment|sid|special)\b)[^\n]{0,80}?(?:^|[\s:$])(0?\.\d{4,6})\b/i]
    : [/certified\s+(?:property\s+)?tax\s+rate[^.]{0,200}?(?:^|[\s:$(])(0?\.\d{4,6})\b/i];
  for (const re of pats)
    for (const c of chunks) {
      const m = re.exec(c.text);
      if (m) return { rate: plainRate(m[1]), page: c.pageStart };
    }
  return null;
}

/**
 * A tax rate record newer than the table's newest entry: a Utah County tax rate record or a city
 * resolution (or minutes) adopting the certified tax rate, dated for a later fiscal year. Its rate is
 * read from its text when the text states one for Vineyard exactly. Null when there is none.
 */
export async function newerRateRecord(env: Env): Promise<NewerRateRecord | null> {
  const top = newestCertifiedRate();
  // Rates for the fiscal year after the table's newest are adopted from May of that year on.
  const since = `${top.fiscalYear}-05-01`;
  const rows = await env.CATALOG_DB.prepare(
    `SELECT id, title, document_date, document_type, source_id, search_shard, year FROM documents
     WHERE (document_date >= ? OR (document_date IS NULL AND document_type = 'tax_rate' AND source_id = ? AND year >= ?))
       AND (document_type = 'tax_rate' OR source_id = ?
            OR (document_type IN ('resolution', 'ordinance') AND (lower(title) LIKE '%certified tax rate%' OR lower(title) LIKE '%property tax rate%' OR lower(title) LIKE '%tax rate%')))
     ORDER BY coalesce(document_date, (year + 1) || '-01-01') DESC LIMIT 10`,
  )
    .bind(since, COUNTY_TAX_SOURCE, top.fiscalYear, COUNTY_TAX_SOURCE)
    .all<{ id: string; title: string; document_date: string | null; document_type: string; source_id: string; search_shard: number | null; year: number | null }>()
    .then((r) => r.results ?? [])
    .catch(() => []);
  const repo = new SearchRepository(env);
  for (const row of rows) {
    // Utah County's tax rate pages print the tax year, not a date: tax year 2026 rates are the fiscal 2027 rates.
    const taxYear = !row.document_date && row.document_type === 'tax_rate' && row.year ? Number(row.year) : null;
    if (!row.document_date && !taxYear) continue;
    const county = row.document_type === 'tax_rate' || row.source_id === COUNTY_TAX_SOURCE;
    if (!county && (!RATE_TITLE.test(row.title) || OTHER_TITLE.test(row.title))) continue;
    const fiscalYear = taxYear ? taxYear + 1 : rateFiscalYear(row.document_date as string);
    if (fiscalYear <= top.fiscalYear) continue;
    let found: { rate: string; page: number | null } | null = null;
    if (row.search_shard != null && repo.activeShards.includes(Number(row.search_shard))) {
      const chunks = await repo.documentChunks(Number(row.search_shard), row.id).catch(() => []);
      found = rateInText(chunks, county);
    }
    // A year the county lists before setting rates prints zeros: never quote a zero rate.
    if (found && !(Number(found.rate) > 0)) {
      if (county) continue;
      found = null;
    }
    return { id: row.id, title: row.title, date: row.document_date ?? `tax year ${taxYear}`, documentType: row.document_type, fiscalYear, rate: found?.rate ?? null, page: found?.page ?? null };
  }
  return null;
}

/**
 * Records-search guard for tax rate questions: only passages from tax rate records (a county tax rate
 * record, or a record whose passage speaks of the tax rate or levy) may answer, and never a project's
 * fiscal or economic analysis, whatever rate it assumes.
 */
export function isTaxRateRecord(h: Pick<ChunkHit, 'title' | 'documentType' | 'sourceId'> & { text?: string | null; excerpt?: string | null }): boolean {
  if (h.documentType === ('tax_rate' as DocumentType) || h.sourceId === COUNTY_TAX_SOURCE) return true;
  if (OTHER_TITLE.test(h.title)) return false;
  const text = `${h.title} ${h.text ?? h.excerpt ?? ''}`;
  // A record that adopts or sets the rate.
  if (/\b(certified\s+(property\s+)?tax\s+rate|truth\s+in\s+taxation|setting\s+the\s+tax\s+rate|rate\s+of\s+tax|tax\s+rate\s+worksheet)\b/i.test(text)) return true;
  // Any other mention of a tax rate counts only outside a project's fiscal or economic analysis.
  if (/\b(fiscal\s+(analysis|impact\s+analysis)|economic\s+(impact|analysis)|feasibility|pro\s+forma|projected\s+(sales\s+tax|revenue)|net\s+fiscal)\b/i.test(text)) return false;
  return /\b(property\s+tax\s+rate|tax\s+rate|mill\s+levy|tax\s+levy)\b/i.test(text);
}

/** The deterministic tax rate answer as a final response, with citations read from the catalog. */
export async function taxRateResponse(env: Env, base: { id: string; question: string; generatedAt: string; relatedDocuments: unknown[]; suggestedFollowUps: string[] }, sentences: RateSentence[]): Promise<AskResponse> {
  const order: RateSentence['cite'] = [];
  for (const s of sentences) for (const c of s.cite) if (!order.some((o) => o.id === c.id && o.page === c.page)) order.push(c);
  const rows = order.length
    ? await env.CATALOG_DB.prepare('SELECT id, title, document_date, original_url, archive_status, archive_key, meeting_id FROM documents WHERE id IN (SELECT value FROM json_each(?))')
        .bind(JSON.stringify([...new Set(order.map((c) => c.id))]))
        .all<{ id: string; title: string | null; document_date: string | null; original_url: string | null; archive_status: string | null; archive_key: string | null; meeting_id: string | null }>()
        .then((r) => new Map((r.results ?? []).map((x) => [x.id, x])))
        .catch(() => new Map<string, never>())
    : new Map<string, never>();
  const citations: Citation[] = order.map((c, i) => {
    const row = rows.get(c.id) as { title: string | null; document_date: string | null; original_url: string | null; archive_status: string | null; archive_key: string | null; meeting_id: string | null } | undefined;
    return {
      index: i + 1,
      documentId: c.id,
      documentTitle: row?.title ?? c.title,
      documentType: c.type,
      documentNumber: null,
      date: row?.document_date ?? c.date,
      governmentBodyName: c.type === 'other' ? null : 'City Council',
      meetingId: row?.meeting_id ?? null,
      meetingTitle: null,
      agendaItem: null,
      page: c.page,
      sectionTitle: null,
      excerpt: { documentId: c.id, chunkId: null, page: c.page, sectionTitle: null, text: '', highlights: [] },
      archiveUrl: row?.archive_status === 'archived' && row.archive_key ? `/api/documents/${c.id}/file` : null,
      originalUrl: row?.original_url ?? null,
    };
  });
  const segments = sentences.map((s) => ({ text: s.text, citations: s.cite.map((c) => order.findIndex((o) => o.id === c.id && o.page === c.page) + 1) }));
  const answer = segments.map((s) => `${s.text}${s.citations.length ? ` ${s.citations.map((c) => `[${c}]`).join('')}` : ''}`).join(' ');
  return {
    ...base,
    retrievalStatus: 'grounded',
    answer,
    paragraphs: [{ segments }],
    citations,
    notice: null,
    engine: 'tax-rate-data',
  } as unknown as AskResponse;
}
