/**
 * Streams an answer from POST /api/ask so the first words appear while the model is still writing.
 * Events: `status` ({ phase }), `delta` ({ t }: raw model text, display only) and `done` (the final,
 * citation-checked AskResponse). Small talk and fallbacks come back as plain JSON. In mock mode the
 * regular AskService is used.
 */
import type { AskRequest, AskResponse } from '@/types/models';
import { AskService } from '@/services';

export interface StreamHandlers {
  onStatus?: (phase: string) => void;
  onDelta?: (text: string) => void;
}

const useStreaming = import.meta.env.VITE_DATA_MODE === 'api';

export async function askStream(req: AskRequest, signal: AbortSignal, on: StreamHandlers = {}): Promise<AskResponse> {
  if (!useStreaming) return AskService.ask(req, signal);
  const res = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream, application/json' },
    body: JSON.stringify({ ...req, stream: true }),
    signal,
  });
  if (!res.ok) {
    let message = 'The archive could not be reached.';
    try {
      const j = (await res.json()) as { error?: { message?: string } };
      if (j.error?.message) message = j.error.message;
    } catch {
      /* not JSON */
    }
    throw new Error(message);
  }
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('text/event-stream') || !res.body) return (await res.json()) as AskResponse;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut: number;
    while ((cut = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      let event = 'message';
      let data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (!data) continue;
      const payload: unknown = JSON.parse(data);
      if (event === 'delta') on.onDelta?.((payload as { t?: string }).t ?? '');
      else if (event === 'status') on.onStatus?.((payload as { phase?: string }).phase ?? '');
      else if (event === 'done') {
        void reader.cancel().catch(() => undefined);
        return payload as AskResponse;
      }
    }
  }
  throw new Error('The answer was interrupted. Please try again.');
}

/** Display form of streamed text: citation markers are hidden until the checked answer arrives. */
export function draftText(raw: string): string[] {
  return raw
    .replace(/\s*(?:\[\d+(?:\s*,\s*\d+)*\])+/g, '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}
