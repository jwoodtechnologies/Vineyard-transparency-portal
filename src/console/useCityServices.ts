/**
 * The service links and phone numbers residents see: the built-in lists with what staff changed in the staff portal
 * (served by /api/content, the same request the map's project list makes). Until that answer arrives, and whenever it
 * fails or is not the expected shape, the built-in lists are used, so a page never waits on it to draw.
 */
import { useMemo } from 'react';
import { useJson } from './api';
import { DIRECTORY, contactsFrom, servicesFrom, type ContactsContent, type DirectoryEntry, type Links, type ServicesContent } from '@/lib/cityServices';

const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Staff-saved service links as they arrive, or null when missing or not the expected shape. */
export function asServices(v: unknown): ServicesContent | null {
  if (!isObj(v)) return null;
  const edits: ServicesContent['edits'] = {};
  if (isObj(v.edits)) {
    for (const [id, e] of Object.entries(v.edits)) {
      if (!isObj(e)) continue;
      edits[id] = {
        ...(typeof e.label === 'string' ? { label: e.label } : {}),
        ...(typeof e.hint === 'string' ? { hint: e.hint } : {}),
        ...(typeof e.href === 'string' ? { href: e.href } : {}),
        ...(typeof e.group === 'string' ? { group: e.group as DirectoryEntry['group'] } : {}),
        ...(Array.isArray(e.words) ? { words: strings(e.words) } : {}),
      };
    }
  }
  const added = (Array.isArray(v.added) ? v.added : [])
    .filter(isObj)
    .filter((a) => typeof a.id === 'string' && typeof a.label === 'string' && typeof a.href === 'string')
    .map((a) => ({
      id: String(a.id),
      label: String(a.label),
      hint: typeof a.hint === 'string' ? a.hint : '',
      href: String(a.href),
      group: String(a.group) as DirectoryEntry['group'],
      kind: (['form', 'page', 'map', 'pay'].includes(String(a.kind)) ? a.kind : 'page') as ServicesContent['added'][number]['kind'],
      words: strings(a.words),
    }));
  return { edits, hidden: strings(v.hidden), added };
}

/** Staff-saved phone numbers and quick links as they arrive, or null. */
export function asContacts(v: unknown): ContactsContent | null {
  if (!isObj(v)) return null;
  const edits: ContactsContent['edits'] = {};
  if (isObj(v.edits)) {
    for (const [k, e] of Object.entries(v.edits)) {
      if (!isObj(e)) continue;
      const out: Record<string, string> = {};
      for (const f of ['label', 'hint', 'href', 'phone']) if (typeof e[f] === 'string') out[f] = e[f] as string;
      (edits as Record<string, unknown>)[k] = out;
    }
  }
  return { edits, hidden: strings(v.hidden) as ContactsContent['hidden'] };
}

export interface CityServices {
  services: DirectoryEntry[];
  links: Links;
  /** False until the staff changes have loaded (or failed to): a page that would say "not listed" waits for this. */
  ready: boolean;
}

export function useCityServices(): CityServices {
  const site = useJson<{ content?: { services?: unknown; contacts?: unknown } }>('/api/content');
  return useMemo(() => {
    const content = site.status === 'done' ? site.data.content : undefined;
    const services = asServices(content?.services);
    return { services: services ? servicesFrom(services) : DIRECTORY, links: contactsFrom(asContacts(content?.contacts)), ready: site.status !== 'loading' };
  }, [site]);
}
