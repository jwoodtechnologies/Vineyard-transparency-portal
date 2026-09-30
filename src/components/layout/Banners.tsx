import { Link } from 'react-router-dom';
import { CloudOff, FlaskConical } from 'lucide-react';
import { useApp } from '@/app/AppContext';

/** Slim, persistent reminder that demo records are samples — never a giant warning banner. */
export function DemoDataStrip() {
  const { dataMode } = useApp();
  if (dataMode !== 'mock') return null;
  return (
    <div className="border-b border-demo/20 bg-demo-soft text-demo">
      <div className="container-wide flex items-center gap-2 py-1.5 text-[12.5px]">
        <FlaskConical className="size-3.5 shrink-0" aria-hidden />
        <p className="min-w-0 truncate">
          <strong className="font-semibold">Demo data.</strong> The production archive is not connected; records shown are labeled samples, not government
          records.
        </p>
        <Link to="/status" className="ml-auto shrink-0 font-medium underline underline-offset-2">
          Details
        </Link>
      </div>
    </div>
  );
}

export function OfflineStrip() {
  const { health, refreshHealth } = useApp();
  if (!health || (health.status !== 'offline' && health.status !== 'backend_not_connected')) return null;
  return (
    <div role="status" className="border-b border-warn/25 bg-warn-soft text-warn">
      <div className="container-wide flex items-center gap-2 py-1.5 text-[12.5px]">
        <CloudOff className="size-3.5 shrink-0" aria-hidden />
        <p className="min-w-0">
          {health.status === 'backend_not_connected'
            ? 'The archive backend is not connected to this deployment yet.'
            : 'The archive can’t be reached right now. Items saved on this device are still available.'}
        </p>
        <button onClick={refreshHealth} className="ml-auto shrink-0 font-medium underline underline-offset-2">
          Retry
        </button>
      </div>
    </div>
  );
}
