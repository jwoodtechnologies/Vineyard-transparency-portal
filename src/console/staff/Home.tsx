import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { ROLE_LABEL, canManageUsers, staff, when, type AuditItem, type Me } from './api';
import { visibleSections } from './sections';
import { useStaffCtx } from './useStaff';

/** What each area lets a person do, in the words they would use. */
const DOES: Record<string, string> = {
  records: 'add records and meeting documents',
  votes: 'correct votes',
  people: 'keep the directory up to date',
  map: 'update the map and projects',
  budget: 'update the budget',
  notices: 'post notices, events and updates',
  site: 'edit site pages and links',
  submissions: 'review resident submissions',
};

function sentence(parts: string[]): string {
  if (parts.length < 2) return parts[0] ?? 'view the portal';
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

export default function Home() {
  const { user } = useStaffCtx();
  const me = user as Me;
  const tiles = visibleSections(me).filter((s) => s.tile && (!s.managersTile || canManageUsers(me)));
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
          {me.department ? `, ${me.department}` : ''}. {me.role === 'editor' ? `You can ${sentence(me.areas.map((a) => DOES[a]).filter(Boolean))}.` : 'You can edit every part of the portal.'}
        </p>
      </div>

      <ul className="vs-tiles">
        {tiles.map((s) => (
          <li key={s.path}>
            <Link to={`/staff/${s.path}`} className="vs-tile">
              <span className="vs-tile-text">
                <span className="vs-tile-title">{s.tileTitle ?? s.label}</span>
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
