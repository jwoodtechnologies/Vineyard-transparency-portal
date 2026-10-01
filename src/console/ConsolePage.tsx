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
import { CalendarDays, ChevronDown, FileText, History, Landmark, Map as MapIcon, Newspaper, Plus, RotateCcw, Scale } from 'lucide-react';
import type { Citation, ConversationTurn, SearchFilters, SearchResult, SearchSort } from '@/types/models';
import { SearchService } from '@/services';
import { askStream, draftText } from './askStream';
import { Composer } from './Composer';
import { AnswerBody, Sources } from './Answer';
import { Records } from './Records';
import { AnswerActions } from './AnswerActions';
import { QuickLinks } from './QuickLinks';
import { Drawer } from './Drawer';
import { SettingsMenu, TopBar } from './Chrome';
import { HistoryPanel } from './HistoryPanel';
import { getChat, newChatId, saveChat, type SavedChat } from './history';
import type { ConsoleAnswer, Preview, Turn } from './types';
import { RECORD_CATEGORIES } from './categories';

const PAGE = 8;
const STEPS = ['Searching the archive', 'Reading the records', 'Checking every source'];
const WRITING = 'Writing the answer';

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
  draft: '',
  phase: 'searching',
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

function Thinking({ writing }: { writing: boolean }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 900);
    return () => clearInterval(id);
  }, []);
  return (
    <div aria-live="polite">
      <span className="vc-status">
        <span className="vc-pulse" aria-hidden="true" />
        <span className="vc-shimmer">{writing ? WRITING : STEPS[step]}</span>
      </span>
      <div className="vc-skeleton" aria-hidden="true">
        <span style={{ width: '96%' }} />
        <span style={{ width: '88%' }} />
        <span style={{ width: '64%' }} />
      </div>
    </div>
  );
}

function citedIds(answer: ConsoleAnswer | null): Set<string> {
  return new Set((answer?.citations ?? []).map((c) => c.documentId));
}

/** One button for everything beyond the cited sources, so nothing is listed twice. */
function MoreRecords({ turn, onOpen }: { turn: Turn; onOpen: () => void }) {
  const r = turn.records;
  if (turn.recordsStatus === 'idle' || !r) return null;
  const cited = citedIds(turn.answer);
  const extra = Math.max(0, r.total - r.items.filter((i) => cited.has(i.document.id)).length);
  if (extra <= 0) return null;
  const label = r.totalIsEstimate ? `${extra}+` : String(extra);
  return (
    <button type="button" className="vc-browse" onClick={onOpen}>
      <span>
        {cited.size ? `${label} more ${extra === 1 ? 'record' : 'records'}` : `Browse ${label} matching ${extra === 1 ? 'record' : 'records'}`}
      </span>
      <ChevronDown size={15} strokeWidth={2} />
    </button>
  );
}

// The open conversation lives here for the whole visit, so going to a record and pressing Back
// brings it back exactly as it was (even with saving turned off) instead of asking again.
const liveChats = new Map<string, Turn[]>();
const scrollPos = new Map<string, number>();

function initialChat(params: URLSearchParams): { id: string; turns: Turn[]; restored: boolean } {
  const c = params.get('c');
  if (c) {
    const live = liveChats.get(c);
    if (live?.length)
      return {
        id: c,
        restored: true,
        turns: live.map((t) => (t.status === 'loading' ? { ...t, status: 'error', error: 'Stopped.', draft: '' } : t)),
      };
    const saved = getChat(c);
    if (saved) return { id: c, turns: restore(saved), restored: true };
  }
  const q = params.get('q')?.trim();
  return { id: newChatId(), turns: q ? [newTurn(q.slice(0, 1000))] : [], restored: false };
}

