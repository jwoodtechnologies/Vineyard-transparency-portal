import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Copy, Mail, UserPlus } from 'lucide-react';
import { ROLE_LABEL, staff, when, type Me, type Role } from './api';
import { Alert, Field } from './ui';
import { useStaffCtx, useStaffData } from './useStaff';
import { PRESETS } from './presets';

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

const DEPARTMENTS = [
  'City Council',
  'City Recorder',
  'Administration',
  'Communications',
  'Community Development',
  'Engineering',
  'Finance',
  'Parks and Recreation',
  'Planning',
  'Public Works',
  'Library',
];

/** An account that was never used is waiting on its link; one that was used and is off was turned off. */
const isPending = (p: Person) => !p.active && !p.lastLoginAt;
const isOff = (p: Person) => !p.active && Boolean(p.lastLoginAt);

function InviteBox({ invite, onDone }: { invite: Invite; onDone: () => void }) {
  const [copied, setCopied] = useState('');
  const [failed, setFailed] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
    heading.current?.scrollIntoView({ block: 'center' });
  }, []);
  const [soon] = useState(() => new Date(invite.expiresAt).getTime() - Date.now() < 3600_000 * 2);
  const when_ = soon ? 'in about an hour' : `on ${new Date(invite.expiresAt).toLocaleDateString([], { month: 'long', day: 'numeric' })}`;
  const message = `Hi ${invite.name.split(' ')[0]}, here is your link to set up your sign-in for the Vineyard Transparency Portal staff area:\n\n${invite.url}\n\nThe link works once and expires ${when_}.`;
  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setFailed(false);
    } catch {
      setCopied('');
      setFailed(true);
    }
  }
  return (
    <section className="vs-card vs-invite" aria-labelledby="vs-invite-h">
      <h2 id="vs-invite-h" className="vs-h2" tabIndex={-1} ref={heading}>
        Send {invite.name} this link
      </h2>
      <p className="vs-hint">It works once, expires {when_}, and will not be shown again. If it gets lost, use New link or Reset sign-in to make another.</p>
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
      <div role="status" className="vs-sr">
        {copied ? 'Copied to the clipboard.' : ''}
      </div>
      {failed && <p className="vs-error">Copy did not work here. Select the link above and copy it by hand.</p>}
    </section>
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
    setError('');
    if (!name.trim()) return setError('Enter the person’s name.');
    if (role === 'editor' && areas.length === 0) return setError('Choose at least one area for this person to edit.');
    setBusy(true);
    try {
      await staff('/users/update', { body: { id: person.id, name, department, role, areas } });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
      setBusy(false);
    }
  }
  return (
    <form className="vs-edit" onSubmit={save} noValidate aria-label={`Edit ${person.name}`}>
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
        <button type="submit" className="vs-btn vs-btn-primary" disabled={busy}>
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
  const roles: Role[] = me.role === 'owner' ? ['editor', 'admin'] : ['editor'];
  const { data, error: loadError, reload: refresh } = useStaffData<{ items: Person[] }>('/users');
  const people = data?.items ?? null;
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [invite, setInvite] = useState<Invite | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; what: 'reset' | 'off' } | null>(null);
  const confirmFocus = useRef<HTMLButtonElement>(null);
  const addHeading = useRef<HTMLHeadingElement>(null);

  // add form
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [department, setDepartment] = useState('');
  const [role, setRole] = useState<Role>('editor');
  const [areas, setAreas] = useState<string[]>([]);
  const [preset, setPreset] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (confirm) confirmFocus.current?.focus();
  }, [confirm]);
  useEffect(() => {
    if (adding) addHeading.current?.focus();
  }, [adding]);

  function choosePreset(key: string) {
    setPreset(key);
    const p = PRESETS.find((x) => x.key === key);
    if (p) {
      setDepartment(p.department);
      setAreas(p.areas);
      setRole('editor');
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    setFormError('');
    if (!name.trim()) return setFormError('Enter the person’s name.');
    if (!email.trim()) return setFormError('Enter their work email address.');
    if (role === 'editor' && areas.length === 0) return setFormError('Choose at least one area for this person to edit, or pick a starting point above.');
    setBusy(true);
    try {
      const r = await staff<{ invite: { path: string; expiresAt: string } }>('/users', { body: { name, email, department, role, areas } });
      setInvite({ name: name.trim(), email: email.trim(), url: `${window.location.origin}${r.invite.path}`, expiresAt: r.invite.expiresAt });
      setName('');
      setEmail('');
      setDepartment('');
      setRole('editor');
      setAreas([]);
      setPreset('');
      setAdding(false);
      setNote('');
      refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not add the person.');
    } finally {
      setBusy(false);
    }
  }

  async function reset(p: Person) {
    setError('');
    setNote('');
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
    setNote('');
    try {
      await staff('/users/update', { body: { id: p.id, active } });
      setConfirm(null);
      setNote(active ? `${p.name}’s account is on again.` : `${p.name}’s account is off. They were signed out and their recovery codes were removed.`);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change the account.');
    }
  }

  return (
    <section className="vs-stack" aria-labelledby="vs-people">
      <div className="vs-head">
        <h1 id="vs-people" className="vs-title">
          Accounts
        </h1>
        {!adding && (
          <button
            type="button"
            className="vs-btn vs-btn-primary"
            onClick={() => {
              setAdding(true);
              setInvite(null);
              setNote('');
            }}
          >
            <UserPlus size={16} aria-hidden="true" /> Add an account
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
        <form className="vs-card" onSubmit={add} noValidate aria-labelledby="vs-add-h">
          <h2 id="vs-add-h" className="vs-h2" tabIndex={-1} ref={addHeading}>
            Add an account
          </h2>
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
          {role === 'editor' && (
            <fieldset className="vs-presets">
              <legend>Start from</legend>
              {PRESETS.map((p) => (
                <label key={p.key} className="vs-preset" data-on={preset === p.key}>
                  <input type="radio" name="preset" checked={preset === p.key} onChange={() => choosePreset(p.key)} />
                  <span className="vs-preset-title">{p.label}</span>
                  <span className="vs-preset-blurb">{p.blurb}</span>
                </label>
              ))}
              <label className="vs-preset" data-on={preset === 'custom'}>
                <input type="radio" name="preset" checked={preset === 'custom'} onChange={() => setPreset('custom')} />
                <span className="vs-preset-title">Choose the areas myself</span>
                <span className="vs-preset-blurb">Pick exactly what this person can edit.</span>
              </label>
            </fieldset>
          )}
          <Field label="Name">{(id) => <input id={id} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <Field label="Work email" hint="Used to sign in. Nothing is sent: you get a link to give them yourself.">
            {(id) => <input id={id} type="email" autoComplete="off" inputMode="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} />}
          </Field>
          <Field label="Department">{(id) => <input id={id} list="vs-departments" autoComplete="off" value={department} onChange={(e) => setDepartment(e.target.value)} />}</Field>
          {role === 'editor' && <AreaPicker value={areas} onChange={setAreas} labels={labels} />}
          <Alert>{formError}</Alert>
          <div className="vs-actions">
            <button type="submit" className="vs-btn vs-btn-primary" disabled={busy}>
              Create account
            </button>
            <button type="button" className="vs-btn vs-btn-quiet" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <Alert>{error || loadError}</Alert>
      <div role="status">{note && <p className="vs-ok">{note}</p>}</div>
      <ul className="vs-list">
        {people?.map((p) => {
          const pending = isPending(p);
          const off = isOff(p);
          const asking = confirm?.id === p.id ? confirm.what : null;
          return (
            <li key={p.id} className="vs-person" data-off={off}>
              <div className="vs-row">
                <div className="vs-row-main">
                  <p className="vs-row-title">
                    {p.name} <span className="vs-badge">{ROLE_LABEL[p.role]}</span>
                    {pending && (
                      <span className="vs-badge" data-tone="wait">
                        {p.invitePending ? 'Invite not used yet' : 'Invite expired'}
                      </span>
                    )}
                    {off && (
                      <span className="vs-badge" data-tone="off">
                        Turned off
                      </span>
                    )}
                  </p>
                  <p className="vs-row-sub">
                    {p.email}
                    {p.department ? ` · ${p.department}` : ''}
                  </p>
                  <p className="vs-row-sub">
                    {p.role === 'editor' ? p.areas.map((a) => labels.find((l) => l.key === a)?.label ?? a).join(', ') : 'All areas'}
                    {p.lastLoginAt ? ` · last signed in ${when(p.lastLoginAt)}` : ''}
                  </p>
                </div>
              </div>
              {p.canManage && (
                <div className="vs-actions">
                  <button
                    type="button"
                    className="vs-btn vs-btn-small vs-btn-quiet"
                    onClick={() => setEditing(editing === p.id ? null : p.id)}
                    aria-expanded={editing === p.id}
                    aria-label={`${editing === p.id ? 'Close' : 'Edit'} ${p.name}`}
                  >
                    {editing === p.id ? 'Close' : 'Edit'}
                  </button>
                  {p.active && p.id !== me.id && asking !== 'reset' && (
                    <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" onClick={() => setConfirm({ id: p.id, what: 'reset' })} aria-label={`Reset sign-in for ${p.name}`}>
                      Reset sign-in
                    </button>
                  )}
                  {pending && (
                    <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" onClick={() => reset(p)} aria-label={`Make a new link for ${p.name}`}>
                      New link
                    </button>
                  )}
                  {off && (
                    <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" onClick={() => setActive(p, true)} aria-label={`Turn on the account for ${p.name}`}>
                      Turn on
                    </button>
                  )}
                  {p.active && p.id !== me.id && asking !== 'off' && (
                    <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" onClick={() => setConfirm({ id: p.id, what: 'off' })} aria-label={`Turn off the account for ${p.name}`}>
                      Turn off
                    </button>
                  )}
                </div>
              )}
              {asking === 'reset' && (
                <div className="vs-confirm" role="group" aria-label={`Confirm reset for ${p.name}`}>
                  <p className="vs-hint">This signs {p.name} out everywhere and removes their passkeys, password and recovery codes. You get a new link to send them.</p>
                  <div className="vs-actions">
                    <button type="button" className="vs-btn vs-btn-small vs-btn-primary" onClick={() => reset(p)} ref={confirmFocus}>
                      Yes, reset {p.name.split(' ')[0]}
                    </button>
                    <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" onClick={() => setConfirm(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {asking === 'off' && (
                <div className="vs-confirm" role="group" aria-label={`Confirm turning off ${p.name}`}>
                  <p className="vs-hint">{p.name} will be signed out at once and cannot sign in until you turn the account on again.</p>
                  <div className="vs-actions">
                    <button type="button" className="vs-btn vs-btn-small vs-btn-primary" onClick={() => setActive(p, false)} ref={confirmFocus}>
                      Yes, turn off {p.name.split(' ')[0]}
                    </button>
                    <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" onClick={() => setConfirm(null)}>
                      Cancel
                    </button>
                  </div>
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
                    setNote(`Saved changes for ${p.name}.`);
                    refresh();
                  }}
                />
              )}
            </li>
          );
        })}
      </ul>
      {people === null && !loadError && <p className="vs-empty">Loading</p>}
    </section>
  );
}
