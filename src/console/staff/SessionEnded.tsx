import { useEffect, useRef } from 'react';
import { SignInForm } from './SignIn';
import { useStaffCtx } from './useStaff';

/**
 * Shown over the page when a request finds the 12 hour session over. The page underneath is left exactly as it
 * was, so what someone was typing is still there when they sign back in and press Save again.
 */
export default function SessionEnded() {
  const { user, sessionEnded, reload, clearSessionEnded } = useStaffCtx();
  const open = sessionEnded && user !== null;
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>('input, button')?.focus();
    return () => {
      if (before && document.contains(before)) before.focus();
    };
  }, [open]);

  if (!open) return null;

  function trap(e: React.KeyboardEvent) {
    if (e.key !== 'Tab' || !box.current) return;
    const items = [...box.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]):not([tabindex="-1"])')];
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="vs-modal" role="presentation">
      <div className="vs-modal-card vs-card" role="alertdialog" aria-modal="true" aria-labelledby="vs-ended-h" aria-describedby="vs-ended-d" ref={box} onKeyDown={trap}>
        <h2 id="vs-ended-h" className="vs-h2">
          Your session ended
        </h2>
        <p id="vs-ended-d" className="vs-hint">
          Sign in again to keep working. What you typed is still on the page, so you can send it once you are back in.
        </p>
        <SignInForm
          autoFocus
          onSignedIn={async () => {
            await reload();
            clearSessionEnded();
          }}
        />
      </div>
    </div>
  );
}
