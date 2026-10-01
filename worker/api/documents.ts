import type { Env } from '../env';
import type { DocumentDetail, DocumentPageText, DocumentRelationship, DocumentSource, DocumentVersion, Paginated, DocumentSummary, RelatedDocument, SearchFilters } from '../../src/types/models';
import { CACHE, HttpError, json, jsonWithEtag, notFound, API_SECURITY_HEADERS } from '../lib/http';
import { archiveUrlFor, toDocument, toDocumentSummary, toGovernmentBody, toMeetingSummary, type Row } from '../lib/mappers';
import { RELATIONSHIP_MAP, typesForCategories } from '../lib/taxonomy';
import { clampInt, parseJsonObject, toBool } from '../lib/util';
import { SearchRepository } from '../search/SearchRepository';
import { storageFor, isArchiveKey, type RangeRequest } from '../storage/StorageProvider';

/** Catalog-side WHERE clause for the shared filter vocabulary (alias `doc`). */
export function catalogFilterSql(f: SearchFilters): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const types = [...(f.documentTypes ?? []), ...(f.categories?.length ? typesForCategories(f.categories) : [])];
  const add = (clause: string, value: unknown) => {
    clauses.push(clause);
    params.push(value);
  };
  if (types.length) add('doc.document_type IN (SELECT value FROM json_each(?))', JSON.stringify(types));
  if (f.years?.length) add('doc.year IN (SELECT value FROM json_each(?))', JSON.stringify(f.years));
  if (f.dateFrom) add('doc.document_date >= ?', f.dateFrom);
  if (f.dateTo) add('doc.document_date <= ?', f.dateTo);
  if (f.governmentBodyIds?.length) add('doc.government_body_id IN (SELECT value FROM json_each(?))', JSON.stringify(f.governmentBodyIds));
  if (f.sourceIds?.length) add('doc.source_id IN (SELECT value FROM json_each(?))', JSON.stringify(f.sourceIds));
  if (f.meetingId) add('doc.meeting_id = ?', f.meetingId);
  if (f.currency?.length) add('doc.currency IN (SELECT value FROM json_each(?))', JSON.stringify(f.currency));
  return { sql: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', params };
}

export const ORDER_BY: Record<string, string> = {
  date_desc: "coalesce(doc.document_date, CAST(doc.year AS TEXT) || '-12-31') IS NULL, coalesce(doc.document_date, CAST(doc.year AS TEXT) || '-12-31') DESC, doc.title",
  date_asc: "coalesce(doc.document_date, CAST(doc.year AS TEXT) || '-12-31') IS NULL, coalesce(doc.document_date, CAST(doc.year AS TEXT) || '-12-31') ASC, doc.title",
  title: 'doc.title COLLATE NOCASE ASC',
  relevance: "coalesce(doc.document_date, CAST(doc.year AS TEXT) || '-12-31') IS NULL, coalesce(doc.document_date, CAST(doc.year AS TEXT) || '-12-31') DESC, doc.title",
};

