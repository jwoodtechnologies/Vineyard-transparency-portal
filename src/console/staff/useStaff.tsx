/* eslint-disable react-refresh/only-export-components -- one small context module */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createProofSource } from './sha';
import { SESSION_ENDED, staff, type Me, type StaffState } from './api';

/** One solved bot-check kept ready for the sign-in screens. */
export const proofs = createProofSource(() => staff<{ id: string; bits: number }>('/challenge'));

type Load = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: StaffState };

interface Ctx {
  load: Load;
  user: Me | null;
  /** True after a request found the session over; the page stays as it was and offers a quick sign-in. */
  sessionEnded: boolean;
  clearSessionEnded: () => void;
  reload: () => Promise<void>;
  signOut: () => Promise<void>;
}

const StaffContext = createContext<Ctx | null>(null);

export function useStaffCtx(): Ctx {
  const c = useContext(StaffContext);
  if (!c) throw new Error('Staff context is missing.');
  return c;
}

export function StaffProvider({ children }: { children: ReactNode }) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [sessionEnded, setSessionEnded] = useState(false);
  useEffect(() => {
    const ended = () => setSessionEnded(true);
    window.addEventListener(SESSION_ENDED, ended);
    return () => window.removeEventListener(SESSION_ENDED, ended);
  }, []);
  const clearSessionEnded = useCallback(() => setSessionEnded(false), []);
  useEffect(() => {
    let live = true;
    staff<StaffState>('/state').then(
      (data) => live && setLoad({ status: 'ready', data }),
      () => live && setLoad({ status: 'error' }),
    );
    return () => {
      live = false;
    };
  }, []);
  /** Re-reads who is signed in; resolves once the screen has the new answer. */
  const reload = useCallback(async () => {
    try {
      setLoad({ status: 'ready', data: await staff<StaffState>('/state') });
    } catch {
      setLoad({ status: 'error' });
    }
  }, []);
  const signOut = useCallback(async () => {
    try {
      await staff('/logout', { method: 'POST' });
    } finally {
      await reload();
    }
  }, [reload]);
  const value = useMemo<Ctx>(
    () => ({ load, user: load.status === 'ready' ? load.data.user : null, sessionEnded, clearSessionEnded, reload, signOut }),
    [load, sessionEnded, clearSessionEnded, reload, signOut],
  );
  return <StaffContext.Provider value={value}>{children}</StaffContext.Provider>;
}

/** Loads a staff API path; `reload()` fetches it again after a change. Keeps showing the old data meanwhile. */
export function useStaffData<T>(path: string) {
  const [rev, setRev] = useState(0);
  const key = `${rev}:${path}`;
  const [state, setState] = useState<{ key: string | null; data: T | null; error: string }>({ key: null, data: null, error: '' });
  useEffect(() => {
    let live = true;
    staff<T>(path).then(
      (data) => live && setState({ key, data, error: '' }),
      (e: Error) => live && setState((s) => ({ key, data: s.data, error: e.message })),
    );
    return () => {
      live = false;
    };
  }, [key, path]);
  const reload = useCallback(() => setRev((r) => r + 1), []);
  return { data: state.data, error: state.key === key ? state.error : '', loading: state.key !== key, reload };
}
