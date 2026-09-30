/**
 * Builds the in-memory DEMO database from raw demo records: generates agendas, minutes and agenda
 * packets from meeting structure, assigns provenance, versions, chunks and relationships.
 *
 * Pure module (no DOM) so scripts/generate-demo-files.ts can reuse the page text to render PDFs.
 */
import type {
  AgendaItem,
  CategoryId,
  Document,
  DocumentChunk,
  DocumentPageText,
  DocumentRelationship,
  DocumentSource,
  DocumentVersion,
  GovernmentBody,
  Meeting,
  MeetingSummary,
  SourceRegistryEntry,
} from '@/types/models';
import { formatDate, formatTime } from '@/lib/format';
import { RAW_DOCUMENTS, type RawDocument, type RawPage } from './documents';
import { RAW_MEETINGS, type RawMeeting } from './meetings';
import { DEMO_BODIES, DEMO_SOURCES } from './registry';
import manifestJson from './demo-files-manifest.json';

interface ManifestEntry {
  fileName: string;
  sha256: string;
  size: number;
  pageCount: number;
  mimeType: string;
}

const manifest = manifestJson as Record<string, ManifestEntry>;

export const DEMO_ARCHIVE_UPDATED_AT = '2026-09-29T15:00:00Z';
const DEMO_SOURCE_BASE = 'https://example.org/vtp-demo/';

export interface MockDatabase {
  documents: Document[];
  documentsById: Map<string, Document>;
  pages: Map<string, DocumentPageText[]>;
  sections: Map<string, Array<string | null>>;
  chunks: DocumentChunk[];
  sources: Map<string, DocumentSource[]>;
  versions: Map<string, DocumentVersion[]>;
  relationships: Map<string, DocumentRelationship[]>;
  meetings: Meeting[];
  meetingsById: Map<string, Meeting>;
  bodies: GovernmentBody[];
  registry: SourceRegistryEntry[];
}

function bodyName(id: string | null | undefined): string | null {
  if (!id) return null;
  return DEMO_BODIES.find((b) => b.id === id)?.name ?? null;
}

function meetingHeading(m: RawMeeting): string {
  return `${m.title} — ${formatDate(m.date)}`;
}

/* ----------------------------------------------------- generated meeting records */

function agendaPages(m: RawMeeting): RawPage[] {
  const lines = m.items.map((item) => `${item.number}. ${item.title}${item.description ? ` — ${item.description}` : ''}`);
  return [
    {
      section: 'Agenda',
      text: `DEMO AGENDA. ${meetingHeading(m)}. ${formatTime(m.startTime)}, ${m.location}. This agenda is sample data generated for interface development. Items: ${lines.join(' ')}`,
    },
  ];
}

function minutesPages(m: RawMeeting): RawPage[] {
  const status = m.minutesStatus === 'approved' ? 'APPROVED DEMO MINUTES' : 'DRAFT DEMO MINUTES (not yet approved)';
  const itemText = m.items
    .filter((i) => i.itemType !== 'other')
    .map((i) => {
      const motions = (i.motions ?? [])
        .map((mo) => `${mo.description} Outcome: ${mo.outcome}. ${mo.voteRecord ?? 'No vote recorded.'}`)
        .join(' ');
      return `Item ${i.number}: ${i.title}. ${motions || 'Discussion only; no action taken.'}`;
    })
    .join(' ');
  return [
    {
      section: 'Minutes',
      text: `${status}. ${meetingHeading(m)}. Convened at ${formatTime(m.startTime)} at ${m.location}. Members present: demo members (placeholder). ${itemText} The meeting adjourned (demo). These minutes are sample data and are not a record of any government meeting.`,
    },
  ];
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
}

