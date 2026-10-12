/**
 * Full screen for the record viewer: a fixed layer over the whole screen (works on iPhone, where pages cannot
 * use the browser Fullscreen API) plus the Fullscreen API where it exists, on `target`. Back and Esc leave it.
 * The record page holds it (not the viewer), so moving to the next record keeps full screen on.
 */
import { useCallback, useEffect, useState, type RefObject } from 'react';

export interface FullScreen {
  full: boolean;
  enter: () => void;
  exit: () => void;
}

export function useFullScreen(target: RefObject<HTMLElement | null>): FullScreen {
  const [full, setFull] = useState(false);
  const exit = useCallback(() => {
    setFull(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    if ((window.history.state as { vcFull?: boolean } | null)?.vcFull) window.history.back();
  }, []);
  const enter = useCallback(() => {
    setFull(true);
    window.history.pushState({ ...(window.history.state ?? {}), vcFull: true }, '');
    const el = target.current as (HTMLElement & { webkitRequestFullscreen?: () => void }) | null;
    try {
      if (el?.requestFullscreen) void el.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined);
      else el?.webkitRequestFullscreen?.();
    } catch {
      /* the fixed layer alone still fills the screen */
    }
  }, [target]);
  useEffect(() => {
    if (!full) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && exit();
    const onPop = () => {
      setFull(false);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
    const onFs = () => {
      if (!document.fullscreenElement) exit();
    };
    document.addEventListener('keydown', onKey);
    window.addEventListener('popstate', onPop);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('fullscreenchange', onFs);
    };
  }, [full, exit]);
  return { full, enter, exit };
}
