import { describe, expect, it } from 'vitest';
import { chooseTitle, detectDocumentType, extractDates, extractDocumentNumbers, identityDocumentNumber } from '../scripts/lib/metadata';

describe('extractDocumentNumbers', () => {
  it('normalizes common ordinance/resolution formats', () => {
    const text = 'ORDINANCE 2026-07 amends Ord. No. 2025-3; see Resolution No. 2026-14, RESOLUTION #26-02 and Res. 2024–110A.';
    expect(extractDocumentNumbers(text).map((m) => m.label)).toEqual([
      'Ordinance 2026-07',
      'Ordinance 2025-3',
      'Resolution 2026-14',
      'Resolution 26-02',
      'Resolution 2024-110A',
    ]);
  });

  it('keeps leading zeros exactly as printed and de-duplicates', () => {
    const m = extractDocumentNumbers('Ordinance 2026-07 ... Ordinance 2026-07 ... Ordinance 2026-7');
    expect(m.map((x) => x.number)).toEqual(['2026-07', '2026-7']);
  });

  it('does not match unrelated numbers', () => {
    expect(extractDocumentNumbers('Phone 801-555-0100, zoning code 15.04.010, page 2026-07-01')).toEqual([]);
  });
});

describe('extractDates', () => {
  it('reads month-name, ISO and U.S. numeric dates in document order', () => {
    const dates = extractDates('Meeting of January 5, 2026 (posted 12/30/2025); effective 2026-02-01; Sept. 9th, 2025; 3/4/26');
    expect(dates.map((d) => d.iso)).toEqual(['2026-01-05', '2025-12-30', '2026-02-01', '2025-09-09', '2026-03-04']);
  });

  it('rejects impossible dates', () => {
    expect(extractDates('February 30, 2026 and 13/45/2026')).toEqual([]);
  });
});

describe('identity metadata', () => {
  it('assigns a document number only when printed and matching the type', () => {
    expect(identityDocumentNumber('ordinance', 'An Ordinance', 'ORDINANCE NO. 2026-07\nAN ORDINANCE AMENDING...')).toBe('Ordinance 2026-07');
    expect(identityDocumentNumber('resolution', 'Resolution No. 2026-14', '')).toBe('Resolution 2026-14');
    expect(identityDocumentNumber('agenda', 'Agenda', 'Item 4: Ordinance 2026-07')).toBeNull();
    expect(identityDocumentNumber('ordinance', 'Draft', 'no number printed')).toBeNull();
  });

  it('chooses titles by precedence and ignores generic link text', () => {
    expect(chooseTitle({ explicit: 'FY2026 Budget', pdfTitle: 'x', fileName: 'a.pdf' })).toBe('FY2026 Budget');
    expect(chooseTitle({ explicit: 'Download', pdfTitle: 'Untitled', firstPageText: '\n  \nCITY COUNCIL AGENDA\nMore', fileName: 'a.pdf' })).toBe('CITY COUNCIL AGENDA');
    expect(chooseTitle({ explicit: null, fileName: 'staff_report-item-4.pdf' })).toBe('staff report item 4');
  });

  it('detects document type from hint, title, then first page', () => {
    expect(detectDocumentType({ hint: 'minutes', title: 'Agenda' })).toBe('minutes');
    expect(detectDocumentType({ title: 'Regular Meeting Agenda' })).toBe('agenda');
    expect(detectDocumentType({ title: 'Scan 001', firstPageText: 'MINUTES OF THE REGULAR MEETING' })).toBe('minutes');
    expect(detectDocumentType({ title: 'Scan 001', firstPageText: 'lorem ipsum' })).toBe('other');
  });
});
