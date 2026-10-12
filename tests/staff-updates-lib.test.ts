import { describe, expect, it } from 'vitest';
import { TEXT_MAX, checkUpdate, detail, draftOf, emptyUpdate, excerpt, type UpdateItem } from '../src/console/staff/updatesLib';

describe('update form checks match the server', () => {
  const ok = { ...emptyUpdate('2026-10-12'), text: 'The courts are open.' };
  it('accepts words and a date', () => expect(checkUpdate(ok)).toBe(''));
  it('wants the words, and not too many', () => {
    expect(checkUpdate({ ...ok, text: '  ' })).toMatch(/Write the update/);
    expect(checkUpdate({ ...ok, text: 'x'.repeat(TEXT_MAX + 1) })).toMatch(/under 20,000/);
  });
  it('wants a real date when one is given', () => {
    expect(checkUpdate({ ...ok, date: '10/12/2026' })).toMatch(/date/);
    expect(checkUpdate({ ...ok, date: '' })).toBe('');
  });
});

describe('reading an update', () => {
  const item: UpdateItem = {
    id: 'upl_1',
    documentId: 'doc_1',
    title: 'Courts open',
    date: '2026-10-12',
    text: 'Eight courts.',
    topic: 'topic:parks',
    topicLabel: 'Topic: Parks and trails',
    postedBy: null,
    updatedAt: '2026-10-12T12:00:00Z',
  };
  it('turns a stored update into form values', () => expect(draftOf(item)).toEqual({ title: 'Courts open', text: 'Eight courts.', date: '2026-10-12', topic: 'topic:parks' }));
  it('cuts a long update at a word for the list', () => {
    expect(excerpt('Short note.')).toBe('Short note.');
    const long = excerpt(`${'word '.repeat(80)}`, 50);
    expect(long.endsWith('...')).toBe(true);
    expect(long.length).toBeLessThanOrEqual(53);
    expect(long).not.toMatch(/wor\.\.\.$/);
  });
});

describe('what shows under a headline', () => {
  it('leaves out words that are only the headline repeated', () => {
    expect(detail('The courts are open.', 'The courts are open.')).toBe('');
    expect(detail('The courts are open.', 'The courts are open.\nAll eight are lit until 10 pm.')).toBe('All eight are lit until 10 pm.');
  });
  it('shows the text when the headline was written separately', () => {
    expect(detail('Courts open', 'The new courts opened on October 10.')).toBe('The new courts opened on October 10.');
  });
});
