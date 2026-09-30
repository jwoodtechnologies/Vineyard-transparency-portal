/** Tiny in-memory response cache for idempotent reads (per tab, never persisted). */
interface Entry {
  at: number;
  value: Promise<unknown>;
}

const store = new Map<string, Entry>();
const MAX = 150;

export function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as Promise<T>;
  const value = load();
  store.set(key, { at: Date.now(), value });
  // Never cache failures.
  value.catch(() => {
    if (store.get(key)?.value === value) store.delete(key);
  });
  if (store.size > MAX) store.delete(store.keys().next().value as string);
  return value;
}

export function clearServiceCache(): void {
  store.clear();
}
