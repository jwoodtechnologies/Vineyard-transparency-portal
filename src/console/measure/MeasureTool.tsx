/**
 * The map's Measure tool: Distance, Area, Circle and Parcel in one compact control, with a readout that
 * is a slim bottom sheet on phones and a small card at the right on wider screens. Points are added by tapping the
 * map, or on touch screens with the center crosshair and Add point, so a finger never hides the spot.
 * Drag a point to move it, tap a segment's middle handle to add one there. Escape cancels, Enter
 * finishes, Backspace undoes. Everything on the map is drawn by ./draw.ts; the math is ./geo.ts.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type * as maplibregl from 'maplibre-gl';
import { Check, ChevronDown, CircleDot, Copy, Download, LandPlot, Link as LinkIcon, Mountain, Pentagon, Plus, Repeat, Ruler, Share2, Trash2, Undo2, X } from 'lucide-react';
import { getJson } from '../api';
import { bearing, circleRing, distance, geometryArea, type Pos } from './geo';
import { addLayers, drawGuide, drawShape, Handles, removeLayers, snap, snapMeters, type SnapData } from './draw';
import { buildProfile, fetchElevations, samplePoints, type Profile } from './profile';
import { emptyState, encodeShape, reduce, type Mode, type Shape } from './shape';
import { ACCURACY, copyText, summarize, summaryLines, toGeoJson, type ParcelInfo } from './summary';
import { AREA_LABEL, areaUnitsFor, BIKE_MPS, fmtArea, fmtBearing, fmtDuration, fmtHeight, fmtLength, loadUnits, saveUnits, WALK_MPS, type AreaUnit, type Units } from './units';

interface Props {
  getMap: () => maplibregl.Map | null;
  /** Bumped each time the map is remade (theme or base map), so the drawing is added again. */
  gen: number;
  ready: boolean;
  /** A shape from a ?m= link, opened as it was shared. */
  initial: Shape | null;
  snapData: () => SnapData;
  onClose: () => void;
}

const MODES: Array<{ id: Mode; label: string; Icon: typeof Ruler }> = [
  { id: 'distance', label: 'Distance', Icon: Ruler },
  { id: 'area', label: 'Area', Icon: Pentagon },
  { id: 'circle', label: 'Circle', Icon: CircleDot },
  { id: 'parcel', label: 'Parcel', Icon: LandPlot },
];

const coarseQuery = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
const wideQuery = () => typeof window !== 'undefined' && window.innerWidth > 820;

interface ParcelResponse {
  found: boolean;
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown } | null;
}

