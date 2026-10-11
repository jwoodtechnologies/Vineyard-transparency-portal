/** Small typed readers for the portal API used by the console screens. */
import { useEffect, useState } from 'react';

/**
 * Adds a marker that changes every five minutes, so no browser or network cache can hand back a
 * list older than that, whatever cache time it was stored with.
 */
export function fresh(url: string): string {
  if (!url.startsWith('/api/')) return url;
  return `${url}${url.includes('?') ? '&' : '?'}_=${Math.floor(Date.now() / 300_000)}`;
}

/** The request public/theme-init.js started for the page being opened, used once. */
function early(url: string): Promise<Response> | null {
  const w = globalThis as { __vtpEarly?: { url: string; res: Promise<Response> } | null };
  const e = w.__vtpEarly;
  if (!e || e.url !== url) return null;
  w.__vtpEarly = null;
  return e.res;
}

export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = (await early(url)?.catch(() => null)) ?? (await fetch(fresh(url), { signal, headers: { accept: 'application/json' } }));
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  const text = await res.text();
  const data = JSON.parse(text) as T;
  remember(url, data, text);
  return data;
}

export type Load<T> = { status: 'loading' } | { status: 'error' } | { status: 'done'; data: T; stale?: boolean };

/*
 * Responses the reader has already seen are kept on this device (memory, then localStorage), so a repeat
 * visit draws the page at once from the last copy while a fresh copy loads in the background. Per viewer
 * only; never personal data (the API has none); storage failures are ignored.
 */
const KEEP_MS = 7 * 86_400_000;
const MAX_ENTRY = 350_000;
const MAX_ENTRIES = 40;
const PREFIX = 'vtp:api:';
const memory = new Map<string, { at: number; data: unknown; text: string | null }>();

function storageIndex(): string[] {
  try {
    return JSON.parse(localStorage.getItem(`${PREFIX}index`) ?? '[]') as string[];
  } catch {
    return [];
  }
}

function remember(url: string, data: unknown, text: string | null): void {
  memory.set(url, { at: Date.now(), data, text });
  if (!text || text.length > MAX_ENTRY) return;
  try {
    const index = storageIndex().filter((u) => u !== url);
    index.push(url);
    while (index.length > MAX_ENTRIES) localStorage.removeItem(PREFIX + index.shift());
    localStorage.setItem(PREFIX + url, `${Date.now()}\n${text}`);
    localStorage.setItem(`${PREFIX}index`, JSON.stringify(index));
  } catch {
    // Full or unavailable: the oldest half goes, and this copy is simply not kept.
    try {
      const index = storageIndex();
      for (const u of index.splice(0, Math.ceil(index.length / 2))) localStorage.removeItem(PREFIX + u);
      localStorage.setItem(`${PREFIX}index`, JSON.stringify(index));
    } catch {
      /* storage unavailable */
    }
  }
}

/** The last copy of a response on this device, or null. */
export function recall<T>(url: string): T | null {
  const hit = memory.get(url);
  if (hit) return hit.data as T;
  try {
    const raw = localStorage.getItem(PREFIX + url);
    if (!raw) return null;
    const cut = raw.indexOf('\n');
    const at = Number(raw.slice(0, cut));
    if (!(Date.now() - at < KEEP_MS)) return null;
    const text = raw.slice(cut + 1);
    const data = JSON.parse(text) as T;
    memory.set(url, { at, data, text });
    return data;
  } catch {
    return null;
  }
}

const recalled = <T,>(url: string | null): Load<T> | null => {
  if (!url) return null;
  const data = recall<T>(url);
  return data == null ? null : { status: 'done', data, stale: true };
};

/**
 * Loads a URL once per distinct value; null means "not yet". A copy kept from an earlier visit is shown
 * at once (stale) and replaced when the fresh copy arrives, if it differs.
 */
export function useJson<T>(url: string | null): Load<T> {
  const [state, setState] = useState<{ url: string | null; value: Load<T> }>(() => ({ url, value: recalled<T>(url) ?? { status: 'loading' } }));
  useEffect(() => {
    if (!url) return;
    const ctl = new AbortController();
    const before = memory.get(url)?.text ?? null;
    getJson<T>(url, ctl.signal).then(
      (data) => {
        const now = memory.get(url);
        // Same bytes as the copy already on screen: keep the object, no re-render.
        if (before !== null && now?.text === before) {
          setState((s) => (s.url === url && s.value.status === 'done' ? { url, value: { status: 'done', data: s.value.data } } : { url, value: { status: 'done', data } }));
          return;
        }
        setState({ url, value: { status: 'done', data } });
      },
      (e: unknown) => {
        if ((e as { name?: string })?.name === 'AbortError') return;
        // Offline or failing: a kept copy stays on screen.
        setState((s) => (s.url === url && s.value.status === 'done' ? s : { url, value: { status: 'error' } }));
      },
    );
    return () => ctl.abort();
  }, [url]);
  if (state.url === url) return state.value;
  return recalled<T>(url) ?? { status: 'loading' };
}

export interface DocLite {
  id: string;
  title: string;
  documentType: string;
  date: string | null;
  pageCount: number | null;
  mimeType: string;
  meetingId: string | null;
}

export interface Latest {
  today: string;
  upcoming: Array<{ id: string; slug: string | null; title: string; body: string | null; date: string | null; time: string | null; location: string | null; agendaPosted: boolean }>;
  posted: Array<{ id: string; title: string; type: string; date: string | null; pages: number | null; body: string | null; meetingId: string | null; meetingTitle: string | null; source: string }>;
  sheriff: Array<{ id: string; title: string; url: string; date: string | null; summary: string | null }>;
  follow: Array<{ name: string; handle: string; url: string }>;
  updatedAt: string | null;
}

export interface MapLayerInfo {
  key: string;
  label: string;
  group: 'Plans' | 'Land' | 'Streets' | 'Places' | 'Safety';
  geometry: 'polygon' | 'line' | 'point';
  pages: number;
  on: boolean;
  minZoom: number | null;
  /** Tiled layers only (parcels): zoom 16 GeoJSON tile URL template on the portal's origin, and map credit. */
  tiles?: string;
  attribution?: string | null;
}
