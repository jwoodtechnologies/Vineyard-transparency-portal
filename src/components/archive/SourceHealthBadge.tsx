import type { SourceHealthStatus } from '@/types/models';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { HEALTH_LABELS } from '@/lib/labels';

const TONES: Record<SourceHealthStatus, BadgeTone> = {
  active: 'ok',
  degraded: 'warn',
  unreachable: 'danger',
  changed: 'warn',
  authentication_required: 'warn',
  blocked: 'danger',
  unknown: 'neutral',
};

export function SourceHealthBadge({ status }: { status: SourceHealthStatus }) {
  return (
    <Badge tone={TONES[status]} icon={<span aria-hidden className="size-1.5 rounded-full bg-current" />}>
      {HEALTH_LABELS[status]}
    </Badge>
  );
}
