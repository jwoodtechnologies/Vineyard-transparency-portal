/** /latest : the newest from Vineyard City in three parts: the last council meeting, recent board meetings, city posts. */
import '@fontsource-variable/inter';
import '@fontsource-variable/source-serif-4';
import './console.css';
import { useEffect, useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, FileText, Megaphone, Users } from 'lucide-react';
import type { MeetingSummary } from '@/types/models';
import { Frame } from './Chrome';
import { CityFacebook } from './FacebookFeed';
import { MeetingFiles } from './MeetingFiles';
import { dayNumber, formatTime, longDate, meetingHref, monthShort, todayIso, toneOf, useMeetings, weekdayShort } from './meetings';

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

function DateBox({ date }: { date: string }) {
  return (
    <div className="vc-meeting-date" aria-hidden="true">
      <span className="vc-meeting-mon">{monthShort(date)}</span>
      <span className="vc-meeting-day">{dayNumber(date)}</span>
      <span className="vc-meeting-dow">{weekdayShort(date)}</span>
    </div>
  );
}

function MeetingCard({ m, featured = false }: { m: MeetingSummary; featured?: boolean }) {
  return (
    <div className="vc-meeting vc-latest-meeting" data-tone={toneOf(m.governmentBodyId)} data-featured={featured || undefined}>
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
        </div>
        <Link to={meetingHref(m)} className="vc-latest-meeting-title">
          <h3 className="vc-meeting-title">{m.title}</h3>
        </Link>
        <MeetingFiles m={m} showMissing />
      </div>
      <Link to={meetingHref(m)} className="vc-meeting-go" aria-label={`Open ${m.title}`}>
        <ChevronRight size={18} strokeWidth={1.6} />
      </Link>
    </div>
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
  const today = todayIso();
  const year = Number(today.slice(0, 4));
  // Early in the year the last meeting may have been in December.
  const load = useMeetings(Number(today.slice(5, 7)) <= 2 ? [year - 1, year] : [year]);

  useEffect(() => {
    document.title = 'Latest | Vineyard Transparency Portal';
  }, []);

  const { council, minutes, next, boards } = useMemo(() => {
    if (load.status !== 'done') return { council: null, minutes: null, next: null, boards: [] as MeetingSummary[] };
    const all = load.data.filter((m) => m.status !== 'cancelled' && m.status !== 'postponed');
    const held = all.filter((m) => m.date < today && (m.agendaDocumentId || m.packetDocumentId || m.minutesDocumentId));
    const isCouncil = (m: MeetingSummary) => m.governmentBodyId === 'city-council';
    const lastCouncil = [...held].reverse().find(isCouncil) ?? null;
    const lastMinutes = [...held].reverse().find((m) => isCouncil(m) && m.minutesDocumentId) ?? null;
    const nextCouncil = all.find((m) => m.date >= today && m.governmentBodyId === 'city-council') ?? null;
    const seen = new Set<string>(['city-council']);
    const latestBoards: MeetingSummary[] = [];
    for (const m of [...held].reverse()) {
      if (seen.has(m.governmentBodyId)) continue;
      seen.add(m.governmentBodyId);
      latestBoards.push(m);
      if (latestBoards.length >= 5) break;
    }
    return { council: lastCouncil, minutes: lastMinutes, next: nextCouncil, boards: latestBoards };
  }, [load, today]);

  return (
    <Frame>
      <header className="vc-page-head vc-latest-head">
        <h1 className="vc-page-title">Latest</h1>
      </header>

      <Section
        title="Last City Council meeting"
        icon={<Users size={16} strokeWidth={1.9} />}
        more={
          <Link to="/votes" className="vc-latest-more">
            How each member voted
          </Link>
        }
      >
        {load.status === 'loading' && <Skeleton />}
        {load.status === 'error' && <div className="vc-empty">Meetings could not be loaded right now. Try again in a moment.</div>}
        {load.status === 'done' && (council ? <MeetingCard m={council} featured /> : <div className="vc-empty">No regular City Council meeting has been posted yet.</div>)}
        {council && minutes && minutes.id !== council.id && (
          <>
            <p className="vc-latest-next">Most recent council minutes posted:</p>
            <MeetingCard m={minutes} />
          </>
        )}
        {next && (
          <p className="vc-latest-next">
            Next meeting: <Link to={meetingHref(next)}>{longDate(next.date)}{formatTime(next.startTime) ? `, ${formatTime(next.startTime)}` : ''}</Link>
          </p>
        )}
      </Section>

      <Section
        title="Latest board meetings"
        icon={<FileText size={16} strokeWidth={1.9} />}
        more={
          <Link to="/meetings?view=past" className="vc-latest-more">
            All past meetings
          </Link>
        }
      >
        {load.status === 'loading' && <Skeleton />}
        {load.status === 'done' && (boards.length ? <div className="vc-sched-list">{boards.map((m) => <MeetingCard key={m.id} m={m} />)}</div> : <div className="vc-empty">No board or commission meetings have been posted yet.</div>)}
      </Section>

      <Section title="From the city on Facebook" icon={<Megaphone size={16} strokeWidth={1.9} />}>
        <CityFacebook />
      </Section>
    </Frame>
  );
}
