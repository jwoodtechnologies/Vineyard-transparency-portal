import { STATUS_LABEL } from '@/lib/recordTitle';
import type { Labels } from './recordLabels';

/** Small factual chips: type, body, date, agenda item, Draft or Adopted. */
export function RecordChips({ labels, showType = true }: { labels: Labels; showType?: boolean }) {
  return (
    <span className="vc-rchips">
      {labels.status && (
        <span className="vc-rchip" data-status={labels.status}>
          {STATUS_LABEL[labels.status]}
        </span>
      )}
      {showType && <span className="vc-rchip">{labels.type}</span>}
      {labels.body && <span className="vc-rchip">{labels.body}</span>}
      {labels.date && <span className="vc-rchip">{labels.date}</span>}
      {labels.item && <span className="vc-rchip">Item {labels.item}</span>}
    </span>
  );
}
