import { useEffect, useRef } from 'react';
import { ScanText } from 'lucide-react';
import type { DocumentPageText } from '@/types/models';
import { Badge } from '@/components/ui/Badge';
import { Highlighted } from '@/components/ui/Highlighted';
import { findHighlights, parseQuery } from '@/lib/text';
import { cn } from '@/lib/cn';

/**
 * Extracted-text view. Always available when text was extracted, even if the archived file cannot
 * be displayed. Text is untrusted and rendered as plain text only.
 */
export function TextViewer({ pages, currentPage, onPageChange, query, ocrConfidence }: { pages: DocumentPageText[]; currentPage: number; onPageChange: (p: number) => void; query?: string; ocrConfidence: number | null }) {
  const refs = useRef(new Map<number, HTMLElement>());
  const parsed = query ? parseQuery(query) : null;

  useEffect(() => {
    refs.current.get(currentPage)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [currentPage]);

  return (
    <div className="space-y-4 bg-raised/70 p-4">
      {pages.map((p) => {
        const hl = parsed ? findHighlights(p.text, parsed.stems, parsed.phrases) : [];
        return (
          <section
            key={p.page}
            ref={(el) => {
              if (el) refs.current.set(p.page, el);
            }}
            aria-label={`Page ${p.page}`}
            className={cn('scroll-mt-4 rounded-lg border bg-surface p-5 sm:p-6', p.page === currentPage ? 'border-accent/50' : 'border-line')}
          >
            <header className="mb-3 flex items-center gap-2">
              <button onClick={() => onPageChange(p.page)} className="text-xs font-semibold uppercase tracking-wide text-subtle hover:text-accent">
                Page {p.page}
              </button>
              {p.ocr && (
                <Badge tone="warn" icon={<ScanText className="size-3" aria-hidden />}>
                  OCR text{ocrConfidence != null ? ` · ${Math.round(ocrConfidence * 100)}% confidence` : ''}
                </Badge>
              )}
              {hl.length > 0 && <Badge tone="accent">{hl.length} match{hl.length === 1 ? '' : 'es'}</Badge>}
            </header>
            <p className="whitespace-pre-wrap font-serif text-[15.5px] leading-[1.75] text-fg">
              <Highlighted text={p.text} ranges={hl} />
            </p>
          </section>
        );
      })}
    </div>
  );
}