/** Returns all raw documents (authored + generated meeting records) with page text. */
export function buildRawDocuments(): { docs: RawDocument[]; packetRanges: Map<string, [number, number]> } {
  const authored = new Map(RAW_DOCUMENTS.map((d) => [d.id, d]));
  const generated: RawDocument[] = [];
  const packetRanges = new Map<string, [number, number]>();

  for (const m of RAW_MEETINGS) {
    const bodyCategory: CategoryId[] = ['meetings'];
    generated.push({
      id: `${m.id}-agenda`,
      title: `DEMO AGENDA — ${meetingHeading(m)}`,
      documentType: 'agenda',
      date: m.date,
      bodyId: m.bodyId,
      meetingId: m.id,
      description: 'Sample agenda generated from demo meeting data.',
      categories: [...bodyCategory, 'agendas'],
      tags: ['agenda', ...m.items.map((i) => i.title.toLowerCase())].slice(0, 6),
      pages: agendaPages(m),
    });

    if (m.status === 'held' && m.minutesStatus !== 'not_available') {
      generated.push({
        id: `${m.id}-minutes`,
        title: `DEMO MINUTES${m.minutesStatus === 'draft' ? ' (DRAFT)' : ''} — ${meetingHeading(m)}`,
        documentType: 'minutes',
        date: m.date,
        bodyId: m.bodyId,
        meetingId: m.id,
        description: `Sample ${m.minutesStatus} minutes generated from demo meeting data. Vote records are placeholders.`,
        categories: [...bodyCategory, 'minutes'],
        tags: ['minutes', 'motions', 'votes'],
        pages: minutesPages(m),
        relationships: [{ type: 'RECORD_OF', toKind: 'meeting', toId: m.id, toTitle: meetingHeading(m), basis: 'source_structure' }],
      });
    }

    if (m.hasPacket) {
      const pages: RawPage[] = [...agendaPages(m).map((p) => ({ ...p, section: 'Agenda' }))];
      for (const item of m.items) {
        const start = pages.length + 1;
        for (const docId of item.documentIds) {
          const doc = authored.get(docId);
          if (!doc) continue;
          doc.pages.forEach((p) => pages.push({ section: `Item ${item.number} — ${p.section ?? doc.title}`, text: p.text }));
        }
        if (pages.length + 1 > start) packetRanges.set(item.id, [start, pages.length]);
      }
      generated.push({
        id: `${m.id}-packet`,
        title: `DEMO AGENDA PACKET — ${meetingHeading(m)}`,
        documentType: 'agenda_packet',
        date: m.date,
        bodyId: m.bodyId,
        meetingId: m.id,
        description: 'Sample agenda packet assembled from the demo agenda and the demo records attached to each item.',
        categories: [...bodyCategory, 'agenda_packets'],
        tags: ['agenda packet', 'staff report', 'exhibits'],
        pages,
        relationships: [{ type: 'PART_OF', toKind: 'meeting', toId: m.id, toTitle: meetingHeading(m), basis: 'source_structure' }],
      });
    }
  }

  return { docs: [...RAW_DOCUMENTS, ...generated], packetRanges };
}

/* ----------------------------------------------------- assembly */

function estimateTokens(text: string): number {
  return Math.ceil(text.split(/\s+/).length * 1.3);
}

