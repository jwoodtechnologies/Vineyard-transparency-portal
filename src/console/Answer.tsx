import { Check, CircleAlert, FileText } from 'lucide-react';
import type { Citation } from '@/types/models';
import type { ConsoleAnswer } from './types';
import { TYPE_LABEL, formatDate } from './format';

interface Props {
  answer: ConsoleAnswer;
  onCite: (c: Citation) => void;
}

export function Sources({ citations, onCite }: { citations: Citation[]; onCite: (c: Citation) => void }) {
  if (!citations.length) return null;
  return (
    <section aria-label="Sources">
      <p className="vc-label">
        Sources <span className="vc-label-count">{citations.length}</span>
      </p>
      <div className="vc-sources">
        {citations.map((c, i) => (
          <button key={c.index} type="button" className="vc-source" style={{ animationDelay: `${i * 60}ms` }} onClick={() => onCite(c)}>
            <span className="vc-source-top">
              <span className="vc-num">{c.index}</span>
              <span>{TYPE_LABEL[c.documentType] ?? 'Record'}</span>
            </span>
            <span className="vc-source-title">{c.documentTitle}</span>
            <span className="vc-source-meta">
              {[formatDate(c.date), c.page ? `Page ${c.page}` : null].filter(Boolean).join(' · ')}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function AnswerBody({ answer, onCite }: Props) {
  const byIndex = new Map(answer.citations.map((c) => [c.index, c]));
  const conversational = answer.mode === 'conversation';
  const paragraphs = answer.paragraphs.length ? answer.paragraphs : answer.answer ? [{ segments: [{ text: answer.answer, citations: [] as number[] }] }] : [];
  let n = 0;
  return (
    <div className="vc-answer" data-mode={conversational ? 'conversation' : 'records'} aria-live="polite">
      {paragraphs.map((p, pi) => (
        <p key={pi}>
          {p.segments.map((s, si) => {
            const delay = Math.min(n++ * 70, 1400);
            return (
              <span key={si} className="vc-seg" style={{ animationDelay: `${delay}ms` }}>
                {s.text}
                {s.citations.map((ci) => {
                  const c = byIndex.get(ci);
                  return c ? (
                    <button key={ci} type="button" className="vc-cite" onClick={() => onCite(c)} aria-label={`Source ${ci}: ${c.documentTitle}${c.page ? `, page ${c.page}` : ''}`} title={c.documentTitle}>
                      {ci}
                    </button>
                  ) : null;
                })}{' '}
              </span>
            );
          })}
        </p>
      ))}
    </div>
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
