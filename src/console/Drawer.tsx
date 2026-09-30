import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, FileText, X } from 'lucide-react';
import { docHref } from '@/lib/routes';
import type { Preview } from './types';
import { TYPE_LABEL, formatDate } from './format';
import { Highlighted } from './Highlighted';

export function Drawer({ preview, onClose }: { preview: Preview; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const v =
    preview.kind === 'citation'
      ? {
          id: preview.citation.documentId,
          title: preview.citation.documentTitle,
          type: preview.citation.documentType,
          date: preview.citation.date,
          body: preview.citation.governmentBodyName,
          meeting: preview.citation.meetingTitle,
          page: preview.citation.page,
          excerpt: preview.citation.excerpt,
          original: preview.citation.originalUrl,
          label: `Source ${preview.citation.index}`,
        }
      : {
          id: preview.result.document.id,
          title: preview.result.document.title,
          type: preview.result.document.documentType,
          date: preview.result.document.date,
          body: preview.result.document.governmentBodyName,
          meeting: preview.result.meetingTitle,
          page: preview.result.excerpts[0]?.page ?? null,
          excerpt: preview.result.excerpts[0] ?? null,
          original: null,
          label: 'Record',
        };

  return (
    <>
      <div className="vc-scrim" onClick={onClose} aria-hidden="true" />
      <aside className="vc-drawer" role="dialog" aria-modal="true" aria-labelledby="vc-drawer-title">
        <div className="vc-drawer-head">
          <span className="vc-label" style={{ margin: 0 }}>
            {v.label}
          </span>
          <button ref={closeRef} type="button" className="vc-ghost" data-icon-only="true" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="vc-drawer-body">
          <span className="vc-type">{TYPE_LABEL[v.type] ?? 'Record'}</span>
          <h2 id="vc-drawer-title" className="vc-drawer-title">
            {v.title}
          </h2>
          <dl className="vc-facts">
            {formatDate(v.date) && (
              <>
                <dt>Date</dt>
                <dd>{formatDate(v.date)}</dd>
              </>
            )}
            {v.body && (
              <>
                <dt>Public body</dt>
                <dd>{v.body}</dd>
              </>
            )}
            {v.meeting && (
              <>
                <dt>Meeting</dt>
                <dd>{v.meeting}</dd>
              </>
            )}
            {v.page != null && (
              <>
                <dt>Page</dt>
                <dd>{v.page}</dd>
              </>
            )}
          </dl>
          {v.excerpt && (
            <blockquote className="vc-quote">
              <Highlighted text={v.excerpt.text} ranges={v.excerpt.highlights} />
            </blockquote>
          )}
        </div>
        <div className="vc-drawer-actions">
          <Link className="vc-primary" to={docHref({ id: v.id }, v.page, preview.query)}>
            <FileText size={16} strokeWidth={2} /> Open document{v.page ? ` at page ${v.page}` : ''}
          </Link>
          {v.original && (
            <a className="vc-secondary" href={v.original} target="_blank" rel="noopener noreferrer">
              Original source <ArrowUpRight size={15} />
            </a>
          )}
        </div>
      </aside>
    </>
  );
}
