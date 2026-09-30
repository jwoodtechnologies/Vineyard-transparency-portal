/**
 * Frontend services. Components call these — never an adapter, database, or fetch directly.
 */
import type { IssueReport, SearchRequest } from '@/types/models';
import { getAdapter } from '@/data/adapters';
import type { DocumentListRequest, MeetingListRequest } from '@/data/adapters/DataAdapter';
import { cached } from './cache';

export { AskService, AI_UNAVAILABLE_MESSAGE, isAiBreakerOpen, resetAiBreaker } from './AskService';
export { clearServiceCache } from './cache';

const MIN = 60_000;
const key = (name: string, arg?: unknown) => `${name}:${JSON.stringify(arg ?? null)}`;

export const SearchService = {
  search: async (req: SearchRequest, signal?: AbortSignal) => (await getAdapter()).search(req, { signal }),
  suggestions: () => cached(key('suggestions'), 10 * MIN, async () => (await getAdapter()).getSuggestions()),
};

export const DocumentService = {
  list: (req: DocumentListRequest) => cached(key('docs', req), MIN, async () => (await getAdapter()).listDocuments(req)),
  get: (id: string) => cached(key('doc', id), 5 * MIN, async () => (await getAdapter()).getDocument(id)),
  text: (id: string) => cached(key('doc-text', id), 5 * MIN, async () => (await getAdapter()).getDocumentText(id)),
  related: (id: string) => cached(key('doc-related', id), 5 * MIN, async () => (await getAdapter()).getRelatedDocuments(id)),
  byIds: (ids: string[]) => cached(key('doc-ids', ids), MIN, async () => (await getAdapter()).getDocumentsByIds(ids)),
  fileUrl: async (id: string, archiveUrl: string | null) => (await getAdapter()).getDocumentFileUrl(id, archiveUrl),
};

export const MeetingService = {
  list: (req: MeetingListRequest) => cached(key('meetings', req), MIN, async () => (await getAdapter()).listMeetings(req)),
  get: (id: string) => cached(key('meeting', id), 5 * MIN, async () => (await getAdapter()).getMeeting(id)),
};

export const BrowseService = {
  categories: () => cached(key('categories'), 10 * MIN, async () => (await getAdapter()).listCategories()),
  facets: () => cached(key('facets'), 10 * MIN, async () => (await getAdapter()).getBrowseFacets()),
  bodies: () => cached(key('bodies'), 10 * MIN, async () => (await getAdapter()).listGovernmentBodies()),
  body: (id: string) => cached(key('body', id), 10 * MIN, async () => (await getAdapter()).getGovernmentBody(id)),
  topics: () => cached(key('topics'), 10 * MIN, async () => (await getAdapter()).listTopics()),
  topic: (id: string) => cached(key('topic', id), 10 * MIN, async () => (await getAdapter()).getTopic(id)),
  municipalCode: () => cached(key('code'), 10 * MIN, async () => (await getAdapter()).getMunicipalCode()),
};

export const SourceService = {
  list: () => cached(key('sources'), 5 * MIN, async () => (await getAdapter()).listSources()),
  get: (id: string) => cached(key('source', id), 5 * MIN, async () => (await getAdapter()).getSource(id)),
};

export const StatisticsService = {
  stats: () => cached(key('stats'), 5 * MIN, async () => (await getAdapter()).getStatistics()),
  health: async () => (await getAdapter()).health(),
  mode: async () => (await getAdapter()).mode,
};

export const ReportService = {
  submit: async (report: IssueReport) => (await getAdapter()).submitIssueReport(report),
};
