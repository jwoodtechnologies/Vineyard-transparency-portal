/**
 * /construction : what is being built in Vineyard, where, and when.
 * Recent city construction notices as dated timelines, a map of the work, and every project in the
 * adopted fiscal 2027 budget with its stage and schedule.
 */
import '@fontsource-variable/inter';
import '@fontsource-variable/source-serif-4';
import './console.css';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { FeatureCollection, Geometry } from 'geojson';
import { ArrowUpRight, ChevronDown, FileText, Mail, MapPin, Phone } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';
import { Frame } from './Chrome';
import { DocLink } from './DocLink';
import { useJson } from './api';
import type { MapFocus } from './ConstructionMap';
import {
  ACTIVE,
  ALSO_FUNDED,
  CATEGORIES,
  CITY_PAGE,
  STAGES,
  millions,
  money,
  plansFrom,
  shortDate,
  telHref,
  type ActiveProject,
  type Category,
  type Plan,
  type PlanProps,
} from './construction';

const ConstructionMap = lazy(() => import('./ConstructionMap'));

type FC = FeatureCollection<Geometry, PlanProps>;

type Picked = { kind: 'active'; id: string } | { kind: 'plan'; key: string };

/** Four small bars: every stage up to the current one is filled. */
function StageBars({ stage }: { stage: Plan['stage'] }) {
  const at = STAGES.indexOf(stage);
  return (
    <span className="vc-cp-bars" aria-hidden="true">
      {STAGES.map((s, i) => (
        <i key={s} data-on={i <= at} data-now={i === at} />
      ))}
    </span>
  );
}

function YearStrip({ plan, years }: { plan: Plan; years: number[] }) {
  if (plan.start == null || plan.finish == null) return null;
  const lo = plan.start;
  const hi = plan.finish;
  return (
    <div className="vc-cp-years" role="img" aria-label={`On the city's list for ${lo === hi ? lo : `${lo} to ${hi}`}`}>
      {years.map((y) => (
        <span key={y} data-on={y >= lo && y <= hi}>
          {y}
        </span>
      ))}
    </div>
  );
}

