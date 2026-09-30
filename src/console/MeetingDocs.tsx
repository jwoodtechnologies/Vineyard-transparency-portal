/**
 * Every record published for one meeting: the agenda, packet and minutes first, then each
 * attachment (staff reports, ordinances, contracts, presentations...). Used as a slide-over sheet
 * from a document ("Everything from this meeting") and inline on the meeting page.
 */
import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, ChevronRight, FileText, Layers, X } from 'lucide-react';
import type { DocLite } from './api';
import { useMeetingDocs } from './meetingDocs';
import { TYPE_LABEL, formatDate } from './format';

export function MeetingDocList({ docs, currentId, onPick }: { docs: DocLite[]; currentId?: string; onPick?: () => void }) {
  return (
    <ul className="vc-mdocs">
      {docs.map((d) => (
        <li key={d.id}>
          <Link to={`/documents/${encodeURIComponent(d.id)}`} className="vc-mdoc" data-current={d.id === currentId} aria-current={d.id === currentId ? 'page' : undefined} onClick={onPick}>
            <span className="vc-mdoc-icon" data-kind={['agenda', 'agenda_packet', 'minutes'].includes(d.documentType) ? d.documentType : 'other'}>
              <FileText size={15} strokeWidth={1.8} />
            </span>
            <span className="vc-mdoc-main">
              <span className="vc-mdoc-title">{d.title}</span>
              <span className="vc-mdoc-meta">
                {TYPE_LABEL[d.documentType as keyof typeof TYPE_LABEL] ?? 'Record'}
                {d.pageCount ? ` · ${d.pageCount} ${d.pageCount === 1 ? 'page' : 'pages'}` : ''}
                {d.id === currentId ? ' · Open now' : ''}
              </span>
            </span>
            <ChevronRight size={16} className="vc-mdoc-go" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function MeetingDocsSheet({ meeting, currentId, onClose }: { meeting: { id: string; title: string; date: string | null }; currentId?: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const { status, docs } = useMeetingDocs(meeting.id);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <>
      <div className="vc-scrim" onClick={onClose} aria-hidden="true" />
      <aside className="vc-drawer vc-drawer-docs" role="dialog" aria-modal="true" aria-labelledby="vc-mdocs-title">
        <div className="vc-drawer-head">
          <span className="vc-label" style={{ margin: 0 }}>
            <Layers size={13} strokeWidth={2} style={{ verticalAlign: '-2px', marginRight: 6 }} />
            Everything from this meeting
          </span>
          <button ref={closeRef} type="button" className="vc-ghost" data-icon-only="true" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="vc-drawer-body">
          <h2 id="vc-mdocs-title" className="vc-drawer-title">
            {meeting.title}
          </h2>
          {meeting.date && <p className="vc-mdocs-date">{formatDate(meeting.date)}</p>}
          {status === 'loading' && (
            <div className="vc-skeleton" aria-hidden="true">
              <span style={{ width: '92%' }} />
              <span style={{ width: '80%' }} />
              <span style={{ width: '86%' }} />
            </div>
          )}
          {status === 'error' && <div className="vc-empty">The list could not be loaded. Try again in a moment.</div>}
          {status === 'done' && !docs.length && <div className="vc-empty">No other records from this meeting are in the archive yet.</div>}
          {status === 'done' && docs.length > 0 && (
            <>
              <p className="vc-mdocs-count">
                {docs.length} {docs.length === 1 ? 'record' : 'records'}
              </p>
              <MeetingDocList docs={docs} currentId={currentId} onPick={onClose} />
            </>
          )}
        </div>
        <div className="vc-drawer-actions">
          <Link className="vc-secondary" to={`/meetings/${encodeURIComponent(meeting.id)}`} onClick={onClose}>
            <CalendarDays size={15} strokeWidth={1.8} /> Meeting page
          </Link>
        </div>
      </aside>
    </>
  );
}
