/**
 * Voting records as a chart, like a spreadsheet: one row for each thing the council or commission decided,
 * with the date, how it ended, and a column for every member. Selecting a row opens the motion and each vote.
 */
import { AI_NOTE } from '@/lib/aiNote';
import './styles';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Check, ChevronDown, ChevronRight, FileText, X } from 'lucide-react';
import { DocLink } from './DocLink';
import { Frame } from './Chrome';
import { useJson, type Load } from './api';
import {
  cellMark,
  COUNCIL_SEATS,
  meetingRows,
  mergeRows,
  PC_SEATS,
  recordedTally,
  pendingRows,
  plainDashes,
  sheetRows,
  STATUS_WORD,
  type DraftMinutes,
  type Mark,
  type MeetingLite,
  type MinutesRead,
  type MotionRow,
  type Seat,
  type SheetRow,
} from './votes';
import { primePeople, usePeople, type Person } from './people';
import { CsvButton } from './CsvButton';
import { csvName } from './csv';
import { voteCsvRows } from './voteCsv';

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
  const short = (d: string) => formatMonthDay(d);
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
                      <i aria-hidden="true">{p ? '✓' : '-'}</i>
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
import { ORDER, VOTE_LABEL } from './MotionCard';
import { formatDate, formatMonthDay, formatWeekdayDate } from '@/lib/dates';
import { ErrorNote } from './ErrorNote';

const fmt = (iso: string | null, o: Intl.DateTimeFormatOptions) => (iso ? (o.weekday ? formatWeekdayDate(iso) : formatDate(iso)) : '');
const last = (n: string) => n.split(' ').pop() ?? n;
/** What the body calls the people who vote in it. */
const seat = (bodyId: string | null) => (bodyId === 'planning-commission' ? 'Commissioner' : bodyId === 'redevelopment-agency' ? 'Board Member' : 'Council Member');
const cap = (n: string) => {
  const t = n.charAt(0).toUpperCase() + n.slice(1);
  return n === n.toLowerCase() ? t.replace(/^Mc([a-z])/, (_, c: string) => `Mc${c.toUpperCase()}`) : t;
};

/** What the marks in the chart mean. Only the marks the chart uses are listed, plus the blank (members not yet seated). */
function Key({ marks, mayor }: { marks: Set<Mark>; mayor: boolean }) {
  return (
    <p className="vc-sh-key" aria-label="Key to the marks">
      <span>
        <Check size={14} strokeWidth={2.8} /> Yes
      </span>
      <span>
        <X size={14} strokeWidth={2.8} /> No
      </span>
      {marks.has('abstain') && (
        <span>
          <i>A</i> Abstained
        </span>
      )}
      {marks.has('recused') && (
        <span>
          <i>R</i> Recused
        </span>
      )}
      <span>
        <i>-</i> Absent
      </span>
      {marks.has('unrecorded') && (
        <span>
          <i>NR</i> No vote recorded
        </span>
      )}
      <span>Blank: not yet seated</span>
      {mayor && <span>Mayor votes only to break a tie</span>}
    </p>
  );
}

const lower = (n: string) => n.toLowerCase();
/** A vote belongs to a member when the minutes print their full name, or only their last name. */
const sameMember = (voter: string, name: string) => lower(voter) === lower(name) || (!voter.includes(' ') && lower(voter) === lower(last(name)));
const surname = (n: string) => cap(last(n));

const MARK_WORD: Record<Mark, string> = {
  yes: 'Yes',
  no: 'No',
  abstain: 'Abstained',
  recused: 'Recused',
  absent: 'Absent',
  unseated: 'not yet seated',
  nonvoting: 'did not vote (votes only to break a tie)',
  unrecorded: 'no vote recorded',
};

/** One member's mark: a check, a cross, a letter, a hyphen for absent; empty for a seat not yet held. */
function MarkGlyph({ mark }: { mark: Mark }) {
  if (mark === 'yes') return <Check size={16} strokeWidth={2.6} />;
  if (mark === 'no') return <X size={16} strokeWidth={2.6} />;
  if (mark === 'abstain') return <>A</>;
  if (mark === 'recused') return <>R</>;
  if (mark === 'absent') return <>-</>;
  if (mark === 'unrecorded') return <small>NR</small>;
  return null;
}

const rolled = (m: MotionRow) => m.votes.filter((v) => v.vote !== 'absent');

/**
 * The year's votes as one chart: what was decided, the date, how it ended and the recorded count on the left, then a
 * column for each seat: the council serving now (a member who has left has none), or the commission as its 2026
 * records show it.
 */
