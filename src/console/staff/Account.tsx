import { useState, type FormEvent } from 'react';
import { KeyRound, Trash2 } from 'lucide-react';
import { AREA_NAME, ROLE_LABEL, staff, when } from './api';
import { createPasskey, deviceName, passkeysSupported } from './passkey';
import { useStaffCtx, useStaffData } from './useStaff';
import { Alert, Field } from './ui';

interface Creds {
  passkeys: Array<{ id: string; name: string | null; created_at: string; last_used_at: string | null }>;
  hasPassword: boolean;
  maxPasskeys: number;
}

export default function Account() {
  const { user, reload, signOut } = useStaffCtx();
  const { data: creds, error: loadError, reload: refresh } = useStaffData<Creds>('/me/credentials');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);

  if (!user) return null;

  async function addPasskey() {
    setError('');
    setNote('');
    setBusy(true);
    try {
      const o = await staff<{ challenge: string; rpId: string; userId: string; email: string; name: string; exclude: string[] }>('/passkey/add/options', { method: 'POST' });
      const key = await createPasskey(o);
      await staff('/passkey/add', { body: { ...key, name: deviceName() } });
      setNote('Passkey added. You can use it to sign in from this device.');
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add the passkey.');
    } finally {
      setBusy(false);
    }
  }

  async function removeKey(id: string) {
    setError('');
    try {
      await staff('/passkey/remove', { body: { id } });
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove it.');
    }
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    setError('');
    setNote('');
    setBusy(true);
    try {
      await staff('/password', { body: { current, next } });
      setCurrent('');
      setNext('');
      setNote('Password saved. Other devices were signed out.');
      refresh();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the password.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="vs-stack" aria-labelledby="vs-account">
      <h1 id="vs-account" className="vs-title">
        Your account
      </h1>
      <div className="vs-card">
        <p className="vs-row-title">{user.name}</p>
        <p className="vs-row-sub">
          {user.email}
          {user.department ? ` · ${user.department}` : ''} · {ROLE_LABEL[user.role]}
        </p>
        <p className="vs-row-sub">{user.role === 'editor' ? `You can edit: ${user.areas.map((a) => AREA_NAME[a] ?? a).join(', ')}.` : 'You can edit every area.'}</p>
      </div>

      <Alert>{error || loadError}</Alert>
      {note && (
        <p className="vs-ok" role="status">
          {note}
        </p>
      )}

      <div className="vs-card">
        <h2 className="vs-h2">Passkeys</h2>
        {creds && creds.passkeys.length === 0 && <p className="vs-hint">No passkeys yet. A passkey lets you sign in with your fingerprint, face or device PIN.</p>}
        <ul className="vs-list">
          {creds?.passkeys.map((k) => (
            <li key={k.id} className="vs-row">
              <div className="vs-row-main">
                <p className="vs-row-title">{k.name || 'Passkey'}</p>
                <p className="vs-row-sub">
                  Added {when(k.created_at)}
                  {k.last_used_at ? ` · last used ${when(k.last_used_at)}` : ''}
                </p>
              </div>
              <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" onClick={() => removeKey(k.id)} aria-label={`Remove ${k.name || 'passkey'}`}>
                <Trash2 size={14} aria-hidden="true" /> Remove
              </button>
            </li>
          ))}
        </ul>
        {passkeysSupported() ? (
          <button type="button" className="vs-btn vs-btn-quiet" onClick={addPasskey} disabled={busy || (creds ? creds.passkeys.length >= creds.maxPasskeys : false)}>
            <KeyRound size={16} aria-hidden="true" /> Add a passkey on this device
          </button>
        ) : (
          <p className="vs-hint">This browser cannot make passkeys.</p>
        )}
      </div>

      <form className="vs-card" onSubmit={savePassword} noValidate>
        <h2 className="vs-h2">{creds?.hasPassword ? 'Change password' : 'Add a password'}</h2>
        {creds?.hasPassword && <Field label="Current password">{(id) => <input id={id} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />}</Field>}
        <Field label="New password" hint="At least 12 characters.">
          {(id) => <input id={id} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />}
        </Field>
        <button type="submit" className="vs-btn vs-btn-quiet" disabled={busy || next.length < 12 || (creds?.hasPassword === true && !current)}>
          Save password
        </button>
      </form>

      <div>
        <button type="button" className="vs-btn vs-btn-quiet" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    </section>
  );
}
