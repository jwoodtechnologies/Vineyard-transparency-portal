import { useState } from 'react';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { when } from './api';
import { Alert, Spinner, Stat } from './ui';
import { useStaffData } from './useStaff';

interface Window {
  visits: number;
  people: number;
  questions: number;
  up: number;
  down: number;
}

interface Usage {
  used: number;
  cap: number;
}

interface InsightsReply {
  day: Window;
  week: Window;
  month: Window;
  all: Window;
  topQuestions: Array<{ q: string; n: number }>;
  questions: Array<{ id: number; at: string; question: string; up: number; down: number }>;
  ratings: Array<{ id: number; at: string; vote: 'up' | 'down'; question: string | null }>;
  ai: { public: Usage; tests: Usage; total: Usage & { allowance: number }; resetsAtMountain: string } | null;
}

type Span = 'day' | 'week' | 'month' | 'all';
const SPANS: Array<[Span, string]> = [
  ['day', 'Today'],
  ['week', '7 days'],
  ['month', '30 days'],
  ['all', 'All time'],
];

const round = (n: number) => Math.round(n).toLocaleString();

/** Insights: how many people use the portal, what they ask, and how the answers are rated. Owners and administrators only. */
export default function Insights() {
  const data = useStaffData<InsightsReply>('/insights/summary');
  const [span, setSpan] = useState<Span>('week');
  const [list, setList] = useState<'questions' | 'down'>('questions');
  const d = data.data;
  const w = d?.[span];
  const rated = w ? w.up + w.down : 0;
  const notHelpful = d?.ratings.filter((r) => r.vote === 'down') ?? [];

  return (
    <section className="vs-stack" aria-labelledby="vs-insights">
      <div>
        <h1 id="vs-insights" className="vs-title">
          Insights
        </h1>
        <p className="vs-lede">How many people use the portal, what they ask the assistant, and whether the answers helped.</p>
      </div>
      <Alert>{data.error}</Alert>
      {!d && !data.error && <Spinner label="Loading" />}

      {d && w && (
        <>
          <div className="vs-seg vs-seg-fit" role="group" aria-label="Period">
            {SPANS.map(([key, label]) => (
              <button key={key} type="button" aria-pressed={span === key} onClick={() => setSpan(key)}>
                {label}
              </button>
            ))}
          </div>
          <ul className="vs-stats" aria-label="Numbers for the period">
            <Stat n={w.people} label="People" />
            <Stat n={w.visits} label="Page views" />
            <Stat n={w.questions} label="Questions" />
            <Stat n={rated ? `${Math.round((100 * w.up) / rated)}%` : 'None'} label={rated ? `Helpful (${w.up} up, ${w.down} down)` : 'No ratings yet'} warn={rated > 0 && w.down > w.up} />
          </ul>

          <div className="vs-card">
            <h2 className="vs-h2">Asked most in 30 days</h2>
            {d.topQuestions.length === 0 ? (
              <p className="vs-empty">No questions yet.</p>
            ) : (
              <ul className="vs-list">
                {d.topQuestions.slice(0, 8).map((t) => (
                  <li key={t.q} className="vs-person">
                    <p className="vs-row-title">{t.q}</p>
                    <p className="vs-row-sub">Asked {t.n === 1 ? 'once' : `${t.n} times`}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="vs-card">
            <div className="vs-seg" role="group" aria-label="Show">
              <button type="button" aria-pressed={list === 'questions'} onClick={() => setList('questions')}>
                Latest questions
              </button>
              <button type="button" aria-pressed={list === 'down'} onClick={() => setList('down')}>
                Not helpful ({notHelpful.length})
              </button>
            </div>
            {list === 'questions' &&
              (d.questions.length === 0 ? (
                <p className="vs-empty">No questions yet.</p>
              ) : (
                <ul className="vs-list">
                  {d.questions.map((q) => (
                    <li key={q.id} className="vs-person">
                      <p className="vs-row-title">{q.question}</p>
                      <p className="vs-row-sub">
                        {when(q.at)}
                        {q.up > 0 && (
                          <>
                            {' · '}
                            <ThumbsUp size={13} aria-label="Helpful" /> {q.up}
                          </>
                        )}
                        {q.down > 0 && (
                          <>
                            {' · '}
                            <ThumbsDown size={13} aria-label="Not helpful" /> {q.down}
                          </>
                        )}
                      </p>
                    </li>
                  ))}
                </ul>
              ))}
            {list === 'down' &&
              (notHelpful.length === 0 ? (
                <p className="vs-empty">No answers were marked not helpful lately.</p>
              ) : (
                <ul className="vs-list">
                  {notHelpful.map((r) => (
                    <li key={r.id} className="vs-person">
                      <p className="vs-row-title">{r.question || 'A question'}</p>
                      <p className="vs-row-sub">Marked not helpful {when(r.at)}</p>
                    </li>
                  ))}
                </ul>
              ))}
          </div>

          {d.ai && (
            <div className="vs-card">
              <h2 className="vs-h2">Assistant use today</h2>
              <ul className="vs-stats">
                <Stat n={round(d.ai.public.used)} label={`of ${round(d.ai.public.cap)} for the public`} warn={d.ai.public.used >= d.ai.public.cap} />
                <Stat n={round(d.ai.total.used)} label={`of ${round(d.ai.total.allowance)} daily allowance`} warn={d.ai.total.used >= d.ai.total.cap} />
              </ul>
              <p className="vs-small">Counted in AI units. Resets at {d.ai.resetsAtMountain}.</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
