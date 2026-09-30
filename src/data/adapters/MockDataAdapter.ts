/**
 * MockDataAdapter — serves clearly labeled DEMO data from memory.
 *
 * Also supports "demo scenarios" (set from the Status page) so every error state can be exercised
 * without a backend: backend offline, AI unavailable, search unavailable, slow network.
 */
import type {
  ArchiveStatistics,
  AskRequest,
  AskResponse,
  BrowseFacets,
  Category,
  CategoryId,
  CodeNode,
  DocumentDetail,
  DocumentPageText,
  DocumentSummary,
  GovernmentBody,
  HealthStatus,
  IssueReport,
  IssueReportReceipt,
  Meeting,
  MeetingSummary,
  Paginated,
  RelatedDocument,
  SearchRequest,
  SearchResponse,
  SourceRegistryEntry,
  SuggestedQuery,
  Topic,
  TopicDetail,
} from '@/types/models';
import { CATEGORY_DESCRIPTIONS, CATEGORY_LABELS, DOCUMENT_TYPE_LABELS } from '@/lib/labels';
import { answerQuestion } from '../mock/askEngine';
import { DEMO_CODE } from '../mock/code';
import { DEMO_ARCHIVE_UPDATED_AT, getMockDatabase, toMeetingSummary, type MockDatabase } from '../mock/db';
import { computeFacets, matchesFilters, runSearch, toSummary } from '../mock/searchEngine';
import { DEMO_SUGGESTIONS } from '../mock/suggestions';
import { DEMO_TOPICS } from '../mock/topics';
import type { DataAdapter, DocumentListRequest, MeetingListRequest, RequestOptions } from './DataAdapter';
import { DataError } from './errors';
import { readDemoScenario, type DemoScenario } from './demoScenario';

const CATEGORY_TYPES: Record<CategoryId, Category['documentTypes']> = {
  meetings: ['agenda', 'agenda_packet', 'minutes', 'transcript', 'recording'],
  agendas: ['agenda'],
  minutes: ['minutes'],
  agenda_packets: ['agenda_packet'],
  ordinances: ['ordinance'],
  resolutions: ['resolution'],
  contracts: ['contract', 'interlocal_agreement', 'professional_services_agreement'],
  development_agreements: ['development_agreement'],
  budgets_finance: ['budget', 'financial_report'],
  audits: ['audit'],
  planning_land_use: ['plan', 'map', 'staff_report'],
  transportation: ['study'],
  public_notices: ['public_notice'],
  reports_studies: ['staff_report', 'study'],
  procurement: ['procurement'],
  maps: ['map'],
  other: ['other', 'proclamation', 'memorandum'],
};

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DataError('aborted', 'Request cancelled.'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DataError('aborted', 'Request cancelled.'));
      },
      { once: true },
    );
  });
}

export class MockDataAdapter implements DataAdapter {
  readonly mode = 'mock' as const;
  private readonly scenario: () => DemoScenario;

  constructor(scenario: () => DemoScenario = readDemoScenario) {
    this.scenario = scenario;
  }

  private get db(): MockDatabase {
    return getMockDatabase();
  }

  /** Simulated network latency so skeleton states are visible and realistic. */
  private async latency(opts?: RequestOptions, base = 180): Promise<void> {
    const s = this.scenario();
    if (s === 'backend_offline') {
      await wait(250, opts?.signal);
      throw new DataError('offline', 'The archive backend could not be reached.');
    }
    await wait(s === 'slow' ? 2200 : base + Math.random() * 220, opts?.signal);
  }

  private notFound(what: string): never {
    throw new DataError('not_found', `${what} was not found in the archive.`, { status: 404 });
  }

  async health(opts?: RequestOptions): Promise<HealthStatus> {
    const s = this.scenario();
    await wait(80, opts?.signal);
    return {
      status: s === 'backend_offline' ? 'offline' : s === 'normal' || s === 'slow' ? 'ok' : 'degraded',
      mode: 'mock',
      search: s !== 'backend_offline' && s !== 'search_unavailable',
      ai: s === 'normal' || s === 'slow',
      checkedAt: new Date().toISOString(),
      message: 'Demo data mode — no production backend is connected.',
    };
  }

  async ask(request: AskRequest, opts?: RequestOptions): Promise<AskResponse> {
    await this.latency(opts, 650);
    if (this.scenario() === 'ai_unavailable') {
      throw new DataError('ai_unavailable', 'The AI answer quota is exhausted (simulated).', { status: 503, retryAfterSeconds: 300 });
    }
    return answerQuestion(this.db, request);
  }

  async search(request: SearchRequest, opts?: RequestOptions): Promise<SearchResponse> {
    await this.latency(opts, 220);
    if (this.scenario() === 'search_unavailable') throw new DataError('search_unavailable', 'Search is temporarily unavailable (simulated).', { status: 503 });
    return runSearch(this.db, request);
  }

