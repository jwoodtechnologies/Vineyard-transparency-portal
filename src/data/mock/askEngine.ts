/**
 * DEMO ASK ENGINE ("demo-extractive").
 *
 * No language model. It answers only by quoting sentences from retrieved demo chunks, attaching a
 * citation to every quoted sentence. When evidence is weak it says so. This mirrors the grounding
 * contract the production RAG service must satisfy (docs/RAG_DESIGN.md):
 *   question → query analysis → retrieval → chunk selection → source validation → answer + citations
 */
import type {
  AnswerParagraph,
  AskRequest,
  AskResponse,
  Citation,
  CategoryId,
  Document,
  DocumentType,
  Meeting,
  SearchFilters,
} from '@/types/models';
import { documentTypeLabel } from '@/lib/labels';
import { formatDate } from '@/lib/format';
import { contentStems, findHighlights, makeSnippet, QUESTION_STOPWORDS, splitSentences, stem, tokenize } from '@/lib/text';
import type { MockDatabase } from './db';
import { documentFrequency, rankChunks, runSearch, toSummary, type ChunkHit } from './searchEngine';

export const NOT_VERIFIED = 'I could not verify that from the records currently indexed in the Vineyard Transparency Portal.';
export const PARTIAL = 'The archive found related documents, but there is not enough evidence to answer this question confidently.';
const DEMO_NOTICE =
  'Demo mode: this answer was assembled by quoting demo records directly — no language model was used, and none of these records are real government records.';

const TYPE_WORDS: Array<{ re: RegExp; types?: DocumentType[]; categories?: CategoryId[] }> = [
  { re: /\bordinances?\b/i, types: ['ordinance'] },
  { re: /\bresolutions?\b/i, types: ['resolution'] },
  { re: /\bcontracts?\b|\bagreements?\b/i, categories: ['contracts', 'development_agreements'] },
  { re: /\bminutes\b/i, types: ['minutes'] },
  { re: /\bagendas?\b/i, types: ['agenda'] },
  { re: /\bbudgets?\b/i, categories: ['budgets_finance'] },
  { re: /\baudits?\b/i, types: ['audit'] },
  { re: /\bnotices?\b/i, types: ['public_notice'] },
  { re: /\bstaff reports?\b/i, types: ['staff_report'] },
];

const TYPE_STOP = new Set(
  'ordinance ordinances resolution resolutions contract contracts agreement agreements minutes agenda agendas notice notices adopted approved passed'.split(' '),
);

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

interface Analysis {
  stems: string[];
  terms: string[];
  filters: SearchFilters;
  listingMode: boolean;
  meetingDate: { month: number; day: number; year: number | null } | null;
}

function analyze(question: string, conversation: AskRequest['conversation']): Analysis {
  const filters: SearchFilters = {};
  const types: DocumentType[] = [];
  const categories: CategoryId[] = [];
  let hasTypeWord = false;
  for (const tw of TYPE_WORDS) {
    if (tw.re.test(question)) {
      hasTypeWord = true;
      if (tw.types) types.push(...tw.types);
      if (tw.categories) categories.push(...tw.categories);
    }
  }
  if (types.length && !categories.length) filters.documentTypes = types;
  else if (categories.length && !types.length) filters.categories = categories;

  const years = [...question.matchAll(/\b(20\d{2}|19\d{2})\b/g)].map((m) => Number(m[1]));
  if (years.length) filters.years = [...new Set(years)];

  const dateMatch = new RegExp(`\\b(${MONTHS.join('|')})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`, 'i').exec(question);
  const meetingDate = dateMatch
    ? { month: MONTHS.indexOf(dateMatch[1].toLowerCase()) + 1, day: Number(dateMatch[2]), year: dateMatch[3] ? Number(dateMatch[3]) : null }
    : null;

  const extra = new Set([...QUESTION_STOPWORDS, ...TYPE_STOP, ...MONTHS]);
  let terms = tokenize(question)
    .map((t) => t.raw.toLowerCase())
    .filter((w) => w.length > 1 && !extra.has(w) && !/^(19|20)\d{2}$/.test(w) && !/^\d{1,2}$/.test(w));
  let stems = contentStems(terms.join(' '));
  terms = [...new Set(terms)];

  // Short follow-ups ("what about 2025?") inherit the previous question's subject.
  if (stems.length < 1 && conversation?.length) {
    const prev = [...conversation].reverse().find((t) => t.role === 'user');
    if (prev) {
      const prevAnalysis = analyze(prev.content, []);
      stems = prevAnalysis.stems;
      terms = prevAnalysis.terms;
      filters.documentTypes ??= prevAnalysis.filters.documentTypes;
      filters.categories ??= prevAnalysis.filters.categories;
    }
  }

  return { stems, terms, filters, listingMode: hasTypeWord && stems.length === 0, meetingDate };
}

