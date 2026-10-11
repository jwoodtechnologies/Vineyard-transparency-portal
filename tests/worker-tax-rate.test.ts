import { describe, expect, it } from 'vitest';
import { handleAsk } from '../worker/ai/rag';
import type { Env } from '../worker/env';
import { isTaxRateQuestion, isTaxRateRecord, rateInText, taxRateIntent, taxRateSentences } from '../worker/ai/taxRateAnswer';
import { CERTIFIED_TAX_RATES, rateFiscalYear } from '../worker/lib/taxRates';

// Type-checked with the Worker project (tsconfig.worker.json): it runs the real ask handler.

type DocRow = { id: string; title: string; document_date: string; document_type: string; source_id: string; search_shard: number | null };

/** A catalog database holding the given documents; the tax rate lookup reads them. */
function catalog(docs: DocRow[] = []) {
  return {
    prepare(sql: string) {
      let params: unknown[] = [];
      const stmt = {
        bind: (...p: unknown[]) => ((params = p), stmt),
        run: async () => ({}),
        first: async () => null,
        all: async () => {
          if (/document_type = 'tax_rate' OR source_id = \?/.test(sql)) return { results: docs.filter((d) => d.document_date >= String(params[0])) };
          if (/FROM documents WHERE id IN/.test(sql)) {
            const ids = JSON.parse(String(params[0])) as string[];
            return { results: ids.map((id) => ({ id, title: id === 'doc_1ef855677abe2a0b' ? '06/25/2025 CC Meeting Minutes' : (docs.find((d) => d.id === id)?.title ?? id), document_date: id === 'doc_1ef855677abe2a0b' ? '2025-06-25' : (docs.find((d) => d.id === id)?.document_date ?? null), original_url: null, archive_status: 'archived', archive_key: 'k', meeting_id: null })) };
          }
          return { results: [] };
        },
      };
      return stmt;
    },
    batch: async () => [],
    exec: async () => ({}),
  };
}

