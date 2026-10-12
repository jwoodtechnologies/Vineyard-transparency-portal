import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { staff } from './api';
import { Alert } from './ui';
import VoteForm, { type VoteSubmit } from './VoteForm';
import { day } from './recordsLib';
import { useStaffData } from './useStaff';
import { EMPTY_DRAFT, outcomeLabel, meetingOption, rollSummary, type BodyOption, type Match, type MeetingRow, type MotionItem, type MotionsReply } from './votesLib';

type Pick = { date: string; body: string };

const same = (a: Pick | null, b: Pick | null) => Boolean(a && b && a.date === b.date && a.body === b.body);

function MotionRow({ m, roster, onChanged, onNotice, onError }: { m: MotionItem; roster: string[]; onChanged: () => void; onNotice: (s: string) => void; onError: (s: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const summary = rollSummary(m.votes);
  const people = [m.mover ? `Moved by ${m.mover}` : '', m.seconder ? `seconded by ${m.seconder}` : ''].filter(Boolean).join(', ');

  async function save(v: VoteSubmit) {
    await staff('/votes/save', {
      body: {
        id: m.id,
        item: v.item,
        motion: v.motion,
        mover: v.mover,
        seconder: v.seconder,
        result: v.result,
        votes: v.votes,
      },
    });
    setEditing(false);
    onNotice('Saved. The change is on the portal now.');
    onChanged();
  }

  async function remove() {
    onError('');
    try {
      await staff('/votes/remove', { body: { id: m.id } });
      onNotice('Removed. It is off the portal and will stay off when the minutes are read again. You can undo it from Activity.');
      onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not remove that.');
      setConfirm(false);
    }
  }

  return (
    <li className="vs-person" id={`vote-${m.id}`}>
      <div className="vs-row">
        <div className="vs-row-main">
          {m.item && <p className="vs-row-sub vs-mot-item">{m.item}</p>}
          <p className="vs-row-title vs-mot-text">{m.motion}</p>
          <p className="vs-row-sub">
            <span className="vs-badge" data-tone={m.result === 'carried' ? undefined : 'off'}>
              {outcomeLabel(m.result, m.tally)}
            </span>
            {m.manual && (
              <>
                {' '}
                <span className="vs-badge" data-tone="off">
                  Corrected by staff
                </span>
              </>
            )}
          </p>
          {people && <p className="vs-row-sub">{people}.</p>}
          {summary ? <p className="vs-row-sub">{summary}</p> : <p className="vs-row-sub">No roll call recorded.</p>}
        </div>
      </div>
      <div className="vs-actions">
        {m.documentId && (
          <Link className="vs-btn vs-btn-small vs-btn-quiet" to={`/documents/${m.documentId}${m.page ? `?page=${m.page}` : ''}`} target="_blank" rel="noopener">
            <ExternalLink size={14} aria-hidden="true" /> Minutes
          </Link>
        )}
        <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" onClick={() => setEditing(!editing)} aria-expanded={editing}>
          <Pencil size={14} aria-hidden="true" /> {editing ? 'Close' : 'Correct'}
        </button>
        {confirm ? (
          <>
            <button type="button" className="vs-btn vs-btn-small vs-btn-primary" onClick={remove}>
              Yes, remove it
            </button>
            <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" onClick={() => setConfirm(false)}>
              Keep it
            </button>
          </>
        ) : (
          <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" onClick={() => setConfirm(true)}>
            <Trash2 size={14} aria-hidden="true" /> Remove
          </button>
        )}
      </div>
      {confirm && <p className="vs-hint">This takes the vote off the portal, including each member's totals. It stays off when the minutes are read again.</p>}
      {editing && (
        <VoteForm
          draft={{
            item: m.item ?? '',
            motion: m.motion,
            mover: m.mover ?? '',
            seconder: m.seconder ?? '',
            result: m.result,
            votes: m.votes,
          }}
          roster={roster}
          submitLabel="Save"
          onSubmit={save}
          onCancel={() => setEditing(false)}
        />
      )}
    </li>
  );
}

function MeetingVotes({ pick, bodyName, onChanged, onNotice, onError }: { pick: Pick; bodyName: string; onChanged: () => void; onNotice: (s: string) => void; onError: (s: string) => void }) {
  const { data, error, reload } = useStaffData<MotionsReply>(`/votes/motions?date=${encodeURIComponent(pick.date)}&body=${encodeURIComponent(pick.body)}`);
  return (
    <div>
      <h2 className="vs-h2">
        {bodyName}, {day(pick.date)}
      </h2>
      <Alert>{error}</Alert>
      {data && data.motions.length === 0 && <p className="vs-empty">No votes are recorded for this meeting.</p>}
      {!data && !error && <p className="vs-empty">Loading</p>}
      <ul className="vs-list">
        {data?.motions.map((m) => (
          <MotionRow
            key={m.id}
            m={m}
            roster={data.roster}
            onNotice={onNotice}
            onError={onError}
            onChanged={() => {
              reload();
              onChanged();
            }}
          />
        ))}
      </ul>
    </div>
  );
}

/** Words typed in the search box, looked up after a short pause. */
function useMatches(q: string): Match[] | null {
  const [state, setState] = useState<{ q: string; matches: Match[] } | null>(null);
  useEffect(() => {
    if (q.length < 2) return;
    let live = true;
    const t = setTimeout(() => {
      staff<{ matches: Match[] }>(`/votes/meetings?q=${encodeURIComponent(q)}`).then(
        (r) => live && setState({ q, matches: r.matches }),
        () => live && setState({ q, matches: [] }),
      );
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);
  return q.length >= 2 && state?.q === q ? state.matches : null;
}

/** Votes: find a meeting, then correct a vote, add one the minutes missed, or take one down. */
export default function Votes() {
  const list = useStaffData<{ meetings: MeetingRow[]; bodies: BodyOption[] }>('/votes/meetings');
  const [chosen, setChosen] = useState<Pick | null>(null);
  const [adding, setAdding] = useState(false);
  const [rev, setRev] = useState(0);
  const [q, setQ] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const banner = useRef<HTMLParagraphElement>(null);
  const matches = useMatches(q.trim());

  const meetings = list.data?.meetings ?? [];
  const bodies = list.data?.bodies ?? [];
  // Until a meeting is chosen, show the newest one.
  const pick: Pick | null = chosen ?? (meetings[0] ? { date: meetings[0].date, body: meetings[0].body } : null);
  const bodyName = (id: string) => bodies.find((b) => b.id === id)?.name ?? id;
  const listed = pick ? meetings.some((m) => same(m, pick)) : true;

  useEffect(() => {
    if (notice) banner.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [notice]);

  return (
    <section className="vs-stack" aria-labelledby="vs-votes">
      <div>
        <h1 id="vs-votes" className="vs-title">
          Votes
        </h1>
        <p className="vs-lede">Correct how a vote was recorded, add one the minutes missed, or take one down. Changes show on the portal right away and are kept when the minutes are read again.</p>
      </div>

      {notice && (
        <p className="vs-ok" role="status" ref={banner}>
          {notice}
        </p>
      )}

      <div className="vs-card vs-stack">
        <div className="vs-field">
          <label htmlFor="vs-meeting">Meeting</label>
          <select
            id="vs-meeting"
            value={pick ? `${pick.date}|${pick.body}` : ''}
            onChange={(e) => {
              const [date, body] = e.target.value.split('|');
              setChosen({ date, body });
              setAdding(false);
              setNotice('');
              setError('');
            }}
            disabled={!list.data}
          >
            {pick && !listed && <option value={`${pick.date}|${pick.body}`}>{`${day(pick.date)} · ${bodyName(pick.body)}`}</option>}
            {meetings.map((m) => (
              <option key={`${m.date}|${m.body}`} value={`${m.date}|${m.body}`}>
                {meetingOption(m, bodies, day)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="vs-sr" htmlFor="vs-find">
            Find a vote by its wording
          </label>
          <div className="vs-search">
            <Search size={16} aria-hidden="true" />
            <input id="vs-find" type="search" placeholder="Or find a vote by its wording" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {matches && matches.length === 0 && <p className="vs-empty">Nothing matches that.</p>}
          {matches && matches.length > 0 && (
            <ul className="vs-list">
              {matches.map((m) => (
                <li key={m.id} className="vs-row">
                  <button
                    type="button"
                    className="vs-match"
                    onClick={() => {
                      setChosen({ date: m.date, body: m.body });
                      setQ('');
                      setAdding(false);
                    }}
                  >
                    <span className="vs-row-title">{m.item || m.motion}</span>
                    <span className="vs-row-sub">
                      {day(m.date)} · {bodyName(m.body)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="vs-actions">
          <button type="button" className="vs-btn vs-btn-quiet" onClick={() => {
              setAdding(!adding);
              setNotice('');
            }}
            aria-expanded={adding}
          >
            <Plus size={16} aria-hidden="true" /> {adding ? 'Close' : 'Add a vote'}
          </button>
        </div>
        {adding && (
          <VoteForm
            draft={EMPTY_DRAFT}
            roster={[]}
            bodies={bodies}
            meeting={pick ?? undefined}
            submitLabel="Add vote"
            onCancel={() => setAdding(false)}
            onSubmit={async (v: VoteSubmit) => {
              const r = await staff<{ date: string; body: string }>('/votes/add', { body: v });
              setChosen({ date: r.date, body: r.body });
              setAdding(false);
              setNotice('Added. It is on the portal now.');
              setRev((n) => n + 1);
              list.reload();
            }}
          />
        )}
      </div>

      <Alert>{error || list.error}</Alert>
      {list.data && meetings.length === 0 && <p className="vs-empty">No votes have been read yet.</p>}
      {pick && <MeetingVotes key={`${pick.date}|${pick.body}|${rev}`} pick={pick} bodyName={bodyName(pick.body)} onChanged={() => list.reload()} onNotice={setNotice} onError={setError} />}
    </section>
  );
}
