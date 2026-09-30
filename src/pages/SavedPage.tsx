import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bookmark, FileText, History, MessageSquareQuote, Search, Trash2, X } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { SkeletonText } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/States';
import { Tabs } from '@/components/ui/Tabs';
import { useToast } from '@/components/ui/Toast';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useLibrary } from '@/hooks/useLibrary';
import { clearHistory, clearSaved, removeHistory, removeSaved, setHistoryEnabled, type SavedKind } from '@/lib/library';
import { formatRelative } from '@/lib/format';
import { cleanText } from '@/lib/safety';

const KIND: Record<SavedKind, { label: string; Icon: typeof FileText }> = {
  document: { label: 'Documents', Icon: FileText },
  search: { label: 'Searches', Icon: Search },
  question: { label: 'Questions', Icon: MessageSquareQuote },
};

export default function SavedPage() {
  useDocumentTitle('Saved on this device');
  const { saved, history, historyEnabled, loading } = useLibrary();
  const [tab, setTab] = useState('saved');
  const [pendingHistory, setPendingHistory] = useState<boolean | null>(null);
  const historyOn = pendingHistory ?? historyEnabled;
  const toast = useToast();

  return (
    <>
      <PageHeader
        eyebrow="Your device"
        title="Saved on this device"
        description="Saved documents, searches, and questions — and your recent history — live only in this browser. Nothing here is sent to a server, and there is no account."
      />
      <div className="container-page max-w-4xl py-8">
        <Tabs
          label="Saved items and history"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'saved', label: 'Saved', count: saved?.length ?? null },
            { id: 'history', label: 'Recent history', count: history?.length ?? null },
          ]}
        >
          {(active, panelProps) => (
            <div {...panelProps} className="pt-6 focus-visible:outline-offset-4">
              {loading && <SkeletonText lines={5} />}
              {active === 'saved' && saved && (
                <>
                  {saved.length === 0 ? (
                    <EmptyState icon={<Bookmark className="size-5" />} title="Nothing saved yet">
                      Use “Save on this device” on any document, search, or answer. Saved items stay in this browser only.
                    </EmptyState>
                  ) : (
                    <div className="space-y-8">
                      {(Object.keys(KIND) as SavedKind[]).map((k) => {
                        const items = saved.filter((s) => s.kind === k);
                        if (!items.length) return null;
                        const { label, Icon } = KIND[k];
                        return (
                          <section key={k} aria-label={label}>
                            <h2 className="eyebrow mb-2 flex items-center gap-1.5">
                              <Icon className="size-3.5" aria-hidden /> {label}
                            </h2>
                            <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
                              {items.map((s) => (
                                <li key={s.key} className="flex items-center gap-3 px-4 py-3">
                                  <Link to={s.path} className="min-w-0 flex-1">
                                    <span className="block truncate font-medium hover:text-accent">{cleanText(s.title)}</span>
                                    <span className="block text-xs text-subtle">
                                      {s.subtitle ? `${s.subtitle} · ` : ''}saved {formatRelative(s.savedAt)}
                                    </span>
                                  </Link>
                                  <Button size="sm" variant="ghost" aria-label={`Remove ${s.title}`} onClick={() => removeSaved(s.key)} icon={<X className="size-4" />} />
                                </li>
                              ))}
                            </ul>
                          </section>
                        );
                      })}
                      <Button
                        variant="danger"
                        size="sm"
                        icon={<Trash2 className="size-4" />}
                        onClick={async () => {
                          if (window.confirm('Remove all saved items from this device?')) {
                            await clearSaved();
                            toast('All saved items removed');
                          }
                        }}
                      >
                        Clear all saved items
                      </Button>
                    </div>
                  )}
                </>
              )}
              {active === 'history' && history && (
                <div className="space-y-6">
                  <div className="card flex flex-wrap items-center justify-between gap-4 p-4">
                    <div>
                      <p className="font-medium">Keep recent history on this device</p>
                      <p className="text-sm text-muted">Turning this off also deletes existing history.</p>
                    </div>
                    <label className="inline-flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        role="switch"
                        checked={historyOn}
                        onChange={async (e) => {
                          const on = e.target.checked;
                          setPendingHistory(on);
                          await setHistoryEnabled(on);
                          setPendingHistory(null);
                          toast(on ? 'History turned on' : 'History turned off and cleared');
                        }}
                        className="peer sr-only"
                      />
                      <span
                        aria-hidden
                        className="relative h-6 w-11 rounded-full bg-line-strong transition-colors after:absolute after:left-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:bg-accent peer-checked:after:translate-x-5 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
                      />
                      <span className="text-sm font-medium">{historyOn ? 'On' : 'Off'}</span>
                    </label>
                  </div>
                  {history.length === 0 ? (
                    <EmptyState icon={<History className="size-5" />} title={historyOn ? 'No recent history' : 'History is off'}>
                      {historyOn ? 'Questions and searches you run will appear here.' : 'Questions and searches are not being recorded on this device.'}
                    </EmptyState>
                  ) : (
                    <>
                      <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
                        {history.map((h) => (
                          <li key={h.key} className="flex items-center gap-3 px-4 py-2.5">
                            {h.kind === 'question' ? <MessageSquareQuote className="size-4 shrink-0 text-subtle" aria-label="Question" /> : <Search className="size-4 shrink-0 text-subtle" aria-label="Search" />}
                            <Link to={h.path} className="min-w-0 flex-1 truncate text-sm hover:text-accent">
                              {cleanText(h.text)}
                            </Link>
                            <span className="shrink-0 text-xs text-subtle">{formatRelative(h.at)}</span>
                            <Button size="sm" variant="ghost" aria-label={`Remove ${h.text} from history`} onClick={() => removeHistory(h.key)} icon={<X className="size-4" />} />
                          </li>
                        ))}
                      </ul>
                      <Button
                        variant="danger"
                        size="sm"
                        icon={<Trash2 className="size-4" />}
                        onClick={async () => {
                          await clearHistory();
                          toast('History cleared');
                        }}
                      >
                        Clear history
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </Tabs>
      </div>
    </>
  );
}
