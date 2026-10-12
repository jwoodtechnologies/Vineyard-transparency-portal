/**
 * Under the map (/map#projects): every funded capital project, one card each (name, what it is,
 * the FY 2027 amount, its stage, and Details for the votes and records), then the city's current
 * construction table as one card per row. One edge-cached call: GET /api/pages/construction (the
 * city's Capital Improvement Plan map layer and its Construction Projects page as last stored).
 * A project with an update from Vineyard City staff (GET /api/updates, read fresh) shows the newest one
 * on its card.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { FeatureCollection, Geometry } from 'geojson';
import { ArrowUpRight, ChevronDown, MapPin } from 'lucide-react';
import { useJson } from './api';
import { DocLink } from './DocLink';
import type { StaffUpdate } from './RecordsHome';
import { ProjectDetail } from './ProjectDetail';
import { ALSO_FUNDED, CITY_PAGE, millions, money, plansFrom, type Plan, type PlanProps } from './construction';
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

function ProjectCard({ p, onShow, update }: { p: Plan; onShow: (gis: string) => void; update?: StaffUpdate }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="vc-mp-card" data-open={open || undefined}>
      <div className="vc-mp-top">
        <h3 className="vc-mp-name">{p.name}</h3>
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
            <button type="button" className="vc-ghost" data-icon-only="true" onClick={() => onShow(p.gis)} aria-label={`Show ${p.name} on the map`} title="Show on the map">
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
        <h2 id="vc-work-h">Construction now</h2>
        <a className="vc-mp-link" href={s.sourceUrl || CITY_PAGE} target="_blank" rel="noopener noreferrer">
          City page <ArrowUpRight size={14} strokeWidth={2} />
        </a>
      </div>
      {asOf && <p className="vc-mp-count">City update, {asOf}</p>}
      <ul className="vc-mp-list">
        {g.rows.map((r, i) => (
          <li key={i} className="vc-mp-card">
            <h3 className="vc-mp-name">{normalizeDatesInText(r[title] || '')}</h3>
            {where && r[where] && <p className="vc-mp-where">{r[where]}</p>}
            {what && r[what] && <p className="vc-mp-what" data-full="true">{normalizeDatesInText(r[what])}</p>}
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

export function MapProjects({ onShow }: { onShow: (gis: string) => void }) {
  const load = useJson<PageData>('/api/pages/construction');
  const own = useJson<FC>(load.status === 'error' || (load.status === 'done' && !load.data.projects) ? '/api/map/layers/projects?page=0&v=5' : null);
  const fc = load.status === 'done' && load.data.projects ? load.data.projects : own.status === 'done' ? own.data : null;
  const plans = useMemo(() => (fc ? plansFrom(fc) : []), [fc]);
  const total = useMemo(() => plans.reduce((s, p) => s + (p.budget ?? 0), 0), [plans]);
  const snapshot = load.status === 'done' ? load.data.construction : null;
  // The newest staff update for each project on the map (the list comes newest first).
  const upd = useJson<{ items: StaffUpdate[] }>('/api/updates?limit=100');
  const latest = useMemo(() => {
    const m = new Map<string, StaffUpdate>();
    for (const u of upd.status === 'done' ? upd.data.items : []) if (u.projectGis && !m.has(u.projectGis)) m.set(u.projectGis, u);
    return m;
  }, [upd]);
  const { hash } = useLocation();
  const ready = plans.length > 0;

  // /construction and /map#projects open here, once the list has its height.
  useEffect(() => {
    if (hash === '#projects' && ready) document.getElementById('projects')?.scrollIntoView({ block: 'start' });
  }, [hash, ready]);

  const failed = load.status === 'error' && own.status === 'error';
  if (failed) return null;

  return (
    <div className="vc-mp" id="projects">
      <section className="vc-mp-sec" aria-labelledby="vc-proj-h">
        <div className="vc-mp-head">
          <h2 id="vc-proj-h">Funded projects</h2>
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
                <ProjectCard key={p.key} p={p} onShow={onShow} update={latest.get(p.gis)} />
              ))}
            </ul>
            <h3 className="vc-mp-sub">Also funded, not on the map</h3>
            <ul className="vc-mp-also">
              {ALSO_FUNDED.map((a) => (
                <li key={a.name}>
                  <span className="vc-mp-also-name">{a.name}</span>
                  <span className="vc-mp-what" data-full="true">
                    {a.about}
                  </span>
                </li>
              ))}
            </ul>
            <p className="vc-mp-src">
              <DocLink id={REFERENCE_GUIDE} className="vc-mp-link">
                Capital Projects Reference Guide
              </DocLink>
            </p>
          </>
        )}
      </section>
      {snapshot && <CityWork s={snapshot} />}
    </div>
  );
}
