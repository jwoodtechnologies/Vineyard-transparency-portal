import { useCallback, useEffect, useEffectEvent, useState } from 'react';

export interface Resource<T> {
  data: T | undefined;
  /** Last successful data, kept while a new key loads (for calm pagination/refinement). */
  previous: T | undefined;
  error: unknown;
  loading: boolean;
  reload: () => void;
}

/**
 * Loads async data for a key. Pass `null` as the key to skip loading.
 * Results from stale keys are ignored, so fast typing/paging never shows out-of-order data.
 */
export function useResource<T>(key: string | null, load: () => Promise<T>): Resource<T> {
  const [nonce, setNonce] = useState(0);
  const fullKey = key == null ? null : `${key}#${nonce}`;
  const [state, setState] = useState<{ key: string | null; data?: T; error?: unknown; last?: T }>({ key: null });
  const run = useEffectEvent(() => load());

  useEffect(() => {
    if (fullKey == null) return;
    let cancelled = false;
    run().then(
      (data) => {
        if (!cancelled) setState({ key: fullKey, data, last: data });
      },
      (error: unknown) => {
        if (!cancelled) setState((s) => ({ key: fullKey, error, last: s.last }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [fullKey]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const current = state.key === fullKey;
  return {
    data: current ? state.data : undefined,
    previous: state.last,
    error: current ? state.error : undefined,
    loading: fullKey != null && !current,
    reload,
  };
}
