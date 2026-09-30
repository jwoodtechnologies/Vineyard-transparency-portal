/** Copy, thumbs up and thumbs down under an answer. Votes go to the owner's activity panel. */
import { useState } from 'react';
import { Check, Copy, ThumbsDown, ThumbsUp } from 'lucide-react';
import type { ConsoleAnswer } from './types';
import { formatDate } from './format';

type Vote = 'up' | 'down';
const KEY = 'vtp:votes';

function readVotes(): Record<string, Vote> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return v && typeof v === 'object' ? (v as Record<string, Vote>) : {};
  } catch {
    return {};
  }
}

function saveVote(id: string, vote: Vote) {
  try {
    const all = readVotes();
    all[id] = vote;
    const keys = Object.keys(all);
    for (const k of keys.slice(0, Math.max(0, keys.length - 300))) delete all[k];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* storage blocked */
  }
}

function plainAnswer(a: ConsoleAnswer): string {
  const text = a.paragraphs.length
    ? a.paragraphs.map((p) => p.segments.map((s) => `${s.text}${s.citations.length ? ` ${s.citations.map((c) => `[${c}]`).join('')}` : ''}`).join(' ')).join('\n\n')
    : a.answer;
  if (!a.citations.length) return text;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const sources = a.citations.map((c) => {
    const bits = [c.documentTitle, formatDate(c.date), c.page ? `page ${c.page}` : null].filter(Boolean).join(', ');
    return `[${c.index}] ${bits}\n${origin}/documents/${encodeURIComponent(c.documentId)}${c.page ? `?page=${c.page}` : ''}`;
  });
  return `${text}\n\nSources\n${sources.join('\n')}`;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older Safari: fall back to a hidden textarea.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function AnswerActions({ answer }: { answer: ConsoleAnswer }) {
  const [vote, setVote] = useState<Vote | null>(() => readVotes()[answer.id] ?? null);
  const [copied, setCopied] = useState(false);
  const rateable = answer.mode !== 'conversation' && /^ask_[0-9a-f]{16}$/.test(answer.id);

  const copy = async () => {
    if (await copyText(plainAnswer(answer))) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }
  };

  const rate = (v: Vote) => {
    if (vote === v) return;
    setVote(v);
    saveVote(answer.id, v);
    void fetch('/api/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ askId: answer.id, vote: v, question: answer.question, answer: answer.answer.slice(0, 4000) }),
      keepalive: true,
    }).catch(() => undefined);
  };

  return (
    <div className="vc-actions" role="group" aria-label="Answer actions">
      <button type="button" className="vc-act" onClick={copy} aria-label={copied ? 'Copied' : 'Copy answer'} title={copied ? 'Copied' : 'Copy answer'} data-done={copied}>
        {copied ? <Check size={15} strokeWidth={2.2} /> : <Copy size={15} strokeWidth={1.9} />}
        <span className="vc-act-text">{copied ? 'Copied' : 'Copy'}</span>
      </button>
      {rateable && (
        <>
          <button type="button" className="vc-act" data-on={vote === 'up'} onClick={() => rate('up')} aria-pressed={vote === 'up'} aria-label="Helpful" title="Helpful">
            <ThumbsUp size={15} strokeWidth={1.9} />
          </button>
          <button type="button" className="vc-act" data-on={vote === 'down'} onClick={() => rate('down')} aria-pressed={vote === 'down'} aria-label="Not helpful" title="Not helpful">
            <ThumbsDown size={15} strokeWidth={1.9} />
          </button>
          {vote && <span className="vc-act-thanks">Thanks for the feedback</span>}
        </>
      )}
    </div>
  );
}
