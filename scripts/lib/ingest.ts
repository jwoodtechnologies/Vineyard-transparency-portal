/**
 * Ingest pipeline for one candidate document:
 *
 *   policy check → DOWNLOAD (size cap, content-type + magic-byte check) → SHA-256 →
 *   DUPLICATE DETECTION → STORAGE (content-addressed) → TEXT EXTRACTION → OCR assessment →
 *   METADATA (deterministic) → optional AI classification (no-op default) → CHUNKING → record
 *
 * Versioning: when a known URL returns different bytes, a NEW DocumentVersion (changeStatus
 * "replaced") is appended and its bytes stored under a new content-addressed key. Earlier versions
 * and their files are never modified or deleted.
 */
import type { Document, DocumentRelationship, DocumentSource, DocumentType } from '../../src/types/models';
import { ArchiveStore, fingerprintOf } from './archive';
import { chunkPages } from './chunk';
import { approvedDomainFor, fileKindForExtension, fileKindForMime, isArchivableKind, isDeniedHost } from './classify';
import { categoriesForType, type DocumentClassifier } from './classifier';
import { findDuplicate, type DuplicateMatch } from './dedupe';
import { sha256Hex, shortId } from './hash';
import { htmlDocumentText } from './html';
import { decodeBody, HttpError, type HttpClientLike } from './http';
import { chooseTitle, detectDocumentType, extractDates, extractDocumentNumbers, identityDocumentNumber } from './metadata';
import { assessOcrNeed, type OcrProvider } from './ocr';
import { extractPdfText, looksLikePdf } from './pdf';
import { resolveSourceForUrl, toDocumentSource, type RegistrySource } from './registry';
import { contentKey, fileNameFromContentDisposition, sanitizeFileName } from './storage/keys';
import type { StorageProvider } from './storage/StorageProvider';
import { extensionOf, fileNameFromUrl, hostOf, normalizeUrl } from './url';
import type {
  ArchiveManifest,
  ArchiveRecord,
  ArchivedVersion,
  CandidateDocument,
  DiscoveryManifest,
  DocumentDiscoveryManifest,
  DocumentPageText,
  FileKind,
  SourceSeedsConfig,
} from './types';

export const PIPELINE_VERSION = 'ingest-0.1.0';

export interface IngestContext {
  config: SourceSeedsConfig;
  http: HttpClientLike;
  storage: StorageProvider;
  archive: ArchiveStore;
  registry: RegistrySource[];
  ocr: OcrProvider;
  classifier: DocumentClassifier;
  extraAllowedHosts: string[];
  maxBytes: number;
  includeUnapprovedHosts: boolean;
  now: () => Date;
  log: (message: string) => void;
}

export type IngestStatus = 'created' | 'new_version' | 'source_added' | 'unchanged' | 'probable_duplicate' | 'skipped' | 'failed';

export interface IngestOutcome {
  url: string;
  status: IngestStatus;
  documentId: string | null;
  message: string;
}

const EXTENSION_FOR_KIND: Partial<Record<FileKind, string>> = { pdf: '.pdf', csv: '.csv', text: '.txt', html: '.html' };

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'document'
  );
}

interface Extraction {
  pages: DocumentPageText[];
  pageCount: number | null;
  pdfTitle: string | null;
  extractor: string | null;
  warnings: string[];
}

async function extractText(kind: FileKind, bytes: Uint8Array, contentType: string | null): Promise<Extraction> {
  const warnings: string[] = [];
  if (kind === 'pdf') {
    try {
      const pdf = await extractPdfText(bytes);
      return { pages: pdf.pages, pageCount: pdf.pageCount, pdfTitle: pdf.info.title, extractor: pdf.extractor, warnings };
    } catch (error) {
      warnings.push(`PDF text extraction failed: ${(error as Error).message}`);
      return { pages: [], pageCount: null, pdfTitle: null, extractor: null, warnings };
    }
  }
  if (kind === 'csv' || kind === 'text') {
    const text = decodeBody(bytes.subarray(0, 5_000_000), contentType).replace(/\r\n?/g, '\n');
    if (bytes.byteLength > 5_000_000) warnings.push('Text truncated to the first 5 MB for indexing.');
    return { pages: [{ page: 1, text, ocr: false }], pageCount: 1, pdfTitle: null, extractor: 'utf8-text', warnings };
  }
  if (kind === 'html') {
    const { title, text } = htmlDocumentText(decodeBody(bytes, contentType));
    return { pages: [{ page: 1, text, ocr: false }], pageCount: 1, pdfTitle: title, extractor: 'html-text', warnings };
  }
  warnings.push(`Text extraction for ${kind} files is not implemented yet; the file is archived for download only.`);
  return { pages: [], pageCount: null, pdfTitle: null, extractor: null, warnings };
}