function VoteSheet({ rows, member, seats, mayor, showBody }: { rows: SheetRow[]; member: string | null; seats: Seat[]; mayor: string | null; showBody: boolean }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const isOn = (name: string) => member !== null && member !== '' && sameMember(member, name);
  const isMayor = (name: string) => mayor !== null && lower(name) === lower(mayor);
  const marks = useMemo(() => {
    const out = new Set<Mark>();
    for (const r of rows) {
      if (r.pending || r.status === 'none' || rolled(r.m).length === 0) continue;
      for (const s of seats) out.add(cellMark(r.m, s, mayor !== null && lower(s.name) === lower(mayor)));
    }
    return out;
  }, [rows, seats, mayor]);
  const span = seats.length + 4;
  return (
    <div className="vc-shw">
      <Key marks={marks} mayor={mayor !== null} />
      <div className="vc-sh" data-many={seats.length >= 7 ? 'true' : undefined}>
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
              <th scope="col" className="vc-sh-th-tally">
                Tally
              </th>
              {seats.map((s) => (
                <th
                  key={s.name}
                  scope="col"
                  className="vc-sh-th-who"
                  data-on={isOn(s.name) ? 'true' : undefined}
                  title={isMayor(s.name) ? `Mayor ${surname(s.name)}` : s.role ? `${s.name}, ${s.role}` : s.name}
                >
                  {isMayor(s.name) && <small>Mayor</small>}
                  {surname(s.name)}
                  {s.role === 'Alternate' && <small className="vc-sh-alt">(Alt.)</small>}
                </th>
              ))}
            </tr>
          </thead>
          {rows.map((r) => {
            const m = r.m;
            const isOpen = open.has(m.id);
            const voted = rolled(m);
            const unanimous = m.result === 'carried' && m.unanimous && voted.length === 0;
            // Everyone who voted is listed when the motion is opened, including a member who has since left (no column of their own). A bare last name is dropped when the same vote also carries the full name.
            const roll = m.votes
              .filter((v) => v.member.includes(' ') || !m.votes.some((o) => o !== v && o.member.includes(' ') && lower(last(o.member)) === lower(v.member)))
              .sort((a, b) => (ORDER[a.vote] ?? 9) - (ORDER[b.vote] ?? 9) || surname(a.member).localeCompare(surname(b.member)));
            const motionText = plainDashes(m.motion.replace(/\s+/g, ' ').trim());
            const tally = r.pending || r.status === 'none' ? null : recordedTally(m);
            const tieNote = tally?.endsWith('(Mayor breaks tie)') ? 'Mayor breaks tie' : null;
            const tallyMain = tally ? tally.replace(/\s*\(Mayor breaks tie\)$/, '') : '';
            const to = m.meetingId ? `/meetings/${encodeURIComponent(m.meetingId)}` : null;
            const date = fmt(m.date, { month: 'short', day: 'numeric', year: 'numeric' });
            const longDate = fmt(m.date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
            const tag = showBody && m.bodyId === 'redevelopment-agency' ? 'RDA' : null;
            const noVotes = r.pending || r.status === 'none';
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
                      <span title={r.full}>{r.title}</span>
                    </button>
                    <span className="vc-sh-meta" aria-hidden="true">
                      <span className="vc-sh-date-m">
                        <span>{date}</span>
                        {tag && <small>{tag}</small>}
                      </span>
                      <span className="vc-sh-status-m" data-status={r.status}>
                        {STATUS_WORD[r.status]}
                        {tallyMain ? ` ${tallyMain}` : ''}
                        {tieNote ? ` (${tieNote})` : ''}
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
                  <td className="vc-sh-tally">
                    {tallyMain}
                    {tieNote && <small>{tieNote}</small>}
                  </td>
                  {noVotes ? (
                    <td colSpan={seats.length} className="vc-sh-note" aria-hidden="true" />
                  ) : unanimous || voted.length === 0 ? (
                    <td colSpan={seats.length} className="vc-sh-note" data-tone={unanimous ? 'good' : undefined}>
                      {unanimous ? 'Unanimous' : 'Names not listed'}
                    </td>
                  ) : (
                    seats.map((s) => {
                      const mk = cellMark(m, s, isMayor(s.name));
                      return (
                        <td key={s.name} className="vc-sh-cell" data-vote={mk} data-on={isOn(s.name) ? 'true' : undefined}>
                          <span className="vc-sh-sr">{`${surname(s.name)}: ${MARK_WORD[mk]}`}</span>
                          <span aria-hidden="true">
                            <MarkGlyph mark={mk} />
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
                        {r.canceled ? (
                          <p className="vc-sh-line">{`The ${m.bodyName ? `${m.bodyName} ` : ''}meeting set for ${longDate} was canceled. The city's meeting portal lists it as canceled.`}</p>
                        ) : r.draft ? (
                          <p className="vc-sh-line">{`${m.bodyName ?? 'The body'} met on ${longDate}. The city has not posted these minutes as their own file yet. Draft minutes are printed in the agenda packet for ${r.draft.date ? fmt(r.draft.date, { month: 'long', day: 'numeric', year: 'numeric' }) : 'a later meeting'}, page ${r.draft.page}.`}</p>
                        ) : r.pending ? (
                          <p className="vc-sh-line">{`${m.bodyName ?? 'The meeting'} met on ${longDate}. The city has not posted the minutes yet. The votes will appear here once it does.`}</p>
                        ) : r.status === 'none' && !m.motion ? (
                          <p className="vc-sh-line">{`${m.bodyName ?? 'The body'} met on ${longDate}. The minutes record no vote on an agenda item.`}</p>
                        ) : (
                          <>
                            {r.full !== r.title && <p className="vc-sh-line">{r.full}</p>}
                            <p className="vc-sh-line">
                              <b>{STATUS_WORD[r.status]}</b>
                              {tallyMain ? ` ${tallyMain}` : ''}
                              {unanimous && tallyMain !== 'Unanimous' ? ', unanimous' : ''}
                              {` on ${longDate}`}
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
                                  <li key={it}>{plainDashes(it).replace(/^(\d+\.\d+)\s+/, '$1  ')}</li>
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
                            {m.tieBreak && <p className="vc-sh-line">{mayor ? `The minutes record that Mayor ${surname(mayor)} broke the tie.` : 'The minutes record that the mayor broke the tie.'}</p>}
                          </>
                        )}
                        <p className="vc-sh-links">
                          {!r.pending && m.documentId && (
                            <DocLink id={m.documentId} page={m.page} className="vc-vt-min">
                              <FileText size={12} /> Minutes{m.page ? ` p. ${m.page}` : ''}
                            </DocLink>
                          )}
                          {r.draft && (
                            <DocLink id={r.draft.documentId} page={r.draft.page} className="vc-vt-min">
                              <FileText size={12} /> Draft minutes p. {r.draft.page}
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
      <p className="vc-sh-note">{AI_NOTE}</p>
    </div>
  );
}

/** Everything a voting page shows for one year, in one response (GET /api/pages/votes, /api/pages/planning). */
export interface VotesPageData {
  version: number;
  years: Array<{ year: number; motions: number; meetings: number }>;
  year: number | null;
  motions: { items: MotionRow[]; total: number };
  meetings: MeetingLite[];
  read: MinutesRead[];
  people: Person[];
  /** Planning Commission: draft minutes printed in a later packet, keyed "body|date". */
  drafts?: Record<string, DraftMinutes | null>;
  attendance?: Attendance;
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
  plain,
  pageUrl,
  agg,
}: {
  year: number;
  query: string;
  open: boolean;
  onToggle: () => void;
  member: string | null;
  commission: boolean;
  showBody: boolean;
  result: string;
  /** No filter is narrowing the list, so a meeting with no minutes belongs on it. */
  plain: boolean;
  /** The page's one-response endpoint (plain view). */
  pageUrl: string;
  /** The page's response already loaded for its newest year. */
  agg: VotesPageData | null;
}) {
  const mine = agg && agg.year === year ? agg : null;
  const own = useJson<VotesPageData>(open && plain && !mine ? `${pageUrl}${pageUrl.includes('?') ? '&' : '?'}year=${year}` : null);
  const filtered = useJson<{ items: MotionRow[]; total: number }>(open && !plain ? `/api/votes?scope=current&${query}${query ? '&' : ''}year=${year}&pageSize=400` : null);
  const data = mine ?? (own.status === 'done' ? own.data : null);
  const ownStatus = own.status;
  const list = useMemo<Load<{ items: MotionRow[]; total: number }>>(
    () => (!plain ? filtered : data ? { status: 'done', data: data.motions } : ownStatus === 'error' ? { status: 'error' } : { status: 'loading' }),
    [plain, filtered, data, ownStatus],
  );
  // Utah's evening is already tomorrow in UTC, so the day is counted from six hours back.
  const [today] = useState(() => new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10));
  const rows = useMemo<SheetRow[]>(() => {
    if (list.status !== 'done') return [];
    const votes = sheetRows(list.data.items, result === 'carried' || result === 'failed' ? result : '');
    if (!plain || !data) return votes;
    if (!commission) return mergeRows(votes, pendingRows(data.meetings, data.read, today));
    // The commission's page lists every meeting of the year; a held meeting with no minutes may have draft minutes in a later packet.
    const voted = new Set(votes.map((r) => `${r.m.bodyId}|${(r.m.date ?? '').slice(0, 10)}`));
    return mergeRows(votes, meetingRows(data.meetings, data.read, today, { voted, drafts: data.drafts ?? {} }));
  }, [list, result, plain, data, today, commission]);
  // The council's columns are everyone serving now: the mayor first, then the council in alphabetical order. The commission's are its seats as the 2026 records show them.
  const people = usePeople();
  const { seats, mayor } = useMemo(() => {
    if (commission) {
      // A member who voted this year and is not in the list of seats still gets a column, so no recorded vote is hidden.
      const voters = list.status === 'done' ? [...new Set(list.data.items.flatMap((m) => m.votes.map((v) => v.member)))].filter((n) => n.includes(' ')) : [];
      const extra = voters.filter((n) => !PC_SEATS.some((s) => sameMember(n, s.name))).map((name) => ({ name }));
      return { seats: [...PC_SEATS, ...extra].sort((a, b) => surname(a.name).localeCompare(surname(b.name))), mayor: null };
    }
    const now = people.filter((p) => p.current && p.kind === 'elected');
    const mayorName = now.find((p) => /^mayor$/i.test(p.role))?.name ?? null;
    const rest = now
      .filter((p) => !/^mayor$/i.test(p.role))
      .map((p) => p.name)
      .sort((a, b) => surname(a).localeCompare(surname(b)));
    const names = now.length ? [...(mayorName ? [mayorName] : []), ...rest] : [];
    return { seats: names.map((name): Seat => COUNCIL_SEATS[name.toLowerCase()] ?? { name }), mayor: mayorName };
  }, [people, commission, list]);
  const ready = seats.length > 0;
  return (
    <section className="vc-year">
      <button type="button" className="vc-year-head" onClick={onToggle} aria-expanded={open}>
        <span className="vc-year-num">{year}</span>
        <ChevronDown size={18} className="vc-board-chev" data-open={open} />
      </button>
      {open && (list.status === 'loading' || (list.status === 'done' && !ready)) && (
        <div className="vc-skeleton" aria-hidden="true">
          <span style={{ width: '90%' }} />
          <span style={{ width: '70%' }} />
        </div>
      )}
      {open && list.status === 'error' && <ErrorNote>This year could not be loaded.</ErrorNote>}
      {open && list.status === 'done' && !rows.length && <p className="vc-mo-note">No votes match.</p>}
      {open && rows.length > 0 && ready && <VoteSheet rows={rows} member={member} seats={seats} mayor={mayor} showBody={showBody} />}
      {open && rows.length > 0 && ready && (
        <div className="vc-csv-row">
          <CsvButton filename={csvName('vineyard', commission ? 'planning-votes' : 'votes', year)} rows={() => voteCsvRows(rows, seats, mayor)} />
        </div>
      )}
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
  const plain = !member && !q && !result && !vote;
  // The plain view (no filter) is one response: years, the newest year's votes and meetings, attendance, drafts.
  const pageUrl = commission ? '/api/pages/planning' : rdaOnly ? '/api/pages/votes?body=redevelopment-agency' : '/api/pages/votes';
  const page = useJson<VotesPageData>(plain ? pageUrl : null);
  const agg = page.status === 'done' ? page.data : null;
  // The people come with the page's response: the member columns need no request of their own.
  if (agg?.people?.length) primePeople(agg.people);
  const yearsQ = new URLSearchParams(Object.entries({ member, body }).filter(([, v]) => v)).toString();
  const yearsOwn = useJson<{ years: Array<{ year: number; motions: number; meetings: number }> }>(plain ? null : `/api/votes/years?scope=current${yearsQ ? `&${yearsQ}` : ''}`);
  const years: Load<{ years: Array<{ year: number; motions: number; meetings: number }> }> = plain ? (agg ? { status: 'done', data: { years: agg.years } } : page.status === 'error' ? { status: 'error' } : { status: 'loading' }) : yearsOwn;
  const attendanceOwn = useJson<Attendance>(!plain && body === 'planning-commission' ? '/api/votes/attendance' : null);
  const att = plain ? (agg?.attendance ?? null) : attendanceOwn.status === 'done' ? attendanceOwn.data : null;
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const yearList = years.status === 'done' ? years.data.years : [];
  const isOpen = (y: number, i: number) => open[y] ?? i === 0;

  return (
    <Frame wide="sheet">
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

      {years.status === 'loading' && (
        <div className="vc-skeleton" aria-hidden="true">
          <span style={{ width: '60%' }} />
        </div>
      )}
      {years.status === 'error' && <ErrorNote>The votes could not be loaded.</ErrorNote>}
      {view !== 'attendance' && years.status === 'done' && !yearList.length && <p className="vc-mo-note">No votes match.</p>}
      {view !== 'attendance' &&
        yearList.map((y, i) => (
          <YearSection
            key={y.year}
            year={y.year}
            result={result}
            commission={commission}
            showBody={!body}
            plain={plain}
            pageUrl={pageUrl}
            agg={agg}
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
