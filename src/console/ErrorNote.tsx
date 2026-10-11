import type { ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';

/**
 * The one error state (docs/DESIGN.md): what failed, in one sentence, and a way to try again.
 * Without `onRetry` the page reloads, which refetches everything on it.
 */
export function ErrorNote({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <div className="vc-error" role="alert">
      <p>{children}</p>
      <button type="button" className="vc-secondary" onClick={onRetry ?? (() => window.location.reload())}>
        <RotateCcw size={14} strokeWidth={1.9} /> Try again
      </button>
    </div>
  );
}