function shortTitle(doc: Document): string {
  const idx = doc.title.indexOf(' — ');
  return idx > -1 ? doc.title.slice(idx + 3) : doc.title;
}

function makeCitation(db: MockDatabase, index: number, doc: Document, page: number | null, quote: string, stems: string[]): Citation {
  const meeting = doc.meetingId ? db.meetingsById.get(doc.meetingId) : undefined;
  const item = meeting?.agendaItems.find((a) => a.id === doc.agendaItemId);
  const chunk = db.chunks.find((c) => c.documentId === doc.id && c.pageStart === page);
  const hl = findHighlights(quote, stems);
  const snip = makeSnippet(quote, hl, 400);
  return {
    index,
    documentId: doc.id,
    documentTitle: doc.title,
    documentType: doc.documentType,
    documentNumber: doc.documentNumber,
    date: doc.date,
    governmentBodyName: doc.governmentBodyName,
    meetingId: doc.meetingId,
    meetingTitle: meeting ? `${meeting.title} — ${formatDate(meeting.date)}` : null,
    agendaItem: item ? `Item ${item.number}: ${item.title}` : null,
    page,
    sectionTitle: chunk?.sectionTitle ?? null,
    excerpt: { documentId: doc.id, chunkId: chunk?.id ?? null, page, sectionTitle: chunk?.sectionTitle ?? null, text: snip.text, highlights: snip.highlights },
    archiveUrl: doc.archiveUrl,
    originalUrl: doc.originalUrl,
    isDemo: doc.isDemo,
  };
}

const BOILERPLATE = /not a government record|not a record of any|is sample data|demo data\)?\.?$|for interface development/i;

