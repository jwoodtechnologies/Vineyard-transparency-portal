/**
 * "/" : the Vineyard Transparency Portal console.
 *
 * One screen. On arrival: the wordmark and a single input, nothing else. After a question the
 * input docks to the bottom and the thread appears: a grounded answer with numbered sources.
 * Matching records stay tucked away behind "Browse records" until the reader asks for them.
 * Chats are saved in this browser only (see history.ts) and can be reopened or deleted.
 */
import '@fontsource-variable/inter';
import '@fontsource-variable/source-serif-4';
import './console.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarDays, ChevronDown, History, Plus, RotateCcw } from 'lucide-react';
import type { Citation, ConversationTurn, SearchFilters, SearchResult, SearchSort } from '@/types/models';
import { AskService, SearchService } from '@/services';
import { Composer } from './Composer';
import { AnswerBody, Sources, Verdict } from './Answer';
import { Records } from './Records';
import { Drawer } from './Drawer';
import { SettingsMenu, TopBar } from './Chrome';
import { HistoryPanel } from './HistoryPanel';
import { newChatId, saveChat, type SavedChat } from './history';
import type { ConsoleAnswer, Preview, Turn } from './types';

const PAGE = 8;
const STEPS = ['Searching the archive', 'Reading the records', 'Checking every source'];

let seq = 0;
const turnId = () => `t${Date.now().toString(36)}${(seq++).toString(36)}`;
const newTurn = (question: string): Turn => ({
  id: turnId(),
  question,
  status: 'loading',
  answer: null,
  error: null,
  filters: {},
  sort: 'relevance',
  pageSize: PAGE,
  records: null,
  recordsStatus: 'loading',
  showRecords: false,
  wantRecords: true,
});

function restore(chat: SavedChat): Turn[] {
  return chat.turns.map((s) => ({
    ...newTurn(s.question),
    id: s.id,
    status: s.answer ? 'done' : 'error',
    answer: s.answer,
    error: s.answer ? null : 'Stopped.',
    recordsStatus: s.answer?.mode === 'conversation' ? 'idle' : 'loading',
    wantRecords: false,
  }));
}

const isSearchOnly = (a: ConsoleAnswer | null) => a?.retrievalStatus === 'search_only' || a?.retrievalStatus === 'ai_unavailable';

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

function BrowseToggle({ turn, onOpen }: { turn: Turn; onOpen: () => void }) {
  const r = turn.records;
  if (turn.recordsStatus === 'idle') return null;
  if (r && r.total === 0) return null;
  const n = r ? (r.totalIsEstimate ? `${r.total}+` : String(r.total)) : null;
  return (
    <button type="button" className="vc-browse" onClick={onOpen}>
      <span>{n ? `Browse ${n} matching ${r?.total === 1 ? 'record' : 'records'}` : 'Browse matching records'}</span>
      <ChevronDown size={15} strokeWidth={2} />
    </button>
  );
}

