/**
 * The map's no-overlap check: every visible control on /map (search, Tools and its menu, the layers panel,
 * Legend, the details card, the projects list, Measure and its buttons, Street View's bar, photo and 3D
 * buttons, the parcel card, Drive mode's picker, bar, turn arrows and small map, the map's own zoom, full screen and (i) buttons) is measured, and any two whose
 * boxes intersect are reported. One control inside another (a button in the panel) is not an overlap.
 * Used by map-shots.mjs; returns the pairs, each with both boxes.
 */
export const CONTROLS = [
  '.vc-map-search',
  '.vc-map-tools > button',
  '.vc-map-tools-menu',
  '.vc-map-panel',
  '.vc-map-legend',
  '.vc-map-card',
  '.vc-mp',
  '.vc-map-loading',
  '.vc-measure',
  '.vc-measure-add',
  '.vc-pcard',
  '.vc-sv-note',
  '.vc-sv-3d',
  '.vc-svp',
  '.vc-drive-pick',
  '.vc-drive-bar',
  '.vc-drive-turns',
  '.vc-drive-inset',
  '.vc-map .maplibregl-ctrl-top-left > .maplibregl-ctrl',
  '.vc-map .maplibregl-ctrl-top-right > .maplibregl-ctrl',
  '.vc-map .maplibregl-ctrl-bottom-left > .maplibregl-ctrl',
  '.vc-map .maplibregl-ctrl-bottom-right > .maplibregl-ctrl',
];

/** Pairs of visible controls whose boxes intersect by more than `slack` pixels each way. */
export async function overlaps(page, slack = 1) {
  return page.evaluate(
    ({ selectors, slack }) => {
      const seen = new Set();
      const items = [];
      for (const sel of selectors)
        for (const el of document.querySelectorAll(sel)) {
          if (seen.has(el)) continue;
          seen.add(el);
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
          const r = el.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) continue;
          // Off screen (a sheet slid away, a panel scrolled out) does not count.
          if (r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) continue;
          const name = sel.replace('.vc-map .maplibregl-ctrl-', 'ctrl-').replace(/ > \.maplibregl-ctrl$/, '') + (el.className && typeof el.className === 'string' && el.className.includes('attrib') ? ' (i)' : el.querySelector?.('.maplibregl-ctrl-zoom-in') ? ' zoom' : el.querySelector?.('.vtp-fs-btn') ? ' full screen' : '');
          items.push({ el, name, box: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } });
        }
      const out = [];
      for (let i = 0; i < items.length; i++)
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i],
            b = items[j];
          if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
          const ix = Math.min(a.box.x + a.box.w, b.box.x + b.box.w) - Math.max(a.box.x, b.box.x);
          const iy = Math.min(a.box.y + a.box.h, b.box.y + b.box.h) - Math.max(a.box.y, b.box.y);
          if (ix > slack && iy > slack) out.push({ a: a.name, b: b.name, boxA: a.box, boxB: b.box });
        }
      return out;
    },
    { selectors: CONTROLS, slack },
  );
}
