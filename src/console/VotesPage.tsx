/**
 * Voting records: every motion the archive's minutes record, who moved and seconded it, how it
 * ended and how each member voted. Filter by member, body, year, result or words in the motion.
 */
import './console.css';
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FileText, Search } from 'lucide-react';
import { Frame } from './Chrome';
import { useJson } from './api';
import { formatDate } from './format';
import { useMemberNames, type MotionRow, type VoteMember, type VoteRow } from './votes';

const BODIES: Array<[string, string]> = [
  ['', 'All bodies'],
  ['city-council', 'City Council'],
  ['redevelopment-agency', 'Redevelopment Agency'],
  ['planning-commission', 'Planning Commission'],
];
const VOTE_LABEL: Record<string, string> = { yes: 'Yes', no: 'No', abstain: 'Abstained', recused: 'Recused', absent: 'Absent' };
const THIS_YEAR = new Date().getFullYear();

export function VoteChips({ votes, highlight }: { votes: VoteRow[]; highlight?: string | null }) {
  const nameOf = useMemberNames();
  return (
    <div className="vc-vote-chips">
      {votes.map((v) => (
        <span key={v.member} className="vc-vote-chip" data-vote={v.vote} data-on={highlight && highlight === v.member ? 'true' : undefined} title={`${nameOf(v.member).name}: ${VOTE_LABEL[v.vote] ?? v.vote}`}>
          {nameOf(v.member).short} <b>{VOTE_LABEL[v.vote] ?? v.vote}</b>
        </span>
      ))}
    </div>
  );
}

export function MotionCard({ m, member }: { m: MotionRow; member?: string | null }) {
  const outcome = m.result === 'carried' ? 'Passed' : m.result === 'failed' ? 'Failed' : 'Outcome not recorded';
  return (
    <article className="vc-motion">
      <div className="vc-motion-head">
        <span className="vc-motion-result" data-result={m.result}>
          {outcome}
          {m.tally ? ` ${m.tally}` : ''}
          {m.tieBreak ? ', mayor broke the tie' : ''}
        </span>
        <span className="vc-motion-meta">
          {m.bodyName}
          {m.date ? ` · ${formatDate(m.date)}` : ''}
        </span>
      </div>
      {m.item && <p className="vc-motion-item">{m.item}</p>}
      <p className="vc-motion-text">Motion to {m.motion.replace(/^to\s+/i, '')}</p>
      <p className="vc-motion-who">
        {m.mover ? `Moved by ${m.mover}` : 'Mover not recorded'}
        {m.seconder ? `, seconded by ${m.seconder}` : ''}
      </p>
      {m.votes.length > 0 && <VoteChips votes={m.votes} highlight={member} />}
      {m.inferred && <p className="vc-motion-note">The minutes record this as passing with all in favor; the yes votes are the members the minutes list as present.</p>}
      <Link to={`/documents/${encodeURIComponent(m.documentId)}${m.page ? `?page=${m.page}` : ''}`} className="vc-motion-src">
        <FileText size={13} /> Minutes{m.page ? `, page ${m.page}` : ''}
      </Link>
    </article>
  );
}

function MemberSummary({ m }: { m: VoteMember }) {
  const nameOf = useMemberNames();
  const { name, person } = nameOf(m.member, m.fullName);
  const cast = m.yes + m.no + m.abstain;
  return (
    <section className="vc-vote-summary">
      <div>
        <p className="vc-vote-summary-name">{person ? <Link to={`/people/${person.slug}`}>{name}</Link> : name}</p>
        <p className="vc-vote-summary-sub">
          {m.firstDate && m.lastDate ? `Votes on record ${m.firstDate.slice(0, 4)} to ${m.lastDate.slice(0, 4)}` : 'Votes on record'}
        </p>
      </div>
      <dl className="vc-vote-stats">
        <div>
          <dt>Yes</dt>
          <dd>{m.yes}</dd>
        </div>
        <div>
          <dt>No</dt>
          <dd>{m.no}</dd>
        </div>
        <div>
          <dt>Abstained</dt>
          <dd>{m.abstain + m.recused}</dd>
        </div>
        <div>
          <dt>Absent</dt>
          <dd>{m.absent}</dd>
        </div>
        <div>
          <dt>Moved</dt>
          <dd>{m.moved}</dd>
        </div>
        <div>
          <dt>Seconded</dt>
          <dd>{m.seconded}</dd>
        </div>
      </dl>
      {cast > 0 && <p className="vc-vote-summary-sub">Voted no on {Math.round((m.no / cast) * 100)}% of the motions they voted on.</p>}
    </section>
  );
}

