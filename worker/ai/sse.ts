/**
 * Reads a Workers AI token stream (server-sent events: `data: {"response":"..."}` ... `data: [DONE]`),
 * calling onDelta for each piece and returning the full text. Pure: no Cloudflare types, so it can
 * be unit-tested anywhere.
 */
export async function readAiStream(stream: ReadableStream<Uint8Array>, onDelta: (text: string) => Promise<void>, deadline = Infinity): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let raw = '';
  try {
    for (;;) {
      if (Date.now() > deadline) throw new Error('AI timeout');
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') return raw;
        try {
          const piece = (JSON.parse(payload) as { response?: unknown }).response;
          if (typeof piece === 'string' && piece) {
            raw += piece;
            await onDelta(piece);
          }
        } catch {
          /* partial or non-JSON line; ignore */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return raw;
}