export async function summariesByIds(env: Env, ids: string[]): Promise<Map<string, DocumentSummary>> {
  const out = new Map<string, DocumentSummary>();
  if (!ids.length) return out;
  const res = await env.CATALOG_DB.prepare('SELECT * FROM documents WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(ids)).all<Row>();
  for (const r of res.results ?? []) out.set(String(r.id), toDocumentSummary(r));
  return out;
}

export async function listDocuments(env: Env, url: URL, filters: SearchFilters): Promise<Response> {
  const ids = url.searchParams.getAll('ids').filter(Boolean).slice(0, 100);
  if (ids.length) {
    const map = await summariesByIds(env, ids);
    const items = ids.map((id) => map.get(id)).filter((x): x is DocumentSummary => Boolean(x));
    return json({ items, page: 1, pageSize: items.length, total: items.length } satisfies Paginated<DocumentSummary>, { cache: CACHE.list });
  }
  const page = clampInt(url.searchParams.get('page'), 1, 1, 10000);
  const pageSize = clampInt(url.searchParams.get('pageSize'), 20, 1, 100);
  const order = ORDER_BY[url.searchParams.get('sort') ?? 'date_desc'] ?? ORDER_BY.date_desc;
  const { sql, params } = catalogFilterSql(filters);
  const [rows, count] = await Promise.all([
    env.CATALOG_DB.prepare(`SELECT * FROM documents doc${sql} ORDER BY ${order} LIMIT ? OFFSET ?`).bind(...params, pageSize, (page - 1) * pageSize).all<Row>(),
    env.CATALOG_DB.prepare(`SELECT count(*) AS n FROM documents doc${sql}`).bind(...params).first<{ n: number }>(),
  ]);
  const body: Paginated<DocumentSummary> = { items: (rows.results ?? []).map(toDocumentSummary), page, pageSize, total: Number(count?.n ?? 0) };
  return json(body, { cache: CACHE.list });
}

async function getDocumentRow(env: Env, idOrSlug: string): Promise<Row> {
  const row = await env.CATALOG_DB.prepare('SELECT * FROM documents WHERE id = ? OR slug = ? LIMIT 1').bind(idOrSlug, idOrSlug).first<Row>();
  if (!row) throw notFound();
  return row;
}

export async function getDocumentDetail(env: Env, request: Request, id: string): Promise<Response> {
  const row = await getDocumentRow(env, id);
  const docId = String(row.id);
  const db = env.CATALOG_DB;
  const [sources, versions, rels, body, meeting, agendaItem] = await Promise.all([
    db
      .prepare(
        `SELECT ds.*, s.name, s.base_url, s.source_type, s.authority FROM document_sources ds LEFT JOIN sources s ON s.id = ds.source_id
         WHERE ds.document_id = ? ORDER BY ds.retrieved_at`,
      )
      .bind(docId)
      .all<Row>(),
    db.prepare('SELECT * FROM document_versions WHERE document_id = ? ORDER BY version_number').bind(docId).all<Row>(),
    db.prepare('SELECT * FROM document_relationships WHERE from_document_id = ? ORDER BY created_at').bind(docId).all<Row>(),
    row.government_body_id ? db.prepare('SELECT * FROM government_bodies WHERE id = ?').bind(row.government_body_id).first<Row>() : Promise.resolve(null),
    row.meeting_id
      ? db.prepare('SELECT m.*, (SELECT count(*) FROM agenda_items a WHERE a.meeting_id = m.id) AS agenda_item_count FROM meetings m WHERE m.id = ?').bind(row.meeting_id).first<Row>()
      : Promise.resolve(null),
    row.agenda_item_id ? db.prepare('SELECT id, number, title FROM agenda_items WHERE id = ?').bind(row.agenda_item_id).first<Row>() : Promise.resolve(null),
  ]);

  const detail: DocumentDetail = {
    ...toDocument(row),
    governmentBody: body ? toGovernmentBody(body) : null,
    meeting: meeting ? toMeetingSummary(meeting) : null,
    agendaItem: agendaItem ? { id: String(agendaItem.id), number: String(agendaItem.number), title: String(agendaItem.title) } : null,
    sources: (sources.results ?? []).map(
      (s): DocumentSource => ({
        id: String(s.id),
        sourceId: String(s.source_id),
        name: String(s.name ?? s.source_id),
        baseUrl: String(s.base_url ?? ''),
        sourceType: (s.source_type ?? 'other') as DocumentSource['sourceType'],
        authority: String(s.authority ?? ''),
        originalUrl: String(s.source_url),
        retrievedAt: String(s.retrieved_at),
        lastVerifiedAt: s.last_verified_at == null ? null : String(s.last_verified_at),
        originalAvailable: toBool(s.original_available),
        httpStatusAtLastCheck: s.http_status == null ? null : Number(s.http_status),
      }),
    ),
    versions: (versions.results ?? []).map(
      (v): DocumentVersion => ({
        id: String(v.id),
        documentId: docId,
        versionNumber: Number(v.version_number),
        retrievedAt: String(v.retrieved_at),
        checksum: String(v.sha256),
        sourceUrl: String(v.source_url),
        fileSize: v.file_size == null ? null : Number(v.file_size),
        pageCount: v.page_count == null ? null : Number(v.page_count),
        changeStatus: (v.change_status ?? 'original') as DocumentVersion['changeStatus'],
        archiveUrl: v.archive_key ? `/api/documents/${docId}/file?version=${Number(v.version_number)}` : null,
        ...(v.note ? { note: String(v.note) } : {}),
      }),
    ),
    relationships: (rels.results ?? []).map(
      (r): DocumentRelationship => ({
        id: String(r.id),
        fromDocumentId: docId,
        relationshipType: (RELATIONSHIP_MAP[String(r.relationship_type)]?.type ?? 'RELATED_TO'),
        toKind: (r.to_kind ?? 'document') as DocumentRelationship['toKind'],
        toId: String(r.to_id),
        toTitle: String(r.to_title ?? ''),
        basis: (r.basis ?? 'source_structure') as DocumentRelationship['basis'],
        evidence: parseJsonObject(r.evidence_json, null),
      }),
    ),
  };
  return jsonWithEtag(request, detail, CACHE.detail);
}

export async function getDocumentText(env: Env, request: Request, id: string): Promise<Response> {
  const row = await getDocumentRow(env, id);
  const repo = new SearchRepository(env);
  if (row.search_shard == null || !repo.activeShards.includes(Number(row.search_shard))) return jsonWithEtag(request, [], CACHE.detail);
  const chunks = await repo.documentChunks(Number(row.search_shard), String(row.id));
  const pages = new Map<number, DocumentPageText>();
  for (const c of chunks) {
    const page = c.pageStart ?? 1;
    const existing = pages.get(page);
    if (existing) existing.text += `\n\n${c.text}`;
    else pages.set(page, { page, text: c.text, ocr: c.ocr });
  }
  return jsonWithEtag(request, [...pages.values()].sort((a, b) => a.page - b.page), CACHE.detail);
}

export async function getRelated(env: Env, request: Request, id: string): Promise<Response> {
  const row = await getDocumentRow(env, id);
  const docId = String(row.id);
  const db = env.CATALOG_DB;
  const [outgoing, incoming, sameMeeting] = await Promise.all([
    db.prepare("SELECT * FROM document_relationships WHERE from_document_id = ? AND to_kind = 'document'").bind(docId).all<Row>(),
    db.prepare("SELECT * FROM document_relationships WHERE to_kind = 'document' AND to_id = ?").bind(docId).all<Row>(),
    row.meeting_id
      ? db.prepare('SELECT id FROM documents WHERE meeting_id = ? AND id != ? ORDER BY document_type LIMIT 50').bind(row.meeting_id, docId).all<{ id: string }>()
      : Promise.resolve({ results: [] as Array<{ id: string }> }),
  ]);
  const wanted: Array<{ id: string; type: RelatedDocument['relationshipType']; reason: string }> = [];
  for (const r of outgoing.results ?? []) {
    const m = RELATIONSHIP_MAP[String(r.relationship_type)];
    wanted.push({ id: String(r.to_id), type: m?.type ?? 'RELATED_TO', reason: m?.reason ?? 'Related record.' });
  }
  for (const r of incoming.results ?? []) {
    const m = RELATIONSHIP_MAP[String(r.relationship_type)];
    wanted.push({ id: String(r.from_document_id), type: m?.type ?? 'RELATED_TO', reason: m?.reason ?? 'Related record.' });
  }
  for (const r of sameMeeting.results ?? []) wanted.push({ id: String(r.id), type: 'PART_OF', reason: 'Published for the same meeting.' });
  const seen = new Set<string>();
  const unique = wanted.filter((w) => (seen.has(w.id) ? false : (seen.add(w.id), true)));
  const summaries = await summariesByIds(env, unique.map((w) => w.id));
  const related: RelatedDocument[] = unique
    .map((w) => {
      const document = summaries.get(w.id);
      return document ? { document, relationshipType: w.type, reason: w.reason } : null;
    })
    .filter((x): x is RelatedDocument => x !== null);
  return jsonWithEtag(request, related, CACHE.detail);
}

function sanitizeFileName(name: string, fallback: string): string {
  const base = (name || fallback).split(/[\\/]/).pop() ?? fallback;
  const clean = base.replace(/[^A-Za-z0-9._ ()-]+/g, '_').replace(/^\.+/, '').slice(0, 150);
  return clean || fallback;
}

function parseRange(header: string | null, size: number): RangeRequest | 'invalid' | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return 'invalid';
  const [, a, b] = m;
  if (a === '' && b === '') return 'invalid';
  if (a === '') {
    const suffix = Math.min(Number(b), size);
    return suffix > 0 ? { offset: size - suffix, suffix } : 'invalid';
  }
  const start = Number(a);
  const end = b === '' ? size - 1 : Math.min(Number(b), size - 1);
  if (start >= size || end < start) return 'invalid';
  return { offset: start, length: end - start + 1 };
}

