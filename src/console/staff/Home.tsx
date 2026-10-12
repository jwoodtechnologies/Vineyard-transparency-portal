import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { AREA_NAME, ROLE_LABEL, staff, when, type AuditItem, type Me } from './api';
import { visibleSections } from './sections';
import { useStaffCtx } from './useStaff';

export default function Home() {
  const { user } = useStaffCtx();
  const me = user as Me;
  const tiles = visibleSections(me).filter((s) => s.tile);
  const [recent, setRecent] = useState<AuditItem[] | null>(null);
  useEffect(() => {
    let live = true;
    staff<{ items: AuditItem[] }>('/audit?limit=5').then(
      (r) => live && setRecent(r.items),
      () => live && setRecent([]),
    );
    return () => {
      live = false;
    };
  }, []);

  return (
    <section className="vs-stack" aria-labelledby="vs-home">
      <div>
        <h1 id="vs-home" className="vs-title">
          Welcome, {me.name.split(' ')[0]}
        </h1>
        <p className="vs-lede">
          {ROLE_LABEL[me.role]}
          {me.department ? `, ${me.department}` : ''}.{' '}
          {me.role === 'editor' ? `You can edit ${me.areas.map((a) => (AREA_NAME[a] ?? a).toLowerCase()).join(', ')}.` : 'You can edit every part of the portal.'}
        </p>
      </div>

      <ul className="vs-tiles">
        {tiles.map((s) => (
          <li key={s.path}>
            <Link to={`/staff/${s.path}`} className="vs-tile">
              <span className="vs-tile-text">
                <span className="vs-tile-title">{s.label}</span>
                <span className="vs-tile-blurb">{s.blurb}</span>
              </span>
              <ChevronRight size={18} aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>

      <div>
        <h2 className="vs-h2">Recent changes</h2>
        {recent && recent.length === 0 && <p className="vs-empty">Nothing has been changed yet.</p>}
        <ul className="vs-list">
          {recent?.map((i) => (
            <li key={i.id} className="vs-row">
              <div className="vs-row-main">
                <p className="vs-row-title">{i.summary}</p>
                <p className="vs-row-sub">
                  {i.user_name ?? 'Someone'} · {when(i.at)}
                </p>
              </div>
            </li>
          ))}
        </ul>
        {recent && recent.length > 0 && (
          <Link to="/staff/activity" className="vs-link">
            See all activity
          </Link>
        )}
      </div>
    </section>
  );
}
