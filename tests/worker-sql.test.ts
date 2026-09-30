import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { splitSql } from '../worker/lib/sql';

describe('migrations', () => {
  it('split into idempotent statements', () => {
    for (const file of ['migrations/catalog/0001_catalog.sql', 'migrations/search/0001_search.sql']) {
      const stmts = splitSql(readFileSync(file, 'utf8'));
      expect(stmts.length).toBeGreaterThan(3);
      for (const s of stmts) expect(s).toMatch(/^(CREATE (TABLE|INDEX|VIRTUAL TABLE) IF NOT EXISTS|INSERT OR IGNORE)/);
    }
  });

  it('never stores binaries in D1', () => {
    expect(readFileSync('migrations/catalog/0001_catalog.sql', 'utf8')).not.toMatch(/\bBLOB\b/);
  });
});
