import { describe, expect, it } from 'vitest';
import { briefAnswer, finishedSentences } from '../worker/ai/answer';
import { readAiStream } from '../worker/ai/sse';

describe('briefAnswer', () => {
  it('keeps the first few distinct sentences as one paragraph', () => {
    const raw = 'The council approved the budget [1].\n\nIt passed 4 to 1 [1]. The council approved the budget [2]. A hearing was held [3]. Parks got more funding [2]. Roads too [4]. And more [5].';
    expect(briefAnswer(raw, 4)).toBe('The council approved the budget [1]. It passed 4 to 1 [1]. A hearing was held [3]. Parks got more funding [2].');
  });

  it('counts finished sentences in streamed text', () => {
    expect(finishedSentences('One [1]. Two [2]. Thr')).toBe(2);
    expect(finishedSentences('One [1].')).toBe(0);
  });
});

describe('readAiStream early stop', () => {
  it('cancels when onDelta returns false', async () => {
    const enc = new TextEncoder();
    let cancelled = false;
    const chunks = ['a', 'b', 'c', 'd'].map((t) => `data: {"response":"${t}"}\n\n`);
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        const next = chunks.shift();
        if (next) c.enqueue(enc.encode(next));
        else c.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    let n = 0;
    const raw = await readAiStream(stream, async () => ++n < 2);
    expect(raw).toBe('ab');
    expect(cancelled).toBe(true);
  });
});
