import { describe, expect, it } from 'vitest';
import { getMockDatabase } from '@/data/mock/db';
import { runSearch } from '@/data/mock/searchEngine';
import { answerQuestion, NOT_VERIFIED } from '@/data/mock/askEngine';

const db = getMockDatabase();

describe('demo database', () => {
  it('labels every record as demo', () => {
    for (const d of db.documents) {
      expect(d.isDemo).toBe(true);
      expect(d.title).toMatch(/DEMO|SAMPLE|EXAMPLE/);
      if (d.documentNumber) expect(d.documentNumber).toMatch(/^DEMO-/);
    }
  });

  it('never points original URLs at government domains', () => {
    for (const d of db.documents) expect(d.originalUrl ?? '').not.toMatch(/vineyardutah\.gov|utah\.gov|suiteonemedia/);
  });

  it('links every chunk to an existing document', () => {
    for (const c of db.chunks) expect(db.documentsById.has(c.documentId)).toBe(true);
  });

  it('builds agenda packets with item page ranges', () => {
    const m = db.meetingsById.get('demo-cc-2026-03-10')!;
    const item = m.agendaItems.find((i) => i.id === 'demo-cc-2026-03-10-5a')!;
    expect(item.packetPageStart).toBeGreaterThan(1);
    expect(item.packetPageEnd).toBeGreaterThanOrEqual(item.packetPageStart!);
  });
});

describe('demo search', () => {
  it('finds exact document numbers first', () => {
    const r = runSearch(db, { query: 'DEMO-RES-2026-04' });
    expect(r.items[0].document.id).toBe('demo-res-2026-04-parking-permits');
    expect(r.items[0].matches.some((m) => m.field === 'document_number')).toBe(true);
  });

  it('requires quoted phrases', () => {
    const r = runSearch(db, { query: '"parking enforcement"' });
    expect(r.total).toBeGreaterThan(0);
    for (const item of r.items) {
      const text = db.pages.get(item.document.id)!.map((p) => p.text).join(' ') + item.document.title;
      expect(text.toLowerCase()).toContain('parking enforcement');
    }
  });

  it('applies filters and disjunctive facets', () => {
    const r = runSearch(db, { query: 'parking', filters: { documentTypes: ['ordinance'] } });
    expect(r.items.every((i) => i.document.documentType === 'ordinance')).toBe(true);
    expect(r.facets.documentTypes.length).toBeGreaterThan(1);
  });

  it('returns nothing for topics not in the demo archive', () => {
    expect(runSearch(db, { query: '300 West' }).total).toBe(0);
    expect(runSearch(db, { query: 'Holdaway' }).total).toBe(0);
  });

  it('explains matches with a page number', () => {
    const r = runSearch(db, { query: 'towing' });
    const ft = r.items[0].matches.find((m) => m.field === 'full_text');
    expect(ft?.page).toBeGreaterThan(0);
    expect(r.items[0].excerpts[0].highlights.length).toBeGreaterThan(0);
  });
});

describe('demo ask engine', () => {
  it('grounds answers with citations that point at real demo chunks', () => {
    const r = answerQuestion(db, { question: 'What contracts mention towing?' });
    expect(r.retrievalStatus).toBe('grounded');
    expect(r.citations.length).toBeGreaterThan(0);
    for (const c of r.citations) {
      expect(db.documentsById.has(c.documentId)).toBe(true);
      const page = db.pages.get(c.documentId)!.find((p) => p.page === c.page)!;
      // The excerpt text (minus ellipses) must literally occur on the cited page.
      const core = c.excerpt.text.replace(/^… |…$| …$/g, '');
      expect(page.text).toContain(core.slice(0, 40));
    }
    for (const p of r.paragraphs) for (const s of p.segments) for (const n of s.citations) expect(n).toBeLessThanOrEqual(r.citations.length);
  });

  it('refuses to invent answers', () => {
    for (const q of ['Find records about 300 West.', 'What agreements mention Holdaway?', 'Find every public record mentioning Flock cameras.']) {
      const r = answerQuestion(db, { question: q });
      expect(r.retrievalStatus).toBe('no_results');
      expect(r.answer).toContain(NOT_VERIFIED);
      expect(r.citations).toHaveLength(0);
    }
  });

  it('handles meeting-date questions honestly', () => {
    expect(answerQuestion(db, { question: 'What was approved at the September 8 council meeting?' }).retrievalStatus).toBe('no_results');
    const r = answerQuestion(db, { question: 'What happened at the March 10 council meeting?' });
    expect(r.retrievalStatus).toBe('grounded');
    expect(r.citations[0].documentId).toBe('demo-cc-2026-03-10-minutes');
  });

  it('lists records by type and year', () => {
    const r = answerQuestion(db, { question: 'Show me ordinances adopted in 2026.' });
    expect(r.retrievalStatus).toBe('grounded');
    expect(r.citations.map((c) => c.documentId)).toEqual(['demo-ord-2026-01-parking']);
  });

  it('marks weakly supported answers as partial', () => {
    const r = answerQuestion(db, { question: 'What did the council say about parking and Holdaway?' });
    expect(r.retrievalStatus).toBe('partial');
  });
});
