import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
// The legacy build ships polyfills (e.g. Map.prototype.getOrInsertComputed) that the modern
// build assumes; without them pdf.js v6 fails in many current browsers.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { ChevronLeft, ChevronRight, Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import { IconButton } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { stem } from '@/lib/text';
import { cn } from '@/lib/cn';
import './pdf-text-layer.css';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface PdfViewerProps {
  url: string;
  page: number;
  onPageChange: (page: number) => void;
  onPageCount?: (count: number) => void;
  onError?: (error: unknown) => void;
  /** Search terms to highlight in the text layer. */
  highlight?: string[];
  title: string;
}

const ZOOMS = [0.6, 0.75, 0.9, 1, 1.15, 1.35, 1.6, 2];

/**
 * Canvas-based PDF viewer (pdf.js) with a selectable text layer and search-term highlighting.
 * The PDF is treated as untrusted: scripting is never enabled and nothing in it is executed.
 */
export default function PdfViewer({ url, page, onPageChange, onPageCount, onError, highlight = [], title }: PdfViewerProps) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [loadState, setLoadState] = useState<{ url: string; error?: unknown } | null>(null);
  const [zoomIndex, setZoomIndex] = useState(3);
  const [width, setWidth] = useState(0);
  const [rendering, setRendering] = useState(true);
  const [pageInput, setPageInput] = useState<{ for: number; value: string }>({ for: page, value: String(page) });
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const hitsKey = highlight.join('|');

  if (pageInput.for !== page) setPageInput({ for: page, value: String(page) });

  // Load the document.
  useEffect(() => {
    let cancelled = false;
    const task = pdfjs.getDocument({ url, disableAutoFetch: true, disableStream: true, rangeChunkSize: 262144, enableXfa: false, withCredentials: false });
    task.promise.then(
      (d) => {
        if (cancelled) return;
        setDoc(d);
        setLoadState({ url });
        onPageCount?.(d.numPages);
      },
      (err: unknown) => {
        if (cancelled) return;
        setLoadState({ url, error: err });
        onError?.(err);
      },
    );
    return () => {
      cancelled = true;
      void task.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // Track available width.
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Render the current page.
  useEffect(() => {
    if (!doc || !width || !canvasRef.current || !textRef.current) return;
    let cancelled = false;
    let renderTask: RenderTask | null = null;
    let textLayer: pdfjs.TextLayer | null = null;
    const target = Math.min(Math.max(1, page), doc.numPages);

    doc.getPage(target).then(async (p: PDFPageProxy) => {
      if (cancelled) return;
      setRendering(true);
      const base = p.getViewport({ scale: 1 });
      const fit = Math.min((width - 32) / base.width, 1.6);
      const scale = Math.max(0.3, fit * ZOOMS[zoomIndex]);
      const viewport = p.getViewport({ scale });
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const canvas = canvasRef.current!;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      const wrapper = pageRef.current!;
      wrapper.style.width = `${Math.floor(viewport.width)}px`;
      wrapper.style.height = `${Math.floor(viewport.height)}px`;
      wrapper.style.setProperty('--total-scale-factor', String(scale));
      wrapper.style.setProperty('--scale-factor', String(scale));
      wrapper.style.setProperty('--scale-round-x', '1px');
      wrapper.style.setProperty('--scale-round-y', '1px');

      renderTask = p.render({ canvas, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
      try {
        await renderTask.promise;
      } catch {
        return; // cancelled
      }
      if (cancelled) return;

      const container = textRef.current!;
      container.replaceChildren();
      textLayer = new pdfjs.TextLayer({ textContentSource: p.streamTextContent(), container, viewport });
      try {
        await textLayer.render();
      } catch {
        return;
      }
      if (cancelled) return;
      const stems = hitsKey ? hitsKey.split('|').map((t) => stem(t)) : [];
      if (stems.length) {
        for (const span of textLayer.textDivs) {
          const words = (span.textContent ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
          if (words.some((w) => stems.includes(stem(w)))) span.classList.add('vtp-hit');
        }
      }
      setRendering(false);
    });

    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
    };
  }, [doc, page, width, zoomIndex, hitsKey]);

  const count = doc?.numPages ?? 0;
  const go = (n: number) => {
    if (!count) return;
    const next = Math.min(Math.max(1, n), count);
    if (next !== page) onPageChange(next);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') {
      e.preventDefault();
      go(page + 1);
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault();
      go(page - 1);
    } else if (e.key === '+' || e.key === '=') setZoomIndex((z) => Math.min(ZOOMS.length - 1, z + 1));
    else if (e.key === '-') setZoomIndex((z) => Math.max(0, z - 1));
  };

  const failed = loadState?.url === url && loadState.error != null;

  return (
    <div className="flex h-full flex-col" onKeyDown={onKeyDown}>
      <div className="flex flex-wrap items-center gap-1 border-b border-line bg-surface px-2 py-1.5" role="toolbar" aria-label="Document viewer controls">
        <IconButton label="Previous page" size="sm" onClick={() => go(page - 1)} disabled={page <= 1 || !count}>
          <ChevronLeft className="size-4" />
        </IconButton>
        <form
          className="flex items-center gap-1.5 text-sm text-muted"
          onSubmit={(e) => {
            e.preventDefault();
            go(Number(pageInput.value) || page);
          }}
        >
          <label htmlFor="vtp-page-input" className="sr-only">
            Page number
          </label>
          <input
            id="vtp-page-input"
            inputMode="numeric"
            value={pageInput.value}
            onChange={(e) => setPageInput({ for: page, value: e.target.value.replace(/\D/g, '').slice(0, 5) })}
            onBlur={() => go(Number(pageInput.value) || page)}
            className="h-8 w-12 rounded-md border border-line-strong bg-surface text-center tabular-nums text-fg"
          />
          <span className="tabular-nums">of {count || '…'}</span>
        </form>
        <IconButton label="Next page" size="sm" onClick={() => go(page + 1)} disabled={!count || page >= count}>
          <ChevronRight className="size-4" />
        </IconButton>
        <span className="mx-1 h-5 w-px bg-line" aria-hidden />
        <IconButton label="Zoom out" size="sm" onClick={() => setZoomIndex((z) => Math.max(0, z - 1))} disabled={zoomIndex === 0}>
          <ZoomOut className="size-4" />
        </IconButton>
        <span className="w-11 text-center text-xs tabular-nums text-subtle" aria-live="polite">
          {Math.round(ZOOMS[zoomIndex] * 100)}%
        </span>
        <IconButton label="Zoom in" size="sm" onClick={() => setZoomIndex((z) => Math.min(ZOOMS.length - 1, z + 1))} disabled={zoomIndex === ZOOMS.length - 1}>
          <ZoomIn className="size-4" />
        </IconButton>
        <IconButton label="Fit to width" size="sm" onClick={() => setZoomIndex(3)}>
          <Maximize2 className="size-3.5" />
        </IconButton>
        {highlight.length > 0 && (
          <span className="ml-auto hidden items-center gap-1.5 pr-1 text-xs text-subtle sm:inline-flex">
            <span className="inline-block size-2.5 rounded-sm bg-mark" aria-hidden /> Highlighting: {highlight.join(', ')}
          </span>
        )}
      </div>
      <div
        ref={frameRef}
        tabIndex={0}
        aria-label={`${title}, page ${page} of ${count || 'unknown'}`}
        className="relative min-h-[60vh] flex-1 overflow-auto bg-raised/70 p-4 focus-visible:outline-offset-[-2px]"
      >
        {failed ? null : (
          <div ref={pageRef} className={cn('relative mx-auto bg-white shadow-md ring-1 ring-black/5', !doc && 'hidden')}>
            <canvas ref={canvasRef} className="block" aria-hidden />
            <div ref={textRef} className="textLayer" />
          </div>
        )}
        {!doc && !failed && (
          <div className="mx-auto aspect-[8.5/11] w-full max-w-2xl rounded-sm bg-surface p-10 shadow-md" role="status" aria-label="Loading document">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="mt-6 h-3 w-full" />
            <Skeleton className="mt-2 h-3 w-full" />
            <Skeleton className="mt-2 h-3 w-4/5" />
            <Skeleton className="mt-8 h-3 w-full" />
            <Skeleton className="mt-2 h-3 w-11/12" />
          </div>
        )}
        {doc && rendering && <span className="sr-only">Rendering page…</span>}
      </div>
    </div>
  );
}
