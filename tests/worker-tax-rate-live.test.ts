/**
 * "What is the property tax rate?" against the live county record: doc_de0686a2ff89b87b "Utah County tax
 * rates 2026, Vineyard tax areas" (GET /api/search?q=Utah+County+tax+rates+2026 and GET /api/documents/<id>/text,
 * read October 11, 2026, saved in tests/fixtures/utah-county-tax-rates-2026.json).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Env } from '../worker/env';
import { newerRateRecord, rateInText, taxRateIntent, taxRateSentences } from '../worker/ai/taxRateAnswer';

const PAGES: Array<{ page: number; text: string }> = JSON.parse(readFileSync(new URL('./fixtures/utah-county-tax-rates-2026.json', import.meta.url), 'utf8'));
const TEXT = PAGES.map((p) => p.text).join('\n');

/** The record's text cut into search chunks the way the archive holds them (no page numbers). */
const chunks = (size: number) => Array.from({ length: Math.ceil(TEXT.length / size) }, (_, i) => ({ pageStart: null, text: TEXT.slice(i * size, (i + 1) * size) }));

const ROW = {
  id: 'doc_de0686a2ff89b87b',
  title: 'Utah County tax rates 2026, Vineyard tax areas',
  document_date: null,
  document_type: 'tax_rate',
  source_id: 'utah-county-tax-rates',
  search_shard: 0,
  year: 2026,
  last_seen_at: '2026-10-11T09:40:00.000Z',
};

const db = (results: unknown[]) => ({ prepare: () => ({ bind: () => ({ all: async () => ({ results }) }) }) });
const env = (size: number) =>
  ({
    CATALOG_DB: db([ROW]),
    SEARCH_DB_0: db(chunks(size).map((c, i) => ({ id: `${ROW.id}:c${i}`, page_start: null, page_end: null, section_title: ROW.title, text: c.text, ocr: 0 }))),
  }) as unknown as Env;

describe('the property tax rate from the Utah County record', () => {
  it('the record states 0.003460 for Vineyard City, tax year 2026', () => {
    expect(TEXT).toMatch(/Vineyard City rate \(tax unit VINE\), tax areas [\d, ]+: 0\.003460/);
    expect(TEXT).toMatch(/read 2026-10-11/);
  });

  it('reads 0.003460 from the summary line, whole or in chunks', () => {
    expect(rateInText([{ pageStart: 1, text: TEXT }], true)).toEqual({ rate: '0.003460', page: 1 });
    for (const size of [400, 1000, 2000]) expect(rateInText(chunks(size), true)?.rate).toBe('0.003460');
  });

  it.each([400, 1000, 5000])('"what is the property tax rate" states 0.003460 for tax year 2026 (fiscal 2027), read October 11, 2026 (chunks of %i)', async (size) => {
    const intent = taxRateIntent('what is the property tax rate');
    expect(intent).toEqual({ kind: 'current' });
    const newer = await newerRateRecord(env(size));
    expect(newer).toMatchObject({ id: ROW.id, rate: '0.003460', taxYear: 2026, fiscalYear: 2027, readOn: '2026-10-11' });
    const text = taxRateSentences(intent!, '2026-10-11', newer).map((s) => s.text);
    expect(text).toEqual(["Vineyard City's property tax rate for tax year 2026 is 0.003460, the rate for the city's fiscal 2027 (Utah County Treasurer tax rates, read October 11, 2026)."]);
    expect(text.join(' ')).not.toMatch(/[\u2012-\u2015]/);
  });
});
