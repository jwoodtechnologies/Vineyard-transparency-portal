import { describe, expect, it } from 'vitest';
import { pendingRows } from '../src/console/votes';

const meeting = (id: string, date: string, body: string, extra: Record<string, unknown> = {}) =>
  ({ id, title: 'Meeting', date: `${date}T18:00:00Z`, status: 'held', governmentBodyId: body, ...extra }) as never;

describe('meetings whose minutes are not posted yet', () => {
  const held = [
    meeting('rda-jan', '2026-01-14', 'redevelopment-agency'),
    meeting('cc-aug', '2026-08-25', 'city-council'),
    meeting('cc-sep', '2026-09-15', 'city-council'),
    meeting('rda-sep', '2026-09-15', 'redevelopment-agency'),
  ];
  it('lists a recent meeting that has no minutes', () => {
    const rows = pendingRows(held, [{ date: '2026-08-25', bodyId: 'city-council' }], '2026-10-05');
    expect(rows.map((r) => `${r.m.bodyId}|${r.m.date}`)).toEqual(['city-council|2026-09-15', 'redevelopment-agency|2026-09-15']);
  });
  it('does not list a meeting from months ago', () => {
    const rows = pendingRows(held, [], '2026-10-05');
    expect(rows.some((r) => r.m.date === '2026-01-14')).toBe(false);
  });
  it('lists a meeting held six days ago', () => {
    const rows = pendingRows([meeting('cc-jan', '2026-01-14', 'city-council')], [], '2026-01-20');
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Minutes not yet posted');
  });
});
