import { describe, expect, it } from 'vitest';
import { mergeConstruction, rowKey, workRows } from '../src/lib/constructionRows';

const city = {
  heading: 'AT A GLANCE: UPDATED 10/5/2026',
  headers: ['Project', 'Location', 'Status', 'Expected Completion'],
  rows: [
    { Project: 'Center Street Crosswalk', Location: 'Center Street', Status: 'Under construction', 'Expected Completion': 'November 2026' },
    { Project: 'Chip seal', Location: 'Citywide', Status: 'Complete', 'Expected Completion': '' },
  ],
};

describe('Construction now', () => {
  it('is the city table when staff changed nothing', () => {
    expect(mergeConstruction(city, null)).toBe(city);
    expect(mergeConstruction(city, { edits: {}, hidden: [], added: [] })).toBe(city);
  });

  it('corrects, hides and adds, adding a column only when needed', () => {
    const g = mergeConstruction(city, {
      edits: { [rowKey('Center  Street Crosswalk')]: { status: 'Paused for winter' } },
      hidden: ['chip seal'],
      added: [{ id: 'c_0123456789', name: '400 South waterline', where: '400 South', work: 'New waterline', status: 'Starts November 3', expected: 'Spring 2027' }],
    })!;
    expect(g.rows.map((r) => r.Project)).toEqual(['Center Street Crosswalk', '400 South waterline']);
    expect(g.rows[0].Status).toBe('Paused for winter');
    expect(g.headers).toContain('Work');
    expect(g.rows[1]).toMatchObject({ Location: '400 South', Work: 'New waterline', Status: 'Starts November 3', 'Expected Completion': 'Spring 2027' });
    expect(g.rows[0].Work).toBe('');
  });

  it('still shows staff projects when the city table could not be read', () => {
    const g = mergeConstruction(null, { edits: {}, hidden: [], added: [{ id: 'c_0123456789', name: 'Trail repair', where: '', work: '', status: 'Underway', expected: '' }] })!;
    expect(g.rows).toEqual([{ Project: 'Trail repair', Location: '', Work: '', Status: 'Underway', 'Expected Completion': '' }]);
  });

  it('lists rows for the staff screen with what changed', () => {
    const rows = workRows(city, { edits: { 'center street crosswalk': { status: 'Paused' } }, hidden: ['chip seal'], added: [] });
    expect(rows[0]).toMatchObject({ name: 'Center Street Crosswalk', status: 'Paused', edited: true, city: true, original: { status: 'Under construction' } });
    expect(rows[1].hidden).toBe(true);
  });
});
