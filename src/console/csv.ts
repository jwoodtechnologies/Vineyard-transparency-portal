/**
 * CSV made in the browser from data a page already has (no extra download from the portal).
 * RFC 4180: fields with a comma, double quote, CR or LF are quoted and inner quotes doubled; rows end
 * in CRLF. A UTF-8 byte order mark goes first so Excel reads accents and symbols correctly.
 */
export type CsvValue = string | number | boolean | null | undefined;

export function csvField(v: CsvValue): string {
  if (v == null) return '';
  const t = typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : String(v);
  return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

export function toCsv(rows: CsvValue[][]): string {
  return rows.map((r) => r.map(csvField).join(',')).join('\r\n') + '\r\n';
}

export const CSV_BOM = '﻿';

/** A safe file name: lower case words joined by hyphens, ending in .csv. */
export function csvName(...parts: Array<string | number | null | undefined>): string {
  const base = parts
    .filter((p) => p != null && p !== '')
    .map((p) =>
      String(p)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, ''),
    )
    .filter(Boolean)
    .join('-');
  return `${base || 'vineyard'}.csv`;
}
