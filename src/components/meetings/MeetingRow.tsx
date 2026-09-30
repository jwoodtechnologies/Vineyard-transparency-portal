import { Link } from 'react-router-dom';
import { AudioLines, FileCheck2, FileStack, MessageSquareText, Video } from 'lucide-react';
import type { MeetingSummary } from '@/types/models';
import { Badge, DemoBadge } from '@/components/ui/Badge';
import { formatDate, formatTime } from '@/lib/format';

export function MeetingRow({ m }: { m: MeetingSummary }) {
  const [month, day] = [formatDate(m.date, 'medium').split(' ')[0], Number(m.date.slice(8, 10))];
  return (
    <Link to={`/meetings/${encodeURIComponent(m.id)}`} className="group flex gap-4 p-4 hover:bg-raised sm:items-center">
      <span className="flex w-14 shrink-0 flex-col items-center rounded-lg border border-line bg-canvas py-1.5">
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-accent">{month}</span>
        <span className="text-xl font-semibold leading-tight tabular-nums">{day}</span>
        <span className="text-[10.5px] tabular-nums text-subtle">{m.date.slice(0, 4)}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="font-semibold group-hover:text-accent">{m.title}</span>
          {m.isDemo && <DemoBadge />}
          {m.status === 'scheduled' && <Badge tone="accent">Upcoming</Badge>}
          {m.status === 'cancelled' && <Badge tone="danger">Cancelled</Badge>}
        </span>
        <span className="mt-0.5 block text-[13px] text-subtle">
          {m.governmentBodyName}
          {m.startTime ? ` · ${formatTime(m.startTime)}` : ''}
          {m.location ? ` · ${m.location}` : ''}
        </span>
        <span className="mt-2 flex flex-wrap gap-1.5">
          <Badge tone={m.agendaDocumentId ? 'neutral' : 'neutral'} icon={<FileStack className="size-3" aria-hidden />}>
            {m.agendaItemCount} items
          </Badge>
          {m.packetDocumentId && <Badge>Packet</Badge>}
          {m.minutesDocumentId && (
            <Badge tone={m.minutesStatus === 'approved' ? 'ok' : 'warn'} icon={<FileCheck2 className="size-3" aria-hidden />}>
              {m.minutesStatus === 'approved' ? 'Minutes' : 'Draft minutes'}
            </Badge>
          )}
          {m.hasVideo && <Badge icon={<Video className="size-3" aria-hidden />}>Video</Badge>}
          {m.hasAudio && <Badge icon={<AudioLines className="size-3" aria-hidden />}>Audio</Badge>}
          {m.hasTranscript && <Badge icon={<MessageSquareText className="size-3" aria-hidden />}>Transcript</Badge>}
        </span>
      </span>
    </Link>
  );
}