export default function VotesPage() {
  const [params, setParams] = useSearchParams();
  const member = params.get('member') ?? '';
  const body = params.get('body') ?? '';
  const year = params.get('year') ?? '';
  const q = params.get('q') ?? '';
  const result = params.get('result') ?? '';
  const vote = params.get('vote') ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };
  const qs = useMemo(() => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ member, body, year, q, result, vote, page: page > 1 ? String(page) : '' })) if (v) u.set(k, v);
    return u.toString();
  }, [member, body, year, q, result, vote, page]);
  const list = useJson<{ items: MotionRow[]; total: number }>(`/api/votes?${qs}`);
  const members = useJson<{ members: VoteMember[] }>(`/api/votes/members${body || year ? `?${new URLSearchParams({ ...(body ? { body } : {}), ...(year ? { year } : {}) })}` : ''}`);
  const nameOf = useMemberNames();
  const memberList = members.status === 'done' ? members.data.members : [];
  const chosen = memberList.find((m) => m.member === member) ?? null;
  const years = Array.from({ length: THIS_YEAR - 2006 }, (_, i) => String(THIS_YEAR - i));

  return (
    <Frame>
      <header className="vc-page-head">
        <h1 className="vc-page-title">Voting records</h1>
        <p className="vc-page-sub">Every motion in the minutes of the City Council, Redevelopment Agency and Planning Commission: who moved it, who seconded it, how it ended and how each member voted.</p>
      </header>

      <div className="vc-vote-filters">
        <label className="vc-vote-search">
          <Search size={15} />
          <input type="search" placeholder="Search motions: budget, rezone, Resolution 2026-34..." defaultValue={q} onKeyDown={(e) => e.key === 'Enter' && set('q', (e.target as HTMLInputElement).value.trim())} onBlur={(e) => e.target.value.trim() !== q && set('q', e.target.value.trim())} />
        </label>
        <select value={member} onChange={(e) => set('member', e.target.value)} aria-label="Member">
          <option value="">All members</option>
          {memberList.map((m) => (
            <option key={m.member} value={m.member}>
              {nameOf(m.member, m.fullName).name}
            </option>
          ))}
        </select>
        <select value={body} onChange={(e) => set('body', e.target.value)} aria-label="Body">
          {BODIES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select value={year} onChange={(e) => set('year', e.target.value)} aria-label="Year">
          <option value="">All years</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <select value={member ? vote : result} onChange={(e) => (member ? set('vote', e.target.value) : set('result', e.target.value))} aria-label={member ? 'Their vote' : 'Result'}>
          {member ? (
            <>
              <option value="">Any vote</option>
              <option value="yes">Voted yes</option>
              <option value="no">Voted no</option>
              <option value="abstain">Abstained</option>
              <option value="absent">Absent</option>
            </>
          ) : (
            <>
              <option value="">Any result</option>
              <option value="carried">Passed</option>
              <option value="failed">Failed</option>
            </>
          )}
        </select>
      </div>

      {chosen && <MemberSummary m={chosen} />}

      {list.status === 'loading' && (
        <div className="vc-skeleton" aria-hidden="true">
          <span style={{ width: '92%' }} />
          <span style={{ width: '80%' }} />
        </div>
      )}
      {list.status === 'error' && <div className="vc-empty">Voting records could not load just now.</div>}
      {list.status === 'done' && (
        <>
          <p className="vc-vote-count">{list.data.total ? `${list.data.total.toLocaleString()} motions` : 'No motions match.'}</p>
          <div className="vc-motions">
            {list.data.items.map((m) => (
              <MotionCard key={m.id} m={m} member={member || null} />
            ))}
          </div>
          {list.data.total > page * 30 && (
            <button type="button" className="vc-ghost vc-series-more" onClick={() => set('page', String(page + 1))}>
              Older motions
            </button>
          )}
          {page > 1 && (
            <button type="button" className="vc-ghost vc-series-more" onClick={() => set('page', String(page - 1))}>
              Newer motions
            </button>
          )}
        </>
      )}
      <p className="vc-person-asof">Read from each meeting's approved minutes (drafts only until the approved minutes are posted). Every motion links to the page of the minutes it comes from.</p>
    </Frame>
  );
}
