import { useEffect, useRef, useState } from 'react';
import { Mail, Pencil, Phone, Plus, RotateCcw, Search, Trash2 } from 'lucide-react';
import { staff } from './api';
import { Alert } from './ui';
import PersonForm from './PersonForm';
import { EMPTY_PERSON, KIND_NOUN, draftOf, personLine, type DirOptions, type DirPerson, type PersonDraft, type PersonKind } from './directoryLib';
import { useStaffData } from './useStaff';

const FILTERS: Array<{ value: '' | PersonKind; label: string }> = [
  { value: '', label: 'All' },
  { value: 'elected', label: 'Council' },
  { value: 'staff', label: 'Staff' },
  { value: 'board', label: 'Boards' },
];

/** What the server takes for a person: boards only for board members, department only for staff. */
const payload = (d: PersonDraft) => ({
  kind: d.kind,
  name: d.name,
  role: d.role,
  department: d.kind === 'staff' ? d.department : '',
  boards: d.kind === 'board' ? d.boards : [],
  term: d.kind === 'staff' ? '' : d.term,
  email: d.kind === 'board' ? '' : d.email,
  phone: d.kind === 'board' ? '' : d.phone,
});

function Row({ p, options, onChanged, onNotice, onError }: { p: DirPerson; options: DirOptions; onChanged: () => void; onNotice: (s: string) => void; onError: (s: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);

  async function change(path: '/directory/remove' | '/directory/restore') {
    onError('');
    try {
      await staff(path, { body: { slug: p.slug } });
      onNotice(path === '/directory/remove' ? `${p.name} is off the portal. You can put them back from this list, or undo it from Activity.` : `${p.name} is back on the portal.`);
      setConfirm(false);
      onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not change that.');
      setConfirm(false);
    }
  }

  return (
    <li className="vs-person" data-off={!p.current}>
      <div className="vs-row">
        <div className="vs-row-main">
          <p className="vs-row-title">
            {p.name}
            <span className="vs-badge" data-tone="off">
              {KIND_NOUN[p.kind]}
            </span>
            {!p.current && (
              <span className="vs-badge" data-tone="wait">
                Not shown
              </span>
            )}
          </p>
          <p className="vs-row-sub">{personLine(p)}</p>
          {p.term && <p className="vs-row-sub">{p.term}</p>}
          {(p.email || p.phone) && (
            <p className="vs-row-sub">
              {p.email && (
                <span className="vs-contact">
                  <Mail size={13} aria-hidden="true" /> {p.email}
                </span>
              )}
              {p.phone && (
                <span className="vs-contact">
                  <Phone size={13} aria-hidden="true" /> {p.phone}
                </span>
              )}
            </p>
          )}
        </div>
      </div>
      <div className="vs-actions">
        <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" onClick={() => setEditing(!editing)} aria-expanded={editing}>
          <Pencil size={14} aria-hidden="true" /> {editing ? 'Close' : 'Edit'}
        </button>
        {!p.current ? (
          <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" onClick={() => change('/directory/restore')}>
            <RotateCcw size={14} aria-hidden="true" /> Put back
          </button>
        ) : confirm ? (
          <>
            <button type="button" className="vs-btn vs-btn-small vs-btn-primary" onClick={() => change('/directory/remove')}>
              Yes, take off
            </button>
            <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" onClick={() => setConfirm(false)}>
              Keep
            </button>
          </>
        ) : (
          <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" onClick={() => setConfirm(true)}>
            <Trash2 size={14} aria-hidden="true" /> Take off
          </button>
        )}
      </div>
      {confirm && <p className="vs-hint">This hides {p.name} from the People and Boards pages. Their past votes and records stay. You can put them back at any time.</p>}
      {editing && (
        <PersonForm
          draft={draftOf(p)}
          options={options}
          adding={false}
          submitLabel="Save"
          onCancel={() => setEditing(false)}
          onSubmit={async (d) => {
            await staff('/directory/edit', { body: { slug: p.slug, ...payload(d) } });
            setEditing(false);
            onNotice('Saved. The change is on the portal now.');
            onChanged();
          }}
        />
      )}
    </li>
  );
}

/** People and boards: the Mayor and Council, city staff and board members. */
export default function Directory() {
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState('');
  const [kind, setKind] = useState<'' | PersonKind>('');
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const banner = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const t = setTimeout(() => setApplied(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    if (notice) banner.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [notice]);
  const params = new URLSearchParams();
  if (applied) params.set('q', applied);
  if (kind) params.set('kind', kind);
  const list = useStaffData<{ items: DirPerson[] }>(`/directory/people${params.size ? `?${params}` : ''}`);
  const opts = useStaffData<DirOptions>('/directory/options');
  const options: DirOptions = opts.data ?? { departments: [], boards: [], boardRoles: ['Chair', 'Vice Chair', 'Member', 'Alternate'] };

  return (
    <section className="vs-stack" aria-labelledby="vs-dir">
      <div>
        <h1 id="vs-dir" className="vs-title">
          People and boards
        </h1>
        <p className="vs-lede">Keep the Mayor and Council, city staff and board members up to date. Changes show on the People and Boards pages right away, and the daily read of the city website leaves what you set alone.</p>
      </div>

      {notice && (
        <p className="vs-ok" role="status" ref={banner}>
          {notice}
        </p>
      )}

      <div className="vs-card vs-stack">
        <div className="vs-actions">
          <button type="button" className="vs-btn vs-btn-quiet" onClick={() => {
              setAdding(!adding);
              setNotice('');
            }}
            aria-expanded={adding}
          >
            <Plus size={16} aria-hidden="true" /> {adding ? 'Close' : 'Add a person'}
          </button>
        </div>
        {adding && (
          <PersonForm
            draft={EMPTY_PERSON}
            options={options}
            adding
            submitLabel="Add person"
            onCancel={() => setAdding(false)}
            onSubmit={async (d) => {
              await staff('/directory/add', { body: payload(d) });
              setAdding(false);
              setQ('');
              setKind('');
              setNotice(`${d.name.trim()} is on the portal now.`);
              list.reload();
              opts.reload();
            }}
          />
        )}
      </div>

      <div>
        <div className="vs-seg" role="group" aria-label="Show">
          {FILTERS.map((f) => (
            <button key={f.value} type="button" aria-pressed={kind === f.value} onClick={() => setKind(f.value)}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="vs-search">
          <Search size={16} aria-hidden="true" />
          <input type="search" aria-label="Search people" placeholder="Search by name, title or department" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Alert>{error || list.error}</Alert>
        {list.data && list.data.items.length === 0 && <p className="vs-empty">{applied || kind ? 'Nobody matches that.' : 'Nobody is listed yet.'}</p>}
        <ul className="vs-list">
          {list.data?.items.map((p) => (
            <Row
              key={p.slug}
              p={p}
              options={options}
              onNotice={setNotice}
              onError={setError}
              onChanged={() => {
                list.reload();
                opts.reload();
              }}
            />
          ))}
        </ul>
        {list.data && list.data.items.length >= 300 && <p className="vs-hint">Showing the first 300. Search to find someone else.</p>}
      </div>
    </section>
  );
}
