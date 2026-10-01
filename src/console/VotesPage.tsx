/**
 * Voting records, read like the minutes: one section per year (this year open), each meeting under
 * its date, and every motion with who moved and seconded it, how it ended, and each member's vote
 * by name. Filters narrow it to a member, body, vote or words in the motion.
 */
import './console.css';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronDown, Search } from 'lucide-react';
import { Frame } from './Chrome';
import { useJson } from './api';
import { useMemberNames, type MotionRow, type VoteMember } from './votes';

const BODIES: Array<[string, string]> = [
  ['', 'Council and RDA'],
  ['city-council', 'City Council meetings'],
  ['redevelopment-agency', 'RDA board meetings'],
];
const VOTE_LABEL: Record<string, string> = { yes: 'Yes', no: 'No', abstain: 'Abstained', recused: 'Recused', absent: 'Absent' };
const ORDER: Record<string, number> = { yes: 0, no: 1, abstain: 2, recused: 3, absent: 4 };

const longDate = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : 'Date not recorded');

/** One motion as the minutes record it, with the full roll call by name. */
export function MotionCard({ m, member }: { m: MotionRow; member?: string | null }) {
  const nameOf = useMemberNames();
  const outcome = m.result === 'carried' ? 'Passed' : m.result === 'failed' ? 'Failed' : 'Outcome not recorded';
  const who = [m.mover ? `Moved by ${nameOf(m.mover).name}` : null, m.seconder ? `seconded by ${nameOf(m.seconder).name}` : null].filter(Boolean).join(', ');
  const roll = [...m.votes].sort((a, b) => (ORDER[a.vote] ?? 9) - (ORDER[b.vote] ?? 9) || nameOf(a.member).name.localeCompare(nameOf(b.member).name));
  return (
    <li className="vc-mo">
      {m.item && <p className="vc-mo-item">{m.item}</p>}
      <p className="vc-mo-text">Motion to {m.motion.replace(/^to\s+/i, '')}</p>
      <p className="vc-mo-line">
        {who ? `${who}. ` : ''}
        <span className="vc-mo-result" data-result={m.result}>
          {outcome}
          {m.tally ? ` ${m.tally}` : ''}
        </span>
        {m.tieBreak ? '. The mayor broke a tie.' : '.'}
      </p>
      {roll.length > 0 && (
        <ul className="vc-roll" aria-label="Roll call">
          {roll.map((v) => (
            <li key={v.member} data-on={member && member === v.member ? 'true' : undefined}>
              <span>{nameOf(v.member).name}</span>
              <b data-vote={v.vote}>{VOTE_LABEL[v.vote] ?? v.vote}</b>
            </li>
          ))}
        </ul>
      )}
      {m.inferred && <p className="vc-mo-note">The minutes say all were in favor; the names are the members the minutes list as present.</p>}
      <Link to={`/documents/${encodeURIComponent(m.documentId)}${m.page ? `?page=${m.page}` : ''}`} className="vc-mo-src">
        Minutes{m.page ? `, page ${m.page}` : ''}
      </Link>
    </li>
  );
}

function YearSection({ year, motions, meetings, query, open, onToggle, member }: { year: number; motions: number; meetings: number; query: string; open: boolean; onToggle: () => void; member: string | null }) {
  const list = useJson<{ items: MotionRow[]; total: number }>(open ? `/api/votes?${query}${query ? '&' : ''}year=${year}&pageSize=400` : null);
  const groups = useMemo(() => {
    if (list.status !== 'done') return [];
    const by = new Map<string, MotionRow[]>();
    for (const m of list.data.items) {
      const k = `${m.date ?? ''}|${m.bodyName ?? ''}`;
      (by.get(k) ?? by.set(k, []).get(k)!).push(m);
    }
    return [...by.entries()];
  }, [list]);
  return (
    <section className="vc-year">
      <button type="button" className="vc-year-head" onClick={onToggle} aria-expanded={open}>
        <span className="vc-year-num">{year}</span>
        <span className="vc-year-sub">
          {motions.toLocaleString()} {motions === 1 ? 'motion' : 'motions'} at {meetings} {meetings === 1 ? 'meeting' : 'meetings'}
        </span>
        <ChevronDown size={18} className="vc-board-chev" data-open={open} />
      </button>
      {open && list.status === 'loading' && (
        <div className="vc-skeleton" aria-hidden="true">
          <span style={{ width: '90%' }} />
          <span style={{ width: '70%' }} />
        </div>
      )}
      {open && list.status === 'error' && <p className="vc-mo-note">This year could not load just now.</p>}
      {open &&
        groups.map(([k, items]) => (
          <div key={k} className="vc-meet">
            <h3 className="vc-meet-head">
              {longDate(items[0].date)}
              <span>{items[0].bodyName}</span>
            </h3>
            <ol className="vc-mos">
              {items.map((m) => (
                <MotionCard key={m.id} m={m} member={member} />
              ))}
            </ol>
          </div>
        ))}
    </section>
  );
}

