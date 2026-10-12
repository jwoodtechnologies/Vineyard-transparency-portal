import { useState, type FormEvent } from 'react';
import { Copy, Mail, UserPlus } from 'lucide-react';
import { ROLE_LABEL, staff, when, type Me, type Role } from './api';
import { Alert, Field } from './ui';
import { useStaffCtx, useStaffData } from './useStaff';

interface Person {
  id: string;
  email: string;
  name: string;
  department: string | null;
  role: Role;
  areas: string[];
  active: boolean;
  lastLoginAt: string | null;
  hasPassword: boolean;
  passkeys: number;
  invitePending: boolean;
  canManage: boolean;
}

interface Invite {
  name: string;
  email: string;
  url: string;
  expiresAt: string;
}

const DEPARTMENTS = ['City Council', 'City Recorder', 'Administration', 'Communications', 'Community Development', 'Engineering', 'Finance', 'Parks and Recreation', 'Planning', 'Public Works', 'Library'];

function InviteBox({ invite, onDone }: { invite: Invite; onDone: () => void }) {
  const [copied, setCopied] = useState('');
  const message = `Hi ${invite.name.split(' ')[0]}, here is your link to set up your sign-in for the Vineyard Transparency Portal staff area:\n\n${invite.url}\n\nThe link works once and expires on ${new Date(invite.expiresAt).toLocaleDateString([], { month: 'long', day: 'numeric' })}.`;
  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {
      setCopied('');
    }
  }
  return (
    <div className="vs-card vs-invite" role="status">
      <h2 className="vs-h2">Send {invite.name} this link</h2>
      <p className="vs-hint">It works once, expires in 7 days, and will not be shown again. If it gets lost, use Reset sign-in to make a new one.</p>
      <input className="vs-linkbox" readOnly value={invite.url} onFocus={(e) => e.currentTarget.select()} aria-label="Sign-in link" />
      <div className="vs-actions">
        <button type="button" className="vs-btn vs-btn-primary" onClick={() => copy(invite.url, 'link')}>
          <Copy size={15} aria-hidden="true" /> {copied === 'link' ? 'Copied' : 'Copy link'}
        </button>
        <button type="button" className="vs-btn vs-btn-quiet" onClick={() => copy(message, 'message')}>
          {copied === 'message' ? 'Copied' : 'Copy as a message'}
        </button>
        <a className="vs-btn vs-btn-quiet" href={`mailto:${encodeURIComponent(invite.email)}?subject=${encodeURIComponent('Your Vineyard portal staff sign-in')}&body=${encodeURIComponent(message)}`}>
          <Mail size={15} aria-hidden="true" /> Open in email
        </a>
        <button type="button" className="vs-btn vs-btn-quiet" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}

function AreaPicker({ value, onChange, labels }: { value: string[]; onChange: (v: string[]) => void; labels: Array<{ key: string; label: string }> }) {
  const all = value.length === labels.length;
  return (
    <fieldset className="vs-areas">
      <legend>Can edit</legend>
      {labels.map((a) => (
        <label key={a.key} className="vs-check">
          <input type="checkbox" checked={value.includes(a.key)} onChange={(e) => onChange(e.target.checked ? [...value, a.key] : value.filter((k) => k !== a.key))} />
          <span>{a.label}</span>
        </label>
      ))}
      <button type="button" className="vs-link" onClick={() => onChange(all ? [] : labels.map((a) => a.key))}>
        {all ? 'Clear all' : 'Select all'}
      </button>
    </fieldset>
  );
}

