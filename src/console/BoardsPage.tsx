/**
 * Boards and commissions: every body that meets, its members as the city website lists them today,
 * and its meetings. Bodies with no meeting in the past year and none scheduled show as inactive.
 */
import './console.css';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, ChevronDown, Search, Vote } from 'lucide-react';
import { Frame } from './Chrome';
import { useJson } from './api';
import { formatDate } from './format';
import { PersonPhoto } from './PersonCard';
import type { Person } from './people';

interface Board {
  id: string;
  name: string;
  meetingName: string;
  hiddenExpired: number;
  kind: 'council' | 'board' | 'staff committee';
  meetings: number;
  firstMeeting: string | null;
  lastMeeting: string | null;
  nextMeeting: string | null;
  active: boolean;
  members: Array<{ slug: string; name: string; role: string; term: string | null; photo: string | null }>;
}

const VOTING = new Set(['city-council', 'redevelopment-agency', 'planning-commission']);

function BoardCard({ b, open, onToggle }: { b: Board; open: boolean; onToggle: () => void }) {
  return (
    <section className="vc-board" data-active={b.active}>
      <button type="button" className="vc-board-head" onClick={onToggle} aria-expanded={open}>
        <span className="vc-board-title">
          <span className="vc-board-name">{b.name}</span>
          <span className="vc-board-sub">
            {b.active ? '' : 'Inactive · '}
            {b.kind === 'staff committee' ? 'Staff committee · ' : ''}
            {b.members.length ? `${b.members.length} members · ` : ''}
            {b.meetings ? `${b.meetings} meetings on file` : 'No meetings on file'}
            {b.nextMeeting ? ` · next ${formatDate(b.nextMeeting)}` : b.lastMeeting ? ` · last ${formatDate(b.lastMeeting)}` : ''}
          </span>
        </span>
        <ChevronDown size={18} className="vc-board-chev" data-open={open} />
      </button>
      {open && (
        <div className="vc-board-body">
          {b.members.length > 0 ? (
            <ul className="vc-people">
              {b.members.map((m) => (
                <li key={m.slug}>
                  <Link to={`/people/${m.slug}`} className="vc-people-item">
                    <PersonPhoto person={{ name: m.name, photo: m.photo } as unknown as Person} size={40} />
                    <span className="vc-people-text">
                      <span className="vc-people-name">{m.name}</span>
                      <span className="vc-people-role">
                        {m.role}
                        {m.term ? ` · Term ${m.term}` : ''}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="vc-board-none">The city website does not list current members for this {b.kind === 'staff committee' ? 'committee' : 'body'}.</p>
          )}
          {b.hiddenExpired > 0 && (
            <p className="vc-board-none">
              {b.hiddenExpired === 1 ? 'One person' : `${b.hiddenExpired} people`} the city website still lists here {b.hiddenExpired === 1 ? 'has a term' : 'have terms'} that ended before this year and {b.hiddenExpired === 1 ? 'does' : 'do'} not appear in this year&apos;s minutes, so {b.hiddenExpired === 1 ? 'is' : 'are'} not shown.
            </p>
          )}
          {b.meetingName !== b.name && <p className="vc-board-none">Its meetings are posted as {b.meetingName}.</p>}
          <div className="vc-board-links">
            {b.meetings > 0 && (
              <Link to={`/meetings?type=meetings&body=${encodeURIComponent(b.id)}`} className="vc-chip">
                <CalendarDays size={13} /> Meetings
              </Link>
            )}
            {VOTING.has(b.id) && (
              <Link to={`/votes?body=${encodeURIComponent(b.id)}`} className="vc-chip">
                <Vote size={13} /> Voting records
              </Link>
            )}
            {b.firstMeeting && <span className="vc-board-since">Meetings on file since {b.firstMeeting.slice(0, 4)}</span>}
          </div>
        </div>
      )}
    </section>
  );
}

export default function BoardsPage() {
  const load = useJson<{ boards: Board[]; asOf: string }>('/api/boards');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [q, setQ] = useState('');
  const boards = load.status === 'done' ? load.data.boards : [];
  const needle = q.trim().toLowerCase();
  const shown = needle ? boards.filter((b) => b.name.toLowerCase().includes(needle) || b.members.some((m) => m.name.toLowerCase().includes(needle))) : boards;
  return (
    <Frame>
      <header className="vc-page-head">
        <h1 className="vc-page-title">Boards and commissions</h1>
        <p className="vc-page-sub">The City Council, the Redevelopment Agency and every board and commission the city website lists, with current members and their meetings.</p>
      </header>
      <label className="vc-vote-search" style={{ marginBottom: 14 }}>
        <Search size={15} />
        <input type="search" placeholder="Find a board or a member" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      {load.status === 'loading' && (
        <div className="vc-skeleton" aria-hidden="true">
          <span style={{ width: '90%' }} />
          <span style={{ width: '76%' }} />
        </div>
      )}
      {load.status === 'error' && <div className="vc-empty">Boards could not load just now.</div>}
      <div className="vc-boards">
        {shown.map((b) => (
          <BoardCard key={b.id} b={b} open={Boolean(needle) || Boolean(open[b.id])} onToggle={() => setOpen((o) => ({ ...o, [b.id]: !o[b.id] }))} />
        ))}
      </div>
      <p className="vc-person-asof">
        Members from the city&apos;s Board &amp; Commission Members page.{' '}
        <a href="https://www.vineyardutah.gov/government/board___commission_members.php" target="_blank" rel="noopener noreferrer">
          View on city website
        </a>
      </p>
    </Frame>
  );
}
