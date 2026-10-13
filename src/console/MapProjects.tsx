/**
 * Construction and projects, shown only while the map's projects layer is on (/construction opens it):
 * a side panel next to the map from 1024 px, a bottom sheet over the map on smaller screens (a peek with
 * the title and counts, dragged or tapped open to most of the screen). Two tabs: every funded capital
 * project, one card each (name, what it is, the FY 2027 amount, its stage, and Details for the votes and
 * records), then the city's current construction table as one card per row. Tapping a card frames the
 * project on the map; a project tapped on the map scrolls to its card. One edge-cached call:
 * GET /api/pages/construction (the city's Capital Improvement Plan map layer and its Construction
 * Projects page as last stored). A project with an update from Vineyard City staff (GET /api/updates,
 * read fresh) shows the newest one on its card.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { Link } from 'react-router-dom';
import type { FeatureCollection, Geometry } from 'geojson';
import { ArrowUpRight, ChevronDown, ChevronUp, MapPin, X } from 'lucide-react';
import { useJson } from './api';
import { DocLink } from './DocLink';
import type { StaffUpdate } from './RecordsHome';
import { ProjectDetail } from './ProjectDetail';
import { CITY_PAGE, alsoFunded, asProjectsContent, millions, money, plansFrom, type Plan, type PlanProps } from './construction';
import { formatDate, normalizeDatesInText } from '@/lib/dates';

type FC = FeatureCollection<Geometry, PlanProps>;

/** The city's Construction Projects page as last stored by the portal's five-minute check (GET /api/construction). */
interface ConstructionSnapshot {
  available: boolean;
  sourceUrl: string;
  asOf?: string;
  glance?: { heading: string | null; headers: string[]; rows: Array<Record<string, string>> } | null;
}
interface PageData {
  construction: ConstructionSnapshot | null;
  projects: FC | null;
}

/** The FY 2026-2027 Capital Projects Reference Guide, as archived. */
const REFERENCE_GUIDE = 'doc_4a2030ca2de99f44';

/** Height of the sheet's handle and title row: what shows over the map when the sheet is folded (also in console.css). */
const PEEK = 76;

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function ProjectCard({ p, onShow, update, active }: { p: Plan; onShow: (gis: string) => void; update?: StaffUpdate; active: boolean }) {
  const [open, setOpen] = useState(false);
  // A tap anywhere on the card (not on its buttons, links or details) frames the project on the map.
  const tap = (e: MouseEvent<HTMLLIElement>) => {
    if (!p.bounds || (e.target as HTMLElement).closest('a, button, .vc-pd')) return;
    onShow(p.gis);
  };
  return (
    <li className="vc-mp-card" data-gis={p.gis} data-open={open || undefined} data-active={active || undefined} data-tap={Boolean(p.bounds) || undefined} onClick={tap}>
      <div className="vc-mp-top">
        <h4 className="vc-mp-name">{p.name}</h4>
        {p.budget != null && <span className="vc-mp-amt">{money(p.budget)}</span>}
      </div>
      <p className="vc-mp-what">{p.about ?? p.category}</p>
      {update && (
        <Link to={`/documents/${encodeURIComponent(update.id)}`} className="vc-mp-upd">
          <b>Latest update{update.date ? `, ${formatDate(update.date)}` : ''}:</b> {update.title}
        </Link>
      )}
      <div className="vc-mp-foot">
        <span className="vc-schip">{p.stage}</span>
        <span className="vc-mp-acts">
          {p.bounds && (
            <button type="button" className="vc-mp-pin" onClick={() => onShow(p.gis)} aria-label={`Show ${p.name} on the map`} aria-pressed={active} title="Show on the map">
              <MapPin size={17} strokeWidth={1.8} />
            </button>
          )}
          <button type="button" className="vc-mp-more" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            Details <ChevronDown size={15} strokeWidth={1.9} />
          </button>
        </span>
      </div>
      {open && <ProjectDetail project={{ gis: p.gis }} budget="source" />}
    </li>
  );
}