function pseudoChecksum(seed: string): string {
  // Deterministic stand-in used only if the demo file manifest has not been generated yet.
  let h1 = 0x811c9dc5;
  let out = '';
  for (let round = 0; out.length < 64; round++) {
    for (let i = 0; i < seed.length; i++) h1 = Math.imul(h1 ^ seed.charCodeAt(i) ^ round, 16777619) >>> 0;
    out += h1.toString(16).padStart(8, '0');
  }
  return out.slice(0, 64);
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso.length === 10 ? `${iso}T17:00:00Z` : iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

let cached: MockDatabase | null = null;

export function getMockDatabase(): MockDatabase {
  if (cached) return cached;

  const { docs: raw, packetRanges } = buildRawDocuments();
  const documents: Document[] = [];
  const pages = new Map<string, DocumentPageText[]>();
  const sections = new Map<string, Array<string | null>>();
  const chunks: DocumentChunk[] = [];
  const sources = new Map<string, DocumentSource[]>();
  const versions = new Map<string, DocumentVersion[]>();
  const relationships = new Map<string, DocumentRelationship[]>();

  for (const r of raw) {
    const m = manifest[r.id];
    const mimeType = r.mimeType ?? 'application/pdf';
    const ext = mimeType === 'text/plain' ? 'txt' : 'pdf';
    const fileName = m?.fileName ?? `${r.id}.${ext}`;
    const checksum = m?.sha256 ?? pseudoChecksum(r.id);
    const retrievedAt = addDays(r.date, 1);
    const archiveUrl = r.noArchivedCopy ? null : `/demo-files/${fileName}`;
    const originalUrl = `${DEMO_SOURCE_BASE}${fileName}`;

    const doc: Document = {
      id: r.id,
      slug: slugify(r.title),
      title: r.title,
      description: r.description,
      documentType: r.documentType,
      documentNumber: r.documentNumber ?? null,
      date: r.date,
      year: Number(r.date.slice(0, 4)),
      governmentBodyId: r.bodyId ?? null,
      governmentBodyName: bodyName(r.bodyId),
      meetingId: r.meetingId ?? null,
      agendaItemId: r.agendaItemId ?? null,
      sourceId: 'demo-source',
      originalUrl,
      archiveUrl,
      mimeType,
      fileName,
      fileSize: m?.size ?? null,
      pageCount: m?.pageCount ?? r.pages.length,
      checksum: r.noArchivedCopy ? null : checksum,
      checksumAlgorithm: 'sha256',
      extractedTextAvailable: true,
      ocrRequired: Boolean(r.ocr),
      ocrStatus: r.ocr ? 'complete' : 'not_required',
      ocrConfidence: r.ocr?.confidence ?? null,
      archivedAt: r.noArchivedCopy ? null : retrievedAt,
      createdAt: retrievedAt,
      updatedAt: r.versions?.length ? r.versions[r.versions.length - 1].retrievedAt : retrievedAt,
      tags: r.tags,
      entities: r.entities ?? [],
      categories: r.categories,
      currency: r.currency ?? (r.documentType === 'ordinance' ? 'current' : 'historical'),
      currentVersion: r.versions?.length ?? 1,
      isDemo: true,
    };
    documents.push(doc);

    pages.set(
      r.id,
      r.pages.map((p, i) => ({ page: i + 1, text: p.text, ocr: Boolean(r.ocr) })),
    );
    sections.set(
      r.id,
      r.pages.map((p) => p.section ?? null),
    );
    r.pages.forEach((p, i) => {
      chunks.push({
        id: `${r.id}#p${i + 1}`,
        documentId: r.id,
        pageStart: i + 1,
        pageEnd: i + 1,
        sectionTitle: p.section ?? null,
        text: p.text,
        tokenEstimate: estimateTokens(p.text),
        embeddingReference: null,
        metadata: { demo: true, ocr: Boolean(r.ocr) },
      });
    });

    sources.set(r.id, [
      {
        id: `${r.id}:demo-source`,
        sourceId: 'demo-source',
        name: 'Demo Source (sample data)',
        baseUrl: DEMO_SOURCE_BASE,
        sourceType: 'other',
        authority: 'None — sample data',
        originalUrl,
        retrievedAt,
        lastVerifiedAt: DEMO_ARCHIVE_UPDATED_AT,
        originalAvailable: !r.originalRemoved,
        httpStatusAtLastCheck: r.originalRemoved ? 404 : 200,
      },
    ]);

    const rawVersions = r.versions ?? [{ versionNumber: 1, retrievedAt, changeStatus: 'original' as const }];
    versions.set(
      r.id,
      rawVersions.map((v, idx) => ({
        id: `${r.id}@v${v.versionNumber}`,
        documentId: r.id,
        versionNumber: v.versionNumber,
        retrievedAt: v.retrievedAt,
        checksum: idx === rawVersions.length - 1 ? checksum : pseudoChecksum(`${r.id}@${v.versionNumber}`),
        sourceUrl: originalUrl,
        fileSize: m?.size ?? null,
        pageCount: r.pages.length,
        changeStatus: v.changeStatus,
        archiveUrl: idx === rawVersions.length - 1 ? archiveUrl : null,
        note: v.note,
      })),
    );

    relationships.set(
      r.id,
      (r.relationships ?? []).map((rel, idx) => ({
        id: `${r.id}:rel${idx}`,
        fromDocumentId: r.id,
        relationshipType: rel.type,
        toKind: rel.toKind,
        toId: rel.toId,
        toTitle: rel.toTitle,
        basis: rel.basis,
        evidence: rel.page ? { documentId: r.id, page: rel.page } : null,
      })),
    );
  }

  // Reverse "attached to meeting packet" relationships for authored docs included in packets.
  for (const m of RAW_MEETINGS) {
    if (!m.hasPacket) continue;
    for (const item of m.items) {
      const range = packetRanges.get(item.id);
      for (const docId of item.documentIds) {
        const list = relationships.get(docId);
        if (!list || !range) continue;
        list.push({
          id: `${docId}:packet`,
          fromDocumentId: docId,
          relationshipType: 'PART_OF',
          toKind: 'document',
          toId: `${m.id}-packet`,
          toTitle: `DEMO AGENDA PACKET — ${meetingHeading(m)} (pages ${range[0]}–${range[1]})`,
          basis: 'source_structure',
          evidence: { documentId: `${m.id}-packet`, page: range[0] },
        });
      }
    }
  }

  const documentsById = new Map(documents.map((d) => [d.id, d]));

  const meetings: Meeting[] = RAW_MEETINGS.map((m) => {
    const agendaItems: AgendaItem[] = m.items.map((i) => {
      const range = packetRanges.get(i.id);
      return {
        id: i.id,
        meetingId: m.id,
        number: i.number,
        title: i.title,
        description: i.description,
        itemType: i.itemType,
        documentIds: i.documentIds.filter((id) => documentsById.has(id)),
        packetPageStart: range?.[0] ?? null,
        packetPageEnd: range?.[1] ?? null,
        motions: (i.motions ?? []).map((mo, idx) => ({
          id: `${i.id}:m${idx}`,
          description: mo.description,
          outcome: mo.outcome,
          voteRecord: mo.voteRecord,
          evidence: { documentId: `${m.id}-minutes`, page: 1 },
        })),
      };
    });
    const has = (id: string) => (documentsById.has(id) ? id : null);
    return {
      id: m.id,
      slug: m.id,
      title: m.title,
      governmentBodyId: m.bodyId,
      governmentBodyName: bodyName(m.bodyId) ?? m.bodyId,
      meetingType: m.meetingType,
      date: m.date,
      startTime: m.startTime,
      location: m.location,
      status: m.status,
      agendaDocumentId: has(`${m.id}-agenda`),
      packetDocumentId: has(`${m.id}-packet`),
      minutesDocumentId: has(`${m.id}-minutes`),
      minutesStatus: m.minutesStatus,
      media: m.media.map((md) => ({
        kind: md.kind,
        label: md.label,
        url: null,
        durationSeconds: md.durationSeconds ?? null,
        documentId: md.documentId ?? null,
        sourceId: 'demo-source',
      })),
      agendaItems,
      sourceIds: ['demo-source'],
      isDemo: true,
    };
  });

  const bodies = DEMO_BODIES.map((b) => {
    const bodyDocs = documents.filter((d) => d.governmentBodyId === b.id);
    const dates = bodyDocs.map((d) => d.date).filter((d): d is string => Boolean(d)).sort();
    return {
      ...b,
      meetingCount: meetings.filter((m) => m.governmentBodyId === b.id).length,
      documentCount: bodyDocs.length,
      firstRecordDate: dates[0] ?? null,
      lastRecordDate: dates[dates.length - 1] ?? null,
    };
  });

  const registry = DEMO_SOURCES.map((s) => (s.id === 'demo-source' ? { ...s, documentCount: documents.length } : s));

  cached = {
    documents,
    documentsById,
    pages,
    sections,
    chunks,
    sources,
    versions,
    relationships,
    meetings,
    meetingsById: new Map(meetings.map((m) => [m.id, m])),
    bodies,
    registry,
  };
  return cached;
}

export function toMeetingSummary(m: Meeting): MeetingSummary {
  const { agendaItems, media, ...rest } = m;
  return {
    ...rest,
    agendaItemCount: agendaItems.length,
    hasVideo: media.some((x) => x.kind === 'video'),
    hasAudio: media.some((x) => x.kind === 'audio'),
    hasTranscript: media.some((x) => x.kind === 'transcript'),
  };
}
