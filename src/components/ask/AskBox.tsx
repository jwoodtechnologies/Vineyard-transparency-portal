import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ArrowUp, Search, Sparkles } from 'lucide-react';
import { cn } from '@/lib/cn';

export type AskMode = 'ask' | 'search';

/**
 * The central query box. Ask mode sends a natural-language question; Search mode runs a
 * traditional archive search. Enter submits; Shift+Enter inserts a newline.
 */
export function AskBox({
  onSubmit,
  initialValue = '',
  mode: controlledMode,
  onModeChange,
  showModeSwitch = true,
  size = 'lg',
  autoFocus,
  placeholder,
  busy,
  className,
}: {
  onSubmit: (value: string, mode: AskMode) => void;
  initialValue?: string;
  mode?: AskMode;
  onModeChange?: (m: AskMode) => void;
  showModeSwitch?: boolean;
  size?: 'lg' | 'md';
  autoFocus?: boolean;
  placeholder?: string;
  busy?: boolean;
  className?: string;
}) {
  const [value, setValue] = useState(initialValue);
  const [localMode, setLocalMode] = useState<AskMode>('ask');
  const mode = controlledMode ?? localMode;
  const ref = useRef<HTMLTextAreaElement>(null);
  const hintId = useId();

  const setMode = (m: AskMode) => {
    setLocalMode(m);
    onModeChange?.(m);
    ref.current?.focus();
  };

  // Auto-grow the textarea.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [value]);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const v = value.trim();
    if (!v || busy) return;
    onSubmit(v, mode);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const ph =
    placeholder ?? (mode === 'ask' ? 'Ask anything about Vineyard public records...' : 'Search titles, full text, document numbers, "exact phrases"...');

  return (
    <form
      onSubmit={submit}
      role="search"
      aria-label={mode === 'ask' ? 'Ask a question about public records' : 'Search public records'}
      className={cn(
        'group relative rounded-2xl border border-line-strong bg-surface shadow-[0_1px_2px_rgb(16_24_40/0.04),0_8px_24px_-12px_rgb(16_24_40/0.12)] transition-[border-color,box-shadow] focus-within:border-accent focus-within:shadow-[0_0_0_4px_color-mix(in_srgb,var(--vtp-accent)_14%,transparent),0_8px_24px_-12px_rgb(16_24_40/0.18)]',
        className,
      )}
    >
      <label htmlFor={`${hintId}-input`} className="sr-only">
        {mode === 'ask' ? 'Your question' : 'Search terms'}
      </label>
      <textarea
        id={`${hintId}-input`}
        ref={ref}
        rows={1}
        value={value}
        autoFocus={autoFocus}
        maxLength={1000}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={ph}
        aria-describedby={hintId}
        enterKeyHint={mode === 'ask' ? 'send' : 'search'}
        className={cn(
          'block w-full resize-none bg-transparent text-fg placeholder:text-subtle focus:outline-none',
          size === 'lg' ? 'px-5 pb-2 pt-4 text-[17px] leading-7 sm:text-lg' : 'px-4 pb-1.5 pt-3 text-[15px] leading-6',
        )}
      />
      <div className={cn('flex items-center gap-2', size === 'lg' ? 'px-3 pb-3' : 'px-2.5 pb-2.5')}>
        {showModeSwitch && (
          <div role="radiogroup" aria-label="Research mode" className="inline-flex rounded-lg bg-raised p-0.5">
            {(
              [
                ['ask', 'Ask', Sparkles],
                ['search', 'Search', Search],
              ] as const
            ).map(([m, label, Icon]) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition-colors',
                  mode === m ? 'bg-surface text-fg shadow-sm' : 'text-subtle hover:text-fg',
                )}
              >
                <Icon className="size-3.5" aria-hidden />
                {label}
              </button>
            ))}
          </div>
        )}
        <p id={hintId} className="ml-1 hidden text-xs text-subtle sm:block">
          {mode === 'ask' ? 'Answers cite the records they come from.' : 'Use quotes for exact phrases.'}
        </p>
        <button
          type="submit"
          disabled={!value.trim() || busy}
          aria-label={mode === 'ask' ? 'Ask' : 'Search'}
          className="ml-auto inline-flex size-9 items-center justify-center rounded-xl bg-accent text-on-accent transition-all hover:bg-accent-hover disabled:bg-raised disabled:text-subtle"
        >
          {mode === 'ask' ? <ArrowUp className="size-[18px]" /> : <Search className="size-4" />}
        </button>
      </div>
    </form>
  );
}
