/**
 * "/" : the Vineyard Transparency Portal console.
 *
 * One screen. On arrival: the wordmark and a single input, nothing else. After a question the
 * input docks to the bottom and the thread appears: a grounded answer with numbered sources,
 * then the matching records with filters. Small talk gets a natural reply and no records.
 * Every answer comes from the archive through AskService / SearchService (works in mock mode).
 */
import '@fontsource-variable/inter';
import '@fontsource-variable/source-serif-4';
import './console.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Monitor, Moon, Plus, RotateCcw, Sun } from 'lucide-react';
import type { Citation, ConversationTurn, SearchFilters, SearchResult, SearchSort } from '@/types/models';
import { AskService, SearchService } from '@/services';
import { useTheme } from '@/hooks/useTheme';
import { Composer } from './Composer';
import { Wordmark } from './Wordmark';
import { AnswerBody, Sources, Verdict } from './Answer';
import { Records } from './Records';
import { Drawer } from './Drawer';
import type { ConsoleAnswer, Preview, Turn } from './types';

const PAGE = 8;
const STEPS = ['Searching the archive', 'Reading the records', 'Checking every source'];

let seq = 0;
const newTurn = (question: string): Turn => ({
  id: `t${Date.now().toString(36)}${(seq++).toString(36)}`,
  question,
  status: 'loading',
  answer: null,
  error: null,
  filters: {},
  sort: 'relevance',
  pageSize: PAGE,
  records: null,
  recordsStatus: 'loading',
});

function history(turns: Turn[]): ConversationTurn[] {
  return turns
    .filter((t) => t.status === 'done' && t.answer)
    .slice(-3)
    .flatMap((t) => [
      { role: 'user' as const, content: t.question },
      { role: 'assistant' as const, content: (t.answer?.answer ?? '').slice(0, 900) },
    ]);
}

function Thinking() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 1400);
    return () => clearInterval(id);
  }, []);
  return (
    <div aria-live="polite">
      <span className="vc-status">
        <span className="vc-pulse" aria-hidden="true" />
        <span className="vc-shimmer">{STEPS[step]}</span>
      </span>
      <div className="vc-skeleton" aria-hidden="true">
        <span style={{ width: '96%' }} />
        <span style={{ width: '88%' }} />
        <span style={{ width: '64%' }} />
      </div>
    </div>
  );
}

function ThemeButton() {
  const { preference, setPreference } = useTheme();
  const next = preference === 'system' ? 'light' : preference === 'light' ? 'dark' : 'system';
  const Icon = preference === 'light' ? Sun : preference === 'dark' ? Moon : Monitor;
  return (
    <button type="button" className="vc-ghost" data-icon-only="true" onClick={() => setPreference(next)} aria-label={`Theme: ${preference}. Switch to ${next}.`} title={`Theme: ${preference}`}>
      <Icon size={17} strokeWidth={1.8} />
    </button>
  );
}

