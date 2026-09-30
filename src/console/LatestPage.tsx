/** /latest : what is new around Vineyard, checked every hour. */
import '@fontsource-variable/inter';
import '@fontsource-variable/source-serif-4';
import './console.css';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, CalendarDays, Clock, FileText, MapPin, Megaphone, Shield, Sparkles } from 'lucide-react';
import { Frame } from './Chrome';
import { useJson, type Latest } from './api';
import { TYPE_LABEL, formatDate } from './format';
import { CATEGORIES, categoryOf, dayNumber, eventTone, formatTime, monthShort, todayIso, toneOf, useEvents, weekdayShort, type PortalEvent } from './meetings';

type Tab = 'all' | 'posts' | 'meetings' | 'records' | 'events' | 'safety';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'all', label: 'Everything' },
  { id: 'posts', label: 'City posts' },
  { id: 'meetings', label: 'Meetings' },
  { id: 'records', label: 'New records' },
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

const FEEDS = [
  { id: 'city', name: 'Vineyard City', url: 'https://www.facebook.com/VineyardCity/' },
  { id: 'ucso', name: "Sheriff's Office, Vineyard", url: 'https://www.facebook.com/VineyardUCSO' },
];

/**
 * The newest posts from the City and the Sheriff's Office Vineyard page, shown with Facebook's own
 * official Page embed (live from Facebook on every visit, so it is always current).
 */
function FacebookFeeds() {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [pick, setPick] = useState(FEEDS[0].id);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(Math.round(el.clientWidth / 10) * 10);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const two = width >= 700;
  const each = Math.max(180, Math.min(500, two ? Math.floor((width - 12) / 2) : width));
  const shown = two ? FEEDS : FEEDS.filter((f) => f.id === pick);
  const src = (url: string) =>
    `https://www.facebook.com/plugins/page.php?${new URLSearchParams({ href: url, tabs: 'timeline', width: String(each), height: '640', small_header: 'true', adapt_container_width: 'true', hide_cover: 'true', show_facepile: 'false' })}`;
  return (
    <div ref={box}>
      {!two && (
        <div className="vc-segment vc-feed-pick" role="radiogroup" aria-label="Page">
          {FEEDS.map((f) => (
            <button key={f.id} type="button" role="radio" aria-checked={pick === f.id} data-on={pick === f.id} onClick={() => setPick(f.id)}>
              {f.name}
            </button>
          ))}
        </div>
      )}
      <div className="vc-feeds" data-two={two}>
        {width > 0 &&
          shown.map((f) => (
            <div key={f.id} className="vc-feed">
              <iframe title={`${f.name} on Facebook`} src={src(f.url)} width={each} height={640} loading="lazy" allow="encrypted-media" referrerPolicy="strict-origin-when-cross-origin" />
              <a href={f.url} target="_blank" rel="noopener noreferrer" className="vc-feed-open">
                Open {f.name} on Facebook <ArrowUpRight size={13} />
              </a>
            </div>
          ))}
      </div>
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
          <span className="vc-live-dot" aria-hidden="true" /> Live posts · records checked every hour{updated ? `, last ${updated}` : ''}
        </p>
        <h1 className="vc-page-title">Latest</h1>
        <p className="vc-page-sub">The newest posts from the City and the Sheriff&apos;s Office, upcoming meetings, events around town and newly posted records.</p>
      </header>

      <div className="vc-filters vc-body-chips vc-latest-tabs" role="tablist" aria-label="Show">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className="vc-chip" data-active={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {load.status === 'error' && <div className="vc-empty">The latest updates could not be loaded. Try again in a moment.</div>}

      {show('posts') && (
        <Section title="Latest posts" icon={<Megaphone size={16} strokeWidth={1.9} />}>
          <FacebookFeeds />
        </Section>
      )}

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

      {show('records') && (
        <Section title="New records" icon={<Sparkles size={16} strokeWidth={1.9} />}>
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

    </Frame>
  );
}
