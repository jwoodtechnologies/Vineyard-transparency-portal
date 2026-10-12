/** Shapes and small helpers for the staff Notices screen. */

export type NoticeStatus = 'showing' | 'scheduled' | 'ended' | 'hidden';

export interface NoticeItem {
  id: string;
  tone: 'info' | 'alert';
  message: string;
  linkUrl: string | null;
  linkLabel: string | null;
  startsOn: string | null;
  endsOn: string | null;
  shown: boolean;
  status: NoticeStatus;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

export const MESSAGE_MAX = 280;

export const STATUS_LABEL: Record<NoticeStatus, string> = { showing: 'Showing now', scheduled: 'Scheduled', ended: 'Ended', hidden: 'Hidden' };

export interface NoticeDraft {
  message: string;
  tone: 'info' | 'alert';
  linkUrl: string;
  linkLabel: string;
  startsOn: string;
  endsOn: string;
}

export const EMPTY_NOTICE: NoticeDraft = { message: '', tone: 'info', linkUrl: '', linkLabel: '', startsOn: '', endsOn: '' };

export const draftOf = (n: NoticeItem): NoticeDraft => ({
  message: n.message,
  tone: n.tone,
  linkUrl: n.linkUrl ?? '',
  linkLabel: n.linkLabel ?? '',
  startsOn: n.startsOn ?? '',
  endsOn: n.endsOn ?? '',
});

/** The same checks the server makes. Empty means fine. */
export function checkNotice(d: NoticeDraft): string {
  const message = d.message.replace(/\s+/g, ' ').trim();
  if (!message) return 'Write the notice.';
  if (message.length > MESSAGE_MAX) return `Keep the notice under ${MESSAGE_MAX} characters.`;
  const link = d.linkUrl.trim();
  if (link) {
    try {
      const u = new URL(link.includes('://') ? link : `https://${link}`);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'That web address does not look right.';
    } catch {
      return 'That web address does not look right.';
    }
  }
  if (d.startsOn && d.endsOn && d.endsOn < d.startsOn) return 'The last day is before the first day.';
  return '';
}

/** "Shows Oct 12 to Oct 14", "Shows from Oct 12", "Shows until Oct 14" or "No end date". */
export function whenLine(n: Pick<NoticeItem, 'startsOn' | 'endsOn'>, day: (iso: string) => string): string {
  if (n.startsOn && n.endsOn) return n.startsOn === n.endsOn ? `Shows ${day(n.startsOn)} only` : `Shows ${day(n.startsOn)} to ${day(n.endsOn)}`;
  if (n.startsOn) return `Shows from ${day(n.startsOn)}`;
  if (n.endsOn) return `Shows until ${day(n.endsOn)}`;
  return 'No end date';
}
