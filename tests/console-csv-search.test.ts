import { describe, expect, it } from 'vitest';
import { CSV_BOM, csvField, csvName, toCsv } from '../src/console/csv';
import { isSearchShortcut } from '../src/console/searchShortcut';

describe('CSV', () => {
  it('quotes per RFC 4180', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "yes"')).toBe('"say ""yes"""');
    expect(csvField('two\nlines')).toBe('"two\nlines"');
    expect(csvField(null)).toBe('');
    expect(csvField(1250000)).toBe('1250000');
    expect(toCsv([['Date', 'Title'], ['2026-09-15', 'Resolution 2026-35, schedule']])).toBe('Date,Title\r\n2026-09-15,"Resolution 2026-35, schedule"\r\n');
    expect(CSV_BOM).toBe('﻿');
  });
  it('names files plainly', () => {
    expect(csvName('vineyard', 'votes', 2026)).toBe('vineyard-votes-2026.csv');
    expect(csvName('vineyard', 'budget', 'departments', 'fy2027')).toBe('vineyard-budget-departments-fy2027.csv');
  });
});

describe('header search shortcut', () => {
  const key = (k: string, extra: Partial<{ metaKey: boolean; ctrlKey: boolean }> = {}) => ({ key: k, metaKey: false, ctrlKey: false, altKey: false, defaultPrevented: false, ...extra });
  it('opens on / unless typing or a modifier is held', () => {
    expect(isSearchShortcut(key('/'), null)).toBe(true);
    expect(isSearchShortcut(key('/', { ctrlKey: true }), null)).toBe(false);
    expect(isSearchShortcut(key('a'), null)).toBe(false);
    const field = { closest: (sel: string) => (sel.includes('input') ? {} : null) };
    expect(isSearchShortcut(key('/'), field)).toBe(false);
  });
});
