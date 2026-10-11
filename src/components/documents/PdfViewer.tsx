import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
// The legacy build ships polyfills (e.g. Map.prototype.getOrInsertComputed) that the modern
// build assumes; without them pdf.js v6 fails in many current browsers.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { stem } from '@/lib/text';
import { outputScale, pdfDocumentOptions } from './pdfAssets';
import './pdf-text-layer.css';
import './viewer.css';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface PdfViewerProps {
  url: string;
  /** Scroll to this page whenever `seq` changes (a page asked for in the address, the page box or the arrows). */
  goto: { page: number; seq: number };
  /** 1 fits the page to the width. */
  zoom: number;
  highlight?: string[];
  title: string;
  onReady: (pageCount: number) => void;
  onVisiblePage: (page: number) => void;
  onError: (error: unknown) => void;
}

const MAX_PAGE_WIDTH = 980;
/** Pages this far outside the screen are drawn ahead, and dropped again (memory) when further away. */
const NEAR = '1500px 0px';

/**
 * Every page of a PDF, one under the other, drawn with pdf.js where the browser cannot show the PDF itself
 * (phones and tablets): sharp at the screen's pixel density, with a transparent, selectable text layer and
 * search words marked. Pages are drawn as they come near the screen. The PDF is untrusted: nothing in it runs.
 */
