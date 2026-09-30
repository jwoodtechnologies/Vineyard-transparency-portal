import type { AskRequest, AskResponse } from '@/types/models';
import { getAdapter } from '@/data/adapters';
import { DataError, isDataError } from '@/data/adapters/errors';

const BREAKER_KEY = 'vtp:ai-breaker-until';
const DEFAULT_BACKOFF_S = 300;

export const AI_UNAVAILABLE_MESSAGE =
  'AI answers are temporarily unavailable. Search results from the public-record archive are shown below.';

function breakerUntil(): number {
  try {
    return Number(sessionStorage.getItem(BREAKER_KEY) ?? 0);
  } catch {
    return 0;
  }
}

function openBreaker(seconds: number): void {
  try {
    sessionStorage.setItem(BREAKER_KEY, String(Date.now() + seconds * 1000));
  } catch {
    /* ignore */
  }
}

export function resetAiBreaker(): void {
  try {
    sessionStorage.removeItem(BREAKER_KEY);
  } catch {
    /* ignore */
  }
}

export function isAiBreakerOpen(): boolean {
  return breakerUntil() > Date.now();
}

/**
 * AskService — natural-language research over the archive.
 *
 * AI is optional. If the AI backend reports exhausted quota / rate limiting, a circuit breaker
 * stops calling it for a backoff period (so an exhausted API is not hammered) and the question is
 * answered with plain archive search instead.
 */
export const AskService = {
  async ask(request: AskRequest, signal?: AbortSignal): Promise<AskResponse> {
    const adapter = await getAdapter();
    if (!isAiBreakerOpen()) {
      try {
        return await adapter.ask(request, { signal });
      } catch (e) {
        if (!isDataError(e) || !['ai_unavailable', 'rate_limited'].includes(e.kind)) throw e;
        openBreaker(e.retryAfterSeconds ?? DEFAULT_BACKOFF_S);
      }
    }
    return this.searchFallback(request, signal);
  },

  async searchFallback(request: AskRequest, signal?: AbortSignal): Promise<AskResponse> {
    const adapter = await getAdapter();
    let results;
    try {
      results = await adapter.search({ query: request.question, match: 'any', pageSize: 8, filters: request.filters }, { signal });
    } catch (e) {
      if (isDataError(e)) throw e;
      throw new DataError('search_unavailable', 'Search is unavailable.', { cause: e });
    }
    return {
      id: `fallback-${Date.now().toString(36)}`,
      question: request.question,
      retrievalStatus: 'ai_unavailable',
      answer: AI_UNAVAILABLE_MESSAGE,
      paragraphs: [],
      citations: [],
      relatedDocuments: [],
      suggestedFollowUps: [],
      searchResults: results.items,
      notice: AI_UNAVAILABLE_MESSAGE,
      generatedAt: new Date().toISOString(),
      engine: 'search-fallback',
      isDemo: adapter.mode === 'mock',
    };
  },
};
