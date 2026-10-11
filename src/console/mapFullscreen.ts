/**
 * Full screen for every map: a MapLibre control (a 44 px button with the zoom buttons) that puts the
 * map's box on the whole screen.
 *  - Where the browser can show an element full screen (desktop, Android), it does; Escape (desktop)
 *    and the back button (Android) leave it.
 *  - Where it cannot (iPhone Safari), the box is fixed over the whole viewport (100dvh, clear of the
 *    notch and home bar), the page under it stops scrolling, and the button turns into a clear Close (X).
 * In both, a history entry is added on the way in, so the phone's back button closes full screen
 * instead of leaving the page; Escape closes it too. The map is resized on the way in and out.
 */
import { isAppleTouch } from '@/lib/appleTouch';
import type * as maplibregl from 'maplibre-gl';

const SVG = (paths: string) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const EXPAND = SVG('<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>');
const CLOSE = SVG('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>');

type FsElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
type FsDocument = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> | void; webkitFullscreenEnabled?: boolean };

/** The element the browser shows full screen right now, if any. */
const fsElement = () => document.fullscreenElement ?? (document as FsDocument).webkitFullscreenElement ?? null;

/** Whether this browser can show an element full screen (false on iPhone Safari). */
export function canElementFullscreen(el: HTMLElement): boolean {
  if (isAppleTouch(navigator.userAgent, navigator.maxTouchPoints ?? 0)) return false;
  const d = document as FsDocument;
  return Boolean((d.fullscreenEnabled || d.webkitFullscreenEnabled) && (el.requestFullscreen || (el as FsElement).webkitRequestFullscreen));
}

export class FullscreenToggle implements maplibregl.IControl {
  private map: maplibregl.Map | null = null;
  private box: HTMLDivElement | null = null;
  private button: HTMLButtonElement | null = null;
  private mode: 'api' | 'css' | null = null;
  private pushed = false;

  /** `target` is the box to show full screen (the map and whatever floats over it). */
  constructor(
    private readonly target: () => HTMLElement | null,
    private readonly onChange?: (full: boolean) => void,
  ) {}

  get isFull() {
    return this.mode !== null;
  }

  onAdd(map: maplibregl.Map): HTMLElement {
    this.map = map;
    const box = document.createElement('div');
    box.className = 'maplibregl-ctrl maplibregl-ctrl-group vtp-fs-ctrl';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'vtp-fs-btn';
    b.addEventListener('click', () => (this.mode ? this.exit() : this.enter()));
    box.appendChild(b);
    this.box = box;
    this.button = b;
    this.paint();
    document.addEventListener('fullscreenchange', this.onFsChange);
    document.addEventListener('webkitfullscreenchange', this.onFsChange);
    window.addEventListener('popstate', this.onPop);
    window.addEventListener('keydown', this.onKey);
    return box;
  }

  onRemove(): void {
    if (this.mode) this.exit();
    document.removeEventListener('fullscreenchange', this.onFsChange);
    document.removeEventListener('webkitfullscreenchange', this.onFsChange);
    window.removeEventListener('popstate', this.onPop);
    window.removeEventListener('keydown', this.onKey);
    this.box?.remove();
    this.map = null;
  }

  enter(): void {
    const el = this.target();
    if (!el || this.mode) return;
    if (canElementFullscreen(el)) {
      this.mode = 'api';
      const req = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : (el as FsElement).webkitRequestFullscreen?.();
      // Refused (no user gesture, a policy): the fixed box instead.
      Promise.resolve(req).catch(() => {
        this.mode = null;
        this.enterCss(el);
      });
    } else this.enterCss(el);
    try {
      history.pushState({ ...(history.state as object | null), vtpMapFull: true }, '');
      this.pushed = true;
    } catch {
      this.pushed = false;
    }
    this.changed(true);
  }

  /** Leaves full screen. `fromHistory`: the back button already took the history entry away. */
  exit(fromHistory = false): void {
    if (!this.mode) return;
    const el = this.target();
    if (this.mode === 'api' && fsElement()) {
      const d = document as FsDocument;
      void Promise.resolve(d.exitFullscreen ? d.exitFullscreen() : d.webkitExitFullscreen?.()).catch(() => undefined);
    }
    el?.classList.remove('vtp-fs');
    document.documentElement.classList.remove('vtp-fs-lock');
    this.mode = null;
    if (this.pushed && !fromHistory && (history.state as { vtpMapFull?: boolean } | null)?.vtpMapFull) history.back();
    this.pushed = false;
    this.changed(false);
  }

  private enterCss(el: HTMLElement) {
    this.mode = 'css';
    el.classList.add('vtp-fs');
    document.documentElement.classList.add('vtp-fs-lock');
    this.changed(true);
  }

  private changed(full: boolean) {
    this.paint();
    this.onChange?.(full);
    // The box changed size: draw the map at its new size (now and once the layout settles).
    const map = this.map;
    if (!map) return;
    map.resize();
    requestAnimationFrame(() => this.map?.resize());
    setTimeout(() => this.map?.resize(), 250);
  }

  private paint() {
    const b = this.button;
    if (!b) return;
    const full = Boolean(this.mode);
    b.innerHTML = full ? CLOSE : EXPAND;
    b.setAttribute('aria-label', full ? 'Close full screen' : 'Full screen');
    b.title = full ? 'Close full screen' : 'Full screen';
    b.setAttribute('aria-pressed', String(full));
    this.box?.setAttribute('data-full', String(full));
  }

  private onFsChange = () => {
    // Left by the browser itself (Escape, the Android back gesture).
    if (this.mode === 'api' && !fsElement()) this.exit();
    else this.changed(Boolean(this.mode));
  };

  private onPop = () => {
    if (this.mode) {
      this.pushed = false;
      this.exit(true);
    }
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && this.mode === 'css') this.exit();
  };
}
