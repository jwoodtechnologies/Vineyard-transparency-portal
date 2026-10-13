import { describe, expect, it } from 'vitest';
import { AREAS } from '../worker/staff/core';
import { PRESETS } from '../src/console/staff/presets';

describe('account presets', () => {
  it('only grant areas the server knows', () => {
    for (const p of PRESETS) {
      expect(p.areas.length).toBeGreaterThan(0);
      for (const a of p.areas) expect(AREAS as readonly string[]).toContain(a);
    }
  });

  it('are unique and fully described', () => {
    expect(new Set(PRESETS.map((p) => p.key)).size).toBe(PRESETS.length);
    for (const p of PRESETS) {
      expect(p.label).toBeTruthy();
      expect(p.blurb).toBeTruthy();
      expect(p.department).toBeTruthy();
      expect(`${p.label}${p.blurb}`).not.toMatch(/[\u2013\u2014]/);
    }
  });

  it('keeps the social media specialist to notices only', () => {
    expect(PRESETS.find((p) => p.key === 'social')?.areas).toEqual(['notices']);
  });
});