export default function ConsolePage() {
  const [params, setParams] = useSearchParams();
  const [turns, setTurns] = useState<Turn[]>(() => {
    const q = params.get('q')?.trim();
    return q ? [newTurn(q.slice(0, 1000))] : [];
  });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const started = useRef(new Set<string>());
  const searched = useRef(new Map<string, string>());
  const controllers = useRef(new Map<string, AbortController>());
  const lastTurnEl = useRef<HTMLElement | null>(null);

  const patch = useCallback((id: string, p: Partial<Turn> | ((t: Turn) => Partial<Turn>)) => {
    setTurns((all) => all.map((t) => (t.id === id ? { ...t, ...(typeof p === 'function' ? p(t) : p) } : t)));
  }, []);

  // Runner: starts the answer request for new turns and (re)runs record searches when filters change.
  useEffect(() => {
    turns.forEach((t, i) => {
      if (!started.current.has(t.id)) {
        started.current.add(t.id);
        const ctrl = new AbortController();
        controllers.current.set(t.id, ctrl);
        AskService.ask({ question: t.question, conversation: history(turns.slice(0, i)) }, ctrl.signal).then(
          (answer) => patch(t.id, (cur) => ({ status: 'done', answer: answer as ConsoleAnswer, recordsStatus: (answer as ConsoleAnswer).mode === 'conversation' ? 'idle' : cur.recordsStatus })),
          (e: unknown) => {
            if (ctrl.signal.aborted) patch(t.id, { status: 'error', error: 'Stopped.' });
            else patch(t.id, { status: 'error', error: e instanceof Error ? e.message : 'The archive could not be reached.' });
          },
        );
      }
      const key = JSON.stringify([t.filters, t.sort, t.pageSize]);
      if (t.recordsStatus !== 'idle' && searched.current.get(t.id) !== key) {
        searched.current.set(t.id, key);
        SearchService.search({ query: t.question, filters: t.filters, sort: t.sort, match: 'any', page: 1, pageSize: t.pageSize }).then(
          (records) => {
            if (searched.current.get(t.id) === key) patch(t.id, (cur) => ({ records, recordsStatus: cur.recordsStatus === 'idle' ? 'idle' : 'done' }));
          },
          () => {
            if (searched.current.get(t.id) === key) patch(t.id, (cur) => ({ recordsStatus: cur.recordsStatus === 'idle' ? 'idle' : 'error' }));
          },
        );
      }
    });
  }, [turns, patch]);

  // Bring each new question to the top of the view.
  const count = turns.length;
  useEffect(() => {
    if (count > 1) lastTurnEl.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [count]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const ask = (text: string) => {
    setTurns((all) => [...all, newTurn(text)]);
    if (!turns.length) setParams({ q: text }, { replace: true });
  };

  const reset = () => {
    controllers.current.forEach((c) => c.abort());
    setTurns([]);
    setPreview(null);
    setParams({}, { replace: true });
    window.scrollTo({ top: 0 });
  };

  const busyTurn = turns.find((t) => t.status === 'loading');
  const stop = () => {
    if (busyTurn) controllers.current.get(busyTurn.id)?.abort();
  };
  const retry = (t: Turn) => {
    setTurns((all) => [...all.filter((x) => x.id !== t.id), newTurn(t.question)]);
  };
  const onFilters = (t: Turn) => (filters: SearchFilters, sort: SearchSort) => patch(t.id, { filters, sort, pageSize: PAGE, recordsStatus: 'loading' });
  const onMore = (t: Turn) => () => patch(t.id, { pageSize: t.pageSize + PAGE, recordsStatus: 'loading' });
  const cite = (t: Turn) => (citation: Citation) => setPreview({ kind: 'citation', citation, query: t.question });
  const open = (t: Turn) => (result: SearchResult) => setPreview({ kind: 'result', result, query: t.question });
  const closePreview = useCallback(() => setPreview(null), []);

  if (!turns.length) {
    return (
      <div className="vc" data-state="landing">
        <div className="vc-atmosphere" aria-hidden="true" />
        <div className="vc-grain" aria-hidden="true" />
        <main className="vc-landing">
          <header className="vc-hero">
            <h1 className="vc-hero-title">
              Vineyard <em>Transparency</em> Portal
            </h1>
            <p className="vc-hero-rule">Public records of Vineyard, Utah</p>
          </header>
          <Composer variant="hero" busy={false} onSubmit={ask} autoFocus />
        </main>
        <p className="vc-legal">An independent public-records project. Not an official website of Vineyard City.</p>
      </div>
    );
  }

  return (
    <div className="vc" data-state="thread">
      <div className="vc-atmosphere" aria-hidden="true" />
      <header className="vc-topbar" data-scrolled={scrolled}>
        <button type="button" className="vc-wordmark-home" onClick={reset} aria-label="Vineyard Transparency Portal, start over">
          <Wordmark />
        </button>
        <div className="vc-topbar-actions">
          <button type="button" className="vc-ghost" onClick={reset}>
            <Plus size={16} strokeWidth={2} /> New
          </button>
          <ThemeButton />
        </div>
      </header>

      <main className="vc-thread">
        {turns.map((t, i) => (
          <article key={t.id} className="vc-turn" ref={i === turns.length - 1 ? (el) => void (lastTurnEl.current = el) : undefined}>
            <div className="vc-you">
              <p className="vc-bubble">{t.question}</p>
            </div>
            <div className="vc-assistant-head" aria-hidden="true">
              <span>Vineyard</span>
            </div>
            {t.status === 'loading' && <Thinking />}
            {t.status === 'error' && (
              <div className="vc-notice">
                {t.error === 'Stopped.' ? 'Stopped.' : "I couldn't reach the archive just now."}{' '}
                <button type="button" className="vc-ghost" onClick={() => retry(t)} style={{ marginLeft: 6 }}>
                  <RotateCcw size={14} /> Try again
                </button>
              </div>
            )}
            {t.status === 'done' && t.answer && (
              <>
                {t.answer.notice && t.answer.mode !== 'conversation' && (t.answer.retrievalStatus === 'search_only' || t.answer.retrievalStatus === 'ai_unavailable') && <p className="vc-notice">{t.answer.notice}</p>}
                {t.answer.mode !== 'conversation' && <Sources citations={t.answer.citations} onCite={cite(t)} />}
                {!(t.answer.retrievalStatus === 'search_only' || t.answer.retrievalStatus === 'ai_unavailable') && <AnswerBody answer={t.answer} onCite={cite(t)} />}
                <Verdict answer={t.answer} />
              </>
            )}
            {t.status !== 'error' && <Records turn={t} onFilters={onFilters(t)} onMore={onMore(t)} onPreview={open(t)} />}
          </article>
        ))}
      </main>

      <div className="vc-dock">
        <Composer variant="dock" busy={Boolean(busyTurn)} onSubmit={ask} onStop={stop} autoFocus />
        <p className="vc-dock-hint">Answers cite indexed public records. Independent project, not an official Vineyard City website.</p>
      </div>

      {preview && <Drawer preview={preview} onClose={closePreview} />}
    </div>
  );
}
