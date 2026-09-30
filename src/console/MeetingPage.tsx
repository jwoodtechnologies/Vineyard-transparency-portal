/** /meetings/:meetingId : one meeting, its documents, video, and what is on the agenda. */
import '@fontsource-variable/inter';
import '@fontsource-variable/source-serif-4';
import './console.css';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, Clock, FileText, MapPin, MessageSquare, Video } from 'lucide-react';
import type { Meeting } from '@/types/models';
import { DocumentService, MeetingService } from '@/services';
import { Frame } from './Chrome';
import { agendaOutline, formatTime, longDate, statusLabel, todayIso, toneOf, type OutlineItem } from './meetings';
import { MeetingDocList } from './MeetingDocs';
import { useMeetingDocs } from './meetingDocs';

type Load<T> = { status: 'loading' } | { status: 'error' } | { status: 'done'; data: T };

function useMeeting(id: string): Load<Meeting> {
  const [state, setState] = useState<{ id: string; value: Load<Meeting> }>({ id: '', value: { status: 'loading' } });
  useEffect(() => {
    let live = true;
    MeetingService.get(id).then(
      (m) => live && setState({ id, value: { status: 'done', data: m } }),
      () => live && setState({ id, value: { status: 'error' } }),
    );
    return () => {
      live = false;
    };
  }, [id]);
  return state.id === id ? state.value : { status: 'loading' };
}

/** Agenda outline from structured items when the source had them, otherwise from the agenda text. */
function useOutline(meeting: Meeting | null): Load<OutlineItem[]> {
  const docId = meeting && !meeting.agendaItems.length ? (meeting.agendaDocumentId ?? meeting.packetDocumentId) : null;
  const [state, setState] = useState<{ id: string | null; value: Load<OutlineItem[]> }>({ id: null, value: { status: 'loading' } });
  useEffect(() => {
    if (!docId) return;
    let live = true;
    DocumentService.text(docId).then(
      (pages) => live && setState({ id: docId, value: { status: 'done', data: agendaOutline(pages.slice(0, 6).map((p) => p.text).join('\n')) } }),
      () => live && setState({ id: docId, value: { status: 'error' } }),
    );
    return () => {
      live = false;
    };
  }, [docId]);
  if (!meeting) return { status: 'loading' };
  if (meeting.agendaItems.length) {
    const flat: OutlineItem[] = [];
    const walk = (items: Meeting['agendaItems'], depth: number) =>
      items.forEach((i) => {
        flat.push({ number: i.number, title: i.title, detail: i.description ?? null, depth });
        if (i.children?.length) walk(i.children, depth + 1);
      });
    walk(meeting.agendaItems, 0);
    return { status: 'done', data: flat };
  }
  if (!docId) return { status: 'done', data: [] };
  return state.id === docId ? state.value : { status: 'loading' };
}

function askAbout(m: Meeting, upcoming: boolean): string {
  const when = longDate(m.date);
  const q = upcoming ? `What is on the agenda for the ${m.title} on ${when}?` : `What happened at the ${m.title} on ${when}?`;
  return `/?q=${encodeURIComponent(q)}`;
}