export default function PdfViewer({ url, goto, zoom, highlight = [], title, onReady, onVisiblePage, onError }: PdfViewerProps) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [ratios, setRatios] = useState<Record<number, number>>({});
  const [width, setWidth] = useState(0);
  const [near, setNear] = useState<Set<number>>(() => new Set([1]));
  const wrap = useRef<HTMLDivElement>(null);
  const pageEls = useRef(new Map<number, HTMLDivElement>());
  const io = useRef<IntersectionObserver | null>(null);
  const pending = useRef<number | null>(null);
  const reported = useRef(0);
  const hitsKey = highlight.join('|');
  const cbs = useRef({ onReady, onVisiblePage, onError });
  useLayoutEffect(() => {
    cbs.current = { onReady, onVisiblePage, onError };
  });

  // Load the document.
  useEffect(() => {
    let cancelled = false;
    const task = pdfjs.getDocument({ url, ...pdfDocumentOptions(pdfjs.version) });
    task.promise.then(
      async (d) => {
        if (cancelled) return;
        const first = await d.getPage(1);
        const v = first.getViewport({ scale: 1 });
        if (cancelled) return;
        setRatios({ 1: v.height / v.width });
        setDoc(d);
        cbs.current.onReady(d.numPages);
      },
      (err: unknown) => {
        if (!cancelled) cbs.current.onError(err);
      },
    );
    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [url]);

  // Available width.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Which pages are near the screen.
  useEffect(() => {
    if (!doc) return;
    const obs = new IntersectionObserver(
      (entries) => {
        setNear((prev) => {
          const next = new Set(prev);
          for (const e of entries) {
            const n = Number((e.target as HTMLElement).dataset.page);
            if (e.isIntersecting) next.add(n);
            else next.delete(n);
          }
          return next;
        });
      },
      { rootMargin: NEAR },
    );
    io.current = obs;
    for (const el of pageEls.current.values()) obs.observe(el);
    return () => {
      obs.disconnect();
      io.current = null;
    };
  }, [doc]);

  const pageRef = useCallback((n: number) => (el: HTMLDivElement | null) => {
    const map = pageEls.current;
    const old = map.get(n);
    if (old && old !== el) io.current?.unobserve(old);
    if (el) {
      map.set(n, el);
      io.current?.observe(el);
    } else map.delete(n);
  }, []);

  // The page under the reading line (40% down the screen), reported as the reader scrolls.
  useEffect(() => {
    if (!doc) return;
    let frame = 0;
    const check = () => {
      frame = 0;
      const line = window.innerHeight * 0.4;
      let best = 0;
      for (const [n, el] of pageEls.current) {
        const r = el.getBoundingClientRect();
        if (r.top <= line && r.bottom > line) {
          best = n;
          break;
        }
        if (r.top > line && (!best || n < best) && r.top < window.innerHeight) best = n;
      }
      if (best && best !== reported.current) {
        reported.current = best;
        cbs.current.onVisiblePage(best);
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true });
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [doc]);

  const count = doc?.numPages ?? 0;
  const fit = Math.max(200, Math.min(width, MAX_PAGE_WIDTH));
  const cssWidth = Math.round(fit * zoom);
  const defaultRatio = ratios[1] ?? 11 / 8.5;

  // Go to a page: the address (?page=N), the page box or the arrows. Page 1 never scrolls past the header.
  useEffect(() => {
    if (!doc || !width) return;
    const n = Math.min(Math.max(1, goto.page), doc.numPages);
    if (goto.seq === 0 && n === 1) return;
    pending.current = n;
    reported.current = n;
    pageEls.current.get(n)?.scrollIntoView({ block: 'start' });
    cbs.current.onVisiblePage(n);
  }, [doc, width, goto.page, goto.seq]);

  const onDrawn = useCallback((n: number) => {
    // Pages above the target may have changed height once drawn: land on the target again.
    if (pending.current === n) {
      pageEls.current.get(n)?.scrollIntoView({ block: 'start' });
      pending.current = null;
    }
  }, []);
  const onRatio = useCallback((n: number, r: number) => setRatios((prev) => (Math.abs((prev[n] ?? 0) - r) < 0.001 ? prev : { ...prev, [n]: r })), []);
  const stems = useMemo(() => (hitsKey ? hitsKey.split('|').map((t) => stem(t)) : []), [hitsKey]);

  return (
    <div ref={wrap} className="vc-pdf-pages" aria-label={title}>
      {!doc && (
        <div className="vc-pdf-page vc-pdf-loading" style={{ width: fit, height: Math.round(fit * defaultRatio) }} role="status" aria-label="Loading the PDF">
          <span className="vc-pdf-shimmer" />
        </div>
      )}
      {doc &&
        Array.from({ length: count }, (_, i) => i + 1).map((n) => (
          <PdfPage
            key={n}
            doc={doc}
            n={n}
            count={count}
            cssWidth={cssWidth}
            ratio={ratios[n] ?? defaultRatio}
            draw={near.has(n) && width > 0}
            stems={stems}
            refCb={pageRef(n)}
            onRatio={onRatio}
            onDrawn={onDrawn}
          />
        ))}
    </div>
  );
}

interface PageProps {
  doc: PDFDocumentProxy;
  n: number;
  count: number;
  cssWidth: number;
  ratio: number;
  draw: boolean;
  stems: string[];
  refCb: (el: HTMLDivElement | null) => void;
  onRatio: (n: number, ratio: number) => void;
  onDrawn: (n: number) => void;
}

function PdfPage({ doc, n, count, cssWidth, ratio, draw, stems, refCb, onRatio, onDrawn }: PageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<'idle' | 'drawn' | 'failed'>('idle');
  const stemKey = stems.join('|');

  useEffect(() => {
    const canvas = canvasRef.current;
    const text = textRef.current;
    if (!canvas || !text) return;
    if (!draw) {
      // Far from the screen: free the memory, keep the page's place (drawn again when it comes back).
      canvas.width = 0;
      canvas.height = 0;
      text.replaceChildren();
      return () => undefined;
    }
    let cancelled = false;
    let task: RenderTask | null = null;
    let layer: pdfjs.TextLayer | null = null;
    doc
      .getPage(n)
      .then(async (p: PDFPageProxy) => {
        if (cancelled) return;
        const base = p.getViewport({ scale: 1 });
        onRatio(n, base.height / base.width);
        const scale = cssWidth / base.width;
        const viewport = p.getViewport({ scale });
        const out = outputScale(viewport.width, viewport.height, window.devicePixelRatio);
        canvas.width = Math.floor(viewport.width * out);
        canvas.height = Math.floor(viewport.height * out);
        const box = boxRef.current!;
        box.style.setProperty('--scale-factor', String(scale));
        box.style.setProperty('--total-scale-factor', String(scale));
        box.style.setProperty('--scale-round-x', '1px');
        box.style.setProperty('--scale-round-y', '1px');
        task = p.render({ canvas, viewport, transform: out !== 1 ? [out, 0, 0, out, 0, 0] : undefined, background: '#ffffff' });
        await task.promise;
        if (cancelled) return;
        setState('drawn');
        onDrawn(n);
        text.replaceChildren();
        layer = new pdfjs.TextLayer({ textContentSource: p.streamTextContent(), container: text, viewport });
        await layer.render();
        if (cancelled || !stemKey) return;
        const want = stemKey.split('|');
        for (const span of layer.textDivs) {
          const words = (span.textContent ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
          if (words.some((w) => want.includes(stem(w)))) span.classList.add('vtp-hit');
        }
      })
      .catch((e: unknown) => {
        if (cancelled || (e instanceof Error && e.name === 'RenderingCancelledException')) return;
        setState('failed');
      });
    return () => {
      cancelled = true;
      task?.cancel();
      layer?.cancel();
    };
  }, [doc, n, cssWidth, draw, stemKey, onRatio, onDrawn]);

  const height = Math.round(cssWidth * ratio);
  const shown = draw ? state : 'idle';
  return (
    <div
      ref={(el) => {
        boxRef.current = el;
        refCb(el);
      }}
      data-page={n}
      id={`vc-pdf-p${n}`}
      className="vc-pdf-page"
      data-state={shown}
      style={{ width: cssWidth, height }}
      aria-label={`Page ${n} of ${count}`}
      role="group"
    >
      <canvas ref={canvasRef} className="vc-pdf-canvas" aria-hidden />
      <div ref={textRef} className="textLayer" />
      {shown !== 'drawn' && <span className="vc-pdf-pageno">{shown === 'failed' ? `Page ${n} could not be drawn` : `Page ${n}`}</span>}
    </div>
  );
}