/** The city's "at a glance" table, one card per row: the project, where, what, its status and when. */
function CityWork({ s }: { s: ConstructionSnapshot }) {
  const g = s.glance;
  if (!s.available || !g || !g.rows.length) return null;
  const find = (re: RegExp) => g.headers.find((h) => re.test(h.trim()));
  const title = find(/^project/i) ?? g.headers[0];
  const where = find(/location|where/i);
  const what = find(/work|description/i);
  const status = find(/^status/i);
  const done = find(/completion|expected|finish/i);
  const used = new Set([title, where, what, status, done]);
  const rest = g.headers.filter((h) => !used.has(h) && !/^type$/i.test(h.trim()));
  // "AT A GLANCE: UPDATED 10/5/2026" gives the city's own date; else the day the portal read the page.
  const updated = g.heading?.match(/updated\s+(.+)$/i)?.[1];
  const asOf = updated ? normalizeDatesInText(updated) : s.asOf ? formatDate(s.asOf) : null;
  return (
    <section className="vc-mp-sec" aria-labelledby="vc-work-h">
      <div className="vc-mp-head">
        <h3 id="vc-work-h" className="vc-mp-h">
          Construction now
        </h3>
        <a className="vc-mp-link" href={s.sourceUrl || CITY_PAGE} target="_blank" rel="noopener noreferrer">
          City page <ArrowUpRight size={14} strokeWidth={2} />
        </a>
      </div>
      {asOf && <p className="vc-mp-count">City update, {asOf}</p>}
      <ul className="vc-mp-list">
        {g.rows.map((r, i) => (
          <li key={i} className="vc-mp-card">
            <h4 className="vc-mp-name">{normalizeDatesInText(r[title] || '')}</h4>
            {where && r[where] && <p className="vc-mp-where">{r[where]}</p>}
            {what && r[what] && (
              <p className="vc-mp-what" data-full="true">
                {normalizeDatesInText(r[what])}
              </p>
            )}
            {rest.map((h) => (r[h] ? <p key={h} className="vc-mp-what" data-full="true">{`${h}: ${normalizeDatesInText(r[h])}`}</p> : null))}
            {(status && r[status]) || (done && r[done]) ? (
              <dl className="vc-mp-facts">
                {status && r[status] && (
                  <div>
                    <dt>Status</dt>
                    <dd>{normalizeDatesInText(r[status])}</dd>
                  </div>
                )}
                {done && r[done] && (
                  <div>
                    <dt>Expected</dt>
                    <dd>{normalizeDatesInText(r[done])}</dd>
                  </div>
                )}
              </dl>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

type Tab = 'funded' | 'now';

interface Props {
  /** Frame a project on the map (and mark its card). */
  onShow: (gis: string) => void;
  /** Close: turns the projects layer off. */
  onClose: () => void;
  /** The project framed or tapped on the map, by its GIS name. */
  active: string | null;
  /** True from 1024 px: a side panel; otherwise a bottom sheet over the map. */
  wide: boolean;
  /** The layer was just turned off: slide away. */
  leaving: boolean;
  /** Open the sheet tall at first (arriving from /construction). */
  startExpanded: boolean;
}

export function MapProjects({ onShow, onClose, active, wide, leaving, startExpanded }: Props) {
  const load = useJson<PageData>('/api/pages/construction');
  const own = useJson<FC>(load.status === 'error' || (load.status === 'done' && !load.data.projects) ? '/api/map/layers/projects?page=0&v=5' : null);
  const fc = load.status === 'done' && load.data.projects ? load.data.projects : own.status === 'done' ? own.data : null;
  // Wording staff saved in the staff portal; the built-in wording is used until it arrives and if it never does.
  const site = useJson<{ content?: { projects?: unknown } }>('/api/content');
  const edited = useMemo(() => (site.status === 'done' ? asProjectsContent(site.data?.content?.projects) : null), [site]);
  // Wait briefly for it so the list does not change under the reader, but never hold the list back if it is slow.
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setWaited(true), 1500);
    return () => clearTimeout(t);
  }, []);
  const plans = useMemo(() => (fc ? plansFrom(fc, edited) : []), [fc, edited]);
  const also = useMemo(() => alsoFunded(edited), [edited]);
  const total = useMemo(() => plans.reduce((s, p) => s + (p.budget ?? 0), 0), [plans]);
  const snapshot = load.status === 'done' ? load.data.construction : null;
  const workRows = snapshot?.available && snapshot.glance?.rows.length ? snapshot.glance.rows.length : 0;
  // The newest staff update for each project on the map (the list comes newest first).
  const upd = useJson<{ items: StaffUpdate[] }>('/api/updates?limit=100');
  const latest = useMemo(() => {
    const m = new Map<string, StaffUpdate>();
    for (const u of upd.status === 'done' ? upd.data.items : []) if (u.projectGis && !m.has(u.projectGis)) m.set(u.projectGis, u);
    return m;
  }, [upd]);
  const ready = plans.length > 0 && (site.status !== 'loading' || waited);
  const failed = load.status === 'error' && own.status === 'error';

  const [tab, setTab] = useState<Tab>('funded');
  const [expanded, setExpanded] = useState(startExpanded);
  const sheet = !wide;
  const folded = sheet && !expanded;
  const rootRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // A project tapped on the map (or framed from its card): its tab, and its card scrolled into view.
  const [prevActive, setPrevActive] = useState(active);
  if (prevActive !== active) {
    setPrevActive(active);
    if (active && tab !== 'funded') setTab('funded');
  }
  useEffect(() => {
    const body = bodyRef.current;
    if (!active || !body || !ready) return;
    const card = [...body.querySelectorAll<HTMLElement>('.vc-mp-card[data-gis]')].find((el) => el.dataset.gis === active);
    if (!card) return;
    // Positions inside the scroller, kept clear of the sticky tabs at its top.
    const tabs = body.querySelector<HTMLElement>('.vc-mp-tabs')?.offsetHeight ?? 0;
    const top = card.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
    const visible = top - tabs >= body.scrollTop && top + card.offsetHeight <= body.scrollTop + body.clientHeight;
    if (!visible) body.scrollTo({ top: Math.max(0, top - tabs - 12), behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, [active, ready, tab]);

  // Escape: closes the side panel; folds the sheet when it is open.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.fullscreenElement || document.querySelector('.vtp-fs')) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, select, [role="dialog"]')) return;
      if (wide) onClose();
      else if (expanded) setExpanded(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [wide, expanded, onClose]);

  // Dragging the sheet by its handle and title row: it follows the finger, then settles open or folded.
  const drag = useRef<{ id: number; y0: number; t0: number; base: number; max: number; y: number; moved: boolean } | null>(null);
  const dragged = useRef(false);
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    dragged.current = false;
    const el = rootRef.current;
    if (!sheet || !el || (e.target as HTMLElement).closest('button, a')) return;
    const safe = parseFloat(getComputedStyle(el).paddingBottom) || 0;
    const max = Math.max(0, el.offsetHeight - PEEK - safe);
    const base = expanded ? 0 : max;
    drag.current = { id: e.pointerId, y0: e.clientY, t0: performance.now(), base, max, y: base, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = rootRef.current;
    if (!d || d.id !== e.pointerId || !el) return;
    const dy = e.clientY - d.y0;
    if (!d.moved && Math.abs(dy) < 6) return;
    d.moved = true;
    d.y = Math.min(d.max, Math.max(0, d.base + dy));
    el.style.transition = 'none';
    el.style.transform = `translateY(${d.y}px)`;
  };
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = rootRef.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (el) {
      el.style.transition = '';
      el.style.transform = '';
    }
    // A plain tap is left to the click that follows (toggled there, so the click cannot land on what the sheet uncovers).
    if (!d.moved) return;
    dragged.current = true;
    const v = (e.clientY - d.y0) / Math.max(1, performance.now() - d.t0);
    setExpanded(v < -0.35 ? true : v > 0.35 ? false : d.y < d.max / 2);
  };

  const onBarClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!sheet || dragged.current || (e.target as HTMLElement).closest('button, a')) return;
    setExpanded((x) => !x);
  };
  // A new tab starts at its top.
  const pick = (t: Tab) => {
    setTab(t);
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  };

  // A card tapped in the open sheet: fold it so the framed project shows on the map.
  const show = (gis: string) => {
    if (sheet) setExpanded(false);
    onShow(gis);
  };

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const next: Tab = tab === 'funded' ? 'now' : 'funded';
    pick(next);
    e.currentTarget.querySelector<HTMLElement>(`[data-tab="${next}"]`)?.focus();
  };

  if (failed) return null;
  const framed = active ? plans.find((p) => p.gis === active) : undefined;
  const summary = ready ? [`${plans.length} funded`, workRows ? `${workRows} in construction` : null].filter(Boolean).join(' · ') : ' ';

  return (
    <aside
      ref={rootRef}
      id="projects"
      className="vc-mp"
      data-kind={wide ? 'side' : 'sheet'}
      data-expanded={sheet ? expanded : undefined}
      data-leaving={leaving || undefined}
      data-no-ptr=""
      aria-labelledby="vc-mp-title"
    >
      <div className="vc-mp-bar" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onClick={onBarClick}>
        {sheet && <span className="vc-mp-grip" aria-hidden="true" />}
        <div className="vc-mp-bar-row">
          <div className="vc-mp-bar-text">
            <h2 id="vc-mp-title" className="vc-mp-title">
              Construction and projects
            </h2>
            {/* Folded over the map with a project framed: its name, so the highlighted shape is named. */}
            {folded && framed ? (
              <p className="vc-mp-sum" data-framed="true">
                <MapPin size={13} strokeWidth={2} aria-hidden="true" /> {framed.name}
              </p>
            ) : (
              <p className="vc-mp-sum">{summary}</p>
            )}
          </div>
          {sheet && (
            <button
              type="button"
              className="vc-mp-icon"
              onClick={() => setExpanded((x) => !x)}
              aria-expanded={expanded}
              aria-controls="vc-mp-body"
              aria-label={expanded ? 'Show the map' : 'Show the list'}
            >
              {expanded ? <ChevronDown size={20} strokeWidth={2} /> : <ChevronUp size={20} strokeWidth={2} />}
            </button>
          )}
          <button type="button" className="vc-mp-icon" onClick={onClose} aria-label="Close construction and projects" title="Close">
            <X size={19} strokeWidth={2} />
          </button>
        </div>
      </div>

      <div className="vc-mp-body" id="vc-mp-body" ref={bodyRef} inert={folded || leaving}>
        {workRows > 0 && (
          <div className="vc-mp-tabs" role="tablist" aria-label="Lists" onKeyDown={onTabKey}>
            <button
              type="button"
              role="tab"
              id="vc-mp-tab-funded"
              data-tab="funded"
              aria-selected={tab === 'funded'}
              aria-controls="vc-mp-pane"
              tabIndex={tab === 'funded' ? 0 : -1}
              onClick={() => pick('funded')}
            >
              Funded <span className="vc-mp-n">{plans.length || ''}</span>
            </button>
            <button type="button" role="tab" id="vc-mp-tab-now" data-tab="now" aria-selected={tab === 'now'} aria-controls="vc-mp-pane" tabIndex={tab === 'now' ? 0 : -1} onClick={() => pick('now')}>
              Construction now <span className="vc-mp-n">{workRows}</span>
            </button>
          </div>
        )}
        <div className="vc-mp-pane" id="vc-mp-pane" role={workRows > 0 ? 'tabpanel' : undefined} aria-labelledby={workRows > 0 ? `vc-mp-tab-${tab}` : undefined}>
          {tab === 'now' && snapshot ? (
            <CityWork s={snapshot} />
          ) : (
            <section className="vc-mp-sec" aria-labelledby="vc-proj-h">
              <div className="vc-mp-head">
                <h3 id="vc-proj-h" className="vc-mp-h">
                  Funded projects
                </h3>
                <Link to="/budget?view=projects" className="vc-mp-link">
                  Budget lines
                </Link>
              </div>
              {!ready ? (
                <div className="vc-skeleton" aria-hidden="true">
                  <span style={{ width: '60%' }} />
                  <span style={{ width: '92%' }} />
                  <span style={{ width: '84%' }} />
                </div>
              ) : (
                <>
                  <p className="vc-mp-count">
                    {plans.length} projects · {millions(total)} in the FY 2027 budget
                  </p>
                  <ul className="vc-mp-list">
                    {plans.map((p) => (
                      <ProjectCard key={p.key} p={p} onShow={show} update={latest.get(p.gis)} active={active === p.gis} />
                    ))}
                  </ul>
                  {also.length > 0 && (
                    <>
                      <h4 className="vc-mp-sub">Also funded, not on the map</h4>
                      <ul className="vc-mp-also">
                        {also.map((a) => (
                          <li key={a.id}>
                            <span className="vc-mp-also-name">{a.name}</span>
                            {a.about && (
                              <span className="vc-mp-what" data-full="true">
                                {a.about}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  <p className="vc-mp-src">
                    <DocLink id={REFERENCE_GUIDE} className="vc-mp-link">
                      Capital Projects Reference Guide
                    </DocLink>
                  </p>
                </>
              )}
            </section>
          )}
        </div>
      </div>
    </aside>
  );
}
