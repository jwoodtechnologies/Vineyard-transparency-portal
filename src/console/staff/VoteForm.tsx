import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { staff } from './api';
import { Alert, Field } from './ui';
import { VOTE_CHOICES, checkRoll, counts, rollFrom, todayIso, votesFrom, type BodyOption, type Roll, type RollVote, type VoteValue } from './votesLib';

export interface VoteDraft {
  item: string;
  motion: string;
  mover: string;
  seconder: string;
  result: string;
  votes: RollVote[];
}

export interface VoteSubmit {
  item: string;
  motion: string;
  mover: string;
  seconder: string;
  result: string;
  votes: RollVote[];
  date?: string;
  body?: string;
}

/** Names that can sit on a board for the meeting being typed in; reloaded when the date or board changes. */
function useRoster(initial: string[], pick: { date: string; body: string } | null): string[] {
  const [loaded, setLoaded] = useState<{ key: string; names: string[] } | null>(null);
  const key = pick ? `${pick.date}|${pick.body}` : '';
  useEffect(() => {
    if (!pick || !/^\d{4}-\d{2}-\d{2}$/.test(pick.date) || !pick.body) return;
    let live = true;
    staff<{ roster: string[] }>(`/votes/roster?date=${encodeURIComponent(pick.date)}&body=${encodeURIComponent(pick.body)}`).then(
      (r) => live && setLoaded({ key, names: r.roster }),
      () => undefined,
    );
    return () => {
      live = false;
    };
    // pick is rebuilt on every render; its date and body are in key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return pick && loaded?.key === key ? loaded.names : initial;
}

function NameSelect({ label, value, onChange, names, hint }: { label: string; value: string; onChange: (v: string) => void; names: string[]; hint?: string }) {
  const all = value && !names.includes(value) ? [value, ...names] : names;
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Not stated</option>
          {all.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

/**
 * One motion: its wording, who moved and seconded, how it ended and how each member voted. Used both to
 * correct a motion read from the minutes and to add one the minutes do not have.
 */
export default function VoteForm({
  draft,
  roster,
  bodies,
  meeting,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  draft: VoteDraft;
  roster: string[];
  /** Present when adding: the person also chooses the meeting. */
  bodies?: BodyOption[];
  meeting?: { date: string; body: string };
  submitLabel: string;
  onSubmit: (v: VoteSubmit) => Promise<void>;
  onCancel: () => void;
}) {
  const adding = Boolean(bodies);
  const rollId = useId();
  const [date, setDate] = useState(meeting?.date ?? todayIso());
  const [body, setBody] = useState(meeting?.body ?? bodies?.[0]?.id ?? '');
  const names = useRoster(roster, adding ? { date, body } : null);
  const [item, setItem] = useState(draft.item);
  const [motion, setMotion] = useState(draft.motion);
  const [mover, setMover] = useState(draft.mover);
  const [seconder, setSeconder] = useState(draft.seconder);
  const [result, setResult] = useState(draft.result === 'carried' || draft.result === 'failed' ? draft.result : '');
  const [typed, setTyped] = useState<Roll>(() => rollFrom(draft.votes, []));
  const [extra, setExtra] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Everyone on the roster plus anyone typed in or already on the vote, each with a vote or "not recorded".
  const roll = useMemo<Roll>(() => {
    const out: Roll = {};
    for (const n of names) out[n] = '';
    for (const [n, v] of Object.entries(typed)) out[n] = v;
    return out;
  }, [names, typed]);
  const shown = Object.keys(roll);
  const c = counts(roll);
  const problem = checkRoll(result, roll);

  function setVote(name: string, v: VoteValue | '') {
    setTyped((t) => ({ ...t, [name]: v }));
  }

  function addName() {
    const n = extra.replace(/\s+/g, ' ').trim();
    if (!n) return;
    const have = shown.find((x) => x.toLowerCase() === n.toLowerCase());
    setTyped((t) => ({ ...t, [have ?? n]: t[have ?? n] ?? '' }));
    setExtra('');
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!motion.trim()) return setError('Write what the motion was.');
    if (!result) return setError('Choose Carried or Failed.');
    if (adding && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return setError('Choose the meeting date.');
    if (problem) return setError(problem);
    setBusy(true);
    setError('');
    try {
      await onSubmit({
        item,
        motion,
        mover,
        seconder,
        result,
        votes: votesFrom(roll),
        ...(adding ? { date, body } : {}),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
      setBusy(false);
    }
  }

  return (
    <form className="vs-edit" onSubmit={submit} noValidate aria-label={adding ? 'Add a vote' : 'Correct this vote'}>
      {adding && (
        <>
          <Field label="Meeting date">{(id) => <input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
          <Field label="Board or council">
            {(id) => (
              <select id={id} value={body} onChange={(e) => setBody(e.target.value)}>
                {bodies?.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </>
      )}
      <Field label="Agenda item" hint="Optional. For example, “7.2 Zoning change for Parcel 4”.">
        {(id) => <input id={id} value={item} maxLength={300} onChange={(e) => setItem(e.target.value)} />}
      </Field>
      <Field label="What was moved">{(id) => <textarea id={id} value={motion} maxLength={2000} onChange={(e) => setMotion(e.target.value)} />}</Field>
      <NameSelect label="Moved by" value={mover} onChange={setMover} names={names} />
      <NameSelect label="Seconded by" value={seconder} onChange={setSeconder} names={names} />
      <fieldset className="vs-field vs-choice">
        <legend>Result</legend>
        <div className="vs-seg" role="radiogroup" aria-label="Result">
          {(['carried', 'failed'] as const).map((r) => (
            <button key={r} type="button" role="radio" aria-checked={result === r} aria-pressed={result === r} onClick={() => setResult(r)}>
              {r === 'carried' ? 'Carried' : 'Failed'}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="vs-field vs-roll">
        <legend>How each member voted</legend>
        <p className="vs-hint">Leave a member as “Not recorded” if the minutes do not say. Totals shown on the portal come from these votes.</p>
        <ul className="vs-list">
          {shown.map((n, i) => (
            <li key={n} className="vs-roll-row">
              <label htmlFor={`${rollId}-${i}`}>{n}</label>
              <select id={`${rollId}-${i}`} value={roll[n]} data-vote={roll[n] || undefined} onChange={(e) => setVote(n, e.target.value as VoteValue | '')}>
                <option value="">Not recorded</option>
                {VOTE_CHOICES.map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.label}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
        <div className="vs-roll-add">
          <input
            aria-label="Add another name"
            placeholder="Add another name"
            value={extra}
            maxLength={80}
            onChange={(e) => setExtra(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addName();
              }
            }}
          />
          <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" onClick={addName} disabled={!extra.trim()}>
            <Plus size={14} aria-hidden="true" /> Add
          </button>
        </div>
        <p className="vs-hint" aria-live="polite">
          {c.recorded ? `Yes ${c.yes}, No ${c.no}, ${c.recorded} recorded.` : 'No votes recorded yet.'}
        </p>
        <Alert>{problem}</Alert>
      </fieldset>
      <Alert>{error}</Alert>
      <div className="vs-actions">
        <button type="submit" className="vs-btn vs-btn-primary" disabled={busy || Boolean(problem)}>
          {submitLabel}
        </button>
        <button type="button" className="vs-btn vs-btn-quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
