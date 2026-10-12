/** /documents/:documentId : one record, shown in the same quiet frame as the rest of the portal. */
import './styles';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowUpRight, CalendarDays, Flag, Layers, MessageSquare, Paperclip, Share2 } from 'lucide-react';
import { DocumentService } from '@/services';
import { isDataError } from '@/data/adapters/errors';
import { ErrorNote } from './ErrorNote';
import { RecordViewer } from './RecordViewer';
import { BackButton, Frame } from './Chrome';
import { formatDate, sourceLabel } from './format';
import { meetingHref } from './meetings';
import { PaperTrail } from './PaperTrail';
import { TrailNav, type TrailStep } from './TrailNav';
import type { DocumentSummary } from '@/types/models';
import { useFullScreen } from '@/components/documents/fullScreen';
import { isTypingTarget } from '@/components/documents/gestures';
import type { Zoom } from '@/components/documents/zoom';
import { DocLink } from './DocLink';
import { labelsOf } from './recordLabels';
import { STATUS_LABEL } from '@/lib/recordTitle';
import { setHead } from '@/lib/head';

/** While a new answer loads, `stale` is the previous one (the record page keeps showing it, so full screen stays on). */
type Load<T> = { status: 'loading'; stale?: T } | { status: 'error'; error: unknown } | { status: 'done'; data: T };

