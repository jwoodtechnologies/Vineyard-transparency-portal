/* eslint-disable react-refresh/only-export-components -- the tour and the hook that opens it */
/**
 * The new staff tour: five or six small cards, each spotlighting the real control it is about on its own
 * screen (tourSteps.ts). It starts by itself the first time someone signs in after joining from an invite,
 * and again from Take the tour in the account menu or the Help link on the staff home. Finishing or
 * skipping it is saved on the account (POST /api/staff/me/tour). Back, Next and Skip; Escape closes; focus
 * stays in the card; the card keeps clear of the control on phones and desktops.
 */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { staff } from './api';
import { useStaffCtx } from './useStaff';
import { PAD, placeCard, tourDue, tourSteps, type Box, type TourStep } from './tourSteps';

interface TourCtx {
  start: () => void;
}

const Ctx = createContext<TourCtx>({ start: () => undefined });
export const useTour = (): TourCtx => useContext(Ctx);

/** Screens where the tour never starts by itself (signing in, joining, recovering). */
const NOT_HERE = /^\/staff\/(join|setup|recover)\b/;

export function TourProvider({ children }: { children: ReactNode }) {
  const { user, reload } = useStaffCtx();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const autoTried = useRef<string | null>(null);

  const start = useCallback(() => {
    opener.current = document.activeElement as HTMLElement | null;
    setOpen(true);
  }, []);

  // The first sign in after joining: once per account (the server keeps whether it was finished or skipped).
  useEffect(() => {
    if (!user || open || autoTried.current === user.id || NOT_HERE.test(pathname) || !tourDue(user)) return;
    autoTried.current = user.id;
    setOpen(true);
  }, [user, open, pathname]);

  const close = useCallback(
    (state: 'done' | 'skipped') => {
      setOpen(false);
      void staff('/me/tour', { body: { state } })
        .then(() => reload())
        .catch(() => undefined);
      const back = opener.current;
      opener.current = null;
      window.setTimeout(() => (back && document.contains(back) ? back : document.querySelector<HTMLElement>('#vs-main h1'))?.focus(), 0);
    },
    [reload],
  );

  const value = useMemo(() => ({ start }), [start]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {open && user && <Tour steps={tourSteps(user)} onClose={close} />}
    </Ctx.Provider>
  );
}

function Tour({ steps, onClose }: { steps: TourStep[]; onClose: (state: 'done' | 'skipped') => void }) {
  const [i, setI] = useState(0);
  const step = steps[Math.min(i, steps.length - 1)];
  const last = i >= steps.length - 1;
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const card = useRef<HTMLDivElement>(null);
  const [target, setTarget] = useState<Box | null>(null);
  const [found, setFound] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const still = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // The step's screen, then its control: scrolled into view and measured (again on scroll and resize).
  useEffect(() => {
    // A new step starts unmeasured: the ring and the card wait for its control.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset for the new step before measuring
    setFound(false);
    setTarget(null);
    if (pathname !== step.path) {
      navigate(step.path);
      return;
    }
    let tries = 0;
    let timer = 0;
    let el: HTMLElement | null = null;
    let frame = 0;
    const measure = () => {
      frame = 0;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setTarget({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    const queue = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const find = () => {
      el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
      if (!el && tries++ < 30) {
        timer = window.setTimeout(find, 100);
        return;
      }
      if (el) el.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' });
      timer = window.setTimeout(() => {
        measure();
        setFound(true);
      }, el ? (still ? 50 : 400) : 0);
    };
    find();
    window.addEventListener('scroll', queue, true);
    window.addEventListener('resize', queue);
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', queue, true);
      window.removeEventListener('resize', queue);
    };
  }, [step, pathname, navigate, still]);

  // The card's place, once its size is known.
  useLayoutEffect(() => {
    const c = card.current;
    if (!c) return;
    setPos(placeCard(target, { width: c.offsetWidth, height: c.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }));
  }, [target, step]);

  // Focus moves to the card on each step, so a screen reader reads its title and text.
  useEffect(() => {
    if (found) card.current?.focus({ preventScroll: true });
  }, [found, i]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose(last ? 'done' : 'skipped');
      return;
    }
    if (e.key !== 'Tab') return;
    // Focus stays in the card.
    const items = [...(card.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [])];
    if (!items.length) return;
    const first = items[0],
      end = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === card.current)) {
      e.preventDefault();
      end.focus();
    } else if (!e.shiftKey && document.activeElement === end) {
      e.preventDefault();
      first.focus();
    }
  };

  const hole = target && found ? { top: target.top - PAD, left: target.left - PAD, width: target.width + 2 * PAD, height: target.height + 2 * PAD } : null;
  return createPortal(
    <div className="vs-tour" data-ready={found || undefined}>
      {/* Clicks around the card do nothing while the tour is open. */}
      <div className="vs-tour-block" aria-hidden="true" />
      {hole ? <div className="vs-tour-hole" aria-hidden="true" style={hole} /> : <div className="vs-tour-shade" aria-hidden="true" />}
      <div
        ref={card}
        className="vs-tour-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vs-tour-title"
        aria-describedby="vs-tour-body"
        tabIndex={-1}
        onKeyDown={onKey}
        style={pos ? { top: pos.top, left: pos.left, width: pos.width } : { visibility: 'hidden' }}
      >
        <p className="vs-tour-count">
          Step {i + 1} of {steps.length}
        </p>
        <h2 id="vs-tour-title" className="vs-tour-title">
          {step.title}
        </h2>
        <p id="vs-tour-body" className="vs-tour-body">
          {step.body}
        </p>
        <div className="vs-tour-acts">
          {!last && (
            <button type="button" className="vs-btn vs-btn-quiet vs-btn-small" onClick={() => onClose('skipped')}>
              Skip
            </button>
          )}
          <span className="vs-tour-gap" />
          <button type="button" className="vs-btn vs-btn-quiet vs-btn-small" onClick={() => setI(i - 1)} disabled={i === 0}>
            Back
          </button>
          <button type="button" className="vs-btn vs-btn-primary vs-btn-small" onClick={() => (last ? onClose('done') : setI(i + 1))}>
            {last ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </div>,
    // Inside the staff page's root, so its styles and theme apply.
    document.querySelector('.vc.vs') ?? document.body,
  );
}