function hostPolicy(ctx: IngestContext, url: string, candidate: CandidateDocument): string | null {
  const host = hostOf(url);
  if (!host) return 'not an http(s) URL';
  if (isDeniedHost(ctx.config, host) && !ctx.extraAllowedHosts.includes(host)) return 'denied domain';
  const approved = approvedDomainFor(ctx.config, url, ctx.extraAllowedHosts) !== null;
  if (!approved && !candidate.hostApproved && !ctx.includeUnapprovedHosts) {
    return 'host not approved (pass --include-unapproved-hosts after review)';
  }
  return null;
}

/** Fold a document number from a trusted hint (printed link text) only when it matches the type. */
function hintedNumber(type: DocumentType, hint: string | null): string | null {
  if (!hint) return null;
  if (type === 'ordinance' && hint.startsWith('Ordinance ')) return hint;
  if (type === 'resolution' && hint.startsWith('Resolution ')) return hint;
  return null;
}

export async function ingestCandidate(candidate: CandidateDocument, ctx: IngestContext, manifest: ArchiveManifest): Promise<IngestOutcome> {
  const url = candidate.url;
  const outcome = (status: IngestStatus, message: string, documentId: string | null = null): IngestOutcome => ({ url, status, documentId, message });

  const policyProblem = hostPolicy(ctx, url, candidate);
  if (policyProblem) return outcome('skipped', policyProblem);
  if (candidate.fileKind && candidate.fileKind !== 'html' && !isArchivableKind(ctx.config, candidate.fileKind)) {
    return outcome('skipped', `${candidate.fileKind} files are not archived (see fileExtensions.archivable)`);
  }

  // DOWNLOAD
  let res;
  try {
    res = await ctx.http.request(url, {
      maxBytes: ctx.maxBytes,
      onTooLarge: 'error',
      allowRedirect: (_from, to) => !isDeniedHost(ctx.config, hostOf(to) ?? ''),
    });
  } catch (error) {
    return outcome('failed', error instanceof HttpError ? `[${error.kind}] ${error.message}` : (error as Error).message);
  }
  if (res.networkPolicyBlock) return outcome('failed', `[blocked_by_network_policy] ${res.networkPolicyBlock}`);
  if (res.redirectRefused) return outcome('skipped', `redirect to denied host ${res.redirectRefused.to}`);
  if (!res.ok || !res.body) return outcome('failed', `HTTP ${res.status}`);
  const bytes = res.body;
  if (bytes.byteLength === 0) return outcome('failed', 'empty response body');

  // CONTENT-TYPE CHECK (declared type, extension, and magic bytes must agree on something archivable)
  const ext = extensionOf(res.url) ?? extensionOf(url);
  let kind: FileKind | null = looksLikePdf(bytes) ? 'pdf' : fileKindForMime(ctx.config, res.contentType) ?? fileKindForExtension(ctx.config, ext);
  if (kind === 'html' && candidate.fileKind !== 'html') {
    return outcome('skipped', 'server returned an HTML page, not a document (viewer/login/error page?)');
  }
  if ((kind === 'pdf' || candidate.fileKind === 'pdf') && !looksLikePdf(bytes)) {
    return outcome('failed', 'declared PDF but the bytes are not a PDF');
  }
  if (!kind && candidate.fileKind === 'html' && res.contentType === 'text/html') kind = 'html';
  if (!kind) return outcome('skipped', `unsupported content type ${res.contentType ?? 'unknown'}`);
  if (kind !== 'html' && !isArchivableKind(ctx.config, kind)) return outcome('skipped', `${kind} files are not archived`);
  const mimeType = res.contentType ?? (kind === 'pdf' ? 'application/pdf' : 'application/octet-stream');

  // HASH + FILE NAME
  const checksum = sha256Hex(bytes);
  const rawName = fileNameFromContentDisposition(res.headers.get('content-disposition')) ?? fileNameFromUrl(res.url) ?? candidate.title ?? 'document';
  let fileName = sanitizeFileName(rawName);
  const wantedExt = EXTENSION_FOR_KIND[kind];
  if (wantedExt && !fileName.toLowerCase().endsWith(wantedExt)) fileName = sanitizeFileName(`${fileName}${wantedExt}`);
  const normalizedUrl = normalizeUrl(url, { stripParams: ctx.config.crawlPolicy.stripQueryParams }) ?? url;
  const retrievedAt = ctx.now().toISOString();
  const source = resolveSourceForUrl(ctx.config, ctx.registry, url, candidate.sourceId);

  // DUPLICATE: identical bytes already archived → add provenance only.
  // (Exception: the same URL reverting to an OLDER version's bytes is a content change → new version.)
  let revertOf: string | null = null;
  const byChecksum = manifest.documents.find((d) => d.checksums.includes(checksum));
  if (byChecksum) {
    const record = ctx.archive.readRecord(byChecksum.documentId);
    if (!record) return outcome('failed', `manifest references missing record ${byChecksum.documentId}; run validate-archive`);
    const sameUrl = record.normalizedUrls.includes(normalizedUrl);
    if (sameUrl && record.document.checksum !== checksum) {
      revertOf = record.document.id;
    } else {
      if (sameUrl) {
        for (const s of record.sources) {
          if (normalizeUrl(s.originalUrl, { stripParams: ctx.config.crawlPolicy.stripQueryParams }) !== normalizedUrl) continue;
          s.lastVerifiedAt = retrievedAt;
          s.originalAvailable = true;
          s.httpStatusAtLastCheck = res.status;
        }
      } else {
        record.sources.push(toDocumentSource(source, record.document.id, url, retrievedAt, res.status));
        record.normalizedUrls.push(normalizedUrl);
      }
      record.document.updatedAt = retrievedAt;
      persist(ctx, manifest, record);
      return outcome(
        sameUrl ? 'unchanged' : 'source_added',
        sameUrl ? 'identical content; source re-verified' : 'identical content already archived; added source reference',
        record.document.id,
      );
    }
  }

  // STORAGE (content-addressed; never overwrites)
  const storageKey = contentKey(checksum, fileName);
  await ctx.storage.put(storageKey, bytes, { contentType: mimeType });

  // TEXT EXTRACTION + OCR assessment
  const extraction = await extractText(kind, bytes, res.headers.get('content-type'));
  const ocr = kind === 'pdf' ? assessOcrNeed(extraction.pages) : { ocrRequired: false, lowTextPages: [], averageCharsPerPage: 0 };
  if (ocr.ocrRequired) extraction.warnings.push(`Low text density (avg ${ocr.averageCharsPerPage} chars/page); OCR required (provider: ${ctx.ocr.id}).`);

  // METADATA (deterministic)
  const firstPageText = extraction.pages[0]?.text ?? '';
  const title = chooseTitle({ explicit: candidate.title ?? candidate.linkText, pdfTitle: extraction.pdfTitle, firstPageText, fileName });
  let documentType = detectDocumentType({ hint: candidate.documentTypeHint, title, firstPageText, url });
  const tags: string[] = [];
  const suggestion = await ctx.classifier.classify({ title, documentType, firstPageText: firstPageText.slice(0, 4000), url });
  if (suggestion) {
    if (documentType === 'other' && suggestion.documentType) {
      documentType = suggestion.documentType;
      extraction.warnings.push(`documentType suggested by classifier ${ctx.classifier.id} (confidence ${suggestion.confidence})`);
    }
    tags.push(...(suggestion.tags ?? []));
  }
  const documentNumber = identityDocumentNumber(documentType, title, firstPageText) ?? hintedNumber(documentType, candidate.documentNumberHint);
  const date = candidate.meeting?.date ?? candidate.dateHint ?? extractDates(`${title}\n${firstPageText.slice(0, 3000)}`)[0]?.iso ?? null;
  const fullText = extraction.pages.map((p) => p.text).join('\n');
  const referencedDocumentNumbers = extractDocumentNumbers(fullText)
    .map((m) => m.label)
    .filter((l) => l !== documentNumber);

  const match: DuplicateMatch | null = revertOf
    ? { kind: 'url', strength: 'same_url', documentId: revertOf }
    : findDuplicate({ checksum, normalizedUrl, documentNumber, documentType, fileName, fileSize: bytes.byteLength, title, date }, manifest.documents);

  const pageCount = extraction.pageCount;
  const baseVersion = (documentId: string, versionNumber: number, changeStatus: ArchivedVersion['changeStatus']): ArchivedVersion => ({
    id: `${documentId}:v${versionNumber}`,
    documentId,
    versionNumber,
    retrievedAt,
    checksum,
    sourceUrl: url,
    fileSize: bytes.byteLength,
    pageCount,
    changeStatus,
    archiveUrl: `/api/documents/${documentId}/file?version=${versionNumber}`,
    storageKey,
    mimeType,
  });

  // NEW VERSION of a known URL
  if (match?.kind === 'url') {
    const record = ctx.archive.readRecord(match.documentId);
    if (!record) return outcome('failed', `manifest references missing record ${match.documentId}; run validate-archive`);
    const versionNumber = Math.max(...record.versions.map((v) => v.versionNumber)) + 1;
    const version = baseVersion(record.document.id, versionNumber, 'replaced');
    version.note = `Content at the source URL changed (previous checksum ${record.versions[record.versions.length - 1]?.checksum.slice(0, 12)}…).`;
    record.versions.push(version);
    Object.assign(record.document, {
      title,
      documentType,
      documentNumber,
      date,
      year: date ? Number(date.slice(0, 4)) : null,
      mimeType,
      fileName,
      fileSize: bytes.byteLength,
      pageCount,
      checksum,
      extractedTextAvailable: extraction.pages.some((p) => p.text.trim()),
      ocrRequired: ocr.ocrRequired,
      ocrStatus: ocr.ocrRequired ? 'pending' : 'not_required',
      archivedAt: retrievedAt,
      updatedAt: retrievedAt,
      currentVersion: versionNumber,
      categories: categoriesForType(documentType),
    } satisfies Partial<Document>);
    for (const s of record.sources) {
      if (normalizeUrl(s.originalUrl, { stripParams: ctx.config.crawlPolicy.stripQueryParams }) !== normalizedUrl) continue;
      s.lastVerifiedAt = retrievedAt;
      s.originalAvailable = true;
      s.httpStatusAtLastCheck = res.status;
    }
    record.pages = extraction.pages;
    record.chunks = chunkPages(record.document.id, extraction.pages);
    record.referencedDocumentNumbers = referencedDocumentNumbers;
    record.ingest = { pipelineVersion: PIPELINE_VERSION, processedAt: retrievedAt, textExtractor: extraction.extractor, classifier: ctx.classifier.id, warnings: extraction.warnings };
    persist(ctx, manifest, record);
    return outcome('new_version', `content changed at source; stored version ${versionNumber}`, record.document.id);
  }

  // NEW RECORD (possibly a probable duplicate of an existing one)
  let documentId = `doc_${shortId(normalizedUrl)}`;
  if (ctx.archive.readRecord(documentId)) documentId = `doc_${shortId(`${normalizedUrl}|${checksum}`)}`;
  const meetingId = candidate.meeting?.externalId ? `mtg_${shortId(`${source.id}|${candidate.meeting.externalId}`)}` : null;
  const bodyName = candidate.meeting?.bodyName ?? null;
  const document: Document = {
    id: documentId,
    slug: `${slugify(title)}-${documentId.slice(4, 10)}`,
    title,
    description: null,
    documentType,
    documentNumber,
    date,
    year: date ? Number(date.slice(0, 4)) : null,
    governmentBodyId: bodyName ? slugify(bodyName) : null,
    governmentBodyName: bodyName,
    meetingId,
    agendaItemId: null,
    sourceId: source.id,
    originalUrl: url,
    archiveUrl: `/api/documents/${documentId}/file`,
    mimeType,
    fileName,
    fileSize: bytes.byteLength,
    pageCount,
    checksum,
    checksumAlgorithm: 'sha256',
    extractedTextAvailable: extraction.pages.some((p) => p.text.trim()),
    ocrRequired: ocr.ocrRequired,
    ocrStatus: ocr.ocrRequired ? 'pending' : 'not_required',
    ocrConfidence: null,
    archivedAt: retrievedAt,
    createdAt: retrievedAt,
    updatedAt: retrievedAt,
    tags,
    entities: [],
    categories: categoriesForType(documentType),
    // Operative status (current/superseded/amended) is set by relationship extraction/review, never guessed here.
    currency: 'unknown',
    currentVersion: 1,
  };
  const relationships: DocumentRelationship[] = [];
  let duplicateOf: string | null = null;
  if (match && match.strength === 'probable') {
    duplicateOf = match.documentId;
    const canonical = manifest.documents.find((d) => d.documentId === match.documentId);
    relationships.push({
      id: `rel_${shortId(`${documentId}|DUPLICATE_OF|${match.documentId}`)}`,
      fromDocumentId: documentId,
      relationshipType: 'DUPLICATE_OF',
      toKind: 'document',
      toId: match.documentId,
      toTitle: canonical?.title ?? match.documentId,
      basis: 'metadata_match',
      evidence: null,
    });
  }
  const sources: DocumentSource[] = [toDocumentSource(source, documentId, url, retrievedAt, res.status)];
  const record: ArchiveRecord = {
    schemaVersion: 1,
    document,
    versions: [baseVersion(documentId, 1, 'original')],
    sources,
    normalizedUrls: [normalizedUrl],
    relationships,
    pages: extraction.pages,
    chunks: chunkPages(documentId, extraction.pages),
    referencedDocumentNumbers,
    duplicateOf,
    ingest: { pipelineVersion: PIPELINE_VERSION, processedAt: retrievedAt, textExtractor: extraction.extractor, classifier: ctx.classifier.id, warnings: extraction.warnings },
  };
  persist(ctx, manifest, record);
  if (duplicateOf) return outcome('probable_duplicate', `archived; probable duplicate of ${duplicateOf} (${match?.kind}) — flagged for review`, documentId);
  return outcome('created', `${kind}, ${bytes.byteLength} bytes, ${pageCount ?? 0} pages, ${record.chunks.length} chunks`, documentId);
}

