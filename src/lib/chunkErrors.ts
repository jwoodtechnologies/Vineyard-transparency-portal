/** What counts as a failed load of the app's code, and how often to reload for one (lib/chunkReload.ts). Pure. */

/** One reload per this many milliseconds at most. */
export const RELOAD_GAP_MS = 60_000;

/** Whether an error is a failed load of the app's own code (the wording differs by browser). */
export function isChunkError(e: unknown): boolean {
  const m = e instanceof Error ? `${e.name} ${e.message}` : String((e as { message?: unknown })?.message ?? e ?? '');
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|ChunkLoadError|Loading (CSS )?chunk \S+ failed|not a valid JavaScript MIME type/i.test(m);
}

/** Whether to reload now, given when the last such reload was (ms, or null). */
export function shouldReload(now: number, last: number | null): boolean {
  return last == null || !Number.isFinite(last) || now - last > RELOAD_GAP_MS;
}
