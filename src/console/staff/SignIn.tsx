import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { staff } from './api';
import { getPasskey, passkeysSupported } from './passkey';
import { proofs, useStaffCtx } from './useStaff';
import { Alert, Field, PasswordInput, Spinner } from './ui';

/** The sign-in form itself, used on the sign-in page and in the "your session ended" box. */
export function SignInForm({ onSignedIn, autoFocus = false }: { onSignedIn: () => Promise<void> | void; autoFocus?: boolean }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [trap, setTrap] = useState('');
  const [busy, setBusy] = useState<'key' | 'password' | null>(null);
  const [error, setError] = useState('');
  const keys = passkeysSupported();

  useEffect(() => {
    proofs.warm(); // solves the bot check while the person types
  }, []);

  async function withPasskey() {
    setError('');
    setBusy('key');
    try {
      const o = await staff<{ challenge: string; rpId: string }>('/passkey/options', { method: 'POST' });
      const answer = await getPasskey(o);
      await staff('/passkey/login', { body: answer });
      await onSignedIn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not sign in.');
      setBusy(null);
    }
  }

  async function withPassword(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password) return setError(!email.trim() ? 'Enter your email address.' : 'Enter your password.');
    setBusy('password');
    try {
      const pow = await proofs.take();
      await staff('/login', { body: { email, password, website: trap, pow } });
      await onSignedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in.');
      setBusy(null);
    }
  }

  return (
    <>
      {keys && (
        <button type="button" className="vs-btn vs-btn-primary vs-block" onClick={withPasskey} disabled={busy !== null}>
          {busy === 'key' ? <Spinner label="Waiting for your passkey" /> : <KeyRound size={17} aria-hidden="true" />} Sign in with a passkey
        </button>
      )}
      {keys && <p className="vs-or">or use your email</p>}

      <form onSubmit={withPassword} noValidate>
        <Field label="Email">
          {(id) => (
            <input
              id={id}
              type="email"
              autoComplete="username webauthn"
              inputMode="email"
              autoCapitalize="none"
              autoFocus={autoFocus && !keys}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          )}
        </Field>
        <Field label="Password">{(id) => <PasswordInput id={id} autoComplete="current-password" value={password} onChange={setPassword} />}</Field>
        {/* A field only a script would fill in. */}
        <div className="vs-trap" aria-hidden="true">
          <label>
            Website
            <input type="text" tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} />
          </label>
        </div>
        <Alert>{error}</Alert>
        <button type="submit" className={`vs-btn ${keys ? 'vs-btn-quiet' : 'vs-btn-primary'} vs-block`} disabled={busy !== null}>
          {busy === 'password' && <Spinner label="Signing in" />} Sign in
        </button>
      </form>
      <p className="vs-small">
        <Link to="/staff/recover">Lost your passkey or forgot your password?</Link>
      </p>
    </>
  );
}

export default function SignIn({ setupOpen }: { setupOpen: boolean }) {
  const { reload } = useStaffCtx();
  const navigate = useNavigate();

  async function done() {
    await reload();
    navigate('/staff', { replace: true });
  }

  return (
    <section className="vs-card vs-narrow" aria-labelledby="vs-signin">
      <h1 id="vs-signin" className="vs-title">
        Staff sign in
      </h1>
      <p className="vs-lede">Update records, votes, maps and notices on the Vineyard Transparency Portal.</p>
      <SignInForm onSignedIn={done} />
      {setupOpen && (
        <p className="vs-small">
          First time setting up the portal? <Link to="/staff/setup">Create the owner account</Link>.
        </p>
      )}
    </section>
  );
}
