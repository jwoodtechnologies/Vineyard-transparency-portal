/**
 * Helpers for the staff screen that edits the service links and the phone numbers and quick links. Each change is a small
 * pure step on a working copy, and what is stored only holds what differs from the lists the portal ships with.
 */
import {
  DIRECTORY,
  LINKS,
  SERVICE_HINT_MAX,
  SERVICE_LABEL_MAX,
  SERVICE_WORDS_MAX,
  SERVICE_WORD_MAX,
  cleanPhone,
  isPhoneLink,
  safeHref,
  type AddedKind,
  type AddedService,
  type ContactEdit,
  type ContactsContent,
  type LinkKey,
  type ServiceEdit,
  type ServiceGroup,
  type ServiceLink,
  type ServicesContent,
} from '@/lib/cityServices';

export interface ServiceDraft {
  label: string;
  hint: string;
  href: string;
  group: ServiceGroup;
  kind: AddedKind;
  words: string;
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

export const parseWords = (s: string): string[] => [
  ...new Set(
    s
      .split(',')
      .map((w) => squash(w).toLowerCase())
      .filter(Boolean),
  ),
];

/** A sentence to show before saving, or '' when the draft is fine. */
export function checkService(d: ServiceDraft): string {
  if (!squash(d.label)) return 'Give the service a name.';
  if (squash(d.label).length > SERVICE_LABEL_MAX) return `Keep the name under ${SERVICE_LABEL_MAX} characters.`;
  if (squash(d.hint).length > SERVICE_HINT_MAX) return `Keep the short note under ${SERVICE_HINT_MAX} characters.`;
  if (!d.href.trim()) return 'Add the web address it should open.';
  if (!safeHref(d.href)) return 'That web address will not work. Paste the full address, starting with https://, or a page of the portal starting with /.';
  const w = parseWords(d.words);
  if (w.length > SERVICE_WORDS_MAX) return `Use at most ${SERVICE_WORDS_MAX} words or phrases.`;
  if (w.some((x) => x.length > SERVICE_WORD_MAX)) return `Keep each word or phrase under ${SERVICE_WORD_MAX} characters.`;
  return '';
}

const empty = (c: ServicesContent) => !Object.keys(c.edits).length && !c.hidden.length && !c.added.length;
const copy = (c: ServicesContent | null): ServicesContent => ({ edits: { ...(c?.edits ?? {}) }, hidden: [...(c?.hidden ?? [])], added: [...(c?.added ?? [])] });

/** What to store for a built-in service: only the fields that differ from it, or null when nothing does. */
export function serviceEditFrom(id: string, d: ServiceDraft): ServiceEdit | null {
  const b = DIRECTORY.find((x) => x.id === id);
  if (!b) return null;
  const e: ServiceEdit = {};
  const label = squash(d.label);
  const hint = squash(d.hint);
  const href = safeHref(d.href);
  if (label && label !== b.label) e.label = label;
  if (hint !== (b.hint ?? '')) e.hint = hint;
  if (href && href !== b.href) e.href = href;
  if (d.group !== b.group) e.group = d.group;
  const words = parseWords(d.words);
  if (words.length) e.words = words;
  return Object.keys(e).length ? e : null;
}

export function withServiceEdit(content: ServicesContent | null, id: string, edit: ServiceEdit | null): ServicesContent | null {
  const c = copy(content);
  if (edit) c.edits[id] = edit;
  else delete c.edits[id];
  return empty(c) ? null : c;
}

export function withHidden(content: ServicesContent | null, id: string, hidden: boolean): ServicesContent | null {
  const c = copy(content);
  c.hidden = c.hidden.filter((x) => x !== id);
  if (hidden) c.hidden.push(id);
  return empty(c) ? null : c;
}

export function addedFrom(d: ServiceDraft, id = ''): AddedService {
  return { id, label: squash(d.label), hint: squash(d.hint), href: safeHref(d.href) ?? d.href.trim(), group: d.group, kind: d.kind, words: parseWords(d.words) };
}

/** Adds a service (id ''), or replaces the one with this id. */
export function withAdded(content: ServicesContent | null, a: AddedService): ServicesContent | null {
  const c = copy(content);
  const at = a.id ? c.added.findIndex((x) => x.id === a.id) : -1;
  if (at >= 0) c.added[at] = a;
  else c.added.push(a);
  return empty(c) ? null : c;
}

export function withoutAdded(content: ServicesContent | null, id: string): ServicesContent | null {
  const c = copy(content);
  c.added = c.added.filter((x) => x.id !== id);
  c.hidden = c.hidden.filter((x) => x !== id);
  return empty(c) ? null : c;
}

// ---- phone numbers and quick links

export interface ContactDraft {
  label: string;
  hint: string;
  href: string;
  phone: string;
}

export const contactDraftOf = (l: ServiceLink): ContactDraft => ({
  label: l.label,
  hint: l.kind === 'call' ? '' : (l.hint ?? ''),
  href: l.kind === 'call' ? '' : l.href,
  phone: l.kind === 'call' ? (l.hint ?? '') : '',
});

export function checkContact(k: LinkKey, d: ContactDraft): string {
  if (!squash(d.label)) return 'Give it a name.';
  if (squash(d.label).length > SERVICE_LABEL_MAX) return `Keep the name under ${SERVICE_LABEL_MAX} characters.`;
  if (isPhoneLink(k)) return cleanPhone(d.phone) ? '' : 'Type the phone number as 10 digits, like 801-226-1929.';
  if (squash(d.hint).length > SERVICE_HINT_MAX) return `Keep the short note under ${SERVICE_HINT_MAX} characters.`;
  if (!safeHref(d.href)) return 'That web address will not work. Paste the full address, starting with https://.';
  return '';
}

export function contactEditFrom(k: LinkKey, d: ContactDraft): ContactEdit | null {
  const b = LINKS[k] as ServiceLink;
  const e: ContactEdit = {};
  const label = squash(d.label);
  if (label && label !== b.label) e.label = label;
  if (isPhoneLink(k)) {
    const phone = cleanPhone(d.phone);
    if (phone && phone !== b.hint) e.phone = phone;
  } else {
    const hint = squash(d.hint);
    if (hint !== (b.hint ?? '')) e.hint = hint;
    const href = safeHref(d.href);
    if (href && href !== b.href) e.href = href;
  }
  return Object.keys(e).length ? e : null;
}

const emptyContacts = (c: ContactsContent) => !Object.keys(c.edits).length && !c.hidden.length;

export function withContactEdit(content: ContactsContent | null, k: LinkKey, edit: ContactEdit | null): ContactsContent | null {
  const c: ContactsContent = { edits: { ...(content?.edits ?? {}) }, hidden: [...(content?.hidden ?? [])] };
  if (edit) c.edits[k] = edit;
  else delete c.edits[k];
  return emptyContacts(c) ? null : c;
}

export function withContactHidden(content: ContactsContent | null, k: LinkKey, hidden: boolean): ContactsContent | null {
  const c: ContactsContent = { edits: { ...(content?.edits ?? {}) }, hidden: (content?.hidden ?? []).filter((x) => x !== k) };
  if (hidden) c.hidden.push(k);
  return emptyContacts(c) ? null : c;
}

/** The host a link opens, for the list ("vineyardutah.gov"), or "This portal". */
export function hostOf(href: string): string {
  if (href.startsWith('/')) return 'This portal';
  if (href.startsWith('tel:')) return 'Phone call';
  try {
    return new URL(href).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
