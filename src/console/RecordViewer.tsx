/**
 * The record itself, under its title on /documents/:id. A PDF opens at once, the whole file, readable:
 *
 * - on a computer, in the browser's own PDF viewer (a same-origin frame of the portal's file route);
 * - on a phone or tablet, as the portal's own pages drawn with pdf.js (src/components/documents/PdfViewer.tsx);
 * - with no copy the portal can serve, read from CivicClerk by the browser where CivicClerk allows it, else
 *   one clear "Open the PDF" button to the official file. Never a blank or broken frame: the file is checked
 *   (its first bytes must be a PDF) before a viewer is drawn.
 *
 * Images are shown as they are. Word files, spreadsheets and other files are offered as a download (nothing is
 * converted), with the text the archive read from them below. One toolbar for all: page, zoom (pdf.js), download,
 * print, open in a new tab and full screen. src/components/documents/viewerMode.ts picks the viewer.
 */
import '@/components/documents/viewer.css';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ArrowUpRight, ChevronLeft, ChevronRight, Download, Expand, FileText, Minus, Plus, Printer, X } from 'lucide-react';
import type { DocumentDetail, DocumentPageText } from '@/types/models';
import { DocumentService } from '@/services';
import { fileKind, fileRoute, FILE_KIND_LABEL, type FileKind } from '@/lib/documentFile';
import { viewerMode, isPhoneOrTablet, type ViewerMode } from '@/components/documents/viewerMode';
import { probePdf } from '@/components/documents/probe';

const PdfViewer = lazy(() => import('@/components/documents/PdfViewer'));

const ZOOMS = [0.75, 1, 1.25, 1.5, 2, 2.5];

