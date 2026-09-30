/**
 * Device-local persistence. IndexedDB when available, localStorage fallback, then memory.
 * Nothing stored here ever leaves the device.
 */
const DB_NAME = 'vineyard-transparency-portal';
const DB_VERSION = 1;
export const STORES = ['saved', 'history'] as const;
export type StoreName = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s, { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

const memory: Record<StoreName, Map<string, unknown>> = { saved: new Map(), history: new Map() };

function lsKey(store: StoreName) {
  return `vtp:store:${store}`;
}

function lsRead(store: StoreName): Record<string, unknown> | null {
  try {
    return JSON.parse(localStorage.getItem(lsKey(store)) ?? '{}') as Record<string, unknown>;
  } catch {
    return null;
  }
}

function lsWrite(store: StoreName, data: Record<string, unknown>): boolean {
  try {
    localStorage.setItem(lsKey(store), JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

function tx<T>(db: IDBDatabase, store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getAll<T extends { key: string }>(store: StoreName): Promise<T[]> {
  const db = await openDb();
  if (db) {
    try {
      return await tx<T[]>(db, store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>);
    } catch {
      /* fall through */
    }
  }
  const ls = lsRead(store);
  if (ls) return Object.values(ls) as T[];
  return [...memory[store].values()] as T[];
}

export async function put<T extends { key: string }>(store: StoreName, value: T): Promise<void> {
  const db = await openDb();
  if (db) {
    try {
      await tx(db, store, 'readwrite', (s) => s.put(value));
      return;
    } catch {
      /* fall through */
    }
  }
  const ls = lsRead(store);
  if (ls && lsWrite(store, { ...ls, [value.key]: value })) return;
  memory[store].set(value.key, value);
}

export async function remove(store: StoreName, key: string): Promise<void> {
  const db = await openDb();
  if (db) {
    try {
      await tx(db, store, 'readwrite', (s) => s.delete(key));
      return;
    } catch {
      /* fall through */
    }
  }
  const ls = lsRead(store);
  if (ls) {
    delete ls[key];
    lsWrite(store, ls);
  }
  memory[store].delete(key);
}

export async function clear(store: StoreName): Promise<void> {
  const db = await openDb();
  if (db) {
    try {
      await tx(db, store, 'readwrite', (s) => s.clear());
    } catch {
      /* fall through */
    }
  }
  try {
    localStorage.removeItem(lsKey(store));
  } catch {
    /* ignore */
  }
  memory[store].clear();
}

export function readPref(key: string): string | null {
  try {
    return localStorage.getItem(`vtp:${key}`);
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string | null): void {
  try {
    if (value == null) localStorage.removeItem(`vtp:${key}`);
    else localStorage.setItem(`vtp:${key}`, value);
  } catch {
    /* ignore */
  }
}
