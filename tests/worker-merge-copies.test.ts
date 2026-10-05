import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { MEETING_COPY_GROUPS_SQL } from '../worker/lib/meetingCopies';

function db() {
  const d = new DatabaseSync(':memory:');
  d.exec('CREATE TABLE documents (id TEXT PRIMARY KEY, title TEXT, document_type TEXT, document_date TEXT, government_body_id TEXT, source_id TEXT, first_seen_at TEXT, search_shard INTEGER)');
  return d;
}
const add = (d: DatabaseSync, id: string, title: string, type: string, date: string, body: string, src = 'vineyard-civicclerk-meetings') =>
  d.prepare('INSERT INTO documents VALUES (?, ?, ?, ?, ?, ?, ?, 0)').run(id, title, type, date, body, src, '2026-09-30');
const groups = (d: DatabaseSync) => d.prepare(MEETING_COPY_GROUPS_SQL).all() as Array<{ docs: string }>;

describe('merging copies of one meeting record', () => {
  it('leaves draft minutes attached to the next meeting alone', () => {
    const d = db();
    add(d, 'own', '9.8.26 APPROVED CC Minutes', 'minutes', '2026-09-08', 'city-council');
    add(d, 'att', '8.25.26 CC Minutes - Draft (City Council Meeting, 2026-09-08, item 1)', 'minutes', '2026-09-08', 'city-council');
    add(d, 'att2', '7.14.26 CC Minutes - Draft (City Council Meeting, 2026-09-08, item 2)', 'minutes', '2026-09-08', 'city-council');
    expect(groups(d)).toHaveLength(0);
  });

  it('still folds the same meeting filed by two sources', () => {
    const d = db();
    add(d, 'cc', '9.8.26 APPROVED CC Minutes', 'minutes', '2026-09-08', 'city-council');
    add(d, 'code', 'City Council minutes 09/08/2026', 'minutes', '2026-09-08', 'city-council', 'vineyard-municipal-code');
    const g = groups(d);
    expect(g).toHaveLength(1);
    expect(JSON.parse(g[0].docs)).toHaveLength(2);
  });

  it('keeps a special meeting apart from the regular one the same day', () => {
    const d = db();
    add(d, 'reg', '8.25.26 CC Minutes', 'minutes', '2026-08-25', 'city-council');
    add(d, 'sp', '8.25.26 Special Session Minutes', 'minutes', '2026-08-25', 'city-council');
    expect(groups(d)).toHaveLength(0);
  });
});