const safeHttp = (u: string | null | undefined) => (u && /^https?:\/\//i.test(u) ? u : null);

function TextPages({ pages, page }: { pages: DocumentPageText[]; page: number }) {
  useEffect(() => {
    if (page > 1) document.getElementById(`vc-p${page}`)?.scrollIntoView({ block: 'start' });
  }, [page]);
  if (!pages.length) return <div className="vc-empty">No readable text was found in this record.</div>;
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

/** The record's text as read by the archive, below a file that is not shown inline. */
function RecordText({ id, page, note }: { id: string; page: number; note?: string }) {
  const [state, setState] = useState<{ id: string; pages: DocumentPageText[] | null; failed: boolean } | null>(null);
  useEffect(() => {
    let live = true;
    DocumentService.text(id).then(
      (pages) => live && setState({ id, pages, failed: false }),
      () => live && setState({ id, pages: null, failed: true }),
    );
    return () => {
      live = false;
    };
  }, [id]);
  if (!state || state.id !== id)
    return (
      <div className="vc-skeleton" aria-hidden="true">
        <span style={{ width: '94%' }} />
        <span style={{ width: '86%' }} />
      </div>
    );
  if (state.failed || !state.pages) return null;
  if (!state.pages.length) return note ? null : <div className="vc-empty">No readable text was found in this record.</div>;
  return (
    <>
      {note && <p className="vc-viewer-note">{note}</p>}
      <TextPages pages={state.pages} page={page} />
    </>
  );
}

const touchDevice = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

/** Prints the PDF itself: a hidden same-origin frame on a computer, the browser's own viewer in a new tab on a phone. */
function printPdf(fileUrl: string) {
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
}

/**
 * Full screen: a fixed layer over the whole screen (works on iPhone, where pages cannot use the browser
 * Fullscreen API) plus the Fullscreen API where it exists. Back and Esc leave it.
 */
function useFullScreen(shell: RefObject<HTMLDivElement | null>) {
  const [full, setFull] = useState(false);
  const exit = useCallback(() => {
    setFull(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    if ((window.history.state as { vcFull?: boolean } | null)?.vcFull) window.history.back();
  }, []);
  const enter = useCallback(() => {
    setFull(true);
    window.history.pushState({ ...(window.history.state ?? {}), vcFull: true }, '');
    const el = shell.current as (HTMLDivElement & { webkitRequestFullscreen?: () => void }) | null;
    try {
      if (el?.requestFullscreen) void el.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined);
      else el?.webkitRequestFullscreen?.();
    } catch {
      /* the fixed layer alone still fills the screen */
    }
  }, [shell]);
  useEffect(() => {
    if (!full) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && exit();
    const onPop = () => {
      setFull(false);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
    const onFs = () => {
      if (!document.fullscreenElement) exit();
    };
    document.addEventListener('keydown', onKey);
    window.addEventListener('popstate', onPop);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('fullscreenchange', onFs);
    };
  }, [full, exit]);
  return { full, enter, exit };
}

interface BarProps {
  title: string;
  page?: { current: number; count: number | null; go: (n: number) => void };
  zoom?: { index: number; set: (i: number) => void };
  download?: string | null;
  print?: (() => void) | null;
  open?: string | null;
  full: boolean;
  onFull: () => void;
  onExit: () => void;
}

/** The viewer's one toolbar. Labels show beside the icons from 720 px; on a phone the icons carry them as names. */
function ViewerBar({ title, page, zoom, download, print, open, full, onFull, onExit }: BarProps) {
  const [draft, setDraft] = useState<{ for: number; value: string } | null>(null);
  const value = draft && draft.for === page?.current ? draft.value : String(page?.current ?? 1);
  const submit = () => {
    if (!page) return;
    const n = Number(value);
    if (n >= 1) page.go(Math.min(n, page.count ?? n));
    setDraft(null);
  };
  return (
    <div className="vc-vbar" role="toolbar" aria-label="Viewer">
      {full && <span className="vc-vbar-title vc-vbar-hide-sm">{title}</span>}
      {page && (
        <div className="vc-vbar-group">
          <button type="button" className="vc-vbtn" aria-label="Previous page" title="Previous page" onClick={() => page.go(page.current - 1)} disabled={page.current <= 1}>
            <ChevronLeft size={18} strokeWidth={2} />
          </button>
          <form
            className="vc-vbar-page"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <label htmlFor="vc-page-box" className="vc-vbar-hide-sm">
              Page
            </label>
            <input
              id="vc-page-box"
              inputMode="numeric"
              aria-label="Page"
              value={value}
              onChange={(e) => setDraft({ for: page.current, value: e.target.value.replace(/\D/g, '').slice(0, 5) })}
              onBlur={submit}
            />
            {page.count ? <span>of {page.count}</span> : null}
          </form>
          <button type="button" className="vc-vbtn" aria-label="Next page" title="Next page" onClick={() => page.go(page.current + 1)} disabled={page.count != null && page.current >= page.count}>
            <ChevronRight size={18} strokeWidth={2} />
          </button>
        </div>
      )}
      {zoom && (
        <div className="vc-vbar-group vc-vbar-zoom">
          <button type="button" className="vc-vbtn" aria-label="Zoom out" title="Zoom out" onClick={() => zoom.set(Math.max(0, zoom.index - 1))} disabled={zoom.index === 0}>
            <Minus size={16} strokeWidth={2} />
          </button>
          <button type="button" className="vc-vbar-pct" title="Fit to width" onClick={() => zoom.set(1)}>
            {Math.round(ZOOMS[zoom.index] * 100)}%
          </button>
          <button type="button" className="vc-vbtn" aria-label="Zoom in" title="Zoom in" onClick={() => zoom.set(Math.min(ZOOMS.length - 1, zoom.index + 1))} disabled={zoom.index === ZOOMS.length - 1}>
            <Plus size={16} strokeWidth={2} />
          </button>
        </div>
      )}
      <div className="vc-vbar-group vc-vbar-end">
        {download && (
          <a className="vc-vbtn" href={download} download aria-label="Download" title="Download">
            <Download size={17} strokeWidth={1.9} />
            <span className="vc-vbar-hide-sm">Download</span>
          </a>
        )}
        {print && (
          <button type="button" className="vc-vbtn vc-vbar-hide-sm" onClick={print} aria-label="Print" title="Print">
            <Printer size={17} strokeWidth={1.9} />
            <span>Print</span>
          </button>
        )}
        {open && (
          <a className="vc-vbtn" href={open} target="_blank" rel="noopener noreferrer" aria-label="Open in a new tab" title="Open in a new tab">
            <ArrowUpRight size={17} strokeWidth={1.9} />
            <span className="vc-vbar-hide-sm">Open</span>
          </a>
        )}
        {full ? (
          <button type="button" className="vc-vbtn vc-vbar-exit" onClick={onExit} autoFocus>
            <X size={18} strokeWidth={2.2} /> <span className="vc-vbar-hide-sm">Exit full screen</span>
            <span className="vc-vbar-show-sm">Exit</span>
          </button>
        ) : (
          <button type="button" className="vc-vbtn" onClick={onFull} aria-label="Full screen" title="Full screen">
            <Expand size={16} strokeWidth={2} />
            <span className="vc-vbar-hide-sm">Full screen</span>
          </button>
        )}
      </div>
    </div>
  );
}

/** A file that is not shown inline: what it is and one clear button. */
function FileCard({ kind, href, label, note }: { kind: FileKind; href: string | null; label: string; note: string }) {
  return (
    <div className="vc-filecard">
      <FileText size={28} strokeWidth={1.5} aria-hidden />
      <p className="vc-filecard-kind">{FILE_KIND_LABEL[kind]}</p>
      <p className="vc-filecard-note">{note}</p>
      {href && (
        <a className="vc-primary vc-filecard-btn" href={href} target={/^https?:/i.test(href) ? '_blank' : undefined} rel="noopener noreferrer" download={/^https?:/i.test(href) ? undefined : ''}>
          {label} {/^https?:/i.test(href) ? <ArrowUpRight size={15} /> : <Download size={15} />}
        </a>
      )}
    </div>
  );
}

type Source = { status: 'checking' } | { status: 'ready'; url: string; sameOrigin: boolean } | { status: 'none' };

/** Where this PDF can be read from, checked before any viewer is drawn. */
function usePdfSource(doc: DocumentDetail, fileUrl: string, enabled: boolean): [Source, () => void] {
  const route = fileRoute(doc);
  const original = safeHttp(doc.originalUrl);
  const [state, setState] = useState<{ key: string; source: Source } | null>(null);
  const [skipSame, setSkipSame] = useState(false);
  const key = `${doc.id}|${skipSame}`;
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    (async (): Promise<Source> => {
      if (route !== 'none' && !skipSame && (await probePdf(fileUrl, true))) return { status: 'ready', url: fileUrl, sameOrigin: true };
      if (route === 'direct' && original && (await probePdf(original, false))) return { status: 'ready', url: original, sameOrigin: false };
      return { status: 'none' };
    })().then((source) => live && setState({ key, source }));
    return () => {
      live = false;
    };
  }, [enabled, key, route, fileUrl, original, skipSame]);
  // The portal's copy loaded but could not be drawn: try the official file (CivicClerk) before giving up.
  const fallback = useCallback(() => {
    if (route === 'direct' && !skipSame) setSkipSame(true);
    else setState({ key, source: { status: 'none' } });
  }, [route, skipSame, key]);
  return [state?.key === key ? state.source : { status: 'checking' }, fallback];
}

