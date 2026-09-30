/**
 * Chat history kept only in this browser (localStorage). No accounts, nothing sent to a server.
 * Each chat stores its questions and the answers that came back, so reopening a chat is instant.
 */
import { useSyncExternalStore } from 'react';
import type { ConsoleAnswer } from './types';

export interface SavedTurn {
  id: string;
  question: string;
  answer: ConsoleAnswer | null;
}
export interface SavedChat {
  id: string;
  title: string;
  updatedAt: number;
  turns: SavedTurn[];
}

const KEY = 'vtp:chats';
const OFF_KEY = 'vtp:chats-off';
const MAX_CHATS = 60;
const MAX_TURNS = 30;
const EMPTY: SavedChat[] = [];

let cache: SavedChat[] | null = null;
let offCache: boolean | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function read(): SavedChat[] {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    cache = Array.isArray(parsed) ? (parsed as SavedChat[]).filter((c) => c && typeof c.id === 'string' && Array.isArray(c.turns)) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(next: SavedChat[]) {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked: drop the oldest half and try once more, otherwise keep it in memory only.
    try {
      const trimmed = next.slice(0, Math.ceil(next.length / 2));
      localStorage.setItem(KEY, JSON.stringify(trimmed));
      cache = trimmed;
    } catch {
      /* private mode or blocked storage */
    }
  }
  emit();
}

export function historyEnabled(): boolean {
  if (offCache != null) return !offCache;
  try {
    offCache = localStorage.getItem(OFF_KEY) === '1';
  } catch {
    offCache = false;
  }
  return !offCache;
}

export function setHistoryEnabled(on: boolean) {
  offCache = !on;
  try {
    if (on) localStorage.removeItem(OFF_KEY);
    else localStorage.setItem(OFF_KEY, '1');
  } catch {
    /* ignore */
  }
  if (!on) write([]);
  else emit();
}

export function saveChat(chat: SavedChat) {
  if (!historyEnabled() || !chat.turns.length) return;
  const turns = chat.turns.slice(-MAX_TURNS).map((t) => ({
    id: t.id,
    question: t.question,
    // Keep the answer but not the long search result list that rides along with it.
    answer: t.answer ? ({ ...t.answer, searchResults: [] } as ConsoleAnswer) : null,
  }));
  const rest = read().filter((c) => c.id !== chat.id);
  write([{ ...chat, turns }, ...rest].slice(0, MAX_CHATS));
}

export function deleteChat(id: string) {
  write(read().filter((c) => c.id !== id));
}

export function clearChats() {
  write([]);
}

export function getChat(id: string): SavedChat | undefined {
  return read().find((c) => c.id === id);
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY || e.key === OFF_KEY) {
      cache = null;
      offCache = null;
      fn();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener('storage', onStorage);
  };
}

export function useChats(): SavedChat[] {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}

export function useHistoryEnabled(): boolean {
  return useSyncExternalStore(subscribe, historyEnabled, () => true);
}

export function newChatId(): string {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}