function useLoad<T>(key: string | null, fn: () => Promise<T>): Load<T> {
  const [state, setState] = useState<{ key: string | null; value: Load<T> }>({ key: null, value: { status: 'loading' } });
  useEffect(() => {
    if (!key) return;
    let live = true;
    fn().then(
      (data) => live && setState({ key, value: { status: 'done', data } }),
      (error: unknown) => live && setState({ key, value: { status: 'error', error } }),
    );
    return () => {
      live = false;
    };
    // fn is recreated every render; the key identifies the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state.key === key ? state.value : { status: 'loading', stale: state.value.status === 'done' ? state.value.data : undefined };
}

/** One record in the viewer's previous and next: its short title and agenda item. */
function stepOf(d: DocumentSummary): TrailStep {
  const lb = labelsOf(d);
  return { id: d.id, title: lb.title, item: lb.item };
}

const safeHttp = (u: string | null | undefined) => (u && /^https?:\/\//i.test(u) ? u : null);

/** Report a resident submission (two reports from different people hide it until the owner looks). */
function ReportButton({ documentId }: { documentId: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const send = () => {
    if (state === 'sending' || state === 'done') return;
    if (!window.confirm('Report this item as wrong, harmful or not about Vineyard?')) return;
    setState('sending');
    fetch('/api/add/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ documentId }) }).then(
      (r) => setState(r.ok ? 'done' : 'error'),
      () => setState('error'),
    );
  };
  return (
    <button type="button" className="vc-secondary" onClick={send} disabled={state === 'sending' || state === 'done'}>
      <Flag size={15} strokeWidth={1.8} /> {state === 'done' ? 'Reported' : state === 'error' ? 'Try again' : 'Report'}
    </button>
  );
}

/** Scrolls to a section of the paper trail below the viewer. */
function jumpTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

/** Keeps ?page=N in the address in step with the page on screen, without a navigation (no re-render, no scroll). */
function replacePageInAddress(p: number) {
  const u = new URL(window.location.href);
  if (p > 1) u.searchParams.set('page', String(p));
  else u.searchParams.delete('page');
  if (u.href !== window.location.href) window.history.replaceState(window.history.state, '', u.pathname + u.search + u.hash);
}

export default function DocumentView() {
  const { documentId = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const urlPage = Math.max(1, Number(params.get('page')) || 1);
  const q = (params.get('q') ?? '').slice(0, 200);
  const [attempt, setAttempt] = useState(0);
  const load = useLoad(`doc:${documentId}:${attempt}`, () => DocumentService.get(documentId));
  const fresh = load.status === 'done' ? load.data : null;
  // Moving to another record keeps the one on screen until the next one has loaded (no blank page, full screen kept).
  const doc = fresh ?? (load.status === 'loading' ? (load.stale ?? null) : null);
  const stage = useRef<HTMLDivElement>(null);
  const screen = useFullScreen(stage);
  // The zoom carries over from one record to the next.
  const [zoom, setZoom] = useState<Zoom>({ mode: 'auto' });
  const [shareNote, setShareNote] = useState<string | null>(null);
  // The paper trail: the meeting, the files on the same agenda item, the meeting's other records.
  const trailLoad = useLoad(doc ? `trail:${doc.id}` : null, () => DocumentService.trail(doc!.id));
  const trail = trailLoad.status === 'done' ? trailLoad.data : trailLoad.status === 'loading' ? (trailLoad.stale ?? null) : null;

  // Previous and next through the meeting's records, in agenda order (this record, or its copy filed with the meeting).
  const nav = useMemo(() => {
    if (!doc || !trail || trail.sequence.length < 2) return null;
    const anchor = trail.sequence.includes(doc.id) ? doc.id : trail.twinId;
    const index = anchor ? trail.sequence.indexOf(anchor) : -1;
    if (index < 0) return null;
    const byId = new Map([...trail.attachments, ...trail.meeting_docs, doc].map((d) => [d.id, stepOf(d)]));
    const steps = trail.sequence.map((id) => byId.get(id)).filter((s): s is NonNullable<typeof s> => Boolean(s));
    if (steps.length !== trail.sequence.length) return null;
    return { steps, index, attachmentIds: new Set([anchor!, ...trail.attachments.map((d) => d.id)]) };
  }, [doc, trail]);
  const viewerParam = params.get('viewer');
  const goTo = useCallback(
    (id: string) => {
      // In full screen the move replaces this entry (Back then leaves the record, Exit stays on the new one).
      navigate(`/documents/${encodeURIComponent(id)}${viewerParam ? `?viewer=${encodeURIComponent(viewerParam)}` : ''}`, { replace: screen.full });
    },
    [navigate, viewerParam, screen.full],
  );
  const step = useCallback(
    (dir: -1 | 1) => {
      const target = nav?.steps[nav.index + dir];
      if (target) goTo(target.id);
    },
    [nav, goTo],
  );
  // The neighbours load ahead, so moving is quick.
  useEffect(() => {
    if (!nav) return;
    for (const s of [nav.steps[nav.index - 1], nav.steps[nav.index + 1]]) if (s) void DocumentService.get(s.id).catch(() => undefined);
  }, [nav]);
  // Arrow keys on a computer (never while typing in a box, or with a modifier key held).
  useEffect(() => {
    if (!nav) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.defaultPrevented || isTypingTarget(e.target)) return;
      e.preventDefault();
      step(e.key === 'ArrowLeft' ? -1 : 1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [nav, step]);
  // A new record starts at the top of the page (full screen keeps its own scroll box).
  const fullNow = useRef(screen.full);
  useEffect(() => {
    fullNow.current = screen.full;
  }, [screen.full]);
  useEffect(() => {
    if (!fullNow.current) window.scrollTo({ top: 0 });
  }, [documentId]);
  const [page, setPage] = useState<{ for: string; page: number }>({ for: documentId, page: urlPage });
  const current = page.for === documentId ? page.page : urlPage;
  const notFound = load.status === 'error' && isDataError(load.error) && load.error.kind === 'not_found';

  useEffect(() => {
    if (doc) setHead(doc.title, [labelsOf(doc).type, doc.governmentBodyName, formatDate(doc.date)].filter(Boolean).join(', ') + '. A Vineyard, Utah public record with its source document and full text.');
  }, [doc]);

  // An old id that now answers with the record it was folded into: the address shows the current id.
  useEffect(() => {
    if (fresh && fresh.id !== documentId && documentId.startsWith('doc_')) navigate(`/documents/${encodeURIComponent(fresh.id)}${window.location.search}`, { replace: true });
  }, [fresh, documentId, navigate]);

  // A slow or failed answer (not a missing record) is tried again once on its own.
  useEffect(() => {
    if (load.status !== 'error' || notFound || attempt > 0) return;
    const t = setTimeout(() => setAttempt(1), 1500);
    return () => clearTimeout(t);
  }, [load.status, notFound, attempt]);

  const onPage = (p: number) => {
    setPage({ for: documentId, page: p });
    replacePageInAddress(p);
  };

  if (load.status === 'error') {
    const message = notFound ? (isDataError(load.error) && /taken out of the archive/.test(load.error.message) ? load.error.message : 'That record is not in the archive.') : null;
    return (
      <Frame>
        <BackButton fallback="/records" />
        <div style={{ marginTop: '2rem' }}>
          {message ? (
            <div className="vc-empty">
              {message}{' '}
              <Link to="/records" className="vc-doc-adopted">
                Browse the records
              </Link>
            </div>
          ) : (
            <ErrorNote onRetry={() => setAttempt((a) => a + 1)}>The record could not be loaded just now.</ErrorNote>
          )}
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
  const fileUrl = doc.archiveUrl ?? null;
  const highlight = q.split(/\s+/).filter((w) => w.length > 2).slice(0, 8);
  const lb = labelsOf(doc);
  const facts = [lb.type, formatDate(doc.date) ?? (doc.adoption?.date ? null : doc.year ? String(doc.year) : null), doc.governmentBodyName, lb.item ? `Item ${lb.item}` : null, doc.pageCount ? `${doc.pageCount} pages` : null].filter(Boolean);
  // The file as filed: its original name (the title above is shortened for reading).
  const filedAs = doc.fileName && doc.fileName !== lb.title ? doc.fileName : doc.title !== lb.title ? doc.title : null;
  const label = sourceLabel(doc.sourceId);
  // The record's own meeting, else the meeting its copy was filed with (a municipal code ordinance).
  const meeting = doc.meeting ?? trail?.meeting ?? null;
  const resident = doc.sourceId === 'resident-submitted';

  return (
    <Frame wide>
      {/* Short, so most of the first page shows under it: Back, the facts and the file name on one line, the title, one row of actions. */}
      <header className="vc-doc-head">
        <div className="vc-doc-top">
          <BackButton fallback="/records" />
          <p className="vc-doc-facts">
            {facts.map((f, i) => (
              <span key={i}>{f}</span>
            ))}
          </p>
          {(lb.status || filedAs || doc.adoption?.date) && (
            <p className="vc-doc-filed">
              {lb.status && (
                <span className="vc-rchip" data-status={lb.status}>
                  {STATUS_LABEL[lb.status]}
                </span>
              )}
              {doc.adoption?.date && (
                <DocLink id={doc.adoption.minutesDocumentId} page={doc.adoption.page} className="vc-doc-adopted">
                  Adopted {formatDate(doc.adoption.date)}, minutes{doc.adoption.page ? ` page ${doc.adoption.page}` : ''}
                </DocLink>
              )}
              {filedAs && <span className="vc-doc-file">File name: {filedAs}</span>}
            </p>
          )}
          {label && <p className="vc-source-label vc-doc-source">{label}</p>}
        </div>
        <h1 className="vc-page-title">{lb.title}</h1>
        <p className="vc-print-only vc-print-src">
          {original || fileUrl ? <>Source document: {original ?? `${window.location.origin}${fileUrl}`}<br /></> : null}
          This page: {`${window.location.origin}${window.location.pathname}`}
        </p>
        <div className="vc-mtg-actions vc-doc-actions">
          {meeting && (
            <Link to={meetingHref(meeting)} className="vc-secondary">
              <CalendarDays size={15} strokeWidth={1.8} /> {meeting.title}
              {meeting.date ? `, ${formatDate(meeting.date)}` : ''}
            </Link>
          )}
          {trail && trail.attachments.length > 0 && (
            <button type="button" className="vc-secondary vc-meeting-docs-btn" onClick={() => jumpTo('attachments')}>
              <Paperclip size={15} strokeWidth={1.8} /> Attachments <span className="vc-count">{trail.attachments.length}</span>
            </button>
          )}
          {trail && trail.meeting_docs.length > 0 && (
            <button type="button" className="vc-secondary vc-meeting-docs-btn" onClick={() => jumpTo('from-meeting')}>
              <Layers size={15} strokeWidth={1.8} /> From this meeting <span className="vc-count">{trail.meeting_docs.length}</span>
            </button>
          )}
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
          {resident && <ReportButton documentId={doc.id} />}
        </div>
      </header>
      <div ref={stage} className="vc-viewer-stage" aria-busy={load.status === 'loading'}>
        <RecordViewer
          key={doc.id}
          doc={doc}
          page={doc.id === documentId ? current : 1}
          onPage={onPage}
          highlight={highlight}
          screen={screen}
          zoom={zoom}
          onZoom={setZoom}
          onSwipe={nav ? step : undefined}
          trailNav={nav ? <TrailNav steps={nav.steps} index={nav.index} attachmentIds={nav.attachmentIds} onGo={goTo} /> : null}
        />
      </div>
      <PaperTrail trail={trail} />
    </Frame>
  );
}