function Editor({ person, me, labels, roles, onSaved }: { person: Person; me: Me; labels: Array<{ key: string; label: string }>; roles: Role[]; onSaved: () => void }) {
  const [name, setName] = useState(person.name);
  const [department, setDepartment] = useState(person.department ?? '');
  const [role, setRole] = useState<Role>(person.role);
  const [areas, setAreas] = useState(person.areas);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const self = person.id === me.id;
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await staff('/users/update', { body: { id: person.id, name, department, role, areas } });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
      setBusy(false);
    }
  }
  return (
    <form className="vs-edit" onSubmit={save} noValidate>
      <Field label="Name">{(id) => <input id={id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
      <Field label="Department">{(id) => <input id={id} list="vs-departments" value={department} onChange={(e) => setDepartment(e.target.value)} />}</Field>
      {roles.length > 1 && !self && (
        <Field label="Role">
          {(id) => (
            <select id={id} value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      {role === 'editor' && <AreaPicker value={areas} onChange={setAreas} labels={labels} />}
      <Alert>{error}</Alert>
      <div className="vs-actions">
        <button type="submit" className="vs-btn vs-btn-primary" disabled={busy || !name.trim() || (role === 'editor' && areas.length === 0)}>
          Save
        </button>
      </div>
    </form>
  );
}

export default function People() {
  const { user, load } = useStaffCtx();
  const me = user as Me;
  const labels = load.status === 'ready' ? load.data.areas : [];
  const roles: Role[] = me.role === 'owner' ? ['editor', 'admin', 'owner'] : ['editor'];
  const { data, error: loadError, reload: refresh } = useStaffData<{ items: Person[] }>('/users');
  const people = data?.items ?? null;
  const [error, setError] = useState('');
  const [invite, setInvite] = useState<Invite | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; what: 'reset' | 'off' } | null>(null);

  // add form
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [department, setDepartment] = useState('');
  const [role, setRole] = useState<Role>('editor');
  const [areas, setAreas] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  async function add(e: FormEvent) {
    e.preventDefault();
    setFormError('');
    setBusy(true);
    try {
      const r = await staff<{ invite: { path: string; expiresAt: string } }>('/users', { body: { name, email, department, role, areas } });
      setInvite({ name: name.trim(), email: email.trim(), url: `${window.location.origin}${r.invite.path}`, expiresAt: r.invite.expiresAt });
      setName('');
      setEmail('');
      setDepartment('');
      setRole('editor');
      setAreas([]);
      setAdding(false);
      refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not add the person.');
    } finally {
      setBusy(false);
    }
  }

  async function reset(p: Person) {
    setError('');
    try {
      const r = await staff<{ invite: { path: string; expiresAt: string } }>('/users/reset', { body: { id: p.id } });
      setInvite({ name: p.name, email: p.email, url: `${window.location.origin}${r.invite.path}`, expiresAt: r.invite.expiresAt });
      setConfirm(null);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reset.');
    }
  }

  async function setActive(p: Person, active: boolean) {
    setError('');
    try {
      await staff('/users/update', { body: { id: p.id, active } });
      setConfirm(null);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change the account.');
    }
  }

  return (
    <section className="vs-stack" aria-labelledby="vs-people">
      <div className="vs-head">
        <h1 id="vs-people" className="vs-title">
          People
        </h1>
        {!adding && (
          <button type="button" className="vs-btn vs-btn-primary" onClick={() => { setAdding(true); setInvite(null); }}>
            <UserPlus size={16} aria-hidden="true" /> Add a person
          </button>
        )}
      </div>
      <p className="vs-lede">Each person gets their own account, so the activity log shows who changed what. Choose which parts of the portal they can edit. Anyone can be turned off at any time.</p>
      <datalist id="vs-departments">
        {DEPARTMENTS.map((d) => (
          <option key={d} value={d} />
        ))}
      </datalist>

      {invite && <InviteBox invite={invite} onDone={() => setInvite(null)} />}

      {adding && (
        <form className="vs-card" onSubmit={add} noValidate aria-label="Add a person">
          <h2 className="vs-h2">Add a person</h2>
          <Field label="Name">{(id) => <input id={id} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <Field label="Work email" hint="Used to sign in. Send them the link yourself after you create the account.">
            {(id) => <input id={id} type="email" autoComplete="off" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />}
          </Field>
          <Field label="Department">{(id) => <input id={id} list="vs-departments" autoComplete="off" value={department} onChange={(e) => setDepartment(e.target.value)} />}</Field>
          {roles.length > 1 && (
            <Field label="Role" hint="Administrators can edit everything and add editors. Owners can also add administrators.">
              {(id) => (
                <select id={id} value={role} onChange={(e) => setRole(e.target.value as Role)}>
                  {roles.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
          {role === 'editor' && <AreaPicker value={areas} onChange={setAreas} labels={labels} />}
          <Alert>{formError}</Alert>
          <div className="vs-actions">
            <button type="submit" className="vs-btn vs-btn-primary" disabled={busy || !name.trim() || !email.trim() || (role === 'editor' && areas.length === 0)}>
              Create account
            </button>
            <button type="button" className="vs-btn vs-btn-quiet" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <Alert>{error || loadError}</Alert>
      <ul className="vs-list">
        {people?.map((p) => (
          <li key={p.id} className="vs-person" data-off={!p.active && !p.invitePending}>
            <div className="vs-row">
              <div className="vs-row-main">
                <p className="vs-row-title">
                  {p.name} <span className="vs-badge">{ROLE_LABEL[p.role]}</span>
                  {!p.active && <span className="vs-badge" data-tone={p.invitePending ? 'wait' : 'off'}>{p.invitePending ? 'Link sent' : 'Off'}</span>}
                </p>
                <p className="vs-row-sub">
                  {p.email}
                  {p.department ? ` · ${p.department}` : ''}
                </p>
                <p className="vs-row-sub">
                  {p.role === 'editor' ? p.areas.map((a) => labels.find((l) => l.key === a)?.label ?? a).join(', ') : 'All areas'}
                  {p.lastLoginAt ? ` · last signed in ${when(p.lastLoginAt)}` : p.active ? '' : ''}
                </p>
              </div>
            </div>
            {p.canManage && (
              <div className="vs-actions">
                <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" onClick={() => setEditing(editing === p.id ? null : p.id)} aria-expanded={editing === p.id}>
                  {editing === p.id ? 'Close' : 'Edit'}
                </button>
                {confirm?.id === p.id && confirm.what === 'reset' ? (
                  <>
                    <button type="button" className="vs-btn vs-btn-small vs-btn-primary" onClick={() => reset(p)}>
                      Yes, reset and make a new link
                    </button>
                    <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" onClick={() => setConfirm(null)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" onClick={() => setConfirm({ id: p.id, what: 'reset' })}>
                    {p.active || p.invitePending ? 'Reset sign-in' : 'New link'}
                  </button>
                )}
                {p.id !== me.id &&
                  (p.active ? (
                    confirm?.id === p.id && confirm.what === 'off' ? (
                      <>
                        <button type="button" className="vs-btn vs-btn-small vs-btn-primary" onClick={() => setActive(p, false)}>
                          Yes, turn off
                        </button>
                        <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" onClick={() => setConfirm(null)}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" onClick={() => setConfirm({ id: p.id, what: 'off' })}>
                        Turn off
                      </button>
                    )
                  ) : (
                    !p.invitePending && (p.hasPassword || p.passkeys > 0) && (
                      <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" onClick={() => setActive(p, true)}>
                        Turn on
                      </button>
                    )
                  ))}
              </div>
            )}
            {editing === p.id && p.canManage && (
              <Editor
                person={p}
                me={me}
                labels={labels}
                roles={roles}
                onSaved={() => {
                  setEditing(null);
                  refresh();
                }}
              />
            )}
          </li>
        ))}
      </ul>
      {people === null && !loadError && <p className="vs-empty">Loading</p>}
    </section>
  );
}