function persist(ctx: IngestContext, manifest: ArchiveManifest, record: ArchiveRecord): void {
  ctx.archive.writeRecord(record);
  const fp = fingerprintOf(record);
  const i = manifest.documents.findIndex((d) => d.documentId === fp.documentId);
  if (i === -1) manifest.documents.push(fp);
  else manifest.documents[i] = fp;
  ctx.archive.saveManifest(manifest);
}

export async function ingestAll(candidates: CandidateDocument[], ctx: IngestContext): Promise<IngestOutcome[]> {
  ctx.archive.ensureDirs();
  const manifest = ctx.archive.loadManifest();
  const outcomes: IngestOutcome[] = [];
  for (const [i, candidate] of candidates.entries()) {
    ctx.log(`[${i + 1}/${candidates.length}] ${candidate.url}`);
    let result: IngestOutcome;
    try {
      result = await ingestCandidate(candidate, ctx, manifest);
    } catch (error) {
      result = { url: candidate.url, status: 'failed', documentId: null, message: (error as Error).message };
    }
    ctx.log(`    ${result.status}: ${result.message}`);
    outcomes.push(result);
  }
  return outcomes;
}

/* ------------------------------ input formats ------------------------------ */

interface SimpleCandidate {
  url: string;
  title?: string;
  sourceId?: string;
}

