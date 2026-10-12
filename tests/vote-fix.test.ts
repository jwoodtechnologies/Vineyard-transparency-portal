import { describe, expect, it } from 'vitest';
import { motionFingerprint } from '../worker/lib/voteFix';

describe('motion identity across re-reads', () => {
  it('ignores case, punctuation and spacing, and the time of day', () => {
    const a = motionFingerprint('city-council', '2026-08-11', 'Approve Resolution 2026-40, as presented.');
    expect(motionFingerprint('city-council', '2026-08-11T18:00:00', 'approve  resolution 2026 40 as   presented')).toBe(a);
  });
  it('tells meetings, bodies and wording apart', () => {
    const a = motionFingerprint('city-council', '2026-08-11', 'approve the budget');
    expect(motionFingerprint('city-council', '2026-08-12', 'approve the budget')).not.toBe(a);
    expect(motionFingerprint('planning-commission', '2026-08-11', 'approve the budget')).not.toBe(a);
    expect(motionFingerprint('city-council', '2026-08-11', 'deny the budget')).not.toBe(a);
  });
  it('only uses the first words, so a trailing addition does not change it', () => {
    const base = 'approve the engineering services agreement with Hansen for the 400 South design and construction';
    expect(motionFingerprint('city-council', '2026-08-11', `${base} subject to legal review`)).toBe(motionFingerprint('city-council', '2026-08-11', base));
  });
  it('copes with nothing', () => {
    expect(motionFingerprint(null, null, null)).toBe('||');
  });
});
