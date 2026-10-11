import { Check, CircleAlert, CornerDownRight, FileText } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { AnswerParagraph, Citation } from '@/types/models';
import { docHref } from '@/lib/routes';
import type { ConsoleAnswer } from './types';
import { TYPE_LABEL, formatDate } from './format';

interface Props {
  answer: ConsoleAnswer;
  onCite: (c: Citation) => void;
  /** The answer replaces text that was already streaming in: no fade, so nothing jumps or flashes. */
  instant?: boolean;
}

/** The records an answer cites, as a compact row of cards. Each opens the record in the portal at the cited page. */
export function Sources({ citations }: { citations: Citation[]; onCite?: (c: Citation) => void }) {
  if (!citations.length) return null;
  return (
    <section aria-label="Sources" className="vc-sources-block">
      <p className="vc-label">
        Sources <span className="vc-label-count">{citations.length}</span>
      </p>
      <div className="vc-sources">
        {citations.map((c, i) => (
          <Link key={c.index} to={docHref({ id: c.documentId }, c.page)} className="vc-source" style={{ animationDelay: `${i * 60}ms` }}>
            <span className="vc-source-top">
              <span className="vc-num">{c.index}</span>
              <span>{TYPE_LABEL[c.documentType] ?? 'Record'}</span>
            </span>
            <span className="vc-source-title">{c.documentTitle}</span>
            {c.sourceLabel && <span className="vc-source-label">{c.sourceLabel}</span>}
            <span className="vc-source-meta">{[formatDate(c.date), c.page ? `Page ${c.page}` : null].filter(Boolean).join(' · ')}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function Cites({ ids, byIndex, onCite }: { ids: number[]; byIndex: Map<number, Citation>; onCite: (c: Citation) => void }) {
  return (
    <>
      {ids.map((ci) => {
        const c = byIndex.get(ci);
        return c ? (
          <button key={ci} type="button" className="vc-cite" onClick={() => onCite(c)} aria-label={`Source ${ci}: ${c.documentTitle}${c.page ? `, page ${c.page}` : ''}`} title={`${c.documentTitle}${c.page ? `, page ${c.page}` : ''}`}>
            {ci}
          </button>
        ) : null;
      })}
    </>
  );
}

/** Citations a whole list or table cites in common are shown once, after it, instead of on every line. */
function sharedCites(p: AnswerParagraph): number[] {
  const lists = p.table ? p.table.rows.map((r) => r.citations) : p.segments.map((s) => s.citations);
  if (lists.length < 2) return [];
  const first = lists[0];
  return first.length && lists.every((l) => l.length === first.length && l.every((x, i) => x === first[i])) ? first : [];
}

export function AnswerBody({ answer, onCite, instant = false }: Props) {
  const byIndex = new Map(answer.citations.map((c) => [c.index, c]));
  const conversational = answer.mode === 'conversation';
  const paragraphs: AnswerParagraph[] = answer.paragraphs.length ? answer.paragraphs : answer.answer ? [{ segments: [{ text: answer.answer, citations: [] }] }] : [];
  let n = 0;
  const delay = () => (instant ? undefined : { animationDelay: `${Math.min(n++ * 70, 1400)}ms` });
  return (
    <div className="vc-answer" data-mode={conversational ? 'conversation' : 'records'} data-instant={instant || undefined} aria-live="polite">
      {paragraphs.map((p, pi) => {
        const shared = sharedCites(p);
        if (p.table) {
          const cols = p.table.columns;
          return (
            <div key={pi} className="vc-answer-table-wrap vc-seg" style={delay()}>
              <table className="vc-answer-table">
                <thead>
                  <tr>
                    {cols.map((c, ci) => (
                      <th key={ci} scope="col">
                        {c || <span className="vc-sr">Item</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {p.table.rows.map((r, ri) => (
                    <tr key={ri}>
                      {r.cells.map((cell, ci) =>
                        ci === 0 ? (
                          <th key={ci} scope="row">
                            {cell}
                            {!shared.length && <Cites ids={r.citations} byIndex={byIndex} onCite={onCite} />}
                          </th>
                        ) : (
                          <td key={ci}>{cell}</td>
                        ),
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {shared.length > 0 && (
                <p className="vc-answer-cites">
                  Source <Cites ids={shared} byIndex={byIndex} onCite={onCite} />
                </p>
              )}
            </div>
          );
        }
        if (p.list) {
          return (
            <div key={pi} className="vc-answer-listwrap">
              <ul className="vc-answer-list">
                {p.segments.map((s, si) => (
                  <li key={si} className="vc-seg" style={delay()}>
                    {s.text}
                    {!shared.length && <Cites ids={s.citations} byIndex={byIndex} onCite={onCite} />}
                  </li>
                ))}
              </ul>
              {shared.length > 0 && (
                <p className="vc-answer-cites">
                  Source <Cites ids={shared} byIndex={byIndex} onCite={onCite} />
                </p>
              )}
            </div>
          );
        }
        return (
          <p key={pi} className={pi === 0 && !conversational ? 'vc-answer-lead' : undefined}>
            {p.segments.map((s, si) => (
              <span key={si} className="vc-seg" style={delay()}>
                {s.text}
                <Cites ids={s.citations} byIndex={byIndex} onCite={onCite} />{' '}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

/** "As of Oct 11, 2026 · City calendar": when the data behind an answer is current, for data that changes. */
export function AsOf({ answer }: { answer: ConsoleAnswer }) {
  const when = formatDate(answer.asOf ?? null);
  if (!when) return null;
  return (
    <p className="vc-asof">
      As of {when}
      {answer.asOfLabel ? ` · ${answer.asOfLabel}` : ''}
    </p>
  );
}

/** Tappable choices for a clarifying question: each one is a full question the portal answers. */
export function ClarifyChoices({ answer, onAsk, disabled }: { answer: ConsoleAnswer; onAsk: (q: string) => void; disabled?: boolean }) {
  const choices = answer.clarify?.choices ?? [];
  if (!choices.length) return null;
  return (
    <div className="vc-clarify" role="group" aria-label="Choose one">
      {choices.map((c) => (
        <button key={c.question} type="button" className="vc-chip vc-clarify-chip" disabled={disabled} onClick={() => onAsk(c.question)}>
          {c.label}
        </button>
      ))}
    </div>
  );
}

/** Suggested next questions, each one the portal can answer for this answer's subject. */
export function FollowUps({ answer, onAsk, disabled }: { answer: ConsoleAnswer; onAsk: (q: string) => void; disabled?: boolean }) {
  const list = answer.clarify ? [] : (answer.suggestedFollowUps ?? []).filter(Boolean).slice(0, 3);
  if (!list.length) return null;
  return (
    <nav className="vc-followups" aria-label="Ask next">
      {list.map((q) => (
        <button key={q} type="button" className="vc-followup" disabled={disabled} onClick={() => onAsk(q)}>
          <CornerDownRight size={14} strokeWidth={2} aria-hidden="true" />
          <span>{q}</span>
        </button>
      ))}
    </nav>
  );
}

export function Verdict({ answer }: { answer: ConsoleAnswer }) {
  if (answer.mode === 'conversation') return null;
  const docs = new Set(answer.citations.map((c) => c.documentId)).size;
  const status = answer.retrievalStatus;
  return (
    <div className="vc-verdict">
      {status === 'grounded' && (
        <span className="vc-pill" data-tone="good">
          <Check size={13} strokeWidth={2.4} /> Grounded in {docs} {docs === 1 ? 'record' : 'records'}
        </span>
      )}
      {status === 'partial' && (
        <span className="vc-pill" data-tone="warn">
          <CircleAlert size={13} strokeWidth={2.2} /> Partly verified
        </span>
      )}
      {(status === 'no_results' || status === 'search_only' || status === 'ai_unavailable') && (
        <span className="vc-pill">
          <FileText size={13} strokeWidth={2} /> From the record archive
        </span>
      )}
      <span>Answers come only from indexed public records. Always check the source.</span>
    </div>
  );
}