export default function MeetingPage() {
  const { meetingId = '' } = useParams();
  const load = useMeeting(meetingId);
  const meeting = load.status === 'done' ? load.data : null;
  const outline = useOutline(meeting);
  const records = useMeetingDocs(meeting?.id ?? null);
  const today = todayIso();

  useEffect(() => {
    if (meeting) document.title = `${meeting.title}, ${longDate(meeting.date)} | Vineyard Transparency Portal`;
  }, [meeting]);

  if (load.status === 'error') {
    return (
      <Frame>
        <Link to="/meetings" className="vc-back">
          <ArrowLeft size={15} /> Calendar
        </Link>
        <div className="vc-empty" style={{ marginTop: '2rem' }}>
          That meeting is not in the archive.
        </div>
      </Frame>
    );
  }
  if (!meeting) {
    return (
      <Frame>
        <div className="vc-skeleton" aria-hidden="true" style={{ marginTop: '3rem' }}>
          <span style={{ width: '40%' }} />
          <span style={{ width: '80%' }} />
          <span style={{ width: '65%' }} />
        </div>
      </Frame>
    );
  }

  const upcoming = meeting.date >= today;
  const status = statusLabel(meeting, today);
  const video = meeting.media.find((x) => x.kind === 'video' && x.url);
  const docs: Array<{ label: string; id: string | null }> = [
    { label: 'Agenda', id: meeting.agendaDocumentId },
    { label: 'Packet', id: meeting.packetDocumentId },
    { label: 'Minutes', id: meeting.minutesDocumentId },
  ];

  return (
    <Frame>
      <Link to="/meetings" className="vc-back">
        <ArrowLeft size={15} /> Calendar
      </Link>

      <header className="vc-mtg-head" data-tone={toneOf(meeting.governmentBodyId)}>
        <p className="vc-mtg-body">
          <span className="vc-body-dot" /> {meeting.governmentBodyName ?? 'Public meeting'}
          {status && <span className="vc-status-tag" data-kind={status.toLowerCase()}>{status}</span>}
        </p>
        <h1 className="vc-page-title">{meeting.title}</h1>
        <div className="vc-mtg-facts">
          <span>{longDate(meeting.date)}</span>
          {formatTime(meeting.startTime) && (
            <span>
              <Clock size={14} strokeWidth={1.8} /> {formatTime(meeting.startTime)}
            </span>
          )}
          {meeting.location && (
            <span>
              <MapPin size={14} strokeWidth={1.8} /> {meeting.location}
            </span>
          )}
        </div>
      </header>

      <div className="vc-mtg-actions">
        {docs.map((d) =>
          d.id ? (
            <Link key={d.label} to={`/documents/${encodeURIComponent(d.id)}`} className="vc-secondary">
              <FileText size={15} strokeWidth={1.8} /> {d.label}
            </Link>
          ) : null,
        )}
        {video?.url && (
          <a href={video.url} target="_blank" rel="noopener noreferrer" className="vc-secondary">
            <Video size={15} strokeWidth={1.8} /> Video <ArrowUpRight size={13} />
          </a>
        )}
        <Link to={askAbout(meeting, upcoming)} className="vc-primary">
          <MessageSquare size={15} strokeWidth={1.8} /> Ask about this meeting
        </Link>
      </div>

      {records.docs.length > 0 && (
        <section className="vc-sched-group">
          <p className="vc-label">
            Every record from this meeting · {records.docs.length}
          </p>
          <MeetingDocList docs={records.docs} />
        </section>
      )}

      <section className="vc-sched-group">
        <p className="vc-label">On the agenda</p>
        {outline.status === 'loading' && (
          <div className="vc-skeleton" aria-hidden="true">
            <span style={{ width: '90%' }} />
            <span style={{ width: '75%' }} />
            <span style={{ width: '82%' }} />
          </div>
        )}
        {outline.status === 'error' && <div className="vc-empty">The agenda text could not be loaded. Open the agenda above to read it.</div>}
        {outline.status === 'done' && outline.data.length > 0 && (
          <ol className="vc-agenda">
            {outline.data.map((it, i) => (
              <li key={`${it.number}-${i}`} data-depth={Math.min(it.depth, 2)}>
                <span className="vc-agenda-num">{it.number}</span>
                <div>
                  <p className="vc-agenda-title">{it.title}</p>
                  {it.detail && <p className="vc-agenda-detail">{it.detail}</p>}
                </div>
              </li>
            ))}
          </ol>
        )}
        {outline.status === 'done' && !outline.data.length && (
          <div className="vc-empty">{meeting.agendaDocumentId || meeting.packetDocumentId ? 'Open the agenda above to see every item.' : upcoming ? 'The agenda has not been posted yet.' : 'No agenda was posted for this meeting.'}</div>
        )}
      </section>

      {meeting.sourceIds.length > 0 && (
        <p className="vc-fineprint">From the city&apos;s public meeting portal. Always check the official documents.</p>
      )}
    </Frame>
  );
}
