/** /documents/:documentId : one record, shown in the same quiet frame as the rest of the portal. */
import '@fontsource-variable/inter';
import '@fontsource-variable/source-serif-4';
import './console.css';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, CalendarDays, Download, Layers, MessageSquare, Printer, Share2 } from 'lucide-react';
import type { DocumentDetail, DocumentPageText } from '@/types/models';
import { DocumentService } from '@/services';
import { Frame } from './Chrome';
import { TYPE_LABEL, formatDate } from './format';
import { meetingHref } from './meetings';
import { MeetingDocsSheet } from './MeetingDocs';
import { useMeetingDocs } from './meetingDocs';

const PdfViewer = lazy(() => import('@/components/documents/PdfViewer'));

type Load<T> = { status: 'loading' } | { status: 'error' } | { status: 'done'; data: T };

function useLoad<T>(key: string | null, fn: () => Promise<T>): Load<T> {
  const [state, setState] = useState<{ key: string | null; value: Load<T> }>({ key: null, value: { status: 'loading' } });
  useEffect(() => {
    if (!key) return;
    let live = true;
    fn().then(
      (data) => live && setState({ key, value: { status: 'done', data } }),
      () => live && setState({ key, value: { status: 'error' } }),
    );
    return () => {
      live = false;
    };
    // fn is recreated every render; the key identifies the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state.key === key ? state.value : { status: 'loading' };
}

const safeHttp = (u: string | null | undefined) => (u && /^https?:\/\//i.test(u) ? u : null);

function TextPages({ pages, page }: { pages: DocumentPageText[]; page: number }) {
  useEffect(() => {
    document.getElementById(`vc-p${page}`)?.scrollIntoView({ block: 'start' });
  }, [page]);
  if (!pages.length) return <div className="vc-empty">No readable text was extracted from this record.</div>;
  return (
    <div className="vc-textpages">
      {pages.map((p) => (
        <section key={p.page} id={`vc-p${p.page}`} className="vc-textpage">
          <p className="vc-label">Page {p.page}</p>
          <div className="vc-textpage-body">{p.text}</div>
        </section>
      ))}
    </div>
  );
}

function Viewer({ doc, page, setPage, highlight }: { doc: DocumentDetail; page: number; setPage: (p: number) => void; highlight: string[] }) {
  const [failed, setFailed] = useState(false);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const isPdf = doc.mimeType === 'application/pdf';
  useEffect(() => {
    let live = true;
    void DocumentService.fileUrl(doc.id, doc.archiveUrl).then((u) => live && setFileUrl(u));
    return () => {
      live = false;
    };
  }, [doc.id, doc.archiveUrl]);
  const needText = !isPdf || failed || !doc.archiveUrl;
  const text = useLoad(needText ? `text:${doc.id}` : null, () => DocumentService.text(doc.id));

  if (!needText && fileUrl) {
    return (
      <div className="vc-viewer">
        <Suspense fallback={<div className="vc-viewer-wait" />}>
          <PdfViewer url={fileUrl} page={page} onPageChange={setPage} onError={() => setFailed(true)} highlight={highlight} title={doc.title} />
        </Suspense>
      </div>
    );
  }
  if (!needText) return <div className="vc-viewer-wait" />;
  if (text.status === 'loading')
    return (
      <div className="vc-skeleton" aria-hidden="true">
        <span style={{ width: '94%' }} />
        <span style={{ width: '86%' }} />
      </div>
    );
  if (text.status === 'error') return <div className="vc-empty">This record could not be displayed here. Try the original source.</div>;
  return <TextPages pages={text.data} page={page} />;
}

const touchDevice = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

/** Prints the record itself: a PDF through a hidden same-origin frame (desktop), or the browser's
 * own PDF viewer in a new tab (phones); text records print the page with a clean print layout. */
function printRecord(doc: DocumentDetail, fileUrl: string | null) {
  if (doc.mimeType === 'application/pdf' && fileUrl) {
    if (touchDevice()) {
      window.open(fileUrl, '_blank', 'noopener');
      return;
    }
    const frame = document.createElement('iframe');
    frame.className = 'vc-print-frame';
    frame.setAttribute('aria-hidden', 'true');
    frame.src = fileUrl;
    frame.onload = () => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } catch {
        window.open(fileUrl, '_blank', 'noopener');
      }
      setTimeout(() => frame.remove(), 120_000);
    };
    document.body.appendChild(frame);
    return;
  }
  window.print();
}

async function shareRecord(title: string): Promise<'shared' | 'copied' | 'failed'> {
  const url = window.location.href;
  try {
    if (navigator.share) {
      await navigator.share({ title, url });
      return 'shared';
    }
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'failed';
  }
}

export default function DocumentView() {
  const { documentId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const q = (params.get('q') ?? '').slice(0, 200);
  const load = useLoad(`doc:${documentId}`, () => DocumentService.get(documentId));
  const doc = load.status === 'done' ? load.data : null;
  const [showMeeting, setShowMeeting] = useState(false);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const siblings = useMeetingDocs(doc?.meeting?.id ?? null);
  const fileUrl = doc ? (doc.archiveUrl ?? (doc.mimeType === 'application/pdf' ? `/api/documents/${encodeURIComponent(doc.id)}/file` : null)) : null;

  useEffect(() => {
    if (doc) document.title = `${doc.title} | Vineyard Transparency Portal`;
  }, [doc]);

  const setPage = (p: number) => {
    const next = new URLSearchParams(params);
    if (p > 1) next.set('page', String(p));
    else next.delete('page');
    setParams(next, { replace: true });
  };

  if (load.status === 'error') {
    return (
      <Frame>
        <Link to="/" className="vc-back">
          <ArrowLeft size={15} /> Back
        </Link>
        <div className="vc-empty" style={{ marginTop: '2rem' }}>
          That record is not in the archive.
        </div>
      </Frame>
    );
  }
  if (!doc) {
    return (
      <Frame wide>
        <div className="vc-skeleton" aria-hidden="true" style={{ marginTop: '3rem' }}>
          <span style={{ width: '30%' }} />
          <span style={{ width: '70%' }} />
          <span style={{ width: '100%', height: '50vh' }} />
        </div>
      </Frame>
    );
  }

  const original = safeHttp(doc.originalUrl);
  const highlight = q.split(/\s+/).filter((w) => w.length > 2).slice(0, 8);
  const facts = [TYPE_LABEL[doc.documentType] ?? 'Record', formatDate(doc.date), doc.governmentBodyName, doc.pageCount ? `${doc.pageCount} pages` : null].filter(Boolean);

  return (
    <Frame wide>
      <button type="button" className="vc-back" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}>
        <ArrowLeft size={15} /> Back
      </button>
      <header className="vc-doc-head">
        <p className="vc-doc-facts">
          {facts.map((f, i) => (
            <span key={i}>{f}</span>
          ))}
        </p>
        <h1 className="vc-page-title">{doc.title}</h1>
        <div className="vc-mtg-actions">
          {doc.meeting && (
            <Link to={meetingHref(doc.meeting)} className="vc-secondary">
              <CalendarDays size={15} strokeWidth={1.8} /> {doc.meeting.title}, {formatDate(doc.meeting.date)}
            </Link>
          )}
          {doc.meeting && siblings.docs.length > 1 && (
            <button type="button" className="vc-secondary vc-meeting-docs-btn" onClick={() => setShowMeeting(true)}>
              <Layers size={15} strokeWidth={1.8} /> Everything from this meeting <span className="vc-count">{siblings.docs.length}</span>
            </button>
          )}
          {doc.archiveUrl && (
            <a href={doc.archiveUrl} className="vc-secondary" download>
              <Download size={15} strokeWidth={1.8} /> Download
            </a>
          )}
          <button type="button" className="vc-secondary" onClick={() => printRecord(doc, fileUrl)}>
            <Printer size={15} strokeWidth={1.8} /> Print
          </button>
          <button
            type="button"
            className="vc-secondary"
            onClick={() =>
              void shareRecord(doc.title).then((r) => {
                setShareNote(r === 'copied' ? 'Link copied' : r === 'failed' ? 'Could not share' : null);
                if (r !== 'shared') setTimeout(() => setShareNote(null), 2200);
              })
            }
          >
            <Share2 size={15} strokeWidth={1.8} /> {shareNote ?? 'Share'}
          </button>
          {original && (
            <a href={original} target="_blank" rel="noopener noreferrer" className="vc-secondary">
              Original source <ArrowUpRight size={13} />
            </a>
          )}
          <Link to={`/?q=${encodeURIComponent(`Summarize ${doc.title}`)}`} className="vc-primary">
            <MessageSquare size={15} strokeWidth={1.8} /> Ask about this
          </Link>
        </div>
      </header>
      <Viewer doc={doc} page={page} setPage={setPage} highlight={highlight} />
      {showMeeting && doc.meeting && <MeetingDocsSheet meeting={{ id: doc.meeting.id, title: doc.meeting.title, date: doc.meeting.date }} currentId={doc.id} onClose={() => setShowMeeting(false)} />}
    </Frame>
  );
}
