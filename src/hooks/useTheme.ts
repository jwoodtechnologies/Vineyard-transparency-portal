import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { readPref, writePref } from '@/lib/storage';

export type ThemePreference = 'light' | 'dark' | 'system';

const listeners = new Set<() => void>();
const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function readPreference(): ThemePreference {
  const v = readPref('theme');
  return v === 'light' || v === 'dark' ? v : 'system';
}

function apply(pref: ThemePreference) {
  const dark = pref === 'dark' || (pref === 'system' && Boolean(media?.matches));
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  const onMedia = () => fn();
  media?.addEventListener('change', onMedia);
  return () => {
    listeners.delete(fn);
    media?.removeEventListener('change', onMedia);
  };
}

export function useTheme() {
  const preference = useSyncExternalStore(subscribe, readPreference, () => 'system' as ThemePreference);
  const systemDark = useSyncExternalStore(subscribe, () => Boolean(media?.matches), () => false);
  const resolved: 'light' | 'dark' = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;

  useEffect(() => {
    apply(preference);
  }, [preference, systemDark]);

  const setPreference = useCallback((p: ThemePreference) => {
    writePref('theme', p === 'system' ? null : p);
    apply(p);
    listeners.forEach((l) => l());
  }, []);

  return { preference, resolved, setPreference };
}