function ActiveCard({ p, onShow, picked }: { p: ActiveProject; onShow: (p: ActiveProject) => void; picked: boolean }) {
  const [more, setMore] = useState(false);
  const shown = more ? p.updates : p.updates.slice(0, 2);
  return (
    <article id={`cp-${p.id}`} className="vc-cp-card" data-picked={picked || undefined}>
      <header className="vc-cp-card-head">
        <span className="vc-cp-n" aria-hidden="true">
          {p.n}
        </span>
        <div>
          <h3>{p.title}</h3>
          <p className="vc-cp-where">{p.where}</p>
        </div>
      </header>
      {p.asOf && <p className="vc-cp-asof">Latest city update: {shortDate(p.asOf)}</p>}
      <p className="vc-cp-sum">{p.summary}</p>
      <dl className="vc-cp-facts">
        {p.facts.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>

      <h4 className="vc-cp-h">Timeline</h4>
      <ol className="vc-cp-line">
        {shown.map((u) => (
          <li key={`${u.date}:${u.title}`}>
            <span className="vc-cp-when">{u.when ? `${u.when}, 2026` : shortDate(u.date)}</span>
            <strong>{u.title}</strong>
            <p>{u.text}</p>
          </li>
        ))}
      </ol>
      {p.updates.length > 2 && (
        <button type="button" className="vc-cp-more" onClick={() => setMore((v) => !v)} aria-expanded={more}>
          {more ? 'Show fewer' : `Show ${p.updates.length - 2} earlier`}
          <ChevronDown size={14} strokeWidth={2} data-up={more || undefined} />
        </button>
      )}

      <h4 className="vc-cp-h">What to expect</h4>
      <ul className="vc-cp-expect">
        {p.expect.map((e) => (
          <li key={e}>{e}</li>
        ))}
      </ul>

      <p className="vc-cp-contact">Questions? {p.contact.label}</p>
      <div className="vc-cp-actions">
        <button type="button" className="vc-primary" onClick={() => onShow(p)}>
          <MapPin size={15} strokeWidth={1.9} /> Show on map
        </button>
        {p.contact.phone && (
          <a className="vc-secondary" href={telHref(p.contact.phone)}>
            <Phone size={15} strokeWidth={1.9} /> {p.contact.phone}
          </a>
        )}
        {p.contact.email && (
          <a className="vc-secondary" href={`mailto:${p.contact.email}`}>
            <Mail size={15} strokeWidth={1.9} /> Email
          </a>
        )}
      </div>

      <details className="vc-cp-docs">
        <summary>
          <FileText size={15} strokeWidth={1.8} /> City documents <span>{p.docs.length}</span>
          <ChevronDown size={15} strokeWidth={1.9} className="vc-cp-docs-chev" />
        </summary>
        <ul>
          {p.docs.map((d) => (
            <li key={d.label}>
              {d.id ? (
                <DocLink id={d.id}>{d.label}</DocLink>
              ) : (
                <a href={d.href} target="_blank" rel="noopener noreferrer">
                  {d.label} <ArrowUpRight size={13} strokeWidth={1.9} />
                </a>
              )}
            </li>
          ))}
        </ul>
      </details>
    </article>
  );
}

function PlanRow({ p, years, open, onToggle, onShow }: { p: Plan; years: number[]; open: boolean; onToggle: () => void; onShow: (p: Plan) => void }) {
  return (
    <li id={`plan-${p.key.replace(/\W+/g, '-')}`} className="vc-cp-row" data-open={open || undefined}>
      <button type="button" className="vc-cp-row-head" onClick={onToggle} aria-expanded={open}>
        <span className="vc-cp-row-main">
          <span className="vc-cp-row-name">{p.name}</span>
          <span className="vc-cp-row-sub">
            <StageBars stage={p.stage} />
            {p.stage}
            {p.pct != null && p.pct > 0 ? `, ${Math.round(p.pct)}% done` : ''}
          </span>
        </span>
        <ChevronDown size={16} strokeWidth={1.9} className="vc-cp-row-chev" />
      </button>
      {open && (
        <div className="vc-cp-row-body">
          {p.about && <p className="vc-cp-row-about">{p.about}</p>}
          <dl className="vc-cp-facts">
            <div>
              <dt>Stage</dt>
              <dd>
                {p.stage}
                {p.pct != null ? `, ${Math.round(p.pct)}% of this stage` : ''}
              </dd>
            </div>
            {p.start != null && p.finish != null && (
              <div>
                <dt>On the city&apos;s list for</dt>
                <dd>
                  {p.start === p.finish ? p.start : `${p.start} to ${p.finish}`}
                  <YearStrip plan={p} years={years} />
                </dd>
              </div>
            )}
            {p.budget != null && (
              <div>
                <dt>Fiscal 2027 budget</dt>
                <dd>
                  {money(p.budget)}
                  {p.source ? `, ${p.source}` : ''}
                </dd>
              </div>
            )}
            {p.location && p.location.toLowerCase() !== p.gis.toLowerCase() && (
              <div>
                <dt>Where</dt>
                <dd>{p.location}</dd>
              </div>
            )}
            {p.department && (
              <div>
                <dt>Department</dt>
                <dd>{p.department}</dd>
              </div>
            )}
            {p.consultant && (
              <div>
                <dt>Consultant</dt>
                <dd>{p.consultant}</dd>
              </div>
            )}
          </dl>
          {p.bounds && (
            <button type="button" className="vc-secondary vc-cp-row-map" onClick={() => onShow(p)}>
              <MapPin size={15} strokeWidth={1.9} /> Show on map
            </button>
          )}
        </div>
      )}
    </li>
  );
}

export default function ConstructionPage() {
  const { resolved } = useTheme();
  const load = useJson<FC>('/api/map/layers/projects?page=0&v=5');
  const plans = useMemo(() => (load.status === 'done' ? plansFrom(load.data) : []), [load]);
  const [category, setCategory] = useState<Category | 'All'>('All');
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const nonce = useRef(0);
  const mapBox = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = 'Construction projects | Vineyard Transparency Portal';
  }, []);

  const years = useMemo(() => {
    const lo = Math.min(...plans.map((p) => p.start ?? 9999));
    const hi = Math.max(...plans.map((p) => p.finish ?? 0));
    return Number.isFinite(lo) && lo < 9999 && hi > 0 ? Array.from({ length: hi - lo + 1 }, (_, i) => lo + i) : [];
  }, [plans]);

  const counts = useMemo(() => {
    const c = new Map<Category, number>();
    for (const p of plans) c.set(p.category, (c.get(p.category) ?? 0) + 1);
    return c;
  }, [plans]);
  const shown = category === 'All' ? plans : plans.filter((p) => p.category === category);
  const total = useMemo(() => plans.reduce((s, p) => s + (p.budget ?? 0), 0), [plans]);

  const toMap = useCallback((bounds: [[number, number], [number, number]]) => {
    nonce.current += 1;
    setFocus({ bounds, nonce: nonce.current });
    mapBox.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const showActive = useCallback(
    (p: ActiveProject) => {
      const lons = p.sites.map((s) => s.lon);
      const lats = p.sites.map((s) => s.lat);
      toMap([
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
      ]);
      setPicked({ kind: 'active', id: p.id });
    },
    [toMap],
  );

  const showPlan = useCallback(
    (p: Plan) => {
      if (p.bounds) toMap(p.bounds);
      setPicked({ kind: 'plan', key: p.key });
    },
    [toMap],
  );

  const onMapPlan = useCallback(
    (gis: string) => {
      const p = plans.find((x) => x.gis === gis);
      if (p) setPicked({ kind: 'plan', key: p.key });
    },
    [plans],
  );
  const onMapActive = useCallback((id: string) => setPicked({ kind: 'active', id }), []);

  const goDetails = () => {
    if (!picked) return;
    if (picked.kind === 'active') {
      document.getElementById(`cp-${picked.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const p = plans.find((x) => x.key === picked.key);
    if (!p) return;
    setCategory('All');
    setOpenKey(p.key);
    requestAnimationFrame(() => document.getElementById(`plan-${p.key.replace(/\W+/g, '-')}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const pickedActive = picked?.kind === 'active' ? ACTIVE.find((a) => a.id === picked.id) : null;
  const pickedPlan = picked?.kind === 'plan' ? plans.find((p) => p.key === picked.key) : null;
  const latest = ACTIVE.map((a) => a.asOf).filter(Boolean).sort().at(-1);

  return (
    <Frame>
      <header className="vc-page-head">
        <h1 className="vc-page-title">Construction projects</h1>
        <p className="vc-page-sub">From the city&apos;s construction notices and project list.</p>
      </header>

      <section className="vc-cp-mapsec" ref={mapBox} aria-label="Map">
        <div className="vc-cp-map">
          <Suspense fallback={<div className="vc-cp-map-wait" />}>
            <ConstructionMap
              key={resolved}
              plans={load.status === 'done' ? load.data : null}
              active={ACTIVE}
              dark={resolved === 'dark'}
              focus={focus}
              selected={pickedPlan?.gis ?? null}
              onPlan={onMapPlan}
              onActive={onMapActive}
            />
          </Suspense>
        </div>
        <div className="vc-cp-legend">
          <span className="vc-cp-key">
            <b className="vc-cp-pin vc-cp-pin-key">1</b> Recent construction notices
          </span>
          <span className="vc-cp-key">
            Funded projects
            <span className="vc-cp-swatches" aria-hidden="true">
              {STAGES.map((s) => (
                <i key={s} data-stage={s} />
              ))}
            </span>
            planning to construction
          </span>
        </div>
        <div className="vc-cp-pick" aria-live="polite">
          {pickedActive ? (
            <>
              <span className="vc-cp-pick-name">
                <b className="vc-cp-n">{pickedActive.n}</b> {pickedActive.title}
              </span>
              <button type="button" className="vc-cp-link" onClick={goDetails}>
                Details
              </button>
            </>
          ) : pickedPlan ? (
            <>
              <span className="vc-cp-pick-name">
                {pickedPlan.name}
                <span className="vc-cp-stage" data-stage={pickedPlan.stage}>
                  {pickedPlan.stage}
                </span>
              </span>
              <button type="button" className="vc-cp-link" onClick={goDetails}>
                Details
              </button>
            </>
          ) : (
            <span className="vc-cp-hint">Tap a numbered pin or a shaded area for details.</span>
          )}
        </div>
      </section>

      <section className="vc-latest-sec">
        <div className="vc-latest-sec-head">
          <h2>Construction updates</h2>
          <a className="vc-latest-more" href={CITY_PAGE} target="_blank" rel="noopener noreferrer">
            City&apos;s page <ArrowUpRight size={12} strokeWidth={2} />
          </a>
        </div>
        {latest && <p className="vc-cp-lede">Latest city update: {shortDate(latest)}.</p>}
        <div className="vc-cp-cards">
          {ACTIVE.map((p) => (
            <ActiveCard key={p.id} p={p} onShow={showActive} picked={pickedActive?.id === p.id} />
          ))}
        </div>
      </section>

      <section className="vc-latest-sec">
        <div className="vc-latest-sec-head">
          <h2>Funded projects</h2>
          <Link to="/budget?view=projects" className="vc-latest-more">
            Budget details
          </Link>
        </div>
        {load.status === 'loading' && <p className="vc-cp-lede">Loading the city&apos;s project list.</p>}
        {load.status === 'error' && <p className="vc-cp-lede">The city&apos;s project list did not load. Reload to try again.</p>}
        {plans.length > 0 && (
          <>
            <p className="vc-cp-lede">
              {plans.length} projects in the fiscal 2027 budget, {millions(total)} in all.
            </p>
            <div className="vc-cp-chips" role="group" aria-label="Filter by type">
              <button type="button" className="vc-chip" data-active={category === 'All'} onClick={() => setCategory('All')}>
                All {plans.length}
              </button>
              {CATEGORIES.filter((c) => counts.get(c)).map((c) => (
                <button key={c} type="button" className="vc-chip" data-active={category === c} onClick={() => setCategory(c)}>
                  {c} {counts.get(c)}
                </button>
              ))}
            </div>
            <ul className="vc-cp-rows">
              {shown.map((p) => (
                <PlanRow key={p.key} p={p} years={years} open={openKey === p.key} onToggle={() => setOpenKey(openKey === p.key ? null : p.key)} onShow={showPlan} />
              ))}
            </ul>
            <p className="vc-cp-fine">
              Stage and years: city project list (years only). Amounts: adopted FY27 budget, July 1, 2026 to June 30, 2027.
            </p>
          </>
        )}

        <details className="vc-cp-also">
          <summary>
            Also funded this year <span>{ALSO_FUNDED.length}</span>
            <ChevronDown size={15} strokeWidth={1.9} className="vc-cp-docs-chev" />
          </summary>
          <p className="vc-cp-fine">From the FY 2026-2027 Capital Projects Reference Guide. Not on the city&apos;s project map.</p>
          <ul>
            {ALSO_FUNDED.map((a) => (
              <li key={a.name}>
                <strong>{a.name}</strong>
                <span>{a.about}</span>
              </li>
            ))}
          </ul>
          <DocLink id="doc_4a2030ca2de99f44" className="vc-cp-link">
            Open the reference guide
          </DocLink>
        </details>
      </section>

      <p className="vc-cp-source">
        Sources: Vineyard City construction notices and email updates, the city&apos;s Capital Improvement Plan map and the FY 2026-2027 Capital Projects Reference Guide, and the adopted fiscal 2027 budget. Independent project, not an official Vineyard City website.
      </p>
    </Frame>
  );
}

