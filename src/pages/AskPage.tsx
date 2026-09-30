import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Check, Loader2, Plus } from 'lucide-react';
import type { AskResponse, ConversationTurn } from '@/types/models';
import { AnswerView } from '@/components/ask/AnswerView';
import { AskBox, type AskMode } from '@/components/ask/AskBox';
import { Button } from '@/components/ui/Button';
import { SkeletonText } from '@/components/ui/Skeleton';
import { DataErrorState } from '@/components/ui/States';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useResource } from '@/hooks/useResource';
import { AskService } from '@/services';
import { recordHistory } from '@/lib/library';
import { askPath, searchPath } from '@/lib/searchParams';
import { cn } from '@/lib/cn';

interface Turn {
  id: string;
  question: string;
  /** Conversation snapshot sent with this question (tab-local; never stored server-side). */
  conversation: ConversationTurn[];
}

let turnSeq = 0;
function newTurn(question: string, conversation: ConversationTurn[] = []): Turn {
  turnSeq += 1;
  return { id: `t${turnSeq}`, question, conversation };
}

const STEPS = ['Analyzing the question', 'Searching indexed records', 'Checking sources and citations'];

function ThinkingState() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 450);
    return () => clearInterval(t);
  }, []);
  return (
    <div role="status" aria-live="polite" className="animate-fade-in">
      <ol className="space-y-1.5">
        {STEPS.map((s, i) => (
          <li key={s} className={cn('flex items-center gap-2 text-sm transition-colors', i <= step ? 'text-muted' : 'text-subtle/60')}>
            {i < step ? <Check className="size-3.5 text-ok" aria-hidden /> : i === step ? <Loader2 className="size-3.5 animate-spin text-accent" aria-hidden /> : <span className="size-3.5" />}
            {s}
          </li>
        ))}
      </ol>
      <SkeletonText lines={4} className="mt-5" />
    </div>
  );
}

function TurnView({ turn, onAnswered, onFollowUp, isLast }: { turn: Turn; onAnswered: (id: string, r: AskResponse) => void; onFollowUp: (q: string) => void; isLast: boolean }) {
  const { data, error, loading, reload } = useResource(`ask:${turn.id}`, () => AskService.ask({ question: turn.question, conversation: turn.conversation }));
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (data) onAnswered(turn.id, data);
  }, [data, onAnswered, turn.id]);

  useEffect(() => {
    if (isLast && turn.conversation.length > 0) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [isLast, turn.conversation.length]);

  return (
    <article ref={ref} className="scroll-mt-24 border-b border-line pb-10 pt-8 first:pt-2 last:border-b-0" aria-busy={loading}>
      <p className="eyebrow">Question</p>
      <h1 className="mt-1.5 font-serif text-[1.6rem] font-semibold leading-snug tracking-[-0.01em] sm:text-[1.85rem]">{turn.question}</h1>
      <div className="mt-6">
        {loading && <ThinkingState />}
        {error != null && <DataErrorState error={error} onRetry={reload} what="an answer" />}
        {data && <AnswerView response={data} onFollowUp={onFollowUp} />}
      </div>
    </article>
  );
}

export default function AskPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const q = (params.get('q') ?? '').trim().slice(0, 1000);
  const [turns, setTurns] = useState<Turn[]>(() => (q ? [newTurn(q)] : []));
  const [prevQ, setPrevQ] = useState(q);
  const answers = useRef(new Map<string, AskResponse>());
  useDocumentTitle(q || 'Ask');

  // Navigating to a new ?q= (browser back/forward, shared link) adds that question to the thread.
  if (q !== prevQ) {
    setPrevQ(q);
    if (q && !turns.some((t) => t.question === q)) setTurns((ts) => [...ts, newTurn(q)]);
  }

  const onAnswered = useCallback((id: string, r: AskResponse) => {
    answers.current.set(id, r);
  }, []);

  const ask = (question: string) => {
    const conversation: ConversationTurn[] = turns.slice(-3).flatMap((t) => {
      const a = answers.current.get(t.id);
      return [{ role: 'user' as const, content: t.question }, ...(a ? [{ role: 'assistant' as const, content: a.answer.slice(0, 1200) }] : [])];
    });
    setTurns((ts) => [...ts, newTurn(question, conversation)]);
    setPrevQ(question);
    void recordHistory('question', question, askPath(question));
    navigate(askPath(question));
  };

  const onSubmit = (value: string, mode: AskMode) => {
    if (mode === 'search') navigate(searchPath({ query: value }));
    else ask(value);
  };

  if (!turns.length) {
    return (
      <div className="container-page max-w-3xl py-16">
        <h1 className="font-serif text-3xl font-semibold">Ask the archive</h1>
        <p className="mt-2 text-muted">Ask a question in plain language. Answers cite the public records they come from.</p>
        <AskBox className="mt-8" onSubmit={onSubmit} autoFocus />
      </div>
    );
  }

  return (
    <div className="container-page flex max-w-3xl flex-1 flex-col pt-6">
      <div className="flex items-center justify-between gap-3">
        <Link to="/" className="text-sm text-subtle hover:text-fg">
          ← Home
        </Link>
        <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => navigate('/')}>
          New question
        </Button>
      </div>
      <div className="flex-1">
        {turns.map((t, i) => (
          <TurnView key={t.id} turn={t} onAnswered={onAnswered} onFollowUp={ask} isLast={i === turns.length - 1} />
        ))}
      </div>
      <div className="sticky bottom-0 z-10 -mx-4 bg-gradient-to-t from-canvas via-canvas to-transparent px-4 pb-4 pt-6 sm:mx-0 sm:px-0">
        <AskBox key={turns.length} onSubmit={onSubmit} size="md" placeholder="Ask a follow-up question…" />
        <p className="mt-2 text-center text-[11.5px] text-subtle">Answers are generated from indexed public records. Always check the cited source.</p>
      </div>
    </div>
  );
}