/** Accept the three supported input shapes (document manifest, source manifest, [{url}]). */
export function candidatesFromInput(raw: unknown): CandidateDocument[] {
  const fromSimple = (s: SimpleCandidate): CandidateDocument | null => {
    const normalized = typeof s?.url === 'string' ? normalizeUrl(s.url) : null;
    if (!normalized) return null;
    return {
      url: s.url,
      normalizedUrl: normalized,
      title: s.title ?? null,
      linkText: s.title ?? null,
      documentTypeHint: null,
      fileKind: null,
      sourceId: s.sourceId ?? '',
      adapterId: 'generic-html',
      foundOn: [],
      hostApproved: false,
      dateHint: null,
      documentNumberHint: null,
      meeting: null,
      contentType: null,
      contentLength: null,
    };
  };
  if (Array.isArray(raw)) return raw.map((r) => fromSimple(r as SimpleCandidate)).filter((c): c is CandidateDocument => c !== null);
  const obj = raw as Partial<DocumentDiscoveryManifest & DiscoveryManifest>;
  if (Array.isArray(obj.candidates)) return obj.candidates;
  if (Array.isArray(obj.documents)) {
    return obj.documents.map((d) => ({
      ...(fromSimple({ url: d.url, title: d.linkTexts[0], sourceId: d.sourceId ?? '' }) as CandidateDocument),
      documentTypeHint: d.documentTypeHint,
      fileKind: d.fileKind,
      foundOn: d.foundOn,
      hostApproved: d.hostApproved,
    }));
  }
  throw new Error('Unrecognised input: expected discovered-documents.json, discovered-sources.json, or an array of {url}.');
}