export default function ConsolePage() {
  const [params, setParams] = useSearchParams();
  const [init] = useState(() => initialChat(params));
  const [chatId, setChatId] = useState(init.id);
  const [turns, setTurns] = useState<Turn[]>(init.turns);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const started = useRef(new Set<string>(init.restored ? init.turns.map((t) => t.id) : []));
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
        // Streamed text is batched to one render per frame so long answers stay smooth on phones.
        let pending = '';
        let frame = 0;
        const flush = () => {
          frame = 0;
          const add = pending;
          pending = '';
          if (add) patch(t.id, (cur) => ({ draft: cur.draft + add, phase: 'writing' }));
        };
        askStream({ question: t.question, conversation: history(turns.slice(0, i)) }, ctrl.signal, {
          onStatus: (phase) => phase === 'writing' && patch(t.id, { phase: 'writing' }),
          onDelta: (text) => {
            pending += text;
            if (!frame) frame = requestAnimationFrame(flush);
          },
        }).then(
          (res) => {
            const answer = res as ConsoleAnswer;
            if (frame) cancelAnimationFrame(frame);
            patch(t.id, (cur) => ({
              draft: '',
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

  // Keep the conversation for Back navigation, and put its id (not the question) in the address.
  useEffect(() => {
    if (turns.length) liveChats.set(chatId, turns);
  }, [turns, chatId]);
  const hasTurns = turns.length > 0;
  useEffect(() => {
    if (hasTurns && params.get('c') !== chatId) setParams({ c: chatId }, { replace: true });
  }, [hasTurns, chatId, params, setParams]);

  // Remember and restore where the reader was in the conversation.
  const chatRef = useRef(chatId);
  useEffect(() => {
    chatRef.current = chatId;
  }, [chatId]);
  useEffect(() => {
    if (init.restored) {
      const y = scrollPos.get(init.id);
      if (y) requestAnimationFrame(() => window.scrollTo({ top: y }));
    }
    return () => {
      scrollPos.set(chatRef.current, window.scrollY);
    };
  }, [init]);

  // Save finished turns to this browser.
  useEffect(() => {
    const done = turns.filter((t) => t.status !== 'loading');
    if (!done.length) return;
    saveChat({ id: chatId, title: turns[0].question.slice(0, 90), updatedAt: Date.now(), turns: done.map((t) => ({ id: t.id, question: t.question, answer: t.answer })) });
  }, [turns, chatId]);

  // The home screen is a single fixed screen: no scrolling or rubber-band bounce on phones.
  const landing = turns.length === 0;
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('vc-locked', landing);
    return () => root.classList.remove('vc-locked');
  }, [landing]);

  // Bring each new question to the top of the view.
  const count = turns.length;
  useEffect(() => {
    if (count > 1) lastTurnEl.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [count]);

  const ask = (text: string) => {
    setTurns((all) => [...all, newTurn(text)]);
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
    setParams({ c: chat.id }, { replace: true });
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
            <Link to="/latest" className="vc-ghost vc-nav" aria-label="Latest" title="Latest">
              <Newspaper size={16} strokeWidth={1.8} />
              <span className="vc-nav-text">Latest</span>
            </Link>
            <Link to="/meetings" className="vc-ghost vc-nav" aria-label="Calendar" title="Calendar">
              <CalendarDays size={16} strokeWidth={1.8} />
              <span className="vc-nav-text">Calendar</span>
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
          <nav className="vc-cats" aria-label="Browse records">
            {RECORD_CATEGORIES.slice(0, 3).map((c, i) => {
              const Icon = [FileText, Landmark, Scale][i];
              return (
                <Link key={c.id} to={`/records?c=${c.id}`} className="vc-cat">
                  <span className="vc-cat-icon">
                    <Icon size={15} strokeWidth={1.9} />
                  </span>
                  <span className="vc-cat-text">
                    <span className="vc-cat-long">{c.label}</span>
                    <span className="vc-cat-short">{c.short}</span>
                    <span className="vc-cat-hint">{c.hint}</span>
                  </span>
                </Link>
              );
            })}
            <Link to="/map" className="vc-cat">
              <span className="vc-cat-icon">
                <MapIcon size={15} strokeWidth={1.9} />
              </span>
              <span className="vc-cat-text">
                <span className="vc-cat-long">City map</span>
                <span className="vc-cat-short">City map</span>
                <span className="vc-cat-hint">Roads, projects</span>
              </span>
            </Link>
          </nav>
        </main>
        <p className="vc-legal">Independent project, not an official Vineyard City website.</p>
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
            {t.status === 'loading' && !t.draft && <Thinking writing={t.phase === 'writing'} />}
            {t.status === 'loading' && t.draft && (
              <div className="vc-answer" data-streaming="true" aria-live="polite">
                {draftText(t.draft).map((para, k, all) => (
                  <p key={k}>
                    {para}
                    {k === all.length - 1 && <span className="vc-caret" aria-hidden="true" />}
                  </p>
                ))}
              </div>
            )}
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
                {!isSearchOnly(t.answer) && <AnswerBody answer={t.answer} onCite={cite(t)} />}
                {t.answer.mode !== 'conversation' && <Sources citations={t.answer.citations} onCite={cite(t)} />}
                <QuickLinks answer={t.answer} />
                <div className="vc-answer-foot">
                  <AnswerActions answer={t.answer} />
                  {t.answer.mode !== 'conversation' && !t.showRecords && <MoreRecords turn={t} onOpen={() => patch(t.id, { showRecords: true })} />}
                </div>
                {t.answer.mode !== 'conversation' && t.showRecords && (
                  <Records
                    turn={t}
                    exclude={citedIds(t.answer)}
                    title={t.answer.citations.length ? 'More records' : 'Records'}
                    onFilters={onFilters(t)}
                    onMore={onMore(t)}
                    onPreview={open(t)}
                    onHide={() => patch(t.id, { showRecords: false })}
                  />
                )}
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
