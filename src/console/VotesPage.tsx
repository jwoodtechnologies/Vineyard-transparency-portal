/**
 * Voting records, read like the minutes: one section per year (this year open), each meeting under
 * its date, and every motion with who moved and seconded it, how it ended, and each member's vote
 * by name. Filters narrow it to a member, body, vote or words in the motion.
 */
import './console.css';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronRight, FileText, MessageSquare, Search } from 'lucide-react';
import { Frame } from './Chrome';
import { useJson } from './api';
import { motionDetail, motionLabel, useMemberNames, type MotionRow, type VoteMember } from './votes';
import { usePeople } from './people';

const BODIES: Array<[string, string]> = [
  ['', 'Council and RDA'],
  ['city-council', 'City Council meetings'],
  ['redevelopment-agency', 'RDA board meetings'],
];

interface Attendance {
  meetings: Array<{ date: string; documentId: string; present: string[]; absent: string[] }>;
  roster: Array<{ name: string; role: string }>;
}

/** Planning Commission attendance this year: one row per commissioner, one mark per meeting. */
function AttendanceView({ a }: { a: Attendance }) {
  const seen = (name: string, list: string[]) => list.some((x) => x.toLowerCase() === name.toLowerCase() || x.toLowerCase() === (name.split(' ').pop() ?? '').toLowerCase());
  const meetings = [...a.meetings].sort((x, y) => x.date.localeCompare(y.date));
  const short = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  if (!meetings.length) return <p className="vc-mo-note">No Planning Commission minutes have been posted for this year yet.</p>;
  return (
    <section className="vc-att2">
      <p className="vc-coverage">From the {meetings.length} meetings this year with posted minutes.</p>
      <ul className="vc-att2-list">
        {a.roster.map((c) => {
          const here = meetings.filter((m) => seen(c.name, m.present)).length;
          return (
            <li key={c.name} className="vc-att2-row">
              <span className="vc-att2-who">
                <b>{c.name}</b>
                {c.role !== 'Commissioner' && <span>{c.role}</span>}
              </span>
              <span className="vc-att2-marks">
                {meetings.map((m) => {
                  const p = seen(c.name, m.present);
                  return (
                    <Link key={m.date} to={`/documents/${encodeURIComponent(m.documentId)}`} className="vc-att2-mark" data-here={p} title={`${short(m.date)}: ${p ? 'present' : 'not present'}`}>
                      <i aria-hidden="true">{p ? '✓' : '–'}</i>
                      {short(m.date)}
                    </Link>
                  );
                })}
              </span>
              <span className="vc-att2-total">
                {here} of {meetings.length}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
const VOTE_LABEL: Record<string, string> = { yes: 'Yes', no: 'No', abstain: 'Abstained', recused: 'Recused', absent: 'Absent' };
const ORDER: Record<string, number> = { yes: 0, no: 1, abstain: 2, recused: 3, absent: 4 };

const DAY = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00Z`) : null);
const fmt = (iso: string | null, o: Intl.DateTimeFormatOptions) => (DAY(iso) ? DAY(iso)!.toLocaleDateString('en-US', { ...o, timeZone: 'UTC' }) : '');
const last = (n: string) => n.split(' ').pop() ?? n;

/** One vote: what it was on, how it ended, and each member's vote. */
export function MotionCard({ m, member }: { m: MotionRow; member?: string | null }) {
  const nameOf = useMemberNames();
  const outcome = m.result === 'carried' ? 'Passed' : m.result === 'failed' ? 'Failed' : 'No result recorded';
  const roll = [...m.votes].filter((v) => v.vote !== 'absent').sort((a, b) => (ORDER[a.vote] ?? 9) - (ORDER[b.vote] ?? 9) || nameOf(a.member).name.localeCompare(nameOf(b.member).name));
  return (
    <li className="vc-vt">
      <div className="vc-vt-top">
        <span className="vc-vt-what">
          <p className="vc-vt-label">{motionLabel(m)}</p>
          {motionDetail(m) && <p className="vc-vt-detail">{motionDetail(m)}</p>}
          {m.refs.length > 0 && !/resolution|ordinance/i.test(motionLabel(m)) && <p className="vc-vt-detail">{m.refs.join(', ')}</p>}
        </span>
        <span className="vc-vt-result" data-result={m.result}>
          {outcome}
          {m.tally ? ` ${m.tally}` : ''}
        </span>
      </div>
      {(m.items?.length ?? 0) > 0 && (
        <ol className="vc-vt-items">
          {m.items!.map((it) => (
            <li key={it}>{it.replace(/^(\d+\.\d+)\s+/, '$1  ')}</li>
          ))}
        </ol>
      )}
      {roll.length > 0 && (
        <ul className="vc-vt-votes" aria-label="How each member voted">
          {roll.map((v) => (
            <li key={v.member} data-vote={v.vote} data-on={member && member === v.member ? 'true' : undefined} title={`${nameOf(v.member).name}: ${VOTE_LABEL[v.vote] ?? v.vote}`}>
              {last(nameOf(v.member).name)}
              <b>{v.vote === 'yes' ? 'Yes' : v.vote === 'no' ? 'No' : VOTE_LABEL[v.vote]}</b>
            </li>
          ))}
        </ul>
      )}
      {(m.mover || m.tieBreak) && (
        <p className="vc-vt-meta">
          {m.mover ? `Moved by ${last(nameOf(m.mover).name)}${m.seconder ? `, seconded by ${last(nameOf(m.seconder).name)}` : ''}` : ''}
          {m.tieBreak ? `${m.mover ? '. ' : ''}Mayor broke the tie` : ''}
        </p>
      )}
      <div className="vc-vt-actions">
        <Link to={`/documents/${encodeURIComponent(m.documentId)}${m.page ? `?page=${m.page}` : ''}`}>
          <FileText size={13} /> Minutes{m.page ? `, page ${m.page}` : ''}
        </Link>
        <Link to={`/?q=${encodeURIComponent(`What did the ${m.bodyId === 'redevelopment-agency' ? 'RDA board' : 'City Council'} approve on ${m.date ?? ''}: ${motionLabel(m) === 'Consent items' ? 'the consent items' : motionLabel(m)}? What does it do?`)}`}>
          <MessageSquare size={13} /> Ask about this
        </Link>
      </div>
    </li>
  );
}

/** A meeting as a card: its date, body and every vote taken, opening the meeting itself. */
function MeetingCard({ items, member, att }: { items: MotionRow[]; member: string | null; att?: { present: string[]; absent: string[] } | null }) {
  const m0 = items[0];
  const body = m0.bodyId === 'redevelopment-agency' ? 'RDA Board' : (m0.bodyName ?? 'Meeting');
  const to = m0.meetingId ? `/meetings/${encodeURIComponent(m0.meetingId)}` : `/documents/${encodeURIComponent(m0.documentId)}`;
  return (
    <article className="vc-mcard">
      <Link to={to} className="vc-mcard-head">
        <span className="vc-mcard-date">
          <span>{fmt(m0.date, { month: 'short' })}</span>
          <b>{fmt(m0.date, { day: 'numeric' })}</b>
        </span>
        <span className="vc-mcard-title">
          <span className="vc-mcard-body">{body}</span>
          <span className="vc-mcard-sub">
            {fmt(m0.date, { weekday: 'long' })} · {items.length} {items.length === 1 ? 'vote' : 'votes'}
            {att ? ` · ${att.present.length} present` : ''}
          </span>
        </span>
        <ChevronRight size={18} className="vc-mcard-go" />
      </Link>
      <ol className="vc-vts">
        {items.map((m) => (
          <MotionCard key={m.id} m={m} member={member} />
        ))}
      </ol>
    </article>
  );
}

interface HeldMeeting {
  id: string;
  date: string | null;
  title: string;
  status?: string;
  minutesDocumentId: string | null;
}

function YearSection({ year, query, open, onToggle, member, attendance, bodies, plain }: { year: number; query: string; open: boolean; onToggle: () => void; member: string | null; attendance: Attendance | null; bodies: string[]; plain: boolean }) {
  const list = useJson<{ items: MotionRow[]; total: number }>(open ? `/api/votes?scope=current&${query}${query ? '&' : ''}year=${year}&pageSize=400` : null);
  const m1 = useJson<{ items: HeldMeeting[] }>(open && plain ? `/api/meetings?body=${bodies[0]}&year=${year}&pageSize=100` : null);
  const m2 = useJson<{ items: HeldMeeting[] }>(open && plain && bodies[1] ? `/api/meetings?body=${bodies[1]}&year=${year}&pageSize=100` : null);
  const [today] = useState(() => new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10));
  // Meetings already held whose minutes the city has not posted: shown so the newest meeting is never missing.
  const waiting = useMemo(() => {
    const all = [...(m1.status === 'done' ? m1.data.items : []), ...(m2.status === 'done' ? m2.data.items : [])];
    return all.filter((m) => m.date && m.date.slice(0, 10) <= today && !m.minutesDocumentId && !/cancel/i.test(`${m.title} ${m.status ?? ''}`) && !/work (meeting|session)/i.test(m.title));
  }, [m1, m2, today]);
  const groups = useMemo(() => {
    if (list.status !== 'done') return [];
    const by = new Map<string, MotionRow[]>();
    for (const m of list.data.items) {
      const k = `${m.date ?? ''}|${m.bodyId ?? ''}`;
      (by.get(k) ?? by.set(k, []).get(k)!).push(m);
    }
    return [...by.entries()];
  }, [list]);
  return (
    <section className="vc-year">
      <button type="button" className="vc-year-head" onClick={onToggle} aria-expanded={open}>
        <span className="vc-year-num">{year}</span>
        <ChevronDown size={18} className="vc-board-chev" data-open={open} />
      </button>
      {open && list.status === 'loading' && (
        <div className="vc-skeleton" aria-hidden="true">
          <span style={{ width: '90%' }} />
          <span style={{ width: '70%' }} />
        </div>
      )}
      {open && list.status === 'error' && <p className="vc-mo-note">This year could not load just now.</p>}
      {open && list.status === 'done' && !groups.length && !waiting.length && <p className="vc-mo-note">No votes match.</p>}
      {open && (
        <div className="vc-mcards">
          {[...groups.map(([k, items]) => ({ k, date: items[0].date ?? '', items, wait: null as HeldMeeting | null })), ...waiting.map((w) => ({ k: w.id, date: (w.date ?? '').slice(0, 10), items: [] as MotionRow[], wait: w }))]
            .sort((a, b) => b.date.localeCompare(a.date))
            .map((g) =>
              g.wait ? (
                <Link key={g.k} to={`/meetings/${encodeURIComponent(g.wait.id)}`} className="vc-mcard vc-mcard-head vc-mcard-wait">
                  <span className="vc-mcard-date">
                    <span>{fmt(g.date, { month: 'short' })}</span>
                    <b>{fmt(g.date, { day: 'numeric' })}</b>
                  </span>
                  <span className="vc-mcard-title">
                    <span className="vc-mcard-body">{g.wait.title.replace(/^Special /, 'Special ')}</span>
                    <span className="vc-mcard-sub">Minutes not posted yet. Votes appear once the city posts them.</span>
                  </span>
                  <ChevronRight size={18} className="vc-mcard-go" />
                </Link>
              ) : (
                <MeetingCard key={g.k} items={g.items} member={member} att={attendance?.meetings.find((x) => x.date === g.items[0].date) ?? null} />
              ),
            )}
        </div>
      )}
    </section>
  );
}

/** How many of this year's meetings have minutes posted (votes come only from posted minutes). */
function Coverage({ bodies }: { bodies: string[] }) {
  const [today] = useState(() => new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10));
  const y = Number(today.slice(0, 4));
  const a = useJson<{ items: Array<{ date: string | null; title: string; status?: string; minutesDocumentId: string | null }> }>(`/api/meetings?body=${bodies[0]}&year=${y}&pageSize=100`);
  const b = useJson<{ items: Array<{ date: string | null; title: string; status?: string; minutesDocumentId: string | null }> }>(bodies[1] ? `/api/meetings?body=${bodies[1]}&year=${y}&pageSize=100` : null);
  if (a.status !== 'done' || (bodies[1] && b.status !== 'done')) return null;
  const all = [...a.data.items, ...(b.status === 'done' ? b.data.items : [])].filter((m) => m.date && m.date.slice(0, 10) <= today && !/cancel/i.test(`${m.title} ${m.status ?? ''}`));
  const posted = all.filter((m) => m.minutesDocumentId).length;
  return (
    <p className="vc-coverage">
      {all.length} {all.length === 1 ? 'meeting' : 'meetings'} held so far in {y}; the city has posted minutes for {posted}. Votes appear here once a meeting&apos;s minutes are posted.
    </p>
  );
}

/** The council's voting record, or (commission) the Planning Commission's own page. */
export function VotesView({ commission = false }: { commission?: boolean }) {
  const [params, setParams] = useSearchParams();
  const askedMember = params.get('member') ?? '';
  const asked = params.get('body') ?? '';
  const body = commission ? 'planning-commission' : ['city-council', 'redevelopment-agency'].includes(asked) ? asked : '';
  const q = params.get('q') ?? '';
  const result = params.get('result') ?? '';
  const vote = params.get('vote') ?? '';
  const view = params.get('view') ?? '';
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  const people = usePeople();
  // Only the officials serving now: the mayor and City Council (or, on the commission page, its members).
  const council = useMemo(() => new Set(people.filter((p) => p.current && p.kind === 'elected').map((p) => p.name.toLowerCase())), [people]);
  const member = commission || council.has(askedMember.toLowerCase()) ? askedMember : '';
  const query = useMemo(() => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ member, body, q, result, vote })) if (v) u.set(k, v);
    return u.toString();
  }, [member, body, q, result, vote]);
  const yearsQ = new URLSearchParams(Object.entries({ member, body }).filter(([, v]) => v)).toString();
  const years = useJson<{ years: Array<{ year: number; motions: number; meetings: number }> }>(`/api/votes/years?scope=current${yearsQ ? `&${yearsQ}` : ''}`);
  const members = useJson<{ members: VoteMember[] }>(`/api/votes/members?scope=current${body ? `&body=${body}` : ''}`);
  const attendance = useJson<Attendance>(body === 'planning-commission' ? '/api/votes/attendance' : null);
  const att = attendance.status === 'done' ? attendance.data : null;
  const nameOf = useMemberNames();
  const memberList = (members.status === 'done' ? members.data.members : []).filter((m) => commission || council.has(m.member.toLowerCase()));
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const yearList = years.status === 'done' ? years.data.years : [];
  const isOpen = (y: number, i: number) => open[y] ?? i === 0;

  return (
    <Frame>
      <header className="vc-page-head">
        <h1 className="vc-page-title">{commission ? 'Planning Commission' : 'Voting records'}</h1>
        <p className="vc-page-sub">
          {commission
            ? 'The current commissioners, their attendance and every motion they have voted on since January 2026, from the commission’s minutes.'
            : 'How the current City Council has voted since January 2026, meeting by meeting, newest first. Includes the council’s votes as the Redevelopment Agency (RDA) board.'}
        </p>
      </header>

      <div className="vc-vfilters" hidden={view === 'attendance'}>
        <label className="vc-vfilter-search">
          <Search size={15} />
          <input type="search" placeholder="Search motions" defaultValue={q} onKeyDown={(e) => e.key === 'Enter' && set('q', (e.target as HTMLInputElement).value.trim())} onBlur={(e) => e.target.value.trim() !== q && set('q', e.target.value.trim())} />
        </label>
        <select value={member} onChange={(e) => set('member', e.target.value)} aria-label="Member">
          <option value="">{body === 'planning-commission' ? 'Whole commission' : 'Whole council'}</option>
          {memberList.map((m) => (
            <option key={m.member} value={m.member}>
              {nameOf(m.member, m.fullName).name}
            </option>
          ))}
        </select>
        {!commission && (
          <select value={body} onChange={(e) => set('body', e.target.value)} aria-label="Body">
            {BODIES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        )}
        {member ? (
          <select value={vote} onChange={(e) => set('vote', e.target.value)} aria-label="Their vote">
            <option value="">Any vote</option>
            <option value="yes">Voted yes</option>
            <option value="no">Voted no</option>
            <option value="abstain">Abstained</option>
          </select>
        ) : (
          <select value={result} onChange={(e) => set('result', e.target.value)} aria-label="Result">
            <option value="">Any result</option>
            <option value="carried">Passed</option>
            <option value="failed">Failed</option>
          </select>
        )}
      </div>


      {view !== 'attendance' && <Coverage bodies={commission ? ['planning-commission'] : body ? [body] : ['city-council', 'redevelopment-agency']} />}
      {commission && (
        <div className="vc-segment vc-tabs" role="tablist" aria-label="View">
          <button type="button" role="tab" aria-selected={view !== 'attendance'} data-on={view !== 'attendance'} onClick={() => set('view', '')}>
            Votes
          </button>
          <button type="button" role="tab" aria-selected={view === 'attendance'} data-on={view === 'attendance'} onClick={() => set('view', 'attendance')}>
            Attendance
          </button>
        </div>
      )}
      {commission && view === 'attendance' && att && <AttendanceView a={att} />}

      {years.status === 'loading' && (
        <div className="vc-skeleton" aria-hidden="true">
          <span style={{ width: '60%' }} />
        </div>
      )}
      {view !== 'attendance' && years.status === 'done' && !yearList.length && <p className="vc-mo-note">No motions match.</p>}
      {view !== 'attendance' && yearList.map((y, i) => (
        <YearSection key={y.year} year={y.year} bodies={commission ? ['planning-commission'] : body ? [body] : ['city-council', 'redevelopment-agency']} plain={!q && !member && !result && !vote} query={query} member={member || null} attendance={att} open={isOpen(y.year, i)} onToggle={() => setOpen((o) => ({ ...o, [y.year]: !isOpen(y.year, i) }))} />
      ))}
      <p className="vc-person-asof">From each meeting&apos;s posted minutes. Routine motions (approving minutes or the agenda, adjourning, closed sessions, opening hearings) are left out. Tap a meeting to open its agenda, minutes and video.</p>
    </Frame>
  );
}

export default function VotesPage() {
  return <VotesView />;
}
