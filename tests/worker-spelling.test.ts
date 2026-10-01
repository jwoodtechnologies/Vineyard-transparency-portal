import { describe, expect, it } from 'vitest';
import { fixSpelling } from '../worker/ai/spelling';

describe('fixSpelling', () => {
  it('fixes common slips', () => {
    expect(fixSpelling("I'm looking to do a grammar request")).toBe("I'm looking to do a GRAMA records request");
    expect(fixSpelling('vinyard city councel minuets')).toBe('Vineyard city council minutes');
    expect(fixSpelling('the new ordinace on parking')).toBe('the new ordinance on parking');
    expect(fixSpelling('Is a permit needed?')).toBe('Is a permit needed?');
  });
});