function pickSentences(hit: ChunkHit, stems: string[]): string[] {
  const sentences = splitSentences(hit.chunk.text)
    .filter((s) => !BOILERPLATE.test(s) || stems.some((st) => /demo|sample/.test(st)))
    .map((s) => {
      const sStems = new Set(tokenize(s).map((t) => t.stem));
      return { s, score: stems.filter((st) => sStems.has(st)).length };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return sentences.slice(0, 2).map((x) => x.s);
}

function followUpsFor(docs: Document[], db: MockDatabase): string[] {
  const out: string[] = [];
  const first = docs[0];
  if (!first) return out;
  if (first.meetingId) {
    const m = db.meetingsById.get(first.meetingId);
    if (m) out.push(`What else was on the agenda for the ${m.governmentBodyName} meeting on ${formatDate(m.date)}?`);
  }
  const entity = docs.flatMap((d) => d.entities).find((e) => e.type !== 'topic');
  if (entity) out.push(`What other records mention ${entity.name}?`);
  const rels = db.relationships.get(first.id) ?? [];
  const sup = rels.find((r) => r.relationshipType === 'SUPERSEDES' || r.relationshipType === 'SUPERSEDED_BY');
  if (sup) out.push(`What changed between ${first.documentNumber ?? 'this record'} and the version it ${sup.relationshipType === 'SUPERSEDES' ? 'replaced' : 'was replaced by'}?`);
  if (first.year) out.push(`Show ${documentTypeLabel(first.documentType).toLowerCase()} records from ${first.year}.`);
  return [...new Set(out)].slice(0, 3);
}

function meetingsOn(db: MockDatabase, md: NonNullable<Analysis['meetingDate']>): Meeting[] {
  return db.meetings.filter((m) => {
    const [y, mo, d] = m.date.split('-').map(Number);
    return mo === md.month && d === md.day && (md.year == null || md.year === y);
  });
}

let counter = 0;
function responseId(): string {
  counter = (counter + 1) % 1e6;
  return `demo-ask-${Date.now().toString(36)}-${counter}`;
}

export function answerQuestion(db: MockDatabase, request: AskRequest): AskResponse {
  const question = request.question.trim();
  const a = analyze(question, request.conversation);
  const filters: SearchFilters = { ...a.filters, ...request.filters };
  const base = {
    id: responseId(),
    question,
    generatedAt: new Date().toISOString(),
    engine: 'demo-extractive',
    isDemo: true,
    notice: DEMO_NOTICE,
  };
  const fallbackSearch = () =>
    runSearch(db, { query: a.terms.join(' ') || question, match: 'any', pageSize: 5, filters: request.filters }).items;

  /* ---- Meeting-date questions: "What happened at the September 8 council meeting?" */
  if (a.meetingDate) {
    const found = meetingsOn(db, a.meetingDate).filter(
      (m) => !filters.governmentBodyIds?.length || filters.governmentBodyIds.includes(m.governmentBodyId),
    );
    if (!found.length) {
      return {
        ...base,
        retrievalStatus: 'no_results',
        answer: `${NOT_VERIFIED} No meeting on that date is recorded in the currently indexed records.`,
        paragraphs: [{ segments: [{ text: `${NOT_VERIFIED} No meeting on that date is recorded in the currently indexed records.`, citations: [] }] }],
        citations: [],
        relatedDocuments: [],
        suggestedFollowUps: ['Which meetings are in the archive?'],
        searchResults: fallbackSearch(),
      };
    }
    const citations: Citation[] = [];
    const paragraphs: AnswerParagraph[] = [];
    for (const m of found) {
      const minutesDoc = m.minutesDocumentId ? db.documentsById.get(m.minutesDocumentId) : undefined;
      const agendaDoc = m.agendaDocumentId ? db.documentsById.get(m.agendaDocumentId) : undefined;
      const evidenceDoc = minutesDoc ?? agendaDoc;
      if (!evidenceDoc) continue;
      const text = db.pages.get(evidenceDoc.id)?.[0]?.text ?? '';
      const idx = citations.length + 1;
      citations.push(makeCitation(db, idx, evidenceDoc, 1, text, a.stems));
      const segments = [{ text: `The ${minutesDoc ? (m.minutesStatus === 'draft' ? 'draft minutes' : 'minutes') : 'agenda'} for the ${m.governmentBodyName} meeting on ${formatDate(m.date)} list the following items.`, citations: [idx] }];
      for (const item of m.agendaItems.filter((i) => i.itemType !== 'other')) {
        const motion = item.motions[0];
        segments.push({
          text: ` Item ${item.number}: ${item.title}${minutesDoc && motion ? ` — recorded outcome: ${motion.outcome}${motion.voteRecord ? ` (${motion.voteRecord})` : ''}.` : '.'}`,
          citations: [idx],
        });
      }
      paragraphs.push({ segments });
    }
    return {
      ...base,
      retrievalStatus: citations.length ? 'grounded' : 'no_results',
      answer: paragraphs.map((p) => p.segments.map((s) => s.text + s.citations.map((c) => ` [${c}]`).join('')).join('')).join('\n\n'),
      paragraphs,
      citations,
      relatedDocuments: found.flatMap((m) => [m.agendaDocumentId, m.packetDocumentId, m.minutesDocumentId]).filter((x): x is string => Boolean(x)).map((id) => toSummary(db.documentsById.get(id)!)),
      suggestedFollowUps: followUpsFor(found.flatMap((m) => (m.minutesDocumentId ? [db.documentsById.get(m.minutesDocumentId)!] : [])), db),
    };
  }

  /* ---- Listing questions: "Show me ordinances adopted in 2026." */
  if (a.listingMode) {
    const listed = runSearch(db, { query: '', filters, sort: 'date_desc', pageSize: 8 });
    if (!listed.items.length) {
      return {
        ...base,
        retrievalStatus: 'no_results',
        answer: NOT_VERIFIED,
        paragraphs: [{ segments: [{ text: NOT_VERIFIED, citations: [] }] }],
        citations: [],
        relatedDocuments: [],
        suggestedFollowUps: [],
        searchResults: fallbackSearch(),
      };
    }
    const citations = listed.items.map((r, i) => {
      const doc = db.documentsById.get(r.document.id)!;
      return makeCitation(db, i + 1, doc, 1, db.pages.get(doc.id)?.[0]?.text ?? '', []);
    });
    const paragraphs: AnswerParagraph[] = [
      {
        segments: [
          { text: `The indexed demo records include ${listed.total} matching record${listed.total === 1 ? '' : 's'}${filters.years?.length ? ` dated ${filters.years.join(', ')}` : ''}:`, citations: [] },
        ],
      },
      ...listed.items.map((r, i) => ({
        segments: [
          {
            text: `${r.document.documentNumber ? `${r.document.documentNumber} — ` : ''}${shortTitle(db.documentsById.get(r.document.id)!)} (${formatDate(r.document.date)}${r.document.currency === 'superseded' ? ', superseded' : ''})`,
            citations: [i + 1],
          },
        ],
      })),
    ];
    return {
      ...base,
      retrievalStatus: 'grounded',
      answer: paragraphs.map((p) => p.segments.map((s) => s.text + s.citations.map((c) => ` [${c}]`).join('')).join('')).join('\n'),
      paragraphs,
      citations,
      relatedDocuments: [],
      suggestedFollowUps: followUpsFor(listed.items.map((r) => db.documentsById.get(r.document.id)!), db),
    };
  }

  /* ---- General retrieval */
  // Ignore terms that appear nowhere; they cannot be verified and should lower confidence.
  const known = a.stems.filter((s) => documentFrequency(db, s) > 0);
  const hits = known.length ? rankChunks(db, known, filters, 16) : [];

  if (!hits.length) {
    return {
      ...base,
      retrievalStatus: 'no_results',
      answer: NOT_VERIFIED,
      paragraphs: [{ segments: [{ text: NOT_VERIFIED, citations: [] }] }],
      citations: [],
      relatedDocuments: [],
      suggestedFollowUps: [],
      searchResults: fallbackSearch(),
    };
  }

  const citations: Citation[] = [];
  const statements: Array<{ doc: Document; sentence: string; idx: number }> = [];
  const perDoc = new Map<string, number>();
  const covered = new Set<string>();
  for (const hit of hits) {
    if (statements.length >= 4) break;
    if ((perDoc.get(hit.doc.id) ?? 0) >= 1) continue;
    // Skip packet pages that duplicate an already-cited authored record.
    if (hit.doc.documentType === 'agenda_packet' && statements.some((s) => hit.chunk.text.includes(s.sentence))) continue;
    const sentences = pickSentences(hit, known);
    if (!sentences.length) continue;
    const idx = citations.length + 1;
    citations.push(makeCitation(db, idx, hit.doc, hit.chunk.pageStart, sentences.join(' '), known));
    for (const s of sentences) {
      statements.push({ doc: hit.doc, sentence: s, idx });
      for (const t of tokenize(s)) if (known.includes(t.stem)) covered.add(t.stem);
    }
    perDoc.set(hit.doc.id, (perDoc.get(hit.doc.id) ?? 0) + 1);
  }

  const coverage = a.stems.length ? covered.size / a.stems.length : 0;
  // Any question term that appears nowhere in the archive means the question cannot be fully verified.
  const hasUnknownTerms = known.length < a.stems.length;
  const status = statements.length === 0 ? 'no_results' : coverage >= 0.6 && !hasUnknownTerms ? 'grounded' : 'partial';

  if (status === 'no_results') {
    return {
      ...base,
      retrievalStatus: 'no_results',
      answer: NOT_VERIFIED,
      paragraphs: [{ segments: [{ text: NOT_VERIFIED, citations: [] }] }],
      citations: [],
      relatedDocuments: hits.slice(0, 4).map((h) => toSummary(h.doc)),
      suggestedFollowUps: [],
      searchResults: fallbackSearch(),
    };
  }

  const citedDocs = [...new Map(statements.map((s) => [s.doc.id, s.doc])).values()];
  const lead =
    status === 'grounded'
      ? `${citedDocs.length} indexed demo record${citedDocs.length === 1 ? '' : 's'} address${citedDocs.length === 1 ? 'es' : ''} this question. Quoted directly:`
      : `${PARTIAL} The closest passages are quoted below.`;
  const unmatched = a.terms.filter((t) => !covered.has(stem(t)));
  const paragraphs: AnswerParagraph[] = [{ segments: [{ text: lead, citations: [] }] }];
  const grouped = new Map<number, { doc: Document; sentences: string[] }>();
  for (const s of statements) {
    const g = grouped.get(s.idx) ?? { doc: s.doc, sentences: [] };
    g.sentences.push(s.sentence);
    grouped.set(s.idx, g);
  }
  for (const [idx, g] of grouped) {
    const cit = citations[idx - 1];
    paragraphs.push({
      segments: [
        {
          text: `${documentTypeLabel(g.doc.documentType)} “${shortTitle(g.doc)}” (${formatDate(g.doc.date)}${cit.page ? `, page ${cit.page}` : ''}): “${g.sentences.join(' ')}”`,
          citations: [idx],
        },
      ],
    });
  }
  if (status === 'partial' && unmatched.length) {
    paragraphs.push({ segments: [{ text: `No indexed record was found that mentions: ${unmatched.map((t) => `“${t}”`).join(', ')}.`, citations: [] }] });
  }

  const citedIds = new Set(citedDocs.map((d) => d.id));
  const related = new Map<string, Document>();
  for (const d of citedDocs) {
    for (const rel of db.relationships.get(d.id) ?? []) {
      const target = rel.toKind === 'document' ? db.documentsById.get(rel.toId) : undefined;
      if (target && !citedIds.has(target.id)) related.set(target.id, target);
    }
  }
  for (const h of hits) if (!citedIds.has(h.doc.id) && related.size < 6) related.set(h.doc.id, h.doc);

  return {
    ...base,
    retrievalStatus: status,
    answer: paragraphs.map((p) => p.segments.map((s) => s.text + s.citations.map((c) => ` [${c}]`).join('')).join('')).join('\n\n'),
    paragraphs,
    citations,
    relatedDocuments: [...related.values()].slice(0, 6).map(toSummary),
    suggestedFollowUps: followUpsFor(citedDocs, db),
    searchResults: status === 'partial' ? fallbackSearch() : undefined,
  };
}
