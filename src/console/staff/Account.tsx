import { useState, type FormEvent } from 'react';
import { KeyRound, Trash2 } from 'lucide-react';
import { AREA_NAME, ROLE_LABEL, staff, when } from './api';
import { createPasskey, deviceName, getPasskey, passkeysSupported } from './passkey';
import { useStaffCtx, useStaffData } from './useStaff';
import { Alert, Field, PasswordInput } from './ui';
import RecoveryCodes from './RecoveryCodes';

interface Creds {
  passkeys: Array<{ id: string; name: string | null; created_at: string; last_used_at: string | null }>;
  hasPassword: boolean;
  maxPasskeys: number;
  recoveryLeft: number;
}

const MIN_PASSWORD = 12;

export default function Account() {
  const { user, reload, signOut } = useStaffCtx();
  const { data: creds, error: loadError, reload: refresh } = useStaffData<Creds>('/me/credentials');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [making, setMaking] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fresh, setFresh] = useState<string[] | null>(null);

  if (!user) return null;

  /** A new sheet of recovery codes, after proving it is really the person: password, or a passkey for a passkey-only account. */
  async function makeCodes(e?: FormEvent) {
    e?.preventDefault();
    setError('');
    setNote('');
    setBusy(true);
    try {
      let body: Record<string, unknown>;
      if (creds?.hasPassword) {
        if (!confirmPassword) throw new Error('Enter your current password to make new codes.');
        body = { current: confirmPassword };
      } else {
        const o = await staff<{ challenge: string; rpId: string }>('/passkey/options', { method: 'POST' });
        body = { passkey: await getPasskey(o) };
      }
      const r = await staff<{ codes: string[] }>('/recovery/new', { body });
      setConfirmPassword('');
      setMaking(false);
      setFresh(r.codes);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not make new codes.');
    } finally {
      setBusy(false);
    }
  }

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
    if (creds?.hasPassword && !current) return setError('Enter your current password.');
    if (next.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters for the new password.`);
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

  if (fresh) return <RecoveryCodes codes={fresh} email={user.email} doneLabel="Done" onDone={() => setFresh(null)} />;

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
      <div role="status">{note && <p className="vs-ok">{note}</p>}</div>

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
        {creds?.hasPassword && <Field label="Current password">{(id) => <PasswordInput id={id} autoComplete="current-password" value={current} onChange={setCurrent} />}</Field>}
        <Field label="New password" hint={`At least ${MIN_PASSWORD} characters.`}>
          {(id) => <PasswordInput id={id} autoComplete="new-password" value={next} onChange={setNext} />}
        </Field>
        <button type="submit" className="vs-btn vs-btn-quiet" disabled={busy}>
          Save password
        </button>
      </form>

      <section className="vs-card" aria-labelledby="vs-rc">
        <h2 id="vs-rc" className="vs-h2">
          Recovery codes
        </h2>
        {creds && creds.recoveryLeft > 2 && (
          <p className="vs-hint">You have {creds.recoveryLeft} unused recovery codes. If you lose your passkey and forget your password, one of them gets you back in.</p>
        )}
        {creds && creds.recoveryLeft > 0 && creds.recoveryLeft <= 2 && (
          <p className="vs-hint">
            You have only {creds.recoveryLeft} unused recovery {creds.recoveryLeft === 1 ? 'code' : 'codes'} left. Make a new set soon.
          </p>
        )}
        {creds && creds.recoveryLeft === 0 && <p className="vs-hint">You have no recovery codes. Make a set now so you can get back in if you lose your sign-in.</p>}
        {!making ? (
          <button
            type="button"
            className="vs-btn vs-btn-quiet"
            onClick={() => {
              setMaking(true);
              setError('');
            }}
          >
            Make new recovery codes
          </button>
        ) : (
          <form onSubmit={makeCodes} noValidate>
            <p className="vs-hint">A new set replaces the old one. {creds?.hasPassword ? 'Enter your current password to confirm.' : 'You will be asked to confirm with your passkey.'}</p>
            {creds?.hasPassword && <Field label="Current password">{(id) => <PasswordInput id={id} autoComplete="current-password" value={confirmPassword} onChange={setConfirmPassword} />}</Field>}
            <div className="vs-actions">
              <button type="submit" className="vs-btn vs-btn-primary" disabled={busy}>
                Make new codes
              </button>
              <button type="button" className="vs-btn vs-btn-quiet" onClick={() => setMaking(false)}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </section>

      <div>
        <button type="button" className="vs-btn vs-btn-quiet" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    </section>
  );
}
