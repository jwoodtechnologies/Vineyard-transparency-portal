/** Small shared pieces for the staff screens. */
import { cloneElement, isValidElement, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';

/**
 * A labelled field. The hint is tied to the control with aria-describedby, so a screen reader reads it
 * after the label, without every screen wiring it by hand.
 */
export function Field({ label, hint, children }: { label: string; hint?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  const hintId = `${id}-hint`;
  const control = children(id);
  const described =
    hint && isValidElement(control)
      ? cloneElement(control as ReactElement<{ 'aria-describedby'?: string }>, { 'aria-describedby': (control.props as { 'aria-describedby'?: string })['aria-describedby'] ?? hintId })
      : control;
  return (
    <div className="vs-field">
      <label htmlFor={id}>{label}</label>
      {described}
      {hint && (
        <p className="vs-hint" id={hintId}>
          {hint}
        </p>
      )}
    </div>
  );
}

/**
 * An error message. It is announced as it appears, and when the person pressed a button to cause it
 * (the usual case) focus moves to it so it is not missed below the fold. It does not take focus away
 * from a field the person is still typing in.
 */
export function Alert({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (!children) return;
    const active = document.activeElement;
    const typing = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement;
    if (!typing) ref.current?.focus();
  }, [children]);
  return children ? (
    <p className="vs-error" role="alert" tabIndex={-1} ref={ref}>
      {children}
    </p>
  ) : null;
}

export function Spinner({ label = 'Working' }: { label?: string }) {
  return (
    <span className="vs-spin" role="status">
      <span aria-hidden="true" />
      <span className="vs-sr">{label}</span>
    </span>
  );
}

/** One number with a short label, for the Insights, Coverage and Health screens. */
export function Stat({ n, label, warn }: { n: number | string; label: string; warn?: boolean }) {
  return (
    <li className="vs-stat" data-tone={warn ? 'warn' : undefined}>
      <p className="vs-stat-n">{typeof n === 'number' ? n.toLocaleString() : n}</p>
      <p className="vs-stat-l">{label}</p>
    </li>
  );
}

/** A password box with a Show/Hide button, so a long password can be checked instead of typed twice. */
export function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
  'aria-describedby': describedBy,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: 'current-password' | 'new-password';
  'aria-describedby'?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="vs-pw">
      <input
        id={id}
        type={show ? 'text' : 'password'}
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={describedBy}
      />
      <button type="button" className="vs-pw-toggle" aria-pressed={show} onClick={() => setShow(!show)}>
        {show ? 'Hide' : 'Show'}
        <span className="vs-sr"> password</span>
      </button>
    </div>
  );
}
