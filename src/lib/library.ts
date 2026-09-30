/**
 * "Saved on this device" library and recent history. Local only — never synced to a server.
 */
import { clear, getAll, put, readPref, remove, writePref } from './storage';

export type SavedKind = 'document' | 'search' | 'question';

export interface SavedItem {
  key: string;
  kind: SavedKind;
  title: string;
  /** In-app path, e.g. /documents/abc or /search?q=parking */
  path: string;
  subtitle?: string;
  savedAt: string;
}

export interface HistoryItem {
  key: string;
  kind: 'question' | 'search';
  text: string;
  path: string;
  at: string;
}

const HISTORY_LIMIT = 50;
const channelName = 'vtp-library';
const events = new EventTarget();
let channel: BroadcastChannel | null = null;
try {
  channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(channelName) : null;
  channel?.addEventListener('message', () => events.dispatchEvent(new Event('change')));
} catch {
  channel = null;
}

function notify() {
  events.dispatchEvent(new Event('change'));
  try {
    channel?.postMessage('change');
  } catch {
    /* ignore */
  }
}

export function subscribeLibrary(fn: () => void): () => void {
  events.addEventListener('change', fn);
  return () => events.removeEventListener('change', fn);
}

export function savedKey(kind: SavedKind, id: string) {
  return `${kind}:${id}`;
}

export async function listSaved(): Promise<SavedItem[]> {
  return (await getAll<SavedItem>('saved')).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export async function saveItem(item: Omit<SavedItem, 'savedAt'>): Promise<void> {
  await put('saved', { ...item, savedAt: new Date().toISOString() });
  notify();
}

export async function removeSaved(key: string): Promise<void> {
  await remove('saved', key);
  notify();
}

export async function clearSaved(): Promise<void> {
  await clear('saved');
  notify();
}

export function isHistoryEnabled(): boolean {
  return readPref('history-enabled') !== 'false';
}

export async function setHistoryEnabled(enabled: boolean): Promise<void> {
  writePref('history-enabled', enabled ? null : 'false');
  if (!enabled) await clear('history');
  notify();
}

export async function listHistory(): Promise<HistoryItem[]> {
  return (await getAll<HistoryItem>('history')).sort((a, b) => b.at.localeCompare(a.at));
}

export async function recordHistory(kind: HistoryItem['kind'], text: string, path: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed || !isHistoryEnabled()) return;
  const key = `${kind}:${trimmed.toLowerCase()}`;
  await put('history', { key, kind, text: trimmed.slice(0, 500), path, at: new Date().toISOString() });
  const all = await listHistory();
  for (const old of all.slice(HISTORY_LIMIT)) await remove('history', old.key);
  notify();
}

export async function removeHistory(key: string): Promise<void> {
  await remove('history', key);
  notify();
}

export async function clearHistory(): Promise<void> {
  await clear('history');
  notify();
}
