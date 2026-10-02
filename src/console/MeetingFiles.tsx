import { FileText, Video } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { MeetingSummary } from '@/types/models';
import { DocLink } from './DocLink';
import { useDraftMinutes } from './meetingDocs';
import { formatDate } from './format';
import { meetingHref, todayIso } from './meetings';

/**
 * The agenda, packet, minutes and video of one meeting, as tags. Each document tag opens the PDF itself in a new
 * tab. With `showMissing`, a meeting whose minutes are not posted says so instead of showing nothing.
 */
export function MeetingFiles({ m, showMissing = false }: { m: MeetingSummary; showMissing?: boolean }) {
  const draft = useDraftMinutes(m, showMissing && m.date < todayIso() && /council|redevelopment|planning commission/i.test(m.governmentBodyName ?? ''));
  return (
    <div className="vc-meeting-docs">
      {m.agendaDocumentId && (
        <DocLink id={m.agendaDocumentId} className="vc-tag" title="Open the agenda (PDF)">
          <FileText size={11} strokeWidth={2} /> Agenda
        </DocLink>
      )}
      {m.packetDocumentId && (
        <DocLink id={m.packetDocumentId} className="vc-tag" title="Open the agenda packet (PDF)">
          <FileText size={11} strokeWidth={2} /> Packet
        </DocLink>
      )}
      {m.minutesDocumentId ? (
        <DocLink id={m.minutesDocumentId} className="vc-tag" title="Open the minutes (PDF)">
          <FileText size={11} strokeWidth={2} /> {m.minutesStatus === 'draft' ? 'Draft minutes' : 'Minutes'}
        </DocLink>
      ) : draft ? (
        <DocLink
          id={draft.documentId}
          page={draft.page}
          className="vc-tag"
          title={`The council has not approved these yet. The draft is printed in the ${formatDate(draft.date) ?? 'next'} agenda packet, page ${draft.page}.`}
        >
          <FileText size={11} strokeWidth={2} /> Draft minutes
        </DocLink>
      ) : (
        showMissing && (
          <span className="vc-tag" data-muted="true">
            Minutes not posted yet
          </span>
        )
      )}
      {m.hasVideo && (
        <Link to={meetingHref(m)} className="vc-tag">
          <Video size={11} strokeWidth={2} /> Video
        </Link>
      )}
    </div>
  );
}
