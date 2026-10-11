import { describe, expect, it } from 'vitest';
import { PLACE_TIME_Q, clockLabel, meetingPlaceText } from '../worker/ai/schedule';

describe('meeting place answer', () => {
  it('names the place and time from the meeting record', () => {
    expect(meetingPlaceText('November 17, 2026 City Council meeting', 'Joint City Council Meeting with Orem City', '18:00:00', ' 56 N State Street,\n Orem ')).toBe(
      'The November 17, 2026 City Council meeting (Joint City Council Meeting with Orem City) is at 56 N State Street, Orem, starting at 6:00 PM.',
    );
    expect(meetingPlaceText('May 5, 2026 City Council meeting', 'City Council', null, '125 S Main St')).toBe('The May 5, 2026 City Council meeting is at 125 S Main St.');
    expect(meetingPlaceText('x', null, null, null)).toBeNull();
  });
  it('reads clock times', () => {
    expect(clockLabel('09:30')).toBe('9:30 AM');
    expect(clockLabel('12:00')).toBe('12:00 PM');
    expect(clockLabel('TBD')).toBeNull();
  });
  it('spots place and time questions only', () => {
    expect(PLACE_TIME_Q.test('Where is the joint City Council meeting with Orem City on November 17, 2026?')).toBe(true);
    expect(PLACE_TIME_Q.test('What time does the September 8 meeting start?')).toBe(true);
    expect(PLACE_TIME_Q.test('Who spoke at the September 8 meeting?')).toBe(false);
  });
});

describe('vote on an item named in words: which item', () => {
  it('picks the item that shares the most words with the question', async () => {
    const { pickItem } = await import('../worker/ai/rag');
    const sep = { item: '7.1 Approve the First Amendment to the Holdaway Fields Development Agreement with Cadence Homes', motion: 'approve the First Amendment to the Holdaway agreement' };
    const jun = { item: '10.2 Approve Holdaway Fields Development Agreement Amendment', motion: 'not to approve the Holdaway Fields Development agreement as amended' };
    const key = (m: { item: string | null; motion: string }) => (m.item ?? m.motion).toLowerCase();
    expect(pickItem([sep, jun], key, 'First Amendment to the Holdaway Fields development agreement')).toEqual([sep]);
    expect(pickItem([sep, jun], key, 'Holdaway Fields agreement')).toEqual([]);
  });
});
