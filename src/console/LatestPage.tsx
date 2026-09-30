/** /latest : what is new around Vineyard, checked every hour. */
import '@fontsource-variable/inter';
import '@fontsource-variable/source-serif-4';
import './console.css';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, CalendarDays, Clock, FileText, MapPin, Megaphone, Shield, Sparkles } from 'lucide-react';
import { Frame } from './Chrome';
import { useJson, type Latest } from './api';
import { TYPE_LABEL, formatDate } from './format';
import { CATEGORIES, categoryOf, dayNumber, eventTone, formatTime, monthShort, todayIso, toneOf, useEvents, weekdayShort, type PortalEvent } from './meetings';

type Tab = 'all' | 'meetings' | 'records' | 'events' | 'safety';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'all', label: 'Everything' },
  { id: 'meetings', label: 'Meetings' },
  { id: 'records', label: 'Just posted' },
  { id: 'events', label: 'Around town' },
  { id: 'safety', label: 'Public safety' },
];

function ago(iso: string | null): string | null {
  if (!iso) return null;
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(mins) || mins < 0) return null;
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} minutes ago`;
  const h = Math.round(mins / 60);
  return h < 24 ? `${h} hour${h === 1 ? '' : 's'} ago` : `${Math.round(h / 24)} days ago`;
}

function DateTile({ iso }: { iso: string }) {
  return (
    <span className="vc-meeting-date" aria-hidden="true">
      <span className="vc-meeting-mon">{monthShort(iso)}</span>
      <span className="vc-meeting-day">{dayNumber(iso)}</span>
      <span className="vc-meeting-dow">{weekdayShort(iso)}</span>
    </span>
  );
}

const bodySlug = (name: string | null) => (name ? name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') : null);

function Section({ title, icon, children, more }: { title: string; icon: ReactNode; children: ReactNode; more?: ReactNode }) {
  return (
    <section className="vc-latest-sec">
      <div className="vc-latest-sec-head">
        <h2>
          {icon}
          {title}
        </h2>
        {more}
      </div>
      {children}
    </section>
  );
}

function Skeleton() {
  return (
    <div className="vc-skeleton" aria-hidden="true">
      <span style={{ width: '92%' }} />
      <span style={{ width: '78%' }} />
      <span style={{ width: '85%' }} />
    </div>
  );
}

export default function LatestPage() {
  const [tab, setTab] = useState<Tab>('all');
  const load = useJson<Latest>('/api/latest');
  const today = todayIso();
  const year = Number(today.slice(0, 4));
  const events = useEvents(today.slice(5, 7) === '12' ? [year, year + 1] : [year]);
  const data = load.status === 'done' ? load.data : null;

  useEffect(() => {
    document.title = 'Latest | Vineyard Transparency Portal';
  }, []);

  const upcomingEvents = useMemo(() => {
    const end = new Date(`${today}T12:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 14);
    const until = end.toISOString().slice(0, 10);
    const seen = new Set<string>();
    return (events ?? [])
      .filter((e) => categoryOf(e) !== 'meetings' && e.start.slice(0, 10) >= today && e.start.slice(0, 10) <= until)
      .filter((e) => {
        const k = `${e.title}|${e.start.slice(0, 10)}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .sort((a, b) => a.start.localeCompare(b.start))
      .slice(0, 10);
  }, [events, today]);

  const show = (t: Tab) => tab === 'all' || tab === t;
  const updated = ago(data?.updatedAt ?? null);

  return (
    <Frame>
      <header className="vc-page-head vc-latest-head">
        <p className="vc-latest-kicker">
          <span className="vc-live-dot" aria-hidden="true" /> Checked every hour{updated ? ` · updated ${updated}` : ''}
        </p>
        <h1 className="vc-page-title">Latest</h1>
        <p className="vc-page-sub">New agendas and minutes, upcoming meetings, events around town and public safety updates in Vineyard.</p>
      </header>

      <div className="vc-filters vc-body-chips vc-latest-tabs" role="tablist" aria-label="Show">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className="vc-chip" data-active={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {load.status === 'error' && <div className="vc-empty">The latest updates could not be loaded. Try again in a moment.</div>}

      {show('meetings') && (
        <Section
          title="Coming up"
          icon={<CalendarDays size={16} strokeWidth={1.9} />}
          more={
            <Link to="/meetings" className="vc-latest-more">
              Full calendar
            </Link>
          }
        >
          {!data ? (
            <Skeleton />
          ) : data.upcoming.length ? (
            <div className="vc-sched-list">
              {data.upcoming.map((m) => (
                <Link key={m.id} to={`/meetings/${encodeURIComponent(m.id)}`} className="vc-meeting" data-tone={toneOf(bodySlug(m.body))}>
                  {m.date && <DateTile iso={m.date} />}
                  <span className="vc-meeting-main">
                    <span className="vc-meeting-title">{m.title}</span>
                    <span className="vc-meeting-meta">
                      {[m.body && !m.title.toLowerCase().startsWith(m.body.toLowerCase()) ? m.body : null, formatTime(m.time), m.location?.split(',')[0]].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="vc-pill vc-latest-pill" data-tone={m.agendaPosted ? 'good' : undefined}>
                    {m.agendaPosted ? 'Agenda posted' : 'Agenda soon'}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="vc-empty">No public meetings are scheduled in the next three weeks.</div>
          )}
        </Section>
      )}

      {show('records') && (
        <Section title="Just posted" icon={<Sparkles size={16} strokeWidth={1.9} />}>
          {!data ? (
            <Skeleton />
          ) : data.posted.length ? (
            <ul className="vc-mdocs">
              {data.posted.map((d) => (
                <li key={d.id}>
                  <Link to={`/documents/${encodeURIComponent(d.id)}`} className="vc-mdoc">
                    <span className="vc-mdoc-icon" data-kind={['agenda', 'agenda_packet', 'minutes'].includes(d.type) ? d.type : 'other'}>
                      <FileText size={15} strokeWidth={1.8} />
                    </span>
                    <span className="vc-mdoc-main">
                      <span className="vc-mdoc-title">{d.title}</span>
                      <span className="vc-mdoc-meta">
                        {[TYPE_LABEL[d.type as keyof typeof TYPE_LABEL] ?? 'Record', d.meetingTitle ?? d.body, formatDate(d.date)].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <ArrowUpRight size={15} className="vc-mdoc-go" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="vc-empty">Nothing new has been posted in the last few weeks.</div>
          )}
        </Section>
      )}

      {show('events') && (
        <Section title="Around town" icon={<MapPin size={16} strokeWidth={1.9} />}>
          {events === null ? (
            <Skeleton />
          ) : upcomingEvents.length ? (
            <div className="vc-sched-list">
              {upcomingEvents.map((e: PortalEvent) => (
                <a key={e.id} href={e.url || '/meetings'} className="vc-meeting" data-tone={eventTone(e)} target={e.url ? '_blank' : undefined} rel="noopener noreferrer">
                  <DateTile iso={e.start.slice(0, 10)} />
                  <span className="vc-meeting-main">
                    <span className="vc-meeting-title">{e.title}</span>
                    <span className="vc-meeting-meta">
                      {[CATEGORIES.find((c) => c.id === categoryOf(e))?.label, e.allDay ? 'All day' : formatTime(e.start.slice(11, 16)), e.location].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <Clock size={15} className="vc-mdoc-go" />
                </a>
              ))}
            </div>
          ) : (
            <div className="vc-empty">No community events are on the city calendar for the next two weeks.</div>
          )}
        </Section>
      )}

      {show('safety') && (
        <Section title="Public safety" icon={<Shield size={16} strokeWidth={1.9} />}>
          {!data ? (
            <Skeleton />
          ) : data.sheriff.length ? (
            <div className="vc-news">
              {data.sheriff.map((n) => (
                <a key={n.id} href={n.url} target="_blank" rel="noopener noreferrer" className="vc-news-card">
                  <span className="vc-news-src">Utah County Sheriff&apos;s Office{n.date ? ` · ${formatDate(n.date.slice(0, 10))}` : ''}</span>
                  <span className="vc-news-title">{n.title}</span>
                  {n.summary && <span className="vc-news-sum">{n.summary}</span>}
                  <span className="vc-news-go">
                    Read the release <ArrowUpRight size={13} />
                  </span>
                </a>
              ))}
            </div>
          ) : (
            <div className="vc-empty">No recent Sheriff&apos;s Office releases mention Vineyard.</div>
          )}
        </Section>
      )}

      {(tab === 'all' || tab === 'safety') && data && (
        <Section title="Follow for daily posts" icon={<Megaphone size={16} strokeWidth={1.9} />}>
          <div className="vc-follow">
            {data.follow.map((f) => (
              <a key={f.handle} href={f.url} target="_blank" rel="noopener noreferrer" className="vc-follow-card">
                <span className="vc-follow-badge" aria-hidden="true">
                  f
                </span>
                <span className="vc-follow-main">
                  <span className="vc-follow-name">{f.name}</span>
                  <span className="vc-follow-handle">facebook.com/{f.handle}</span>
                </span>
                <ArrowUpRight size={15} className="vc-mdoc-go" />
              </a>
            ))}
          </div>
        </Section>
      )}
    </Frame>
  );
}