export default function ConsolePage() {
  const [params, setParams] = useSearchParams();
  const [chatId, setChatId] = useState(newChatId);
  const [turns, setTurns] = useState<Turn[]>(() => {
    const q = params.get('q')?.trim();
    return q ? [newTurn(q.slice(0, 1000))] : [];
  });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const started = useRef(new Set<string>());
  const searched = useRef(new Map<string, string>());
  const controllers = useRef(new Map<string, AbortController>());
  const lastTurnEl = useRef<HTMLElement | null>(null);

  const patch = useCallback((id: string, p: Partial<Turn> | ((t: Turn) => Partial<Turn>)) => {
    setTurns((all) => all.map((t) => (t.id === id ? { ...t, ...(typeof p === 'function' ? p(t) : p) } : t)));
  }, []);

  // Runner: asks new questions, and fetches record lists when they are wanted or their filters change.
  useEffect(() => {
    turns.forEach((t, i) => {
      if (t.status === 'loading' && !started.current.has(t.id)) {
        started.current.add(t.id);
        const ctrl = new AbortController();
        controllers.current.set(t.id, ctrl);
        AskService.ask({ question: t.question, conversation: history(turns.slice(0, i)) }, ctrl.signal).then(
          (res) => {
            const answer = res as ConsoleAnswer;
            patch(t.id, (cur) => ({
              status: 'done',
              answer,
              recordsStatus: answer.mode === 'conversation' ? 'idle' : cur.recordsStatus,
              showRecords: cur.showRecords || isSearchOnly(answer),
            }));
          },
          (e: unknown) => {
            if (ctrl.signal.aborted) patch(t.id, { status: 'error', error: 'Stopped.' });
            else patch(t.id, { status: 'error', error: e instanceof Error ? e.message : 'The archive could not be reached.' });
          },
        );
      }
      if (!(t.wantRecords || t.showRecords)) return;
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

  // Save finished turns to this browser.
  useEffect(() => {
    const done = turns.filter((t) => t.status !== 'loading');
    if (!done.length) return;
    saveChat({ id: chatId, title: turns[0].question.slice(0, 90), updatedAt: Date.now(), turns: done.map((t) => ({ id: t.id, question: t.question, answer: t.answer })) });
  }, [turns, chatId]);

  // Bring each new question to the top of the view.
  const count = turns.length;
  useEffect(() => {
    if (count > 1) lastTurnEl.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [count]);

  const ask = (text: string) => {
    setTurns((all) => [...all, newTurn(text)]);
    if (!turns.length) setParams({ q: text }, { replace: true });
  };

  const reset = useCallback(() => {
    controllers.current.forEach((c) => c.abort());
    setTurns([]);
    setPreview(null);
    setChatId(newChatId());
    setParams({}, { replace: true });
    window.scrollTo({ top: 0 });
  }, [setParams]);

  const openChat = (chat: SavedChat) => {
    controllers.current.forEach((c) => c.abort());
    const restored = restore(chat);
    restored.forEach((t) => started.current.add(t.id));
    setChatId(chat.id);
    setTurns(restored);
    setPreview(null);
    setHistoryOpen(false);
    setParams({}, { replace: true });
    requestAnimationFrame(() => window.scrollTo({ top: 0 }));
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
  const closeHistory = useCallback(() => setHistoryOpen(false), []);
  const newChat = () => {
    reset();
    setHistoryOpen(false);
  };

  const historyPanel = historyOpen && <HistoryPanel activeId={turns.length ? chatId : null} onOpen={openChat} onNew={newChat} onClose={closeHistory} />;

  if (!turns.length) {
    return (
      <div className="vc" data-state="landing">
        <div className="vc-atmosphere" aria-hidden="true" />
        <div className="vc-grain" aria-hidden="true" />
        <div className="vc-corners">
          <button type="button" className="vc-ghost" data-icon-only="true" onClick={() => setHistoryOpen(true)} aria-label="Chat history" title="Chat history">
            <History size={17} strokeWidth={1.8} />
          </button>
          <div className="vc-topbar-actions">
            <Link to="/meetings" className="vc-ghost vc-nav">
              <CalendarDays size={16} strokeWidth={1.8} />
              <span className="vc-nav-text">Meetings</span>
            </Link>
            <SettingsMenu />
          </div>
        </div>
        <main className="vc-landing">
          <header className="vc-hero">
            <h1 className="vc-hero-title">
              Vineyard <em>Transparency</em> Portal
            </h1>
            <p className="vc-hero-rule">Public records of Vineyard, Utah</p>
          </header>
          <Composer variant="hero" busy={false} onSubmit={ask} autoFocus />
        </main>
        <p className="vc-legal">Independent project. Not an official Vineyard City website.</p>
        {historyPanel}
      </div>
    );
  }

  return (
    <div className="vc" data-state="thread">
      <div className="vc-atmosphere" aria-hidden="true" />
      <TopBar onHome={reset} onHistory={() => setHistoryOpen(true)}>
        <button type="button" className="vc-ghost vc-nav" onClick={reset}>
          <Plus size={16} strokeWidth={2} />
          <span className="vc-nav-text">New</span>
        </button>
      </TopBar>

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
                {t.answer.notice && t.answer.mode !== 'conversation' && isSearchOnly(t.answer) && <p className="vc-notice">{t.answer.notice}</p>}
                {t.answer.mode !== 'conversation' && <Sources citations={t.answer.citations} onCite={cite(t)} />}
                {!isSearchOnly(t.answer) && <AnswerBody answer={t.answer} onCite={cite(t)} />}
                {t.answer.mode !== 'conversation' && <Verdict answer={t.answer} />}
                {t.answer.mode !== 'conversation' &&
                  (t.showRecords ? (
                    <Records turn={t} onFilters={onFilters(t)} onMore={onMore(t)} onPreview={open(t)} onHide={() => patch(t.id, { showRecords: false })} />
                  ) : (
                    <BrowseToggle turn={t} onOpen={() => patch(t.id, { showRecords: true })} />
                  ))}
              </>
            )}
          </article>
        ))}
      </main>

      <div className="vc-dock">
        <Composer variant="dock" busy={Boolean(busyTurn)} onSubmit={ask} onStop={stop} autoFocus />
      </div>

      {preview && <Drawer preview={preview} onClose={closePreview} />}
      {historyPanel}
    </div>
  );
}
