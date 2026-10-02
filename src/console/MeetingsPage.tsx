/**
 * /meetings (and /calendar) : Vineyard's calendar. Public meetings from the city's meeting portal
 * plus community, recreation, library and utility events from the city website calendar.
 * Three views of the same data: Upcoming (the default), a month Calendar, and Past by year.
 */
import '@fontsource-variable/inter';
import '@fontsource-variable/source-serif-4';
import './console.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowUpRight, Check, ChevronDown, ChevronLeft, ChevronRight, FileText, MapPin, Megaphone, Video } from 'lucide-react';
import type { MeetingSummary } from '@/types/models';
import { Frame } from './Chrome';
import { CityFacebook } from './FacebookFeed';
import {
  CATEGORIES,
  categoryOf,
  dayMonth,
  dayNumber,
  eventTone,
  formatTime,
  meetingHref,
  mergeItems,
  monthGrid,
  monthLabel,
  monthShort,
  shiftMonth,
  statusLabel,
  todayIso,
  toneOf,
  useBodies,
  useEvents,
  useMeetings,
  weekdayShort,
  type CalItem,
  type CategoryId,
  type PortalEvent,
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

function DateBox({ date }: { date: string }) {
  return (
    <div className="vc-meeting-date" aria-hidden="true">
      <span className="vc-meeting-mon">{monthShort(date)}</span>
      <span className="vc-meeting-day">{dayNumber(date)}</span>
      <span className="vc-meeting-dow">{weekdayShort(date)}</span>
    </div>
  );
}

function MeetingRow({ m, today, cityTime = null }: { m: MeetingSummary; today: string; cityTime?: string | null }) {
  const status = statusLabel(m, today);
  const tag = status === 'Upcoming' ? null : status;
  return (
    <Link to={meetingHref(m)} className="vc-meeting" data-tone={toneOf(m.governmentBodyId)}>
      <DateBox date={m.date} />
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
          {cityTime && formatTime(cityTime) && <span className="vc-time-alt">Agenda time. The city website calendar lists {formatTime(cityTime)}.</span>}
          {tag && (
            <span className="vc-status-tag" data-kind={tag.toLowerCase()}>
              {tag}
            </span>
          )}
        </div>
        <h3 className="vc-meeting-title">{m.title}</h3>
        <div className="vc-meeting-docs">
          {m.agendaDocumentId && (
            <span className="vc-tag">
              <FileText size={11} strokeWidth={2} /> Agenda
            </span>
          )}
          {m.packetDocumentId && (
            <span className="vc-tag">
              <FileText size={11} strokeWidth={2} /> Packet
            </span>
          )}
          {m.minutesDocumentId && (
            <span className="vc-tag">
              <FileText size={11} strokeWidth={2} /> Minutes
            </span>
          )}
          {m.hasVideo && (
            <span className="vc-tag">
              <Video size={11} strokeWidth={2} /> Video
            </span>
          )}
        </div>
      </div>
      <ChevronRight className="vc-meeting-go" size={18} strokeWidth={1.6} aria-hidden="true" />
    </Link>
  );
}

function eventTimeLabel(e: PortalEvent): string {
  if (e.allDay) return 'All day';
  const a = formatTime(e.start.slice(11, 16));
  const b = e.end && e.end.slice(0, 10) === e.start.slice(0, 10) ? formatTime(e.end.slice(11, 16)) : null;
  return b ? `${a} to ${b}` : (a ?? '');
}

function EventRow({ e }: { e: PortalEvent }) {
  const [open, setOpen] = useState(false);
  const label = CATEGORIES.find((c) => c.id === categoryOf(e))?.label ?? e.category;
  const canceled = /cancel/i.test(e.title);
  return (
    <div className="vc-meeting vc-event" data-tone={eventTone(e)} data-open={open}>
      <button type="button" className="vc-event-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <DateBox date={e.start.slice(0, 10)} />
        <div className="vc-meeting-main">
          <div className="vc-meeting-meta">
            <span className="vc-body-dot" />
            <span>{label}</span>
            <span className="vc-dot" />
            <span>{eventTimeLabel(e)}</span>
            {canceled && (
              <span className="vc-status-tag" data-kind="cancelled">
                Canceled
              </span>
            )}
          </div>
          <h3 className="vc-meeting-title">{e.title.replace(/^CANCELED\s*[-:|]?\s*/i, '')}</h3>
          {e.location && (
            <p className="vc-event-where">
              <MapPin size={12} strokeWidth={1.8} /> {e.location}
            </p>
          )}
        </div>
        <ChevronDown className="vc-meeting-go vc-event-chev" size={18} strokeWidth={1.6} aria-hidden="true" />
      </button>
      {open && (
        <div className="vc-event-more">
          {e.description ? <p className="vc-event-desc">{e.description}</p> : <p className="vc-event-desc vc-muted">No description was posted for this event.</p>}
          <a href={e.url} target="_blank" rel="noopener noreferrer" className="vc-secondary">
            On the city calendar <ArrowUpRight size={13} />
          </a>
        </div>
      )}
    </div>
  );
}

function Row({ item, today }: { item: CalItem; today: string }) {
  return item.kind === 'meeting' ? <MeetingRow m={item.m} today={today} cityTime={item.cityTime ?? null} /> : <EventRow e={item.e} />;
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

function Upcoming({ items, today, meetingsOnly }: { items: CalItem[]; today: string; meetingsOnly: boolean }) {
  const upcoming = items.filter((i) => i.date >= today);
  const recent = items.filter((i) => i.kind === 'meeting' && i.date < today).slice(-6).reverse();
  return (
    <>
      {upcoming.length ? (
        groupBy(upcoming.slice(0, 60), (i) => i.date.slice(0, 7)).map(([ym, list]) => (
          <section key={ym} className="vc-sched-group">
            <p className="vc-label">{monthLabel(ym)}</p>
            <div className="vc-sched-list">
              {list.map((i) => (
                <Row key={i.key} item={i} today={today} />
              ))}
            </div>
          </section>
        ))
      ) : (
        <div className="vc-empty">{meetingsOnly ? 'No upcoming meetings have been posted yet. The city usually posts agendas a few days ahead.' : 'Nothing upcoming has been posted yet.'}</div>
      )}
      {recent.length > 0 && (
        <section className="vc-sched-group">
          <p className="vc-label">Recently held</p>
          <div className="vc-sched-list">
            {recent.map((i) => (
              <Row key={i.key} item={i} today={today} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

const itemTone = (i: CalItem) => (i.kind === 'meeting' ? toneOf(i.m.governmentBodyId) : eventTone(i.e));
const itemName = (i: CalItem) => (i.kind === 'meeting' ? (i.m.governmentBodyName ?? i.m.title) : i.e.title.replace(/^CANCELED\s*[-:|]?\s*/i, ''));
const shortTime = (t: string | null) => (t ? (formatTime(t) ?? '').replace(':00', '').replace(' ', '').toLowerCase() : '');

function Calendar({ items, month, onMonth, today }: { items: CalItem[]; month: string; onMonth: (ym: string) => void; today: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  const byDay = useMemo(() => {
    const map = new Map<string, CalItem[]>();
    for (const i of items) map.set(i.date, [...(map.get(i.date) ?? []), i]);
    return map;
  }, [items]);
  const cells = monthGrid(month);
  const inMonth = items.filter((i) => i.date.startsWith(month));
  const dayList = selected ? (byDay.get(selected) ?? []) : inMonth;

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
                {list.slice(0, 3).map((i) =>
                  i.kind === 'meeting' ? (
                    <Link key={i.key} to={meetingHref(i.m)} className="vc-cal-event" data-tone={itemTone(i)} onClick={(e) => e.stopPropagation()} title={`${i.m.title}${i.time ? `, ${formatTime(i.time)}` : ''}`}>
                      <span className="vc-cal-time">{shortTime(i.time)}</span>
                      <span className="vc-cal-name">{itemName(i)}</span>
                    </Link>
                  ) : (
                    <button key={i.key} type="button" className="vc-cal-event" data-tone={itemTone(i)} title={itemName(i)} onClick={(e) => (e.stopPropagation(), setSelected(c.iso))}>
                      {i.time && <span className="vc-cal-time">{shortTime(i.time)}</span>}
                      <span className="vc-cal-name">{itemName(i)}</span>
                    </button>
                  ),
                )}
                {list.length > 3 && <span className="vc-cal-more">+{list.length - 3} more</span>}
              </div>
              <div className="vc-cal-dots" aria-hidden="true">
                {list.slice(0, 4).map((i) => (
                  <span key={i.key} data-tone={itemTone(i)} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <section className="vc-sched-group">
        <p className="vc-label">{selected ? dayMonth(selected) : `${inMonth.length} on the calendar in ${monthLabel(month)}`}</p>
        {dayList.length ? (
          <div className="vc-sched-list">
            {dayList.map((i) => (
              <Row key={i.key} item={i} today={today} />
            ))}
          </div>
        ) : (
          <div className="vc-empty">Nothing on the calendar for this month.</div>
        )}
      </section>
    </>
  );
}

function Past({ items, today }: { items: CalItem[]; today: string }) {
  const past = items.filter((i) => i.date < today).reverse();
  if (!past.length) return <div className="vc-empty">Nothing on the record for this year.</div>;
  return (
    <>
      {groupBy(past, (i) => i.date.slice(0, 7)).map(([ym, list]) => (
        <section key={ym} className="vc-sched-group">
          <p className="vc-label">
            {monthLabel(ym)} <span className="vc-label-count">{list.length}</span>
          </p>
          <div className="vc-sched-list">
            {list.map((i) => (
              <Row key={i.key} item={i} today={today} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

const TYPES: Array<{ id: 'all' | CategoryId; label: string; tone?: number }> = [{ id: 'all', label: 'All' }, ...CATEGORIES];

export default function MeetingsPage() {
  const [params, setParams] = useSearchParams();
  const today = todayIso();
  const thisYear = Number(today.slice(0, 4));
  const view = (VIEWS.some((v) => v.id === params.get('view')) ? params.get('view') : 'upcoming') as View;
  const type = (TYPES.some((t) => t.id === params.get('type')) ? params.get('type') : 'all') as 'all' | CategoryId;
  const body = type === 'meetings' ? params.get('body') : null;
  const month = /^\d{4}-\d{2}$/.test(params.get('month') ?? '') ? String(params.get('month')) : today.slice(0, 7);
  const yearParam = Number(params.get('year'));
  const year = yearParam >= 1990 && yearParam <= thisYear + 1 ? yearParam : thisYear;
  const bodies = useBodies();

  useEffect(() => {
    document.title = 'Calendar | Vineyard Transparency Portal';
  }, []);

  const firstYear = useMemo(() => {
    const ys = bodies.map((b) => Number(b.firstRecordDate?.slice(0, 4))).filter((y) => y > 1990);
    return ys.length ? Math.min(...ys) : thisYear - 5;
  }, [bodies, thisYear]);

  const monthYear = Number(month.slice(0, 4));
  const yearsNeeded = view === 'upcoming' ? [thisYear, thisYear + 1] : view === 'calendar' ? [monthYear] : [year];
  const load = useMeetings(yearsNeeded);
  const events = useEvents(yearsNeeded);

  const set = (next: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v == null) p.delete(k);
      else p.set(k, v);
    }
    setParams(p, { replace: true });
  };

  const loaded = load.status === 'done' ? load.data : null;
  const meetings = useMemo(() => loaded ?? [], [loaded]);
  const items = useMemo(() => mergeItems(meetings, events ?? []), [meetings, events]);
  const shown = useMemo(
    () =>
      items.filter((i) => {
        if (type === 'all') return true;
        if (i.kind === 'meeting') return type === 'meetings' && (!body || i.m.governmentBodyId === body);
        return categoryOf(i.e) === type && !body;
      }),
    [items, type, body],
  );

  const bodyChips = useMemo(() => {
    const withMeetings = bodies.filter((b) => (b.meetingCount ?? 0) > 0).map((b) => ({ id: b.id, name: b.name, count: b.meetingCount ?? 0 }));
    if (withMeetings.length) return withMeetings.sort((a, b) => b.count - a.count);
    const seen = new Map<string, { id: string; name: string; count: number }>();
    for (const m of meetings) {
      if (!m.governmentBodyId) continue;
      const cur = seen.get(m.governmentBodyId) ?? { id: m.governmentBodyId, name: m.governmentBodyName ?? m.governmentBodyId, count: 0 };
      cur.count++;
      seen.set(m.governmentBodyId, cur);
    }
    return [...seen.values()].sort((a, b) => b.count - a.count);
  }, [bodies, meetings]);
  const mainBodies = bodyChips.slice(0, MAIN_BODIES);
  const moreBodies = bodyChips.slice(MAIN_BODIES).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Frame wide>
      <header className="vc-page-head">
        <h1 className="vc-page-title">Calendar</h1>
        <p className="vc-page-sub">Public meetings, community events, recreation, library programs and trash days in Vineyard.</p>
      </header>

      <div className="vc-sched-controls">
        <div className="vc-segment" role="tablist" aria-label="View">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" role="tab" aria-selected={view === v.id} data-on={view === v.id} onClick={() => set({ view: v.id === 'upcoming' ? null : v.id })}>
              {v.label}
            </button>
          ))}
        </div>
        <div className="vc-filters vc-body-chips" role="group" aria-label="Show">
          {TYPES.map((t) => (
            <button
              key={t.id}
              type="button"
              className={t.tone != null ? 'vc-chip vc-chip-tone' : 'vc-chip'}
              data-tone={t.tone}
              data-active={type === t.id}
              onClick={() => set({ type: t.id === 'all' || type === t.id ? null : t.id, body: null })}
            >
              {t.tone != null && <span className="vc-body-dot" />} {t.label}
            </button>
          ))}
        </div>
      </div>

      {type === 'meetings' && bodyChips.length > 1 && (
        <div className="vc-filters vc-body-chips vc-subfilters" role="group" aria-label="Board or commission">
          <button type="button" className="vc-chip" data-active={!body} onClick={() => set({ body: null })}>
            All boards
          </button>
          {mainBodies.map((b) => (
            <button key={b.id} type="button" className="vc-chip vc-chip-tone" data-tone={toneOf(b.id)} data-active={body === b.id} onClick={() => set({ body: body === b.id ? null : b.id })}>
              <span className="vc-body-dot" /> {b.name}
            </button>
          ))}
          {moreBodies.length > 0 && <MoreBodies bodies={moreBodies} value={body} onPick={(id) => set({ body: id })} />}
        </div>
      )}

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
      {load.status === 'error' && <div className="vc-empty">The calendar could not be loaded right now. Please try again in a moment.</div>}
      {load.status === 'done' && view === 'upcoming' && <Upcoming items={shown} today={today} meetingsOnly={type === 'meetings'} />}
      {load.status === 'done' && view === 'calendar' && <Calendar items={shown} month={month} today={today} onMonth={(ym) => set({ month: ym === today.slice(0, 7) ? null : ym })} />}
      {load.status === 'done' && view === 'past' && <Past items={shown} today={today} />}

      <section className="vc-latest-sec" aria-label="City posts">
        <div className="vc-latest-sec-head">
          <h2>
            <Megaphone size={16} strokeWidth={1.9} />
            From the city on Facebook
          </h2>
          <Link to="/latest" className="vc-latest-more">
            Latest
          </Link>
        </div>
        <CityFacebook />
      </section>
    </Frame>
  );
}
