import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, History, Landmark } from 'lucide-react';
import type { CodeNode } from '@/types/models';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge, DemoBadge } from '@/components/ui/Badge';
import { SkeletonText } from '@/components/ui/Skeleton';
import { DataErrorState, InlineNotice } from '@/components/ui/States';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useResource } from '@/hooks/useResource';
import { BrowseService } from '@/services';
import { CURRENCY_LABELS } from '@/lib/labels';
import { formatDate } from '@/lib/format';
import { cleanText } from '@/lib/safety';
import { cn } from '@/lib/cn';

function matches(node: CodeNode, q: string): boolean {
  if (!q) return true;
  const hay = `${node.number} ${node.heading} ${node.text ?? ''}`.toLowerCase();
  return hay.includes(q) || node.children.some((c) => matches(c, q));
}

function Section({ node }: { node: CodeNode }) {
  const superseded = node.currency === 'superseded' || node.currency === 'historical';
  return (
    <article id={node.id} className={cn('scroll-mt-24 rounded-xl border p-4 sm:p-5', superseded ? 'border-dashed border-warn/40 bg-warn-soft/30' : 'border-line bg-surface')}>
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="font-mono text-sm font-semibold">§ {node.number}</h4>
        <span className="font-semibold">{cleanText(node.heading)}</span>
        <Badge tone={node.currency === 'current' ? 'ok' : node.currency === 'superseded' ? 'warn' : 'neutral'}>{CURRENCY_LABELS[node.currency]}</Badge>
        {node.isDemo && <DemoBadge />}
      </div>
      {superseded && (
        <InlineNotice tone="warn" className="mt-3">
          This is superseded language kept for the historical record. It is <strong>not</strong> the current municipal code.
        </InlineNotice>
      )}
      {node.text && <p className="mt-3 whitespace-pre-line font-serif text-[15.5px] leading-relaxed">{cleanText(node.text)}</p>}
      <p className="mt-2 text-xs text-subtle">{node.effectiveDate ? `Effective ${formatDate(node.effectiveDate)}` : 'Effective date not recorded'}</p>
      {node.history.length > 0 && (
        <details className="mt-3 group">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-accent">
            <History className="size-4" aria-hidden /> History ({node.history.length})
            <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <ol className="mt-2 space-y-1.5 border-l border-line pl-4 text-sm">
            {node.history.map((h, i) => (
              <li key={i}>
                <span className="font-medium capitalize">{h.action}</span> · {formatDate(h.date)}
                {h.ordinanceNumber && (
                  <>
                    {' '}
                    by{' '}
                    {h.ordinanceDocumentId ? (
                      <Link to={`/documents/${encodeURIComponent(h.ordinanceDocumentId)}`} className="link font-mono text-[13px]">
                        {h.ordinanceNumber}
                      </Link>
                    ) : (
                      <span className="font-mono text-[13px]">{h.ordinanceNumber}</span>
                    )}
                  </>
                )}
                {h.note && <span className="text-subtle"> — {h.note}</span>}
              </li>
            ))}
          </ol>
        </details>
      )}
    </article>
  );
}

function Tree({ nodes, q, depth = 0 }: { nodes: CodeNode[]; q: string; depth?: number }) {
  return (
    <div className={cn(depth > 0 && 'mt-3 space-y-3')}>
      {nodes
        .filter((n) => matches(n, q))
        .map((n) =>
          n.level === 'section' || n.level === 'subsection' ? (
            <Section key={n.id} node={n} />
          ) : (
            <section key={n.id} id={n.id} className={cn('scroll-mt-24', depth === 0 ? 'mb-8' : 'mt-4')} aria-label={n.heading}>
              <h3 className={cn('flex items-center gap-2 font-semibold', depth === 0 ? 'font-serif text-xl' : 'text-base text-muted')}>
                <span className="font-mono text-sm text-subtle">{n.level === 'title' ? `Title ${n.number}` : `Chapter ${n.number}`}</span>
                {cleanText(n.heading)}
                {n.isDemo && depth === 0 && <DemoBadge />}
              </h3>
              <Tree nodes={n.children} q={q} depth={depth + 1} />
            </section>
          ),
        )}
    </div>
  );
}

export default function CodePage() {
  useDocumentTitle('Municipal code');
  const code = useResource('code', BrowseService.municipalCode);
  const [q, setQ] = useState('');
  return (
    <>
      <PageHeader
        eyebrow="Legislation"
        title="Municipal code"
        description="Search by title, chapter, section, or text. Current language, superseded versions, and amendment history are always labeled — superseded text is never presented as current law."
      />
      <div className="container-page py-8">
        <InlineNotice tone="info" icon={<Landmark className="size-4" />} className="mb-6">
          The live code is published through the CivicPlus/Municode ecosystem. Its current URL is discovered from official Vineyard pages during source discovery. The official
          publication controls if it differs from this archive.
        </InlineNotice>
        <label className="mb-6 block max-w-md">
          <span className="sr-only">Filter code sections</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by number, heading, or text (e.g. 10-4-020)"
            className="h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm"
          />
        </label>
        {code.error != null && <DataErrorState error={code.error} onRetry={code.reload} what="the municipal code" />}
        {code.loading && <SkeletonText lines={8} />}
        {code.data && <Tree nodes={code.data} q={q.trim().toLowerCase()} />}
      </div>
    </>
  );
}