/** The outer ring of a parcel's largest part. */
function outerRing(g: ParcelResponse['geometry']): Pos[] | null {
  if (!g) return null;
  const polys = (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []) as Pos[][][];
  let best: Pos[] | null = null;
  for (const p of polys) if (p[0] && (!best || geometryArea({ type: 'Polygon', coordinates: [p[0]] }) > geometryArea({ type: 'Polygon', coordinates: [best] }))) best = p[0];
  return best;
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers and some embedded views: a hidden text box and the copy command.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok: boolean;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

function hint(mode: Mode, coarse: boolean, count: number, done: boolean): string {
  if (done) return mode === 'parcel' ? 'Tap another parcel to measure it.' : 'Drag a point to adjust it. Tap a middle handle to add a point.';
  switch (mode) {
    case 'distance':
      return coarse ? 'Move the map to put the crosshair on a spot, then tap Add point.' : count ? 'Click to add the next point. Press Enter to finish.' : 'Click the map to add points.';
    case 'area':
      return coarse ? 'Put the crosshair on each corner and tap Add point. Three or more points make an area.' : 'Click each corner. Three or more points make an area. Press Enter to finish.';
    case 'circle':
      return coarse
        ? count
          ? 'Move the crosshair to the edge, then tap Set edge.'
          : 'Put the crosshair on the center, then tap Set center.'
        : count
          ? 'Click the edge of the circle.'
          : 'Click the center and drag out the radius, or click the center and then the edge.';
    case 'parcel':
      return coarse ? 'Put the crosshair inside a parcel, then tap Measure parcel.' : 'Click a parcel to measure it.';
  }
}

export function MeasureTool({ getMap, gen, ready, initial, snapData, onClose }: Props) {
  const [state, dispatch] = useReducer(reduce, initial, (s) => (s ? reduce(emptyState(s.mode), { type: 'load', shape: s }) : emptyState()));
  const [units, setUnitsState] = useState<Units>(loadUnits);
  const [coarse] = useState(coarseQuery);
  const [wide, setWide] = useState(wideQuery);
  const [guide, setGuide] = useState<Pos | null>(null);
  const [parcel, setParcel] = useState<ParcelInfo | null>(null);
  const [parcelState, setParcelState] = useState<'idle' | 'loading' | 'none' | 'error'>('idle');
  const [open, setOpen] = useState(false);
  const [share, setShare] = useState(false);
  const [note, setNote] = useState('');
  const [said, setSaid] = useState('');
  const [profile, setProfile] = useState<{ status: 'off' | 'loading' | 'error' | 'done'; data?: Profile | null }>({ status: 'off' });
  const panelRef = useRef<HTMLElement>(null);
  const handles = useRef<Handles | null>(null);
  const live = useRef({ state, coarse });
  const snapRef = useRef(snapData);
  useEffect(() => {
    live.current = { state, coarse };
    snapRef.current = snapData;
  });

  const parcelForSum = state.mode === 'parcel' ? parcel : null;
  const sum = useMemo(() => summarize(state, parcelForSum), [state, parcelForSum]);
  const drawing = !state.done && state.mode !== 'parcel';

  const setUnits = useCallback((u: Units) => {
    setUnitsState(u);
    saveUnits(u);
  }, []);

  // A tap or click on the map, or Add point at the crosshair: snapped to a parcel corner or road line when close.
  const addAt = useCallback(
    (at: Pos) => {
      const map = getMap();
      const s = live.current.state;
      if (s.mode === 'parcel' || !map) return dispatch({ type: 'add', at });
      dispatch({ type: 'add', at: snap(at, snapRef.current(), snapMeters(map, at)).at });
    },
    [getMap],
  );

  // The map side: layers, handles and pointer listeners, added again whenever the map is remade.
  useEffect(() => {
    const map = getMap();
    if (!map || !ready) return;
    addLayers(map);
    const h = new Handles(map, {
      onDrag: (index, at, phase) => {
        if (phase === 'start') dispatch({ type: 'move', index, at: live.current.state.pts[index] ?? at });
        else if (phase === 'move') dispatch({ type: 'move', index, at, record: false });
        else dispatch({ type: 'move', index, at: snap(at, snapRef.current(), snapMeters(map, at)).at, record: false });
      },
      onInsert: (after, at) => dispatch({ type: 'insert', after, at }),
      onPointTap: (index) => {
        const s = live.current.state;
        if (s.done) return;
        if (index === 0 && s.pts.length > 2) {
          if (s.mode === 'distance' && !s.closed) dispatch({ type: 'close' });
          dispatch({ type: 'finish' });
        } else if (index === s.pts.length - 1 && s.pts.length > 1) dispatch({ type: 'finish' });
      },
    });
    handles.current = h;
    map.doubleClickZoom.disable();
    map.getCanvas().style.cursor = 'crosshair';
    let frame = 0;
    const setGuideSoon = (p: Pos | null) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setGuide(p));
    };
    // Circles on a mouse: press on the center and drag out the radius.
    let circleDrag = false;
    let suppressClick = false;
    const onDown = (e: maplibregl.MapMouseEvent) => {
      const s = live.current.state;
      if (live.current.coarse || s.mode !== 'circle' || s.pts.length || e.originalEvent.button !== 0) return;
      map.dragPan.disable();
      circleDrag = true;
      dispatch({ type: 'add', at: [e.lngLat.lng, e.lngLat.lat] });
    };
    const onUp = (e: maplibregl.MapMouseEvent) => {
      if (!circleDrag) return;
      circleDrag = false;
      map.dragPan.enable();
      const s = live.current.state;
      const p = map.project(s.pts[0]);
      // Dragged out: that is the edge. Not moved: the click that follows is the press that set the center.
      if (Math.hypot(p.x - e.point.x, p.y - e.point.y) > 6) dispatch({ type: 'add', at: [e.lngLat.lng, e.lngLat.lat] });
      else suppressClick = true;
    };
    const onClick = (e: maplibregl.MapMouseEvent) => {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      addAt([e.lngLat.lng, e.lngLat.lat]);
    };
    const onMove = (e: maplibregl.MapMouseEvent) => {
      if (!live.current.coarse) setGuideSoon([e.lngLat.lng, e.lngLat.lat]);
    };
    const onOut = () => {
      if (!live.current.coarse) setGuideSoon(null);
    };
    const onPan = () => {
      if (live.current.coarse) {
        const c = map.getCenter();
        setGuideSoon([c.lng, c.lat]);
      }
    };
    map.on('mousedown', onDown);
    map.on('mouseup', onUp);
    map.on('click', onClick);
    map.on('mousemove', onMove);
    map.on('mouseout', onOut);
    map.on('move', onPan);
    onPan();
    return () => {
      cancelAnimationFrame(frame);
      map.off('mousedown', onDown);
      map.off('mouseup', onUp);
      map.off('click', onClick);
      map.off('mousemove', onMove);
      map.off('mouseout', onOut);
      map.off('move', onPan);
      map.dragPan.enable();
      map.doubleClickZoom.enable();
      map.getCanvas().style.cursor = '';
      h.clear();
      handles.current = null;
      try {
        removeLayers(map);
        map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
      } catch {
        // The map was already removed.
      }
    };
  }, [getMap, gen, ready, addAt]);

  // Draw the shape and its handles whenever it changes.
  useEffect(() => {
    const map = getMap();
    if (!map || !ready || !map.getSource('vtp-measure')) return;
    drawShape(map, state.mode, state.pts, state.closed, sum, units.system);
    handles.current?.update(state.mode, state.pts, state.closed);
  }, [getMap, gen, ready, state, sum, units.system]);

  // The dashed guide to the pointer or crosshair while drawing.
  const guideFrom = drawing && state.pts.length ? (state.mode === 'circle' ? state.pts[0] : state.pts[state.pts.length - 1]) : null;
  const guideOn = guideFrom && guide && !(state.mode === 'circle' && state.pts.length === 2) ? guide : null;
  useEffect(() => {
    const map = getMap();
    if (!map || !ready || !map.getSource('vtp-measure')) return;
    drawGuide(map, guideOn ? guideFrom : null, guideOn);
  }, [getMap, gen, ready, guideFrom, guideOn]);

  // A shared link: the map moves to the shape once it is ready.
  const fitted = useRef(false);
  useEffect(() => {
    const map = getMap();
    if (!map || !ready || fitted.current || !initial) return;
    // The whole circle, not just its radius line, is brought into view.
    const pts = initial.mode === 'circle' && initial.pts.length === 2 ? circleRing(initial.pts[0], distance(initial.pts[0], initial.pts[1]), 24) : initial.pts;
    const xs = pts.map((p) => p[0]),
      ys = pts.map((p) => p[1]);
    // After the readout has set the map's padding (the effect below), so the shape lands in the open part of the map.
    const t = setTimeout(() => {
      fitted.current = true;
      if (pts.length === 1) map.jumpTo({ center: pts[0], zoom: Math.max(map.getZoom(), 17) });
      else
        map.fitBounds(
          [
            [Math.min(...xs), Math.min(...ys)],
            [Math.max(...xs), Math.max(...ys)],
          ],
          { padding: 40, maxZoom: 19, duration: 0 },
        );
    }, 60);
    return () => clearTimeout(t);
  }, [getMap, ready, initial]);

  // Keep the shape clear of the readout: the map's padding follows the sheet (phones) or card (wider screens).
  useEffect(() => {
    const el = panelRef.current;
    const map = getMap();
    if (!el || !map || !ready) return;
    const apply = () => {
      const w = wideQuery();
      setWide(w);
      const r = el.getBoundingClientRect();
      const box = map.getContainer().getBoundingClientRect();
      // The same numbers place the crosshair (console.css .vc-mx) and lift the map's own buttons above the sheet.
      const bottom = w ? 0 : Math.max(0, box.bottom - r.top + 8);
      const right = w ? Math.max(0, box.right - r.left + 8) : 0;
      const wrap = el.closest<HTMLElement>('.vc-map-wrap');
      wrap?.style.setProperty('--vc-measure-h', `${bottom}px`);
      wrap?.style.setProperty('--vc-measure-w', `${right}px`);
      try {
        map.setPadding({ top: 70, bottom, left: 0, right });
      } catch {
        // Map removed.
      }
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    window.addEventListener('resize', apply);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', apply);
      const wrap = el.closest<HTMLElement>('.vc-map-wrap');
      wrap?.style.removeProperty('--vc-measure-h');
      wrap?.style.removeProperty('--vc-measure-w');
    };
  }, [getMap, gen, ready]);

  // Parcel mode: the parcel under the point, from the same county lookup as the parcel card.
  const parcelAt = state.mode === 'parcel' ? state.pts[0] : undefined;
  useEffect(() => {
    if (!parcelAt) return;
    let stale = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- shows Loading at once for the new point
    setParcelState('loading');
    getJson<ParcelResponse>(`/api/map/parcel?lng=${parcelAt[0].toFixed(6)}&lat=${parcelAt[1].toFixed(6)}&v=2`).then(
      (r) => {
        if (stale) return;
        const ring = r.found ? outerRing(r.geometry) : null;
        if (!r.found || !ring) {
          setParcel(null);
          setParcelState('none');
          return;
        }
        const acres = Number(r.properties.ACREAGE);
        setParcel({
          number: r.properties.PARCEL_NO != null ? String(r.properties.PARCEL_NO) : null,
          address: typeof r.properties.SITE_FULL_ADDRESS === 'string' ? r.properties.SITE_FULL_ADDRESS : null,
          recordedAcres: Number.isFinite(acres) && acres > 0 ? acres : null,
          ring,
          area: geometryArea(r.geometry),
        });
        setParcelState('idle');
      },
      () => {
        if (stale) return;
        setParcel(null);
        setParcelState('error');
      },
    );
    return () => {
      stale = true;
    };
  }, [parcelAt]);

  // The elevation profile, while it is open: fetched again a moment after the line changes.
  const profileOn = profile.status !== 'off';
  const sampleKey = state.mode === 'distance' && state.pts.length > 1 ? JSON.stringify(samplePoints(state.pts, state.closed)) : '';
  useEffect(() => {
    if (!profileOn || !sampleKey) return;
    let stale = false;
    const t = setTimeout(() => {
      const samples = JSON.parse(sampleKey) as Pos[];
      setProfile({ status: 'loading' });
      fetchElevations(samples).then(
        (els) => !stale && setProfile({ status: 'done', data: buildProfile(samples, els) }),
        () => !stale && setProfile({ status: 'error' }),
      );
    }, 500);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [profileOn, sampleKey]);

  // Screen readers hear the totals a moment after they settle.
  const lines = useMemo(() => summaryLines(sum, units, parcelForSum), [sum, units, parcelForSum]);
  const headline = lines.slice(0, sum.mode === 'parcel' ? 4 : 2).join('. ');
  useEffect(() => {
    const t = setTimeout(() => setSaid(headline), 700);
    return () => clearTimeout(t);
  }, [headline]);

  const link = () => {
    const u = new URL('/map', window.location.origin);
    const m = encodeShape(state);
    if (m) u.searchParams.set('m', m);
    return u.toString();
  };
  const flash = (t: string) => {
    setNote(t);
    setTimeout(() => setNote(''), 2200);
  };
  const doCopyLink = async () => flash((await copy(link())) ? 'Link copied.' : 'The link could not be copied.');
  const doCopyNumbers = async () => flash((await copy(copyText(sum, units, parcelForSum, link()))) ? 'Numbers copied.' : 'The numbers could not be copied.');
  const doExport = () => {
    const blob = new Blob([JSON.stringify(toGeoJson(state, sum, parcelForSum), null, 2)], { type: 'application/geo+json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `vineyard-${state.mode}-measurement.geojson`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    flash('GeoJSON file saved.');
  };

  const addAtCenter = () => {
    const c = getMap()?.getCenter();
    if (c) addAt([c.lng, c.lat]);
  };

  // Keys: Escape cancels (clears, or closes the tool when nothing is drawn), Enter finishes, Backspace undoes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const s = live.current.state;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (s.pts.length) dispatch({ type: 'clear' });
        else onClose();
      } else if (e.key === 'Enter' && t?.tagName !== 'BUTTON' && t?.tagName !== 'A') {
        if (s.pts.length) {
          e.preventDefault();
          dispatch({ type: 'finish' });
        }
      } else if (e.key === 'Backspace' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z')) {
        e.preventDefault();
        dispatch({ type: 'undo' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const L = (m: number) => fmtLength(m, units.system);
  const areaUnits = areaUnitsFor(units);
  const live1 = guideOn && guideFrom ? { d: distance(guideFrom, guideOn), b: bearing(guideFrom, guideOn) } : null;

  // The big number and the line under it.
  let big = '';
  let sub: string[] = [];
  switch (state.mode) {
    case 'distance':
      big = state.pts.length > 1 ? L(sum.length) : live1 ? L(live1.d) : '';
      if (state.pts.length > 1) sub = [`${sum.segments.length} ${sum.segments.length === 1 ? 'segment' : 'segments'}`, `walk ${fmtDuration(sum.length / WALK_MPS)}`, `bike ${fmtDuration(sum.length / BIKE_MPS)}`];
      break;
    case 'area':
      big = sum.area ? fmtArea(sum.area, units.area) : '';
      if (sum.area) sub = [...areaUnits.slice(1, 3).map((a) => fmtArea(sum.area, a)), `perimeter ${L(sum.length)}`];
      break;
    case 'circle': {
      const r = sum.radius || (live1 && state.pts.length === 1 ? live1.d : 0);
      big = r ? `${L(r)} radius` : '';
      if (r) sub = [`diameter ${L(2 * r)}`, fmtArea(Math.PI * r * r, units.area), `circumference ${L(2 * Math.PI * r)}`];
      break;
    }
    case 'parcel':
      big = parcelState === 'loading' ? 'Loading parcel' : parcel ? fmtArea(parcel.area, 'acres') : '';
      if (parcel && parcelState !== 'loading') sub = [parcel.address, parcel.number ? `parcel ${parcel.number}` : null].filter((x): x is string => Boolean(x));
      break;
  }
  const addLabel = state.mode === 'circle' ? (state.pts.length ? 'Set edge' : 'Set center') : state.mode === 'parcel' ? 'Measure parcel' : 'Add point';
  const canFinish = drawing && state.pts.length > (state.mode === 'area' ? 2 : 1) && state.mode !== 'circle';
  const hasShape = state.pts.length > 0 && (state.mode !== 'parcel' || Boolean(parcel));

  return (
    <>
      {drawing && coarse && <div className="vc-mx" aria-hidden="true" />}
      <section ref={panelRef} className="vc-measure" data-wide={wide || undefined} data-open={open || undefined} aria-label="Measure">
        <div className="vc-measure-head">
          <div className="vc-measure-modes" role="radiogroup" aria-label="What to measure">
            {MODES.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={state.mode === id}
                data-on={state.mode === id}
                onClick={() => (dispatch({ type: 'mode', mode: id }), setParcel(null), setParcelState('idle'), setProfile({ status: 'off' }))}
              >
                <Icon size={16} strokeWidth={1.9} aria-hidden="true" />
                <span>{label}</span>
              </button>
            ))}
          </div>
          <button type="button" className="vc-measure-icon" onClick={onClose} aria-label="Close measure" title="Close">
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        <div className="vc-measure-read">
          <div className="vc-measure-nums">
            {big ? <p className="vc-measure-big">{big}</p> : <p className="vc-measure-hint">{hint(state.mode, coarse, state.pts.length, state.done)}</p>}
            {sub.length > 0 && <p className="vc-measure-sub">{sub.join(' · ')}</p>}
            {state.mode === 'distance' && live1 && live1.d >= 0.3 && state.pts.length > 0 && drawing && (
              <p className="vc-measure-sub">
                Next: {L(live1.d)}, {fmtBearing(live1.b)}
              </p>
            )}
            {state.mode === 'parcel' && parcelState === 'none' && <p className="vc-measure-sub">No parcel there. Try a spot inside a parcel line.</p>}
            {state.mode === 'parcel' && parcelState === 'error' && <p className="vc-measure-sub">The parcel could not be loaded right now. Try again shortly.</p>}
          </div>
          <button
            type="button"
            className="vc-measure-units"
            onClick={() => setUnits({ system: units.system === 'imperial' ? 'metric' : 'imperial', area: units.system === 'imperial' ? 'ha' : 'acres' })}
            aria-label={units.system === 'imperial' ? 'Units: feet and miles. Switch to meters and kilometers' : 'Units: meters and kilometers. Switch to feet and miles'}
          >
            {units.system === 'imperial' ? 'ft, mi' : 'm, km'}
          </button>
        </div>

        <div className="vc-measure-acts">
          {(drawing || state.mode === 'parcel') && coarse && (
            <button type="button" className="vc-measure-add" onClick={addAtCenter}>
              <Plus size={17} strokeWidth={2.2} aria-hidden="true" /> {addLabel}
            </button>
          )}
          <button type="button" className="vc-measure-icon" onClick={() => dispatch({ type: 'undo' })} disabled={!state.past.length} aria-label="Undo" title="Undo (Backspace)">
            <Undo2 size={18} strokeWidth={1.9} />
          </button>
          <button type="button" className="vc-measure-icon" onClick={() => (dispatch({ type: 'clear' }), setParcel(null))} disabled={!state.pts.length} aria-label="Clear" title="Clear (Escape)">
            <Trash2 size={18} strokeWidth={1.9} />
          </button>
          {state.mode === 'distance' && state.pts.length > 2 && (
            <button
              type="button"
              className="vc-measure-icon"
              onClick={() => dispatch({ type: 'close' })}
              aria-pressed={state.closed}
              aria-label={state.closed ? 'Open the loop' : 'Close the shape into a loop'}
              title={state.closed ? 'Open the loop' : 'Close the loop'}
            >
              <Repeat size={18} strokeWidth={1.9} />
            </button>
          )}
          {canFinish && (
            <button type="button" className="vc-measure-icon" onClick={() => dispatch({ type: 'finish' })} aria-label="Finish" title="Finish (Enter)">
              <Check size={18} strokeWidth={2.2} />
            </button>
          )}
          <span className="vc-measure-gap" />
          <div className="vc-measure-share">
            <button type="button" className="vc-measure-icon" onClick={() => setShare((v) => !v)} aria-expanded={share} disabled={!hasShape} aria-label="Share and save" title="Share and save">
              <Share2 size={18} strokeWidth={1.9} />
            </button>
            {share && hasShape && (
              <div className="vc-measure-menu" role="menu">
                <button type="button" role="menuitem" onClick={() => (setShare(false), void doCopyLink())}>
                  <LinkIcon size={16} aria-hidden="true" /> Copy link
                </button>
                <button type="button" role="menuitem" onClick={() => (setShare(false), void doCopyNumbers())}>
                  <Copy size={16} aria-hidden="true" /> Copy the numbers
                </button>
                <button type="button" role="menuitem" onClick={() => (setShare(false), doExport())}>
                  <Download size={16} aria-hidden="true" /> Export GeoJSON
                </button>
              </div>
            )}
          </div>
          <button type="button" className="vc-measure-icon vc-measure-more" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={open ? 'Fewer details' : 'More details'} title="Details">
            <ChevronDown size={18} strokeWidth={1.9} />
          </button>
        </div>

        {open && (
          <div className="vc-measure-details">
            {(state.mode === 'area' || state.mode === 'circle') && (
              <label className="vc-measure-field">
                <span>Area in</span>
                <select value={units.area} onChange={(e) => setUnits({ ...units, area: e.target.value as AreaUnit })}>
                  {(['acres', 'sqft', 'sqmi', 'ha'] as AreaUnit[]).map((a) => (
                    <option key={a} value={a}>
                      {AREA_LABEL[a]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {state.mode === 'parcel' && parcel && (
              <dl className="vc-measure-dl">
                <div>
                  <dt>From the map shape</dt>
                  <dd>{fmtArea(parcel.area, 'acres')}</dd>
                </div>
                {parcel.recordedAcres != null && (
                  <>
                    <div>
                      <dt>County recorded acreage</dt>
                      <dd>{fmtArea(parcel.recordedAcres * 4046.8564224, 'acres')}</dd>
                    </div>
                    <div>
                      <dt>Difference</dt>
                      <dd>{lines.find((l) => l.startsWith('Difference'))?.replace('Difference: ', '')}</dd>
                    </div>
                  </>
                )}
                <div>
                  <dt>Perimeter</dt>
                  <dd>{L(sum.length)}</dd>
                </div>
                <div>
                  <dt>Square feet</dt>
                  <dd>{fmtArea(parcel.area, 'sqft')}</dd>
                </div>
              </dl>
            )}
            {(state.mode === 'area' || state.mode === 'circle') && sum.area > 0 && (
              <dl className="vc-measure-dl">
                {areaUnits.map((a) => (
                  <div key={a}>
                    <dt>{AREA_LABEL[a]}</dt>
                    <dd>{fmtArea(sum.area, a)}</dd>
                  </div>
                ))}
              </dl>
            )}
            {(state.mode === 'distance' || state.mode === 'area') && sum.segments.length > 0 && (
              <ol className="vc-measure-segs" aria-label="Segments">
                {sum.segments.map((s, i) => (
                  <li key={i}>
                    <span>{i + 1}</span>
                    <b>{L(s.meters)}</b>
                    <span>{fmtBearing(s.bearing)}</span>
                  </li>
                ))}
              </ol>
            )}
            {state.mode === 'distance' && state.pts.length > 1 && (
              <div className="vc-measure-elev">
                {profile.status === 'off' ? (
                  <button type="button" className="vc-measure-pill" onClick={() => setProfile({ status: 'loading' })}>
                    <Mountain size={16} aria-hidden="true" /> Elevation profile
                  </button>
                ) : profile.status === 'error' ? (
                  <p className="vc-measure-sub">Elevation could not be loaded right now. Try again shortly.</p>
                ) : profile.status === 'loading' || !profile.data ? (
                  <p className="vc-measure-sub">{profile.status === 'loading' ? 'Loading elevation.' : 'No elevation data along this line.'}</p>
                ) : (
                  <ElevationChart p={profile.data} units={units} />
                )}
              </div>
            )}
          </div>
        )}

        <p className="vc-measure-note">{note || ACCURACY}</p>
        <div className="vc-sr" role="status" aria-live="polite">
          {said}
        </div>
      </section>
    </>
  );
}

function ElevationChart({ p, units }: { p: Profile; units: Units }) {
  const W = 300,
    H = 72,
    pad = 4;
  const lo = p.low.elevation,
    hi = p.high.elevation;
  const span = Math.max(hi - lo, 3);
  const x = (at: number) => pad + (p.length ? (at / p.length) * (W - 2 * pad) : 0);
  const y = (e: number) => H - pad - ((e - lo) / span) * (H - 2 * pad);
  const line = p.points.map((q, i) => `${i ? 'L' : 'M'}${x(q.at).toFixed(1)},${y(q.elevation).toFixed(1)}`).join('');
  const area = `${line}L${x(p.points[p.points.length - 1].at).toFixed(1)},${H - pad}L${x(p.points[0].at).toFixed(1)},${H - pad}Z`;
  const Hgt = (m: number) => fmtHeight(m, units.system);
  const where = (at: number) => (at < 1 ? 'at the start' : at > p.length - 1 ? 'at the end' : `at ${fmtLength(at, units.system)}`);
  const label = `Elevation profile: gain ${Hgt(p.gain)}, loss ${Hgt(p.loss)}, low ${Hgt(lo)}, high ${Hgt(hi)}.`;
  return (
    <figure className="vc-measure-chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
        <path d={area} className="vc-measure-chart-fill" />
        <path d={line} className="vc-measure-chart-line" vectorEffect="non-scaling-stroke" />
        <circle cx={x(p.low.at)} cy={y(lo)} r="3" className="vc-measure-chart-dot" />
        <circle cx={x(p.high.at)} cy={y(hi)} r="3" className="vc-measure-chart-dot" />
      </svg>
      <figcaption>
        <span>Gain {Hgt(p.gain)}</span>
        <span>Loss {Hgt(p.loss)}</span>
        <span>
          Low {Hgt(lo)} {where(p.low.at)}
        </span>
        <span>
          High {Hgt(hi)} {where(p.high.at)}
        </span>
        <small>USGS 3D Elevation Program</small>
      </figcaption>
    </figure>
  );
}
