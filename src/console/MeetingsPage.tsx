/**
 * /meetings : Vineyard's public meeting schedule, past and upcoming.
 * Three views of the same data: Upcoming (the default), a month Calendar, and Past by year.
 */
import '@fontsource-variable/inter';
import '@fontsource-variable/source-serif-4';
import './console.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Check, ChevronDown, ChevronLeft, ChevronRight, FileText, Video } from 'lucide-react';
import type { MeetingSummary } from '@/types/models';
import { Frame } from './Chrome';
import {
  dayMonth,
  dayNumber,
  formatTime,
  meetingHref,
  monthGrid,
  monthLabel,
  monthShort,
  shiftMonth,
  statusLabel,
  todayIso,
  toneOf,
  useBodies,
  useMeetings,
  weekdayShort,
} from './meetings';

type View = 'upcoming' | 'calendar' | 'past';
const VIEWS: Array<{ id: View; label: string }> = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'past', label: 'Past' },
];

function groupBy<T>(items: T[], key: (t: T) => string): Array<[string, T[]]> {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    map.set(k, [...(map.get(k) ?? []), it]);
  }
  return [...map.entries()];
}

function MeetingRow({ m, today }: { m: MeetingSummary; today: string }) {
  const status = statusLabel(m, today);
  const tag = status === 'Upcoming' ? null : status;
  return (
    <Link to={meetingHref(m)} className="vc-meeting" data-tone={toneOf(m.governmentBodyId)}>
      <div className="vc-meeting-date" aria-hidden="true">
        <span className="vc-meeting-mon">{monthShort(m.date)}</span>
        <span className="vc-meeting-day">{dayNumber(m.date)}</span>
        <span className="vc-meeting-dow">{weekdayShort(m.date)}</span>
      </div>
      <div className="vc-meeting-main">
        <div className="vc-meeting-meta">
          <span className="vc-body-dot" />
          <span>{m.governmentBodyName ?? 'Public meeting'}</span>
          {formatTime(m.startTime) && (
            <>
              <span className="vc-dot" />
              <span>{formatTime(m.startTime)}</span>
            </>
          )}
          {tag && <span className="vc-status-tag" data-kind={tag.toLowerCase()}>{tag}</span>}
        </div>
        <h3 className="vc-meeting-title">{m.title}</h3>
        <div className="vc-meeting-docs">
          {m.agendaDocumentId && <span className="vc-tag"><FileText size={11} strokeWidth={2} /> Agenda</span>}
          {m.packetDocumentId && <span className="vc-tag"><FileText size={11} strokeWidth={2} /> Packet</span>}
          {m.minutesDocumentId && <span className="vc-tag"><FileText size={11} strokeWidth={2} /> Minutes</span>}
          {m.hasVideo && <span className="vc-tag"><Video size={11} strokeWidth={2} /> Video</span>}
        </div>
      </div>
      <ChevronRight className="vc-meeting-go" size={18} strokeWidth={1.6} aria-hidden="true" />
    </Link>
  );
}

const MAIN_BODIES = 4;

