import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { HealthStatus, IssueReport } from '@/types/models';
import { config } from '@/config/env';
import { StatisticsService } from '@/services';

interface ReportContext {
  context: IssueReport['context'];
  defaultType?: IssueReport['issueType'];
  subject?: string;
}

interface AppState {
  dataMode: 'mock' | 'api';
  health: HealthStatus | null;
  refreshHealth: () => void;
  report: ReportContext | null;
  openReport: (ctx: Omit<ReportContext, 'context'> & { context?: Partial<IssueReport['context']> }) => void;
  closeReport: () => void;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [report, setReport] = useState<ReportContext | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    const check = () =>
      StatisticsService.health().then(
        (h) => alive && setHealth(h),
        () => alive && setHealth({ status: 'offline', mode: config.dataMode, search: false, ai: false, checkedAt: new Date().toISOString() }),
      );
    check();
    const onOnline = () => check();
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOnline);
    return () => {
      alive = false;
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOnline);
    };
  }, [nonce]);

  const refreshHealth = useCallback(() => setNonce((n) => n + 1), []);
  const openReport = useCallback<AppState['openReport']>((ctx) => {
    setReport({ ...ctx, context: { pageUrl: window.location.href, ...ctx.context } });
  }, []);
  const closeReport = useCallback(() => setReport(null), []);

  const value = useMemo<AppState>(
    () => ({ dataMode: config.dataMode, health, refreshHealth, report, openReport, closeReport }),
    [health, refreshHealth, report, openReport, closeReport],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside AppProvider');
  return v;
}
