import { useState } from 'react';
import { Activity, FlaskConical, RefreshCw } from 'lucide-react';
import { useApp } from '@/app/AppContext';
import { ArchiveStatus } from '@/components/archive/ArchiveStatus';
import { SourceHealthBadge } from '@/components/archive/SourceHealthBadge';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { InlineNotice } from '@/components/ui/States';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useResource } from '@/hooks/useResource';
import { SourceService, isAiBreakerOpen, resetAiBreaker } from '@/services';
import { readDemoScenario, writeDemoScenario, type DemoScenario } from '@/data/adapters/demoScenario';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/cn';

const SCENARIOS: Array<{ value: DemoScenario; label: string; description: string }> = [
  { value: 'normal', label: 'Normal', description: 'Demo data with simulated network latency.' },
  { value: 'ai_unavailable', label: 'AI unavailable', description: 'The AI quota is exhausted; Ask falls back to archive search.' },
  { value: 'search_unavailable', label: 'Search unavailable', description: 'The search index is not responding.' },
  { value: 'backend_offline', label: 'Backend offline', description: 'Every request to the archive fails.' },
  { value: 'slow', label: 'Slow network', description: 'Every request takes over two seconds (skeleton states).' },
];

export default function StatusPage() {
  useDocumentTitle('Archive status');
  const { health, dataMode, refreshHealth } = useApp();
  const sources = useResource('sources', SourceService.list);
  const [scenario, setScenario] = useState<DemoScenario>(readDemoScenario);
  const breakerOpen = isAiBreakerOpen();

  const apply = (s: DemoScenario) => {
    setScenario(s);
    writeDemoScenario(s);
    resetAiBreaker();
    // Reload so cached responses and health state reflect the new scenario.
    window.location.reload();
  };

  return (
    <>
      <PageHeader eyebrow="System" title="Archive status" description="Health of the archive, its services, and the public-record sources it monitors." />
      <div className="container-page space-y-8 py-8">
        <section className="card p-5" aria-labelledby="svc-h">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="svc-h" className="flex items-center gap-2 font-semibold">
              <Activity className="size-4 text-accent" aria-hidden /> Services
            </h2>
            <Button size="sm" variant="ghost" icon={<RefreshCw className="size-4" />} onClick={refreshHealth}>
              Re-check
            </Button>
          </div>
          <dl className="mt-4 grid gap-4 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-subtle">Data mode</dt>
              <dd className="mt-1">
                <Badge tone={dataMode === 'mock' ? 'demo' : 'accent'}>{dataMode === 'mock' ? 'Demo data (mock)' : 'Production API'}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-subtle">Archive</dt>
              <dd className="mt-1">
                <Badge tone={health?.status === 'ok' ? 'ok' : health?.status === 'degraded' ? 'warn' : health ? 'danger' : 'neutral'}>{health?.status.replace(/_/g, ' ') ?? 'checking…'}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-subtle">Search</dt>
              <dd className="mt-1">
                <Badge tone={health?.search ? 'ok' : 'danger'}>{health ? (health.search ? 'available' : 'unavailable') : '…'}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-subtle">AI answers</dt>
              <dd className="mt-1 flex flex-wrap gap-1">
                <Badge tone={health?.ai && !breakerOpen ? 'ok' : 'warn'}>{health ? (health.ai && !breakerOpen ? 'available' : 'unavailable — search fallback') : '…'}</Badge>
              </dd>
            </div>
          </dl>
          {health?.message && <p className="mt-4 text-sm text-muted">{health.message}</p>}
          {breakerOpen && (
            <p className="mt-3 text-sm text-muted">
              AI requests are paused on this device after an exhausted-quota response.{' '}
              <button
                className="link"
                onClick={() => {
                  resetAiBreaker();
                  refreshHealth();
                }}
              >
                Try AI again
              </button>
            </p>
          )}
          <p className="mt-3 text-xs text-subtle">Checked {formatDateTime(health?.checkedAt)}</p>
        </section>

        <ArchiveStatus />

        <section aria-labelledby="sh-h">
          <h2 id="sh-h" className="eyebrow mb-3">
            Source health
          </h2>
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="border-b border-line text-xs text-subtle">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Source
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Last successful check
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {sources.data?.map((s) => (
                  <tr key={s.id}>
                    <td className="px-4 py-2.5 font-medium">{s.name}</td>
                    <td className="px-4 py-2.5">
                      <SourceHealthBadge status={s.health?.status ?? 'unknown'} />
                    </td>
                    <td className="px-4 py-2.5 text-muted">{formatDateTime(s.health?.lastSuccessfulCheckAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-subtle">Real sources show “Not yet checked” until the source-health monitor runs against them. No status is fabricated.</p>
        </section>

        {dataMode === 'mock' && (
          <section className="card p-5" aria-labelledby="demo-h">
            <h2 id="demo-h" className="flex items-center gap-2 font-semibold">
              <FlaskConical className="size-4 text-demo" aria-hidden /> Demo scenarios
            </h2>
            <InlineNotice tone="demo" className="mt-3">
              This site is running on bundled demo data. The production archive is not connected, and no demo record is a real government record. Use these scenarios to
              preview how the portal behaves when services fail.
            </InlineNotice>
            <fieldset className="mt-4">
              <legend className="sr-only">Simulated scenario</legend>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {SCENARIOS.map((s) => (
                  <label
                    key={s.value}
                    className={cn(
                      'flex cursor-pointer gap-2.5 rounded-lg border p-3 text-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent',
                      scenario === s.value ? 'border-accent bg-accent-soft' : 'border-line hover:bg-raised',
                    )}
                  >
                    <input type="radio" name="scenario" checked={scenario === s.value} onChange={() => apply(s.value)} className="mt-0.5 accent-[var(--vtp-accent)]" />
                    <span>
                      <span className="block font-medium">{s.label}</span>
                      <span className="block text-xs text-subtle">{s.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </section>
        )}
      </div>
    </>
  );
}
