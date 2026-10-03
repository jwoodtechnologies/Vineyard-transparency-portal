/**
 * The city's own Facebook posts in a panel of their own: a slide-up sheet on phones, a drawer on wide screens, and
 * a docked column beside Latest on wide screens. The posts are Facebook's official Page embed; nothing is copied or
 * stored by the portal, and the embed loads only when a panel is open.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, ChevronRight, X } from 'lucide-react';

const PAGE_URL = 'https://www.facebook.com/VineyardCity';
const SHERIFF_URL = 'https://www.facebook.com/VineyardUCSO';

function Mark() {
  return (
    <span className="vc-soc-mark" aria-hidden="true">
      V
    </span>
  );
}

/** Facebook's Page plugin, sized to the room it is given (it allows 180 to 500 pixels wide). */
function Feed() {
  const box = useRef<HTMLDivElement>(null);
  const [dim, setDim] = useState<{ w: number; h: number } | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const w = Math.round(el.clientWidth);
      const h = Math.round(el.clientHeight);
      if (w < 50 || h < 50) return;
      // A new size reloads the embed, so only follow real changes.
      setDim((p) => (!p || Math.abs(p.w - w) >= 24 || Math.abs(p.h - h) >= 90 ? { w, h } : p));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // If Facebook is blocked and never answers, stop the placeholder anyway.
  useEffect(() => {
    const t = window.setTimeout(() => setLoaded(true), 6000);
    return () => window.clearTimeout(t);
  }, []);
  const w = dim ? Math.max(180, Math.min(500, dim.w)) : 0;
  const h = dim ? Math.max(300, dim.h) : 0;
  const src = dim
    ? `https://www.facebook.com/plugins/page.php?${new URLSearchParams({ href: PAGE_URL, tabs: 'timeline', width: String(w), height: String(h), small_header: 'true', adapt_container_width: 'true', hide_cover: 'true', show_facepile: 'false' })}`
    : '';
  return (
    <div ref={box} className="vc-soc-frame" data-loaded={loaded}>
      <div className="vc-soc-wait" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      {dim && <iframe title="Vineyard City on Facebook" src={src} width={w} height={h} loading="lazy" allow="encrypted-media" referrerPolicy="strict-origin-when-cross-origin" onLoad={() => setLoaded(true)} />}
    </div>
  );
}

function Foot() {
  return (
    <div className="vc-soc-foot">
      <a href={PAGE_URL} target="_blank" rel="noopener noreferrer" className="vc-soc-open">
        Open on Facebook <ArrowUpRight size={15} strokeWidth={2} />
      </a>
      <p>
        Posts are shown by Facebook; the portal does not copy or store them. Also on Facebook:{' '}
        <a href={SHERIFF_URL} target="_blank" rel="noopener noreferrer">
          Utah County Sheriff&apos;s Office, Vineyard
        </a>
      </p>
    </div>
  );
}

/** The button or card that opens the panel. */
export function SocialLauncher({ onOpen, variant = 'card' }: { onOpen: () => void; variant?: 'card' | 'pill' }) {
  if (variant === 'pill') {
    return (
      <button type="button" className="vc-soc-pill" onClick={onOpen} aria-haspopup="dialog">
        <Mark />
        City on Facebook
      </button>
    );
  }
  return (
    <button type="button" className="vc-soc-launch" onClick={onOpen} aria-haspopup="dialog">
      <Mark />
      <span className="vc-soc-launch-text">
        <b>City on Facebook</b>
        <span>Latest posts from Vineyard City</span>
      </span>
      <ChevronRight size={18} strokeWidth={1.7} aria-hidden="true" />
    </button>
  );
}

/** The panel, docked in the page (wide screens). */
export function SocialDock() {
  return (
    <aside className="vc-soc-dock" aria-label="Vineyard City on Facebook">
      <div className="vc-soc-head">
        <Mark />
        <div className="vc-soc-title">
          <b>Vineyard City</b>
          <span>Posts on Facebook</span>
        </div>
      </div>
      <Feed />
      <Foot />
    </aside>
  );
}

const CLOSE_MS = 220;

/** The panel as a sheet over the page: slides up on phones, in from the right on wide screens. */
export function SocialSheet({ onClose }: { onClose: () => void }) {
  const sheet = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const [closing, setClosing] = useState(false);
  const drag = useRef<{ y: number; dy: number } | null>(null);

  const close = useCallback(() => {
    setClosing(true);
    window.setTimeout(onClose, CLOSE_MS);
  }, [onClose]);

  useEffect(() => {
    const back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeBtn.current?.focus({ preventScroll: true });
    document.documentElement.classList.add('vc-soc-lock');
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('keydown', key);
      document.documentElement.classList.remove('vc-soc-lock');
      back?.focus({ preventScroll: true });
    };
  }, [close]);

  // Pull the header down to dismiss, like any phone sheet.
  const down = (e: ReactPointerEvent) => {
    if (e.pointerType === 'mouse') return;
    drag.current = { y: e.clientY, dy: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: ReactPointerEvent) => {
    const d = drag.current;
    const el = sheet.current;
    if (!d || !el) return;
    d.dy = Math.max(0, e.clientY - d.y);
    el.style.transition = 'none';
    el.style.translate = `0 ${d.dy}px`;
  };
  const up = () => {
    const d = drag.current;
    const el = sheet.current;
    drag.current = null;
    if (!d || !el) return;
    if (d.dy > 110) {
      close();
    } else {
      el.style.transition = 'translate 0.3s cubic-bezier(0.22, 1, 0.36, 1)';
      el.style.translate = '';
    }
  };

  // Inside the page's own .vc so the theme colors apply, and outside the animated page body so fixed positioning holds.
  const root = document.querySelector<HTMLElement>('.vc') ?? document.body;
  return createPortal(
    <>
      <div className="vc-soc-scrim" data-closing={closing} onClick={close} aria-hidden="true" />
      <div ref={sheet} className="vc-soc-sheet" data-closing={closing} role="dialog" aria-modal="true" aria-label="Vineyard City on Facebook">
        <div className="vc-soc-head vc-soc-head-sheet" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          <span className="vc-soc-grab" aria-hidden="true" />
          <Mark />
          <div className="vc-soc-title">
            <b>Vineyard City</b>
            <span>Posts on Facebook</span>
          </div>
          <button ref={closeBtn} type="button" className="vc-soc-close" onClick={close} aria-label="Close">
            <X size={18} strokeWidth={1.9} />
          </button>
        </div>
        <Feed />
        <Foot />
      </div>
    </>,
    root,
  );
}
