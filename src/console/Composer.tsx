import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ArrowUp, Search, Square } from 'lucide-react';

const HERO_PROMPTS = ['Ask about Vineyard records', 'What did the council approve?', 'FY 2027 budget amendments', 'Minutes, packets and notices'];

interface Props {
  variant: 'hero' | 'dock';
  busy: boolean;
  onSubmit: (text: string) => void;
  onStop?: () => void;
  autoFocus?: boolean;
}

export function Composer({ variant, busy, onSubmit, onStop, autoFocus }: Props) {
  const [value, setValue] = useState('');
  const [prompt, setPrompt] = useState(0);
  const [fading, setFading] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Cycle the hero placeholder through real example questions.
  useEffect(() => {
    if (variant !== 'hero') return;
    let swap: ReturnType<typeof setTimeout> | undefined;
    const id = setInterval(() => {
      setFading(true);
      swap = setTimeout(() => {
        setPrompt((p) => (p + 1) % HERO_PROMPTS.length);
        setFading(false);
      }, 380);
    }, 3800);
    return () => {
      clearInterval(id);
      if (swap) clearTimeout(swap);
    };
  }, [variant]);

  useEffect(() => {
    if (autoFocus) ref.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  const resize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 192)}px`;
  };

  const send = (e?: FormEvent) => {
    e?.preventDefault();
    const text = value.trim();
    if (!text || busy) return;
    onSubmit(text);
    setValue('');
    requestAnimationFrame(() => {
      if (ref.current) ref.current.style.height = 'auto';
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  const placeholder = variant === 'hero' ? HERO_PROMPTS[prompt] : 'Ask a follow-up';

  return (
    <div className="vc-composer-wrap">
      <form className="vc-composer" onSubmit={send} role="search">
        {variant === 'hero' && <Search className="vc-composer-icon" size={20} strokeWidth={1.8} aria-hidden="true" />}
        <label htmlFor={`vc-input-${variant}`} className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
          Ask a question or search Vineyard public records
        </label>
        <textarea
          id={`vc-input-${variant}`}
          ref={ref}
          className="vc-input"
          rows={1}
          value={value}
          placeholder={placeholder}
          data-fade={fading}
          maxLength={1000}
          enterKeyHint="send"
          onChange={(e) => {
            setValue(e.target.value);
            resize();
          }}
          onKeyDown={onKeyDown}
        />
        {busy && onStop ? (
          <button type="button" className="vc-send" data-busy="true" onClick={onStop} aria-label="Stop">
            <Square size={14} fill="currentColor" strokeWidth={0} />
          </button>
        ) : (
          <button type="submit" className="vc-send" disabled={!value.trim() || busy} aria-label="Send">
            <ArrowUp size={variant === 'hero' ? 20 : 18} strokeWidth={2.2} />
          </button>
        )}
      </form>
    </div>
  );
}