function MoreBodies({ bodies, value, onPick }: { bodies: Array<{ id: string; name: string; count: number }>; value: string | null; onPick: (id: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const current = bodies.find((b) => b.id === value);
  return (
    <div className="vc-filter" ref={box}>
      <button type="button" className="vc-chip vc-chip-tone" data-tone={current ? toneOf(current.id) : undefined} data-active={Boolean(current)} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {current ? (
          <>
            <span className="vc-body-dot" /> {current.name}
          </>
        ) : (
          `More (${bodies.length})`
        )}
        <ChevronDown size={14} strokeWidth={2} />
      </button>
      {open && (
        <div className="vc-menu vc-menu-right" role="listbox" aria-label="More bodies">
          {bodies.map((b) => (
            <button key={b.id} type="button" className="vc-option" role="option" aria-selected={b.id === value} data-selected={b.id === value} data-tone={toneOf(b.id)} onClick={() => (onPick(b.id === value ? null : b.id), setOpen(false))}>
              <span className="vc-option-check">{b.id === value ? <Check size={14} strokeWidth={2.4} /> : <span className="vc-body-dot" />}</span>
              {b.name}
              {b.count > 0 && <span className="vc-option-count">{b.count}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="vc-skeleton" aria-hidden="true" style={{ marginTop: '1rem' }}>
      <span style={{ width: '94%' }} />
      <span style={{ width: '82%' }} />
      <span style={{ width: '88%' }} />
    </div>
  );
}

function Upcoming({ meetings, today }: { meetings: MeetingSummary[]; today: string }) {
  const upcoming = meetings.filter((m) => m.date >= today);
  const recent = meetings.filter((m) => m.date < today).slice(-6).reverse();
  return (
    <>
      {upcoming.length ? (
        groupBy(upcoming.slice(0, 40), (m) => m.date.slice(0, 7)).map(([ym, list]) => (
          <section key={ym} className="vc-sched-group">
            <p className="vc-label">{monthLabel(ym)}</p>
            <div className="vc-sched-list">
              {list.map((m) => (
                <MeetingRow key={m.id} m={m} today={today} />
              ))}
            </div>
          </section>
        ))
      ) : (
        <div className="vc-empty">No upcoming meetings have been posted yet. The city usually posts agendas a few days ahead.</div>
      )}
      {recent.length > 0 && (
        <section className="vc-sched-group">
          <p className="vc-label">Recently held</p>
          <div className="vc-sched-list">
            {recent.map((m) => (
              <MeetingRow key={m.id} m={m} today={today} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function Calendar({ meetings, month, onMonth, today }: { meetings: MeetingSummary[]; month: string; onMonth: (ym: string) => void; today: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  const byDay = useMemo(() => {
    const map = new Map<string, MeetingSummary[]>();
    for (const m of meetings) map.set(m.date, [...(map.get(m.date) ?? []), m]);
    return map;
  }, [meetings]);
  const cells = monthGrid(month);
  const inMonth = meetings.filter((m) => m.date.startsWith(month));
  const dayList = selected ? byDay.get(selected) ?? [] : inMonth;

  return (
    <>
      <div className="vc-cal-head">
        <h2 className="vc-cal-title">{monthLabel(month)}</h2>
        <div className="vc-cal-nav">
          <button type="button" className="vc-ghost" data-icon-only="true" aria-label="Previous month" onClick={() => (setSelected(null), onMonth(shiftMonth(month, -1)))}>
            <ChevronLeft size={18} />
          </button>
          <button type="button" className="vc-chip" onClick={() => (setSelected(null), onMonth(today.slice(0, 7)))}>
            Today
          </button>
          <button type="button" className="vc-ghost" data-icon-only="true" aria-label="Next month" onClick={() => (setSelected(null), onMonth(shiftMonth(month, 1)))}>
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
      <div className="vc-cal" role="grid" aria-label={monthLabel(month)}>
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} className="vc-cal-dow" role="columnheader">
            {d}
          </div>
        ))}
        {cells.map((c) => {
          const list = byDay.get(c.iso) ?? [];
          return (
            <div
              key={c.iso}
              role="gridcell"
              className="vc-cal-cell"
              data-out={!c.inMonth}
              data-today={c.iso === today}
              data-selected={c.iso === selected}
              data-has={list.length > 0}
              onClick={() => list.length && setSelected(c.iso === selected ? null : c.iso)}
            >
              <span className="vc-cal-num">{dayNumber(c.iso)}</span>
              <div className="vc-cal-events">
                {list.slice(0, 3).map((m) => (
                  <Link key={m.id} to={meetingHref(m)} className="vc-cal-event" data-tone={toneOf(m.governmentBodyId)} onClick={(e) => e.stopPropagation()} title={`${m.title}${m.startTime ? `, ${formatTime(m.startTime)}` : ''}`}>
                    <span className="vc-cal-time">{formatTime(m.startTime)?.replace(':00', '').replace(' ', '').toLowerCase()}</span>
                    <span className="vc-cal-name">{m.governmentBodyName ?? m.title}</span>
                  </Link>
                ))}
                {list.length > 3 && <span className="vc-cal-more">+{list.length - 3} more</span>}
              </div>
              <div className="vc-cal-dots" aria-hidden="true">
                {list.slice(0, 4).map((m) => (
                  <span key={m.id} data-tone={toneOf(m.governmentBodyId)} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <section className="vc-sched-group">
        <p className="vc-label">{selected ? dayMonth(selected) : `${inMonth.length} ${inMonth.length === 1 ? 'meeting' : 'meetings'} in ${monthLabel(month)}`}</p>
        {dayList.length ? (
          <div className="vc-sched-list">
            {dayList.map((m) => (
              <MeetingRow key={m.id} m={m} today={today} />
            ))}
          </div>
        ) : (
          <div className="vc-empty">No meetings on the record for this month.</div>
        )}
      </section>
    </>
  );
}

function Past({ meetings, today }: { meetings: MeetingSummary[]; today: string }) {
  const past = meetings.filter((m) => m.date < today).reverse();
  if (!past.length) return <div className="vc-empty">No meetings on the record for this year.</div>;
  return (
    <>
      {groupBy(past, (m) => m.date.slice(0, 7)).map(([ym, list]) => (
        <section key={ym} className="vc-sched-group">
          <p className="vc-label">
            {monthLabel(ym)} <span className="vc-label-count">{list.length}</span>
          </p>
          <div className="vc-sched-list">
            {list.map((m) => (
              <MeetingRow key={m.id} m={m} today={today} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

export default function MeetingsPage() {
  const [params, setParams] = useSearchParams();
  const today = todayIso();
  const thisYear = Number(today.slice(0, 4));
  const view = (VIEWS.some((v) => v.id === params.get('view')) ? params.get('view') : 'upcoming') as View;
  const body = params.get('body');
  const month = /^\d{4}-\d{2}$/.test(params.get('month') ?? '') ? String(params.get('month')) : today.slice(0, 7);
  const yearParam = Number(params.get('year'));
  const year = yearParam >= 1990 && yearParam <= thisYear + 1 ? yearParam : thisYear;
  const bodies = useBodies();

  useEffect(() => {
    document.title = 'Meetings | Vineyard Transparency Portal';
  }, []);

  const firstYear = useMemo(() => {
    const ys = bodies.map((b) => Number(b.firstRecordDate?.slice(0, 4))).filter((y) => y > 1990);
    return ys.length ? Math.min(...ys) : thisYear - 5;
  }, [bodies, thisYear]);

  const monthYear = Number(month.slice(0, 4));
  const yearsNeeded = view === 'upcoming' ? [thisYear, thisYear + 1] : view === 'calendar' ? [monthYear] : [year];
  const load = useMeetings(yearsNeeded);

  const set = (next: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v == null) p.delete(k);
      else p.set(k, v);
    }
    setParams(p, { replace: true });
  };

  const loaded = load.status === 'done' ? load.data : null;
  const all = useMemo(() => loaded ?? [], [loaded]);
  const shown = body ? all.filter((m) => m.governmentBodyId === body) : all;
  const bodyChips = useMemo(() => {
    const withMeetings = bodies.filter((b) => (b.meetingCount ?? 0) > 0).map((b) => ({ id: b.id, name: b.name, count: b.meetingCount ?? 0 }));
    if (withMeetings.length) return withMeetings.sort((a, b) => b.count - a.count);
    const seen = new Map<string, { id: string; name: string; count: number }>();
    for (const m of all) {
      if (!m.governmentBodyId) continue;
      const cur = seen.get(m.governmentBodyId) ?? { id: m.governmentBodyId, name: m.governmentBodyName ?? m.governmentBodyId, count: 0 };
      cur.count++;
      seen.set(m.governmentBodyId, cur);
    }
    return [...seen.values()].sort((a, b) => b.count - a.count);
  }, [bodies, all]);
  const mainBodies = bodyChips.slice(0, MAIN_BODIES);
  const moreBodies = bodyChips.slice(MAIN_BODIES).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Frame wide>
      <header className="vc-page-head">
        <h1 className="vc-page-title">Meetings</h1>
        <p className="vc-page-sub">Every public meeting of Vineyard City, with agendas, packets, minutes and video.</p>
      </header>

      <div className="vc-sched-controls">
        <div className="vc-segment" role="tablist" aria-label="View">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" role="tab" aria-selected={view === v.id} data-on={view === v.id} onClick={() => set({ view: v.id === 'upcoming' ? null : v.id })}>
              {v.label}
            </button>
          ))}
        </div>
        {bodyChips.length > 1 && (
          <div className="vc-filters vc-body-chips" role="group" aria-label="Body">
            <button type="button" className="vc-chip" data-active={!body} onClick={() => set({ body: null })}>
              All
            </button>
            {mainBodies.map((b) => (
              <button key={b.id} type="button" className="vc-chip vc-chip-tone" data-tone={toneOf(b.id)} data-active={body === b.id} onClick={() => set({ body: body === b.id ? null : b.id })}>
                <span className="vc-body-dot" /> {b.name}
              </button>
            ))}
            {moreBodies.length > 0 && <MoreBodies bodies={moreBodies} value={body} onPick={(id) => set({ body: id })} />}
          </div>
        )}
      </div>

      {view === 'past' && (
        <div className="vc-years" role="group" aria-label="Year">
          {Array.from({ length: thisYear - firstYear + 1 }, (_, i) => thisYear - i).map((y) => (
            <button key={y} type="button" className="vc-chip" data-active={y === year} onClick={() => set({ year: y === thisYear ? null : String(y) })}>
              {y}
            </button>
          ))}
        </div>
      )}

      {load.status === 'loading' && <Skeleton />}
      {load.status === 'error' && <div className="vc-empty">The meeting schedule could not be loaded right now. Please try again in a moment.</div>}
      {load.status === 'done' && view === 'upcoming' && <Upcoming meetings={shown} today={today} />}
      {load.status === 'done' && view === 'calendar' && <Calendar meetings={shown} month={month} today={today} onMonth={(ym) => set({ month: ym === today.slice(0, 7) ? null : ym })} />}
      {load.status === 'done' && view === 'past' && <Past meetings={shown} today={today} />}
    </Frame>
  );
}
