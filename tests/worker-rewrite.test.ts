import { describe, expect, it } from 'vitest';
import { factsLine, parseRewrite } from '../worker/ai/rewrite';

describe('conversation rewrite', () => {
  it('uses the standalone question for a follow-up', () => {
    const r = parseRewrite('{"followUp": true, "standalone": "Is 575 South under construction right now?", "facts": []}', "Isn't it under construction right now?");
    expect(r).toEqual({ followUp: true, standalone: 'Is 575 South under construction right now?', facts: [] });
  });
  it('keeps the resident words for a new question', () => {
    const r = parseRewrite('<think></think>{"followUp": false, "standalone": "How do I pay my water bill", "facts": []}', 'How do I pay my utility bill?');
    expect(r?.standalone).toBe('How do I pay my utility bill?');
    expect(r?.followUp).toBe(false);
  });
  it('keeps only stated facts, marked as the resident\'s', () => {
    const r = parseRewrite('{"followUp": true, "standalone": "When will 575 South reopen?", "facts": ["You said David Lauret posted that 575 South should reopen October 15.", "The road is closed"]}', 'David said it reopens Oct 15, when?');
    expect(r?.facts).toEqual(['You said David Lauret posted that 575 South should reopen October 15.']);
    expect(factsLine(r!.facts)).toMatch(/^You said David Lauret posted that 575 South should reopen October 15\. That comes from you, not from a city record/);
  });
  it('rejects unusable output', () => {
    expect(parseRewrite('no json here', 'x')).toBeNull();
    expect(parseRewrite('{"followUp": true, "standalone": ""}', '?')).toBeNull();
  });
});
