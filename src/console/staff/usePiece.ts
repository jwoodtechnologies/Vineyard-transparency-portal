/** One stored piece of site wording (site_content), as a staff screen edits it. */
import { useRef, useState } from 'react';
import { StaffError, staff } from './api';
import { useStaffData } from './useStaff';

export interface Stored<T> {
  value: T | null;
  updatedAt: string | null;
}

export const CONFLICT = 'Someone else saved a change a moment ago, so yours was not saved. The list now shows their version. Make your change again on top of it.';
export const WAIT = 'Wait for the last save to finish, then try again.';

/** One stored piece of site wording: the copy on screen, and a save that runs one at a time and spots someone else's save. */
export function usePiece<T>(key: string, onConflict: () => void) {
  const stored = useStaffData<Stored<T>>(`/content/get?key=${key}`);
  const [local, setLocal] = useState<Stored<T> | null>(null);
  const current = local ?? stored.data;
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  async function commit(next: T | null): Promise<void> {
    if (lock.current) throw new Error(WAIT);
    lock.current = true;
    setSaving(true);
    try {
      if (next === null) {
        if (current?.value) await staff('/content/reset', { body: { key, base: current.updatedAt } });
        setLocal({ value: null, updatedAt: null });
      } else {
        const r = await staff<{ value: T; updatedAt: string }>('/content/save', { body: { key, value: next, base: current?.updatedAt ?? null } });
        setLocal({ value: r.value, updatedAt: r.updatedAt });
      }
    } catch (e) {
      if (e instanceof StaffError && e.status === 409) {
        setLocal(null);
        stored.reload();
        onConflict();
        throw new Error(CONFLICT, { cause: e });
      }
      throw e;
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }
  return { current, value: current?.value ?? null, error: stored.error, reload: stored.reload, saving, commit };
}

/** Puts focus back on a control after the thing that held it closed or moved, so a keyboard or screen reader user keeps their place. */
export const refocus = (el: HTMLElement | null) => {
  if (el) requestAnimationFrame(() => el.focus());
};
