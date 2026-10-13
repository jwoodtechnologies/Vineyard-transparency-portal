/**
 * The map's (i) credits, folded on every screen size until someone taps the (i). MapLibre's compact
 * attribution unfolds itself the first time credits arrive (and on wide screens), covering the legend
 * and the drawing; this keeps it folded unless the reader opened it.
 */
import * as maplibregl from 'maplibre-gl';

export class FoldedAttribution extends maplibregl.AttributionControl {
  private watch: MutationObserver | null = null;

  constructor(options: maplibregl.AttributionControlOptions = {}) {
    super({ ...options, compact: true });
  }

  onAdd(map: maplibregl.Map): HTMLElement {
    const el = super.onAdd(map);
    // Once the reader taps the (i), it is theirs to open and close.
    el.addEventListener(
      'click',
      () => {
        this.watch?.disconnect();
        this.watch = null;
      },
      { capture: true, once: true },
    );
    const fold = () => {
      if (el.classList.contains('maplibregl-compact-show')) el.classList.remove('maplibregl-compact-show');
    };
    fold();
    this.watch = new MutationObserver(fold);
    this.watch.observe(el, { attributes: true, attributeFilter: ['class'] });
    return el;
  }

  onRemove(): void {
    this.watch?.disconnect();
    this.watch = null;
    super.onRemove();
  }
}