export interface RecordViewerProps {
  doc: DocumentDetail;
  /** The page in the address (?page=N). */
  page: number;
  /** Keeps the address in step with the page on screen (replaces history). */
  onPage: (page: number) => void;
  highlight: string[];
}

export function RecordViewer({ doc, page, onPage, highlight }: RecordViewerProps) {
  const shell = useRef<HTMLDivElement>(null);
  const { full, enter, exit } = useFullScreen(shell);
  const kind = fileKind(doc.mimeType, doc.fileName);
  const route = fileRoute(doc);
  const fileUrl = `/api/documents/${encodeURIComponent(doc.id)}/file`;
  const original = safeHttp(doc.originalUrl);
  const override = useMemo(() => (typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('viewer')), []);
  const [source, fallback] = usePdfSource(doc, fileUrl, kind === 'pdf');
  const mode: ViewerMode = source.status === 'ready' && !source.sameOrigin ? 'pdfjs' : viewerMode(navigator, override);
  const [count, setCount] = useState<number | null>(doc.pageCount ?? null);
  const [zoomIndex, setZoomIndex] = useState(1);
  const [goto, setGoto] = useState({ page, seq: 0 });
  const [nativePage, setNativePage] = useState(page);
  const [imageFailed, setImageFailed] = useState(false);

  const go = (n: number) => {
    const next = Math.max(1, count ? Math.min(n, count) : n);
    onPage(next);
    if (mode === 'native') setNativePage(next);
    else setGoto((g) => ({ page: next, seq: g.seq + 1 }));
  };
  // The pages move to another scroll box when full screen opens or closes: land on the same page again.
  const pageNow = useRef(page);
  useEffect(() => {
    pageNow.current = page;
  }, [page]);
  const relocate = () => {
    const target = pageNow.current;
    setTimeout(() => setGoto((g) => ({ page: target, seq: g.seq + 1 })), 60);
  };
  const setZoom = (i: number) => {
    setZoomIndex(i);
    setGoto((g) => ({ page, seq: g.seq + 1 }));
  };

  let body: ReactNode;
  let bar: Omit<BarProps, 'title' | 'full' | 'onFull' | 'onExit'> = {};
  const downloadable = route === 'archive' || route === 'proxy' ? fileUrl : original;

  if (kind === 'pdf') {
    if (source.status === 'checking') {
      body = (
        <div className="vc-pdf-pages">
          <div className="vc-pdf-page vc-pdf-loading" role="status" aria-label="Loading the PDF">
            <span className="vc-pdf-shimmer" />
          </div>
        </div>
      );
    } else if (source.status === 'none') {
      body = (
        <>
          <FileCard
            kind="pdf"
            href={original ?? null}
            label="Open the PDF"
            note={original ? 'The portal holds no copy of this PDF it can show here. It opens at the official address.' : 'The PDF could not be loaded.'}
          />
          <RecordText id={doc.id} page={page} note="The text the archive read from it:" />
        </>
      );
      bar = { download: null, open: original };
    } else if (mode === 'native') {
      body = (
        <iframe
          key={`${source.url}#${nativePage}`}
          className="vc-pdf-frame"
          title={doc.title}
          src={`${source.url}#page=${nativePage}&view=FitH&navpanes=0`}
        />
      );
      bar = { page: { current: nativePage, count, go }, download: source.url, print: () => printPdf(source.url), open: `${source.url}#page=${nativePage}` };
    } else {
      body = (
        <Suspense
          fallback={
            <div className="vc-pdf-pages">
              <div className="vc-pdf-page vc-pdf-loading" role="status" aria-label="Loading the PDF">
                <span className="vc-pdf-shimmer" />
              </div>
            </div>
          }
        >
          <PdfViewer
            url={source.url}
            goto={goto}
            zoom={ZOOMS[zoomIndex]}
            highlight={highlight}
            title={doc.title}
            onReady={setCount}
            onVisiblePage={onPage}
            onError={fallback}
          />
        </Suspense>
      );
      bar = {
        page: { current: page, count, go },
        zoom: isPhoneOrTablet(navigator) ? undefined : { index: zoomIndex, set: setZoom },
        download: source.sameOrigin ? source.url : downloadable,
        print: source.sameOrigin ? () => printPdf(source.url) : null,
        open: source.url,
      };
    }
  } else if (kind === 'image' && doc.archiveUrl && !imageFailed) {
    body = (
      <div className="vc-viewer-image">
        <img src={doc.archiveUrl} alt={doc.title} onError={() => setImageFailed(true)} />
      </div>
    );
    bar = { download: doc.archiveUrl, open: doc.archiveUrl };
  } else if (kind === 'text') {
    body = <RecordText id={doc.id} page={page} />;
    bar = { print: () => window.print(), open: original };
  } else {
    const href = route === 'archive' ? fileUrl : original;
    body = (
      <>
        <FileCard
          kind={kind}
          href={href}
          label={route === 'archive' ? 'Download' : 'Open the file'}
          note={kind === 'image' ? 'The image could not be shown here.' : `A ${FILE_KIND_LABEL[kind].toLowerCase()} is not shown in the browser. ${route === 'archive' ? 'Download it to open it.' : 'It opens at the official address.'}`}
        />
        <RecordText id={doc.id} page={page} note="The text the archive read from it:" />
      </>
    );
    bar = { download: route === 'archive' ? fileUrl : null, open: original };
  }

  return (
    <div ref={shell} className="vc-viewer-shell" data-full={full} data-mode={kind === 'pdf' && source.status === 'ready' ? mode : 'other'}>
      <ViewerBar
        title={doc.title}
        {...bar}
        full={full}
        onFull={() => {
          enter();
          relocate();
        }}
        onExit={() => {
          exit();
          relocate();
        }}
      />
      <div className="vc-viewer-body">{body}</div>
    </div>
  );
}
