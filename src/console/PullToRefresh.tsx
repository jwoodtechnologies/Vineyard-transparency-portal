/**
 * Pull down to refresh, on touch screens. Dragging down from the top of a page slides the whole page down
 * and a ring draws itself in the space that opens up (no backing panel); let go past the line and the page
 * settles, the ring spins and the page reloads. Skipped over maps, text fields, open panels and the document
 * viewer, and whenever the page is not at the very top.
 */
import { useEffect, useRef } from 'react';

/** Page travel, in pixels, that arms the refresh. */
const ARM = 64;
/** Furthest the page slides. */
const MAX = 118;
/** Where the page rests while it reloads. */
const HOLD = 60;
/** Finger travel counts for half. */
const RESIST = 0.5;
const R = 18;
const CIRC = 2 * Math.PI * R;

const BLOCK = '.maplibregl-map, input, textarea, select, iframe, [contenteditable="true"], [role="dialog"], .vc-history, .vc-soc-sheet, .vc-viewer-shell, [data-no-ptr]';

/** True when something between the finger and the page is a scroller that is not at its top. */
function scrolledInside(from: Element | null): boolean {
  for (let n = from; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
    if (n.scrollTop > 0) {
      const oy = getComputedStyle(n).overflowY;
      if (oy === 'auto' || oy === 'scroll') return true;
    }
  }
  return false;
}

export default function PullToRefresh() {
  const box = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const arc = useRef<SVGCircleElement>(null);

  useEffect(() => {
    if (!window.matchMedia('(pointer: coarse)').matches) return;
    const wrap = box.current;
    const dial = ring.current;
    const stroke = arc.current;
    if (!wrap || !dial || !stroke) return;

    let state: 'idle' | 'maybe' | 'pull' | 'busy' = 'idle';
    let page: HTMLElement | null = null;
    let y0 = 0;
    let x0 = 0;
    let pull = 0;
    let armed = false;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ease = still ? 'none' : 'transform 0.32s cubic-bezier(0.22, 1, 0.36, 1)';

    const draw = (px: number, animate: boolean) => {
      if (page) {
        page.style.transition = animate ? ease : 'none';
        page.style.transform = px > 0 ? `translate3d(0, ${px}px, 0)` : '';
      }
      const p = Math.min(1, px / ARM);
      wrap.style.display = px > 0 || state === 'busy' ? 'block' : 'none';
      dial.style.transition = animate ? ease.replace('transform', 'translate') : 'none';
      dial.style.opacity = String(Math.min(1, px / 26));
      // translate, rotate and scale are separate properties, applied in that order, so the spin never bends the position.
      dial.style.translate = `0 ${px / 2 - 22}px`;
      dial.style.scale = String(0.55 + 0.45 * p);
      if (state !== 'busy') {
        stroke.style.strokeDasharray = `${CIRC}`;
        stroke.style.strokeDashoffset = `${CIRC * (1 - p)}`;
        dial.style.rotate = `${p * 240}deg`;
      }
    };

    const rest = () => {
      draw(0, true);
      const el = page;
      window.setTimeout(() => {
        if (state === 'busy') return;
        if (el) {
          el.style.transition = '';
          el.style.transform = '';
        }
        wrap.style.display = 'none';
      }, 340);
      page = null;
      state = 'idle';
      pull = 0;
      armed = false;
    };

    const onStart = (e: TouchEvent) => {
      if (state !== 'idle') return;
      if (e.touches.length !== 1 || window.scrollY > 0) return;
      if (document.documentElement.classList.contains('vc-locked')) return;
      const t = e.target instanceof Element ? e.target : null;
      if (t && (t.closest(BLOCK) || scrolledInside(t))) return;
      page = document.querySelector<HTMLElement>('.vc');
      if (!page) return;
      y0 = e.touches[0].clientY;
      x0 = e.touches[0].clientX;
      state = 'maybe';
    };

    const onMove = (e: TouchEvent) => {
      if (state !== 'maybe' && state !== 'pull') return;
      if (e.touches.length !== 1) {
        rest();
        return;
      }
      const dy = e.touches[0].clientY - y0;
      const dx = e.touches[0].clientX - x0;
      if (state === 'maybe') {
        if (dy < -6 || (Math.abs(dx) > 8 && Math.abs(dx) > dy)) {
          state = 'idle';
          page = null;
          return;
        }
        if (dy <= 8) return;
        if (window.scrollY > 0) {
          state = 'idle';
          page = null;
          return;
        }
        state = 'pull';
      }
      if (e.cancelable) e.preventDefault();
      pull = Math.min(MAX, Math.max(0, (dy - 8) * RESIST));
      draw(pull, false);
      const now = pull >= ARM;
      if (now !== armed) {
        armed = now;
        if (now) navigator.vibrate?.(8);
      }
    };

    const onEnd = () => {
      if (state !== 'pull') {
        if (state === 'maybe') {
          state = 'idle';
          page = null;
        }
        return;
      }
      if (pull >= ARM) {
        state = 'busy';
        dial.dataset.busy = 'true';
        stroke.style.strokeDasharray = `${CIRC * 0.3} ${CIRC}`;
        stroke.style.strokeDashoffset = '0';
        dial.style.rotate = '0deg';
        draw(HOLD, true);
        window.setTimeout(() => window.location.reload(), 650);
      } else {
        rest();
      }
    };

    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd, { passive: true });
    window.addEventListener('touchcancel', rest, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', rest);
    };
  }, []);

  return (
    <div ref={box} className="vc-ptr" aria-hidden="true">
      <div ref={ring} className="vc-ptr-ring">
        <svg viewBox="0 0 44 44">
          <circle className="vc-ptr-track" cx="22" cy="22" r={R} />
          <circle ref={arc} className="vc-ptr-arc" cx="22" cy="22" r={R} />
        </svg>
      </div>
    </div>
  );
}
