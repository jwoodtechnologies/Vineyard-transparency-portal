import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ArrowUp, Mic, Search, Square } from 'lucide-react';

// Browser speech recognition (Chrome, Edge, Safari on Mac and iPhone). Free, no account; the words
// are written into the box live as you speak. Hidden where the browser does not support it.
interface SpeechResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechEvent {
  resultIndex: number;
  results: ArrayLike<SpeechResult>;
}
interface Recognizer {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
}
type RecognizerCtor = new () => Recognizer;
const speechCtor = (): RecognizerCtor | null => {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognizerCtor; webkitSpeechRecognition?: RecognizerCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

const HERO_PROMPTS = ['Ask about Vineyard records', 'What did the council approve?', 'FY 2027 budget amendments', 'Minutes, packets and notices'];
// Phones get prompts short enough to fit beside the mic and send buttons.
const HERO_PROMPTS_SHORT = ['Ask about Vineyard', 'Council decisions', 'The city budget', 'Meeting minutes'];
const narrow = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 480px)').matches;

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
  const [short] = useState(narrow);
  const prompts = short ? HERO_PROMPTS_SHORT : HERO_PROMPTS;
  const [fading, setFading] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const [listening, setListening] = useState(false);
  const [micNote, setMicNote] = useState<string | null>(null);
  const rec = useRef<Recognizer | null>(null);
  const [canSpeak] = useState(() => speechCtor() !== null);

  useEffect(() => () => rec.current?.abort(), []);

  const stopListening = () => {
    rec.current?.stop();
    rec.current = null;
    setListening(false);
  };

  const startListening = () => {
    const Ctor = speechCtor();
    if (!Ctor || busy) return;
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = navigator.language || 'en-US';
    const base = value.trim();
    let finals = '';
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const piece = e.results[i][0].transcript;
        if (e.results[i].isFinal) finals += piece;
        else interim += piece;
      }
      const spoken = `${finals}${interim}`.replace(/\s+/g, ' ').trim();
      setValue(`${base}${base && spoken ? ' ' : ''}${spoken}`.slice(0, 1000));
      requestAnimationFrame(resize);
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') setMicNote('Microphone access is blocked. Allow it in your browser settings.');
      else if (e.error === 'no-speech') setMicNote('No speech heard. Tap the mic and try again.');
    };
    r.onend = () => {
      if (rec.current === r) rec.current = null;
      setListening(false);
    };
    try {
      r.start();
      rec.current = r;
      setMicNote(null);
      setListening(true);
    } catch {
      setListening(false);
    }
  };

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
    if (listening) stopListening();
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

  const placeholder = listening ? (short ? 'Listening...' : 'Listening... start speaking') : micNote ?? (variant === 'hero' ? prompts[prompt] : 'Ask a follow-up');

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
          data-fade={fading && !listening && !micNote}
          maxLength={1000}
          enterKeyHint="send"
          onChange={(e) => {
            setValue(e.target.value);
            resize();
          }}
          onKeyDown={onKeyDown}
        />
        {canSpeak && !(busy && onStop) && (
          <button
            type="button"
            className="vc-mic"
            data-on={listening}
            onClick={() => (listening ? stopListening() : startListening())}
            aria-label={listening ? 'Stop dictation' : 'Speak your question'}
            aria-pressed={listening}
            title={listening ? 'Stop dictation' : 'Speak your question'}
          >
            <Mic size={variant === 'hero' ? 19 : 17} strokeWidth={1.9} />
          </button>
        )}
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
