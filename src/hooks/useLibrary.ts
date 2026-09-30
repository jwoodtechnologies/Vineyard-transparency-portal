import { useCallback, useEffect, useState } from 'react';
import {
  isHistoryEnabled,
  listHistory,
  listSaved,
  removeSaved,
  saveItem,
  savedKey,
  subscribeLibrary,
  type HistoryItem,
  type SavedItem,
  type SavedKind,
} from '@/lib/library';

export function useLibrary() {
  const [saved, setSaved] = useState<SavedItem[] | null>(null);
  const [history, setHistory] = useState<HistoryItem[] | null>(null);
  const [historyEnabled, setHistoryEnabledState] = useState(isHistoryEnabled);

  useEffect(() => {
    let alive = true;
    const refresh = () => {
      Promise.all([listSaved(), listHistory()]).then(([s, h]) => {
        if (!alive) return;
        setSaved(s);
        setHistory(h);
        setHistoryEnabledState(isHistoryEnabled());
      });
    };
    refresh();
    const unsub = subscribeLibrary(refresh);
    return () => {
      alive = false;
      unsub();
    };
  }, []);

  return { saved, history, historyEnabled, loading: saved === null };
}

/** Toggle state for one saveable item. */
export function useSavedToggle(kind: SavedKind, id: string, item: () => Omit<SavedItem, 'savedAt' | 'key' | 'kind'>) {
  const { saved } = useLibrary();
  const key = savedKey(kind, id);
  const isSaved = Boolean(saved?.some((s) => s.key === key));
  const toggle = useCallback(async () => {
    if (isSaved) await removeSaved(key);
    else await saveItem({ key, kind, ...item() });
    return !isSaved;
  }, [isSaved, key, kind, item]);
  return { isSaved, toggle };
}
