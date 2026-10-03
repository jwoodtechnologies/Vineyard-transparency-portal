/**
 * Voting records as a chart, like a spreadsheet: one row for each thing the council or commission decided,
 * with the date, how it ended, and a column for every member. Selecting a row opens the motion and each vote.
 */
import './console.css';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Check, ChevronDown, ChevronRight, FileText, X } from 'lucide-react';
import { DocLink } from './DocLink';
import { Frame } from './Chrome';
import { useJson } from './api';
import {
  mergeRows,
  motionDetail,
  motionLabel,
  motionTally,
  pendingRows,
  sheetRows,
  STATUS_WORD,
  useMemberNames,
  type MeetingLite,
  type MinutesRead,
  type MotionRow,
  type SheetRow,
} from './votes';
import { usePeople } from './people';

interface Attendance {
  meetings: Array<{
    date: string;
    documentId: string;
    present: string[];
    absent: string[];
  }>;
  roster: Array<{ name: string; role: string }>;
}

/** Planning Commission attendance this year: one row per commissioner, one mark per meeting. */
function AttendanceView({ a }: { a: Attendance }) {
  const seen = (name: string, list: string[]) => list.some((x) => x.toLowerCase() === name.toLowerCase() || x.toLowerCase() === (name.split(' ').pop() ?? '').toLowerCase());
  const meetings = [...a.meetings].sort((x, y) => x.date.localeCompare(y.date));
  const short = (d: string) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
  if (!meetings.length) return <p className="vc-mo-note">No Planning Commission minutes have been posted for this year yet.</p>;
  return (
    <section className="vc-att2">
      <p className="vc-coverage">{meetings.length} meetings with posted minutes this year</p>
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
                    <DocLink
                      key={m.date}
                      id={m.documentId}
                      className="vc-att2-mark"
                      data-here={p}
                      title={`${short(m.date)}: ${p ? 'present' : 'not present'}. Opens the minutes (PDF)`}
                    >
                      <i aria-hidden="true">{p ? '✓' : '–'}</i>
                      {short(m.date)}
                    </DocLink>
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
const VOTE_LABEL: Record<string, string> = {
  yes: 'Yes',
  no: 'No',
  abstain: 'Abstained',
  recused: 'Recused',
  absent: 'Absent',
};
const ORDER: Record<string, number> = {
  yes: 0,
  no: 1,
  abstain: 2,
  recused: 3,
  absent: 4,
};

const DAY = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00Z`) : null);
const fmt = (iso: string | null, o: Intl.DateTimeFormatOptions) => (DAY(iso) ? DAY(iso)!.toLocaleDateString('en-US', { ...o, timeZone: 'UTC' }) : '');
const last = (n: string) => n.split(' ').pop() ?? n;
const cap = (n: string) => {
  const t = n.charAt(0).toUpperCase() + n.slice(1);
  return n === n.toLowerCase() ? t.replace(/^Mc([a-z])/, (_, c: string) => `Mc${c.toUpperCase()}`) : t;
};
/** What the body calls the people who vote in it. */
const seat = (bodyId: string | null) => (bodyId === 'planning-commission' ? 'Commissioner' : bodyId === 'redevelopment-agency' ? 'Board Member' : 'Council Member');

/** One vote: what it was on, how it ended, and each member's vote. */
export function MotionCard({ m, member }: { m: MotionRow; member?: string | null }) {
  const nameOf = useMemberNames();
  const outcome = m.result === 'carried' ? 'Passed' : m.result === 'failed' ? 'Failed' : 'No result recorded';
  const roll = [...m.votes]
    .filter((v) => v.vote !== 'absent')
    .sort((a, b) => (ORDER[a.vote] ?? 9) - (ORDER[b.vote] ?? 9) || nameOf(a.member).name.localeCompare(nameOf(b.member).name));
  // No names in the minutes ("passed unanimously"): the badge says so in place of the member tags.
  const unanimous = m.result === 'carried' && m.unanimous && roll.length === 0;
  const surname = (id: string) => cap(last(nameOf(id).name));
  const titled = (id: string) => `${/^mayor$/i.test(nameOf(id).person?.role ?? '') ? 'Mayor' : seat(m.bodyId)} ${surname(id)}`;
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
          {motionTally(m) ? ` ${motionTally(m)}` : ''}
        </span>
      </div>
      {(m.items?.length ?? 0) > 0 && (
        <ol className="vc-vt-items">
          {m.items!.map((it) => (
            <li key={it}>{it.replace(/^(\d+\.\d+)\s+/, '$1  ')}</li>
          ))}
        </ol>
      )}
      {(roll.length > 0 || unanimous) && (
        <ul className="vc-vt-tags" aria-label="How each member voted">
          {unanimous && (
            <li data-badge="unanimous">
              <b>Unanimous</b>
            </li>
          )}
          {roll.map((v) => (
            <li key={v.member} data-vote={v.vote} data-on={member && member === v.member ? 'true' : undefined} title={`${titled(v.member)}: ${VOTE_LABEL[v.vote] ?? v.vote}`}>
              <span>{/^mayor$/i.test(nameOf(v.member).person?.role ?? '') ? `Mayor ${surname(v.member)}` : surname(v.member)}</span>
              <b>{VOTE_LABEL[v.vote] ?? v.vote}</b>
            </li>
          ))}
        </ul>
      )}
      <div className="vc-vt-foot">
        {m.tieBreak && <span className="vc-vt-meta">Mayor broke the tie</span>}
        <DocLink id={m.documentId} page={m.page} className="vc-vt-min">
          <FileText size={12} /> Minutes{m.page ? ` p. ${m.page}` : ''}
        </DocLink>
      </div>
    </li>
  );
}

/** What the marks in the chart mean. */
function Key() {
  return (
    <p className="vc-sh-key" aria-label="Key to the marks">
      <span>
        <Check size={14} strokeWidth={2.8} /> Yes
      </span>
      <span>
        <X size={14} strokeWidth={2.8} /> No
      </span>
      <span>
        <i>A</i> Abstained
      </span>
      <span>
        <i>R</i> Recused
      </span>
      <span>
        <i data-absent="true" /> Absent
      </span>
    </p>
  );
}

const lower = (n: string) => n.toLowerCase();
/** A vote belongs to a member when the minutes print their full name, or only their last name. */
const sameMember = (voter: string, name: string) => lower(voter) === lower(name) || (!voter.includes(' ') && lower(voter) === lower(last(name)));
const surname = (n: string) => cap(last(n));

/** The year's votes as one chart: what was decided, the date and how it ended on the left, then a column for each member who sits now (the council) or who voted (the commission). */
function VoteSheet({ rows, member, council, mayor, showBody }: { rows: SheetRow[]; member: string | null; council: string[] | null; mayor: string | null; showBody: boolean }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  // Everyone serving now has a column, whether or not they have voted yet (the mayor votes only to break a tie). A member who has left has none.
  const cols = useMemo(() => {
    if (council) return council;
    const all = [...new Set(rows.flatMap((r) => r.m.votes.map((v) => v.member)))];
    return all.filter((n) => n.includes(' ') || !all.some((o) => o !== n && o.includes(' ') && lower(last(o)) === lower(n))).sort((a, b) => surname(a).localeCompare(surname(b)));
  }, [council, rows]);
  const voteOf = (m: MotionRow, name: string) => m.votes.find((v) => sameMember(v.member, name))?.vote ?? 'none';
  const isOn = (name: string) => member !== null && member !== '' && sameMember(member, name);
  const isMayor = (name: string) => mayor !== null && lower(name) === lower(mayor);
  const span = cols.length + 3;
  return (
    <div className="vc-shw">
      <div className="vc-sh" data-many={cols.length >= 7 ? 'true' : undefined}>
        <table className="vc-sh-table">
          <thead>
            <tr>
              <th scope="col" className="vc-sh-th-what">
                Voted on
              </th>
              <th scope="col" className="vc-sh-th-date">
                Date
              </th>
              <th scope="col" className="vc-sh-th-status">
                Status
              </th>
              {cols.map((n) => (
                <th key={n} scope="col" className="vc-sh-th-who" data-on={isOn(n) ? 'true' : undefined} title={isMayor(n) ? `Mayor ${surname(n)}` : n}>
                  {isMayor(n) && <small>Mayor</small>}
                  {surname(n)}
                </th>
              ))}
            </tr>
          </thead>
          {rows.map((r) => {
            const m = r.m;
            const isOpen = open.has(m.id);
            const rolled = m.votes.filter((v) => v.vote !== 'absent');
            const unanimous = m.result === 'carried' && m.unanimous && rolled.length === 0;
            const roll = m.votes
              .filter((v) => cols.some((n) => sameMember(v.member, n)))
              .sort((a, b) => (ORDER[a.vote] ?? 9) - (ORDER[b.vote] ?? 9) || surname(a.member).localeCompare(surname(b.member)));
            const motionText = m.motion.replace(/\s+/g, ' ').trim();
            const tally = motionTally(m);
            const to = m.meetingId ? `/meetings/${encodeURIComponent(m.meetingId)}` : null;
            const date = fmt(m.date, { month: 'short', day: 'numeric', year: 'numeric' });
            const tag = showBody && m.bodyId === 'redevelopment-agency' ? 'RDA' : null;
            return (
              <tbody key={m.id} data-open={isOpen ? 'true' : undefined} data-pending={r.pending ? 'true' : undefined}>
                <tr className="vc-sh-row" onClick={() => toggle(m.id)}>
                  <td className="vc-sh-what">
                    <button
                      type="button"
                      className="vc-sh-title"
                      aria-expanded={isOpen}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle(m.id);
                      }}
                    >
                      <ChevronRight size={14} className="vc-sh-chev" aria-hidden="true" />
                      <span>{r.title}</span>
                    </button>
                    <span className="vc-sh-meta" aria-hidden="true">
                      <span className="vc-sh-date-m">
                        <span>{date}</span>
                        {tag && <small>{tag}</small>}
                      </span>
                      <span className="vc-sh-status-m" data-status={r.status}>
                        {STATUS_WORD[r.status]}
                      </span>
                    </span>
                  </td>
                  <td className="vc-sh-date">
                    {date}
                    {tag && <small>{tag}</small>}
                  </td>
                  <td className="vc-sh-status" data-status={r.status}>
                    {STATUS_WORD[r.status]}
                  </td>
                  {r.pending ? (
                    <td colSpan={cols.length} className="vc-sh-note" aria-hidden="true" />
                  ) : unanimous || rolled.length === 0 ? (
                    <td colSpan={cols.length} className="vc-sh-note" data-tone={unanimous ? 'good' : undefined}>
                      {unanimous ? 'Unanimous' : 'Names not listed'}
                    </td>
                  ) : (
                    cols.map((n) => {
                      const v = voteOf(m, n);
                      return (
                        <td key={n} className="vc-sh-cell" data-vote={v} data-on={isOn(n) ? 'true' : undefined}>
                          <span className="vc-sh-sr">{`${surname(n)}: ${v === 'none' ? 'no vote recorded' : (VOTE_LABEL[v] ?? v)}`}</span>
                          <span aria-hidden="true">
                            {v === 'yes' ? (
                              <Check size={16} strokeWidth={2.6} />
                            ) : v === 'no' ? (
                              <X size={16} strokeWidth={2.6} />
                            ) : v === 'abstain' ? (
                              'A'
                            ) : v === 'recused' ? (
                              'R'
                            ) : v === 'absent' ? (
                              <i />
                            ) : null}
                          </span>
                        </td>
                      );
                    })
                  )}
                </tr>
                {isOpen && (
                  <tr className="vc-sh-more">
                    <td colSpan={span}>
                      <div className="vc-sh-detail">
                        {r.pending ? (
                          <p className="vc-sh-line">
                            {`${m.bodyName ?? 'The meeting'} met on ${fmt(m.date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}. The city has not posted the minutes yet. The votes will appear here once it does.`}
                          </p>
                        ) : (
                          <>
                            {r.full !== r.title && <p className="vc-sh-line">{r.full}</p>}
                            <p className="vc-sh-line">
                              <b>{STATUS_WORD[r.status]}</b>
                              {tally ? ` ${tally}` : ''}
                              {unanimous ? ', unanimous' : ''}
                              {` on ${fmt(m.date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}`}
                              {m.bodyName ? `, ${m.bodyId === 'redevelopment-agency' ? 'RDA Board' : m.bodyName}` : ''}
                            </p>
                            {motionText && <p className="vc-sh-line">{`Motion: ${motionText.charAt(0).toUpperCase()}${motionText.slice(1)}`}</p>}
                            {(m.mover || m.seconder) && (
                              <p className="vc-sh-line">
                                {m.mover ? `Moved by ${surname(m.mover)}` : ''}
                                {m.mover && m.seconder ? ', ' : ''}
                                {m.seconder ? `${m.mover ? 'seconded' : 'Seconded'} by ${surname(m.seconder)}` : ''}
                              </p>
                            )}
                            {(m.items?.length ?? 0) > 0 && (
                              <ol className="vc-vt-items">
                                {m.items!.map((it) => (
                                  <li key={it}>{it.replace(/^(\d+\.\d+)\s+/, '$1  ')}</li>
                                ))}
                              </ol>
                            )}
                            {m.refs.length > 0 && !/resolution|ordinance/i.test(r.title) && <p className="vc-sh-line">{m.refs.join(', ')}</p>}
                            {roll.length > 0 ? (
                              <ul className="vc-sh-roll" aria-label="How each member voted">
                                {roll.map((v) => (
                                  <li key={v.member} data-on={isOn(v.member) ? 'true' : undefined}>
                                    <span>
                                      {isMayor(v.member) || (mayor !== null && sameMember(v.member, mayor))
                                        ? `Mayor ${surname(v.member)}`
                                        : `${seat(m.bodyId)} ${surname(v.member)}`}
                                    </span>
                                    <b>{VOTE_LABEL[v.vote] ?? v.vote}</b>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              !unanimous && <p className="vc-sh-line">The minutes do not say how each member voted.</p>
                            )}
                            {m.tieBreak && mayor && <p className="vc-sh-line">{`Mayor ${surname(mayor)} broke the tie.`}</p>}
                          </>
                        )}
                        <p className="vc-sh-links">
                          {!r.pending && (
                            <DocLink id={m.documentId} page={m.page} className="vc-vt-min">
                              <FileText size={12} /> Minutes{m.page ? ` p. ${m.page}` : ''}
                            </DocLink>
                          )}
                          {to && (
                            <Link to={to} className="vc-vt-min">
                              Meeting page <ChevronRight size={12} />
                            </Link>
                          )}
                        </p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            );
          })}
        </table>
      </div>
    </div>
  );
}

function YearSection({
  year,
  query,
  open,
  onToggle,
  member,
  commission,
  showBody,
  result,
  bodies,
  plain,
}: {
  year: number;
  query: string;
  open: boolean;
  onToggle: () => void;
  member: string | null;
  commission: boolean;
  showBody: boolean;
  result: string;
  /** The bodies on this chart, for finding meetings whose minutes are not posted yet. */
  bodies: string[];
  /** No filter is narrowing the list, so a meeting with no minutes belongs on it. */
  plain: boolean;
}) {
  const list = useJson<{ items: MotionRow[]; total: number }>(open ? `/api/votes?scope=current&${query}${query ? '&' : ''}year=${year}&pageSize=400` : null);
  const meet = (b: string | undefined) => (open && plain && b ? `/api/meetings?year=${year}&body=${b}&pageSize=100&sort=date_desc` : null);
  const first = useJson<{ items: MeetingLite[] }>(meet(bodies[0]));
  const second = useJson<{ items: MeetingLite[] }>(meet(bodies[1]));
  const read = useJson<{ meetings: MinutesRead[] }>(open && plain ? `/api/votes/meetings?year=${year}` : null);
  // Utah's evening is already tomorrow in UTC, so the day is counted from six hours back.
  const [today] = useState(() => new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10));
  const rows = useMemo<SheetRow[]>(() => {
    if (list.status !== 'done') return [];
    const votes = sheetRows(list.data.items, result === 'carried' || result === 'failed' ? result : '');
    if (!plain || read.status !== 'done' || first.status !== 'done' || (bodies[1] && second.status !== 'done')) return votes;
    const held = [...first.data.items, ...(second.status === 'done' ? second.data.items : [])];
    return mergeRows(votes, pendingRows(held, read.data.meetings, today));
  }, [list, result, plain, first, second, read, bodies, today]);
  // The council's columns are everyone serving now: the mayor first, then the council in alphabetical order. The commission's are whoever voted.
  const people = usePeople();
  const { council, mayor } = useMemo(() => {
    const now = people.filter((p) => p.current && p.kind === 'elected');
    const mayorName = now.find((p) => /^mayor$/i.test(p.role))?.name ?? null;
    const rest = now
      .filter((p) => !/^mayor$/i.test(p.role))
      .map((p) => p.name)
      .sort((a, b) => surname(a).localeCompare(surname(b)));
    return { council: now.length ? [...(mayorName ? [mayorName] : []), ...rest] : null, mayor: mayorName };
  }, [people]);
  const ready = commission || council !== null;
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
      {open && list.status === 'done' && !rows.length && <p className="vc-mo-note">No votes match.</p>}
      {open && rows.length > 0 && ready && <VoteSheet rows={rows} member={member} council={commission ? null : council} mayor={commission ? null : mayor} showBody={showBody} />}
    </section>
  );
}

/** The council's voting recap, or (commission) the Planning Commission's own page. */
export function VotesView({ commission = false }: { commission?: boolean }) {
  const [params, setParams] = useSearchParams();
  const asked = params.get('body') ?? '';
  const rdaOnly = !commission && asked === 'redevelopment-agency';
  // The council's chart carries every vote of the City Council and the Redevelopment Agency, where the same members sit as its board. An RDA row is tagged.
  const body = commission ? 'planning-commission' : rdaOnly ? 'redevelopment-agency' : '';
  const bodies = commission ? ['planning-commission'] : rdaOnly ? ['redevelopment-agency'] : ['city-council', 'redevelopment-agency'];
  const member = params.get('member') ?? '';
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
  const query = useMemo(() => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ member, body, q, result, vote })) if (v) u.set(k, v);
    return u.toString();
  }, [member, body, q, result, vote]);
  const yearsQ = new URLSearchParams(Object.entries({ member, body }).filter(([, v]) => v)).toString();
  const years = useJson<{ years: Array<{ year: number; motions: number; meetings: number }> }>(`/api/votes/years?scope=current${yearsQ ? `&${yearsQ}` : ''}`);
  const attendance = useJson<Attendance>(body === 'planning-commission' ? '/api/votes/attendance' : null);
  const att = attendance.status === 'done' ? attendance.data : null;
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const yearList = years.status === 'done' ? years.data.years : [];
  const isOpen = (y: number, i: number) => open[y] ?? i === 0;

  return (
    <Frame>
      <header className="vc-page-head">
        <h1 className="vc-page-title vc-votes-title">{commission ? 'Planning Commission Voting Recap' : 'City Council Voting Recap'}</h1>
      </header>

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

      {view !== 'attendance' && <Key />}
      {years.status === 'loading' && (
        <div className="vc-skeleton" aria-hidden="true">
          <span style={{ width: '60%' }} />
        </div>
      )}
      {view !== 'attendance' && years.status === 'done' && !yearList.length && <p className="vc-mo-note">No votes match.</p>}
      {view !== 'attendance' &&
        yearList.map((y, i) => (
          <YearSection
            key={y.year}
            year={y.year}
            result={result}
            commission={commission}
            showBody={!body}
            bodies={bodies}
            plain={!member && !q && !result && !vote}
            query={query}
            member={member || null}
            open={isOpen(y.year, i)}
            onToggle={() => setOpen((o) => ({ ...o, [y.year]: !isOpen(y.year, i) }))}
          />
        ))}
    </Frame>
  );
}

export default function VotesPage() {
  return <VotesView />;
}