export default function VotesPage() {
  const [params, setParams] = useSearchParams();
  const member = params.get('member') ?? '';
  const body = params.get('body') ?? '';
  const q = params.get('q') ?? '';
  const result = params.get('result') ?? '';
  const vote = params.get('vote') ?? '';
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  const query = useMemo(() => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ member, body, q, result, vote })) if (v) u.set(k, v);
    return u.toString();
  }, [member, body, q, result, vote]);
  const yearsQ = new URLSearchParams(Object.entries({ member, body }).filter(([, v]) => v)).toString();
  const years = useJson<{ years: Array<{ year: number; motions: number; meetings: number }> }>(`/api/votes/years${yearsQ ? `?${yearsQ}` : ''}`);
  const members = useJson<{ members: VoteMember[] }>(`/api/votes/members${body ? `?body=${body}` : ''}`);
  const nameOf = useMemberNames();
  const memberList = members.status === 'done' ? members.data.members : [];
  const chosen = memberList.find((m) => m.member === member) ?? null;
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const yearList = years.status === 'done' ? years.data.years : [];
  const isOpen = (y: number, i: number) => open[y] ?? i === 0;

  return (
    <Frame>
      <header className="vc-page-head">
        <h1 className="vc-page-title">Voting records</h1>
        <p className="vc-page-sub">How the current mayor and City Council have voted since their term began in January 2026: every motion in the minutes, by meeting, with each member&apos;s vote. The council also sits as the Redevelopment Agency (RDA) board.</p>
      </header>

      <div className="vc-vfilters">
        <label className="vc-vfilter-search">
          <Search size={15} />
          <input type="search" placeholder="Search motions" defaultValue={q} onKeyDown={(e) => e.key === 'Enter' && set('q', (e.target as HTMLInputElement).value.trim())} onBlur={(e) => e.target.value.trim() !== q && set('q', e.target.value.trim())} />
        </label>
        <select value={member} onChange={(e) => set('member', e.target.value)} aria-label="Member">
          <option value="">Whole council</option>
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
        {member ? (
          <select value={vote} onChange={(e) => set('vote', e.target.value)} aria-label="Their vote">
            <option value="">Any vote</option>
            <option value="yes">Voted yes</option>
            <option value="no">Voted no</option>
            <option value="abstain">Abstained</option>
            <option value="absent">Absent</option>
          </select>
        ) : (
          <select value={result} onChange={(e) => set('result', e.target.value)} aria-label="Result">
            <option value="">Any result</option>
            <option value="carried">Passed</option>
            <option value="failed">Failed</option>
          </select>
        )}
      </div>

      {chosen && (
        <p className="vc-vsummary">
          <strong>{nameOf(chosen.member, chosen.fullName).name}</strong>: {chosen.yes} yes, {chosen.no} no, {chosen.abstain + chosen.recused} abstained or recused, absent {chosen.absent} times; moved {chosen.moved} and seconded {chosen.seconded} motions
          {chosen.firstDate && chosen.lastDate ? `, ${chosen.firstDate.slice(0, 4)} to ${chosen.lastDate.slice(0, 4)}` : ''}.
        </p>
      )}

      {years.status === 'loading' && (
        <div className="vc-skeleton" aria-hidden="true">
          <span style={{ width: '60%' }} />
        </div>
      )}
      {years.status === 'done' && !yearList.length && <p className="vc-mo-note">No motions match.</p>}
      {yearList.map((y, i) => (
        <YearSection key={y.year} year={y.year} motions={y.motions} meetings={y.meetings} query={query} member={member || null} open={isOpen(y.year, i)} onToggle={() => setOpen((o) => ({ ...o, [y.year]: !isOpen(y.year, i) }))} />
      ))}
      <p className="vc-person-asof">Read from each meeting&apos;s approved minutes (a draft only until the approved minutes are posted). Every motion links to the page of the minutes it comes from.</p>
    </Frame>
  );
}
