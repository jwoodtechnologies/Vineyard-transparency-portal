import { describe, expect, it } from 'vitest';
import { readAiStream } from '../worker/ai/sse';

function sse(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const x of chunks) c.enqueue(enc.encode(x));
      c.close();
    },
  });
}

describe('readAiStream', () => {
  it('reassembles Workers AI server-sent events split at arbitrary byte boundaries', async () => {
    const body = ['data: {"response":"The coun', 'cil approved"}\n\nda', 'ta: {"response":" it [1]."}\n\n', 'data: [DONE]\n\n'];
    const seen: string[] = [];
    const raw = await readAiStream(sse(body), async (t) => void seen.push(t));
    expect(raw).toBe('The council approved it [1].');
    expect(seen).toEqual(['The council approved', ' it [1].']);
  });

  it('stops at [DONE] and ignores junk lines', async () => {
    const seen: string[] = [];
    const raw = await readAiStream(sse([': keep-alive\n\n', 'data: {"response":"Done [1]."}\n\n', 'data: [DONE]\n\n', 'data: {"response":"late"}\n\n']), async (t) => void seen.push(t));
    expect(raw).toBe('Done [1].');
    expect(seen).toEqual(['Done [1].']);
  });
});
