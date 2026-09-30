/** Small typed readers for the portal API used by the console screens. */
import { useEffect, useState } from 'react';

export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return (await res.json()) as T;
}

export type Load<T> = { status: 'loading' } | { status: 'error' } | { status: 'done'; data: T };

/** Loads a URL once per distinct value; null means "not yet". */
export function useJson<T>(url: string | null): Load<T> {
  const [state, setState] = useState<{ url: string | null; value: Load<T> }>({ url: null, value: { status: 'loading' } });
  useEffect(() => {
    if (!url) return;
    const ctl = new AbortController();
    getJson<T>(url, ctl.signal).then(
      (data) => setState({ url, value: { status: 'done', data } }),
      (e: unknown) => {
        if ((e as { name?: string })?.name !== 'AbortError') setState({ url, value: { status: 'error' } });
      },
    );
    return () => ctl.abort();
  }, [url]);
  return state.url === url ? state.value : { status: 'loading' };
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
  group: 'Plans' | 'Land' | 'Streets' | 'Places';
  geometry: 'polygon' | 'line' | 'point';
  pages: number;
  on: boolean;
  minZoom: number | null;
}