async function ask(env: Partial<Env>, question: string) {
  const req = new Request('https://example.test/api/ask', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': `t${Math.random()}` }, body: JSON.stringify({ question }) });
  const res = await handleAsk(env as Env, req);
  return res.json() as Promise<{ answer: string; engine: string; citations: Array<{ documentId: string; page: number | null }> }>;
}

describe('property tax rate answers, from the certified rate table', () => {
  it('answers "what is the property tax rate" with the fiscal 2026 rate, its date and page, and says fiscal 2027 is not in the archive', async () => {
    const r = await ask({ CATALOG_DB: catalog() as never }, 'what is the property tax rate');
    expect(r.engine).toBe('tax-rate-data');
    expect(r.answer).toContain('The newest certified tax rate on file for Vineyard is 0.003796 for fiscal 2026 (adopted June 25, 2025; minutes page 9).');
    expect(r.answer).toContain('The fiscal 2027 rate is not in the archive yet.');
    expect(r.answer).not.toMatch(/Momentum|fiscal analysis/i);
    expect(r.answer).not.toMatch(/[–—]/);
    expect(r.citations.map((c) => [c.documentId, c.page])).toEqual([['doc_1ef855677abe2a0b', 9]]);
  });

  it('reads the ways residents ask it', () => {
    for (const q of ["What's Vineyard's certified tax rate?", 'what is the city tax rate', 'tax rate for Vineyard', 'what is the mill levy', 'how much is the property tax rate', 'current property tax rate']) expect(taxRateIntent(q), q).toEqual({ kind: 'current' });
    expect(taxRateIntent('what is the property tax rate for FY26')).toEqual({ kind: 'year', fiscalYear: 2026, calendar: false });
    expect(taxRateIntent('what is the sales tax rate')).toBeNull();
    expect(taxRateIntent('how much does property tax bring in')).toBeNull();
    expect(taxRateIntent('why did the property tax rate go up')).toBeNull();
    expect(isTaxRateQuestion('why did the property tax rate go up')).toBe(true);
    expect(isTaxRateQuestion('what is the transient room tax rate')).toBe(false);
  });

  it('answers a named year from the table, and leaves older years to the records search', () => {
    const fy26 = taxRateSentences({ kind: 'year', fiscalYear: 2026, calendar: false }, '2026-10-11', null).map((s) => s.text);
    expect(fy26).toEqual(["Vineyard's certified tax rate for fiscal 2026 is 0.003796 (adopted June 25, 2025; minutes page 9)."]);
    const fy27 = taxRateSentences({ kind: 'year', fiscalYear: 2027, calendar: false }, '2026-10-11', null).map((s) => s.text);
    expect(fy27[0]).toBe('The fiscal 2027 rate is not in the archive yet.');
    expect(taxRateSentences({ kind: 'year', fiscalYear: 2019, calendar: true }, '2026-10-11', null)).toEqual([]);
  });

  it('passes over a county record whose Vineyard rate cannot be read, and never sends the reader to open it', async () => {
    const county: DocRow = { id: 'doc_county2026', title: 'Utah County 2026 Tax Rates', document_date: '2026-06-15', document_type: 'tax_rate', source_id: 'utah-county-tax-rates', search_shard: null };
    const r = await ask({ CATALOG_DB: catalog([county]) as never }, 'what is the property tax rate');
    expect(r.engine).toBe('tax-rate-data');
    expect(r.answer).not.toContain('Open it for the rate');
    expect(r.answer).toContain('0.003796 for fiscal 2026');
  });

  it('says the county rate for the tax year in one sentence, last year only when asked', () => {
    const text = rateInText([{ pageStart: 3, text: 'ALPINE SCHOOL DISTRICT 0.005123\nVINEYARD RDA 0.000000\nVINEYARD CITY 0.003512\nOREM CITY 0.001900' }], true);
    expect(text).toEqual({ rate: '0.003512', page: 3 });
    expect(rateInText([{ pageStart: null, text: 'Vineyard City rate (tax unit VINE), tax areas 95, 96: 0.003460' }], true)).toEqual({ rate: '0.003460', page: null });
    expect(rateInText([{ pageStart: null, text: 'VINE VINEYARD: 0.0034600' }], true)).toEqual({ rate: '0.003460', page: null });
    expect(rateInText([{ pageStart: 2, text: 'ADOPTING THE CERTIFIED TAX RATE OF .003401 FOR FISCAL YEAR 2026-2027' }], false)).toEqual({ rate: '0.003401', page: 2 });
    const county = taxRateSentences({ kind: 'current' }, '2026-10-11', { id: 'doc_c', title: 'Utah County tax rates 2026, Vineyard tax areas', date: 'tax year 2026', documentType: 'tax_rate', fiscalYear: 2027, rate: '0.003460', page: null, taxYear: 2026, readOn: '2026-10-11' }).map((x) => x.text);
    expect(county).toEqual(["Vineyard City's property tax rate for tax year 2026 is 0.003460, the rate for the city's fiscal 2027 (Utah County Treasurer tax rates, read October 11, 2026)."]);
    const res = taxRateSentences({ kind: 'current' }, '2026-10-11', { id: 'doc_res', title: 'Resolution 2026-30 Certified Tax Rate', date: '2026-06-23', documentType: 'resolution', fiscalYear: 2027, rate: '0.003401', page: 2 }).map((x) => x.text);
    expect(res).toEqual(['The newest certified tax rate on file for Vineyard is 0.003401 for fiscal 2027 (Resolution 2026-30 Certified Tax Rate, June 23, 2026, page 2).']);
  });

  it('reads a rate record dated May or later as the next fiscal year', () => {
    expect(rateFiscalYear('2025-06-25')).toBe(2026);
    expect(rateFiscalYear('2026-06-15')).toBe(2027);
    expect(rateFiscalYear('2026-02-01')).toBe(2026);
    expect(CERTIFIED_TAX_RATES.every((e) => rateFiscalYear(e.adopted) === e.fiscalYear)).toBe(true);
  });

  it('never lets a project fiscal analysis answer a tax rate question', () => {
    expect(isTaxRateRecord({ title: 'Momentum Climbing Gym Fiscal Analysis', documentType: 'study', sourceId: 'x', text: 'assumes the city property tax rate of 0.0021' })).toBe(false);
    expect(isTaxRateRecord({ title: '10/08/2024 City Council Agenda Packet', documentType: 'agenda_packet', sourceId: 'x', text: 'Fiscal analysis: Momentum Climbing Gym. Using a property tax rate of 0.0021 the project yields' })).toBe(false);
    expect(isTaxRateRecord({ title: '06/25/2025 CC Meeting Minutes', documentType: 'minutes', sourceId: 'x', text: 'THE CERTIFIED TAX RATE OF .003796' })).toBe(true);
    expect(isTaxRateRecord({ title: 'Utah County 2026 Tax Rates', documentType: 'other', sourceId: 'utah-county-tax-rates', text: '' })).toBe(true);
  });
});