  async listDocuments(request: DocumentListRequest, opts?: RequestOptions): Promise<Paginated<DocumentSummary>> {
    await this.latency(opts);
    const res = runSearch(this.db, { query: '', filters: request.filters, sort: request.sort ?? 'date_desc', page: request.page, pageSize: request.pageSize });
    return { items: res.items.map((r) => r.document), page: res.page, pageSize: res.pageSize, total: res.total };
  }

  async getDocumentsByIds(ids: string[], opts?: RequestOptions): Promise<DocumentSummary[]> {
    await this.latency(opts, 80);
    return ids.map((id) => this.db.documentsById.get(id)).filter((d) => d !== undefined).map(toSummary);
  }

  async getDocument(id: string, opts?: RequestOptions): Promise<DocumentDetail> {
    await this.latency(opts);
    const db = this.db;
    const doc = db.documentsById.get(id) ?? db.documents.find((d) => d.slug === id);
    if (!doc) this.notFound('Document');
    const meeting = doc.meetingId ? db.meetingsById.get(doc.meetingId) : undefined;
    const item = meeting?.agendaItems.find((a) => a.id === doc.agendaItemId);
    return {
      ...doc,
      governmentBody: db.bodies.find((b) => b.id === doc.governmentBodyId) ?? null,
      meeting: meeting ? toMeetingSummary(meeting) : null,
      agendaItem: item ? { id: item.id, number: item.number, title: item.title } : null,
      sources: db.sources.get(doc.id) ?? [],
      versions: db.versions.get(doc.id) ?? [],
      relationships: db.relationships.get(doc.id) ?? [],
    };
  }

  async getDocumentText(id: string, opts?: RequestOptions): Promise<DocumentPageText[]> {
    await this.latency(opts, 120);
    const pages = this.db.pages.get(id);
    if (!pages) this.notFound('Document text');
    return pages;
  }

  async getRelatedDocuments(id: string, opts?: RequestOptions): Promise<RelatedDocument[]> {
    await this.latency(opts, 150);
    const db = this.db;
    const doc = db.documentsById.get(id);
    if (!doc) this.notFound('Document');
    const out = new Map<string, RelatedDocument>();
    for (const rel of db.relationships.get(id) ?? []) {
      if (rel.toKind !== 'document') continue;
      const target = db.documentsById.get(rel.toId);
      if (target) out.set(target.id, { document: toSummary(target), relationshipType: rel.relationshipType, reason: rel.toTitle });
    }
    // Inbound relationships.
    for (const [fromId, rels] of db.relationships) {
      for (const rel of rels) {
        if (rel.toKind === 'document' && rel.toId === id && !out.has(fromId)) {
          const from = db.documentsById.get(fromId);
          const inverse = rel.relationshipType === 'SUPERSEDES' ? 'SUPERSEDED_BY' : rel.relationshipType === 'SUPERSEDED_BY' ? 'SUPERSEDES' : 'RELATED_TO';
          if (from) out.set(from.id, { document: toSummary(from), relationshipType: inverse, reason: 'Links to this record' });
        }
      }
    }
    // Same meeting.
    if (doc.meetingId) {
      for (const d of db.documents) {
        if (d.id !== id && d.meetingId === doc.meetingId && !out.has(d.id)) {
          out.set(d.id, { document: toSummary(d), relationshipType: 'RELATED_TO', reason: 'Same meeting' });
        }
      }
    }
    // Shared tags/entities.
    const keys = new Set([...doc.tags, ...doc.entities.map((e) => e.name)].map((s) => s.toLowerCase()));
    const scored = db.documents
      .filter((d) => d.id !== id && !out.has(d.id))
      .map((d) => ({ d, n: [...d.tags, ...d.entities.map((e) => e.name)].filter((t) => keys.has(t.toLowerCase())).length }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n)
      .slice(0, 4);
    for (const { d } of scored) out.set(d.id, { document: toSummary(d), relationshipType: 'SIMILAR', reason: 'Shares subjects' });
    return [...out.values()].slice(0, 10);
  }

  getDocumentFileUrl(_id: string, archiveUrl: string | null): string | null {
    return archiveUrl;
  }

  async listMeetings(request: MeetingListRequest, opts?: RequestOptions): Promise<Paginated<MeetingSummary>> {
    await this.latency(opts);
    let list = this.db.meetings.filter(
      (m) => (!request.governmentBodyId || m.governmentBodyId === request.governmentBodyId) && (!request.year || m.date.startsWith(String(request.year))),
    );
    list = [...list].sort((a, b) => (request.sort === 'date_asc' ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)));
    const page = Math.max(1, request.page ?? 1);
    const pageSize = request.pageSize ?? 20;
    return { items: list.slice((page - 1) * pageSize, page * pageSize).map(toMeetingSummary), page, pageSize, total: list.length };
  }