export async function getDocumentFile(env: Env, request: Request, id: string, url: URL): Promise<Response> {
  const row = await getDocumentRow(env, id);
  const docId = String(row.id);
  const versionParam = url.searchParams.get('version');
  let key = row.archive_status === 'archived' ? (row.archive_key as string | null) : null;
  let sha = row.sha256 as string | null;
  let immutable = false;
  if (versionParam) {
    const v = await env.CATALOG_DB.prepare('SELECT * FROM document_versions WHERE document_id = ? AND version_number = ?').bind(docId, clampInt(versionParam, 0, 0, 100000)).first<Row>();
    if (!v) throw notFound('That version is not in the archive.');
    key = (v.archive_key as string | null) ?? null;
    sha = String(v.sha256);
    immutable = true;
  }

  const storage = storageFor(env.ARCHIVE);
  if (!key || !storage.available || !isArchiveKey(key)) {
    const original = String(row.original_url ?? '');
    if (/^https?:\/\//i.test(original) && !versionParam) {
      return new Response(null, { status: 302, headers: { location: original, 'cache-control': 'public, max-age=300', 'x-vtp-archive': 'remote-only', ...API_SECURITY_HEADERS } });
    }
    throw notFound('No archived copy of this record is available.');
  }

  const etag = `"${sha}"`;
  const baseHeaders: Record<string, string> = {
    ...API_SECURITY_HEADERS,
    'cross-origin-resource-policy': 'same-origin',
    'accept-ranges': 'bytes',
    etag,
    'cache-control': immutable ? CACHE.immutable : CACHE.file,
  };
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: baseHeaders });

  const head = await storage.head(key);
  if (!head) throw notFound('The archived copy could not be found.');
  const range = parseRange(request.headers.get('range'), head.size);
  if (range === 'invalid') return new Response(null, { status: 416, headers: { ...baseHeaders, 'content-range': `bytes */${head.size}` } });

  const obj = await storage.get(key, range ?? undefined);
  if (!obj) throw notFound('The archived copy could not be found.');

  const mime = String(row.mime_type ?? 'application/octet-stream');
  const fileName = sanitizeFileName(String(row.original_filename ?? ''), `${docId}`);
  const headers: Record<string, string> = { ...baseHeaders };
  if (/^text\/html|application\/xhtml/i.test(mime)) {
    headers['content-type'] = 'application/octet-stream';
    headers['content-disposition'] = `attachment; filename="${fileName}"`;
    headers['content-security-policy'] = 'sandbox';
  } else {
    headers['content-type'] = mime;
    // PDFs may be shown in a same-origin frame so the portal's Print button can print them directly.
    if (mime === 'application/pdf') headers['x-frame-options'] = 'SAMEORIGIN';
    headers['content-disposition'] = `inline; filename="${fileName}"`;
  }
  if (range && obj.range) {
    headers['content-range'] = `bytes ${obj.range.offset}-${obj.range.offset + obj.range.length - 1}/${head.size}`;
    headers['content-length'] = String(obj.range.length);
    return new Response(request.method === 'HEAD' ? null : obj.body, { status: 206, headers });
  }
  headers['content-length'] = String(head.size);
  return new Response(request.method === 'HEAD' ? null : obj.body, { status: 200, headers });
}

export function archiveUrlOf(row: Row): string | null {
  return archiveUrlFor(row);
}

export { HttpError };
