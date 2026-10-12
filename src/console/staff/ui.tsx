/** Small shared pieces for the staff screens. */
import { useId, type ReactNode } from 'react';

export function Field({ label, hint, children }: { label: string; hint?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="vs-field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint && <p className="vs-hint">{hint}</p>}
    </div>
  );
}

export function Alert({ children }: { children: ReactNode }) {
  return children ? (
    <p className="vs-error" role="alert">
      {children}
    </p>
  ) : null;
}

export function Spinner({ label = 'Working' }: { label?: string }) {
  return (
    <span className="vs-spin" role="status" aria-label={label}>
      <span />
    </span>
  );
}