  async getMeeting(id: string, opts?: RequestOptions): Promise<Meeting> {
    await this.latency(opts);
    const m = this.db.meetingsById.get(id);
    if (!m) this.notFound('Meeting');
    return m;
  }

  async listGovernmentBodies(opts?: RequestOptions): Promise<GovernmentBody[]> {
    await this.latency(opts, 100);
    return this.db.bodies;
  }

  async getGovernmentBody(id: string, opts?: RequestOptions): Promise<GovernmentBody> {
    await this.latency(opts, 100);
    const b = this.db.bodies.find((x) => x.id === id || x.slug === id);
    if (!b) this.notFound('Public body');
    return b;
  }

  async listCategories(opts?: RequestOptions): Promise<Category[]> {
    await this.latency(opts, 100);
    const docs = this.db.documents;
    return (Object.keys(CATEGORY_LABELS) as CategoryId[]).map((id) => ({
      id,
      label: CATEGORY_LABELS[id],
      description: CATEGORY_DESCRIPTIONS[id],
      documentTypes: CATEGORY_TYPES[id],
      documentCount: docs.filter((d) => matchesFilters(d, { categories: [id] })).length,
    }));
  }

  async getBrowseFacets(opts?: RequestOptions): Promise<BrowseFacets> {
    await this.latency(opts, 120);
    const f = computeFacets(this.db.documents, undefined, this.db);
    const subjects = new Map<string, number>();
    for (const d of this.db.documents) for (const t of d.tags) subjects.set(t, (subjects.get(t) ?? 0) + 1);
    return {
      ...f,
      documentTypes: f.documentTypes.map((b) => ({ ...b, label: DOCUMENT_TYPE_LABELS[b.value as keyof typeof DOCUMENT_TYPE_LABELS] ?? b.label })),
      subjects: [...subjects.entries()]
        .filter(([, n]) => n >= 2)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 30)
        .map(([value, count]) => ({ value, label: value, count })),
    };
  }

  async listSources(opts?: RequestOptions): Promise<SourceRegistryEntry[]> {
    await this.latency(opts, 100);
    return this.db.registry;
  }

  async getSource(id: string, opts?: RequestOptions): Promise<SourceRegistryEntry> {
    await this.latency(opts, 100);
    const s = this.db.registry.find((x) => x.id === id);
    if (!s) this.notFound('Source');
    return s;
  }

  async getStatistics(opts?: RequestOptions): Promise<ArchiveStatistics> {
    await this.latency(opts, 120);
    const db = this.db;
    const dates = db.documents.map((d) => d.date).filter((d): d is string => Boolean(d)).sort();
    return {
      documentsIndexed: db.documents.length,
      pagesIndexed: db.chunks.length,
      meetingsIndexed: db.meetings.length,
      earliestRecordDate: dates[0] ?? null,
      latestRecordDate: dates[dates.length - 1] ?? null,
      archiveLastUpdatedAt: DEMO_ARCHIVE_UPDATED_AT,
      sourcesMonitored: db.registry.length,
      sourcesHealthy: db.registry.filter((s) => s.health?.status === 'active').length,
      ocrPendingCount: 0,
      isDemo: true,
    };
  }

  async getSuggestions(opts?: RequestOptions): Promise<SuggestedQuery[]> {
    await wait(40, opts?.signal);
    return DEMO_SUGGESTIONS;
  }

  async listTopics(opts?: RequestOptions): Promise<Topic[]> {
    await this.latency(opts, 100);
    return DEMO_TOPICS.map((t) => ({ id: t.id, slug: t.slug, name: t.name, kind: t.kind, description: t.description, documentCount: t.documentIds.length, isDemo: true }));
  }

  async getTopic(id: string, opts?: RequestOptions): Promise<TopicDetail> {
    await this.latency(opts, 150);
    const t = DEMO_TOPICS.find((x) => x.id === id || x.slug === id);
    if (!t) this.notFound('Topic');
    return { ...t, documentCount: t.documentIds.length };
  }

  async getMunicipalCode(opts?: RequestOptions): Promise<CodeNode[]> {
    await this.latency(opts, 120);
    return DEMO_CODE;
  }

  async submitIssueReport(report: IssueReport, opts?: RequestOptions): Promise<IssueReportReceipt> {
    await this.latency(opts, 400);
    if (!report.description.trim() && report.issueType === 'other') {
      throw new DataError('bad_response', 'Please describe the issue.');
    }
    return { id: `demo-report-${Date.now().toString(36)}`, receivedAt: new Date().toISOString(), status: 'received' };
  }
}
