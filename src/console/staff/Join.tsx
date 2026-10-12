import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { staff } from './api';
import { createPasskey, passkeysSupported } from './passkey';
import { useStaffCtx } from './useStaff';
import { Alert, Field, Spinner } from './ui';

interface Invite {
  name: string;
  email: string;
  department: string | null;
  kind: 'invite' | 'recovery';
  minPassword: number;
}

/** Reads the one-time token from the link (kept after the # so it never reaches a server log). */
function tokenFromLink(): string {
  const t = window.location.hash.slice(1);
  if (t) window.history.replaceState(null, '', window.location.pathname);
  return t;
}

/** Finishes an account: choose a passkey or a password. Used by invitation links and by first-time setup. */
export default function Join({ token: given }: { token?: string }) {
  const { reload } = useStaffCtx();
  const navigate = useNavigate();
  const [token] = useState(() => given ?? tokenFromLink());
  const [lookup, setLookup] = useState<Invite | 'bad' | null>(null);
  const invite = token ? lookup : 'bad';
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [usePassword, setUsePassword] = useState(false);
  const [busy, setBusy] = useState<'key' | 'password' | null>(null);
  const [error, setError] = useState('');
  const keys = passkeysSupported();

  useEffect(() => {
    if (!token) return;
    let live = true;
    staff<Invite>('/invite/lookup', { body: { token } }).then(
      (i) => {
        if (!live) return;
        setLookup(i);
        setName(i.name === 'Owner' ? '' : i.name);
      },
      () => live && setLookup('bad'),
    );
    return () => {
      live = false;
    };
  }, [token]);

  async function finish(extra: Record<string, unknown>) {
    await staff('/invite/accept', { body: { token, name, ...extra } });
    await reload();
    navigate('/staff', { replace: true });
  }

  async function withPasskey() {
    setError('');
    if (!name.trim()) return setError('Enter your name first.');
    setBusy('key');
    try {
      const o = await staff<{ challenge: string; rpId: string; userId: string; email: string }>('/invite/options', { body: { token } });
      const passkey = await createPasskey({ ...o, name: name.trim() });
      await finish({ passkey });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the passkey.');
      setBusy(null);
    }
  }

  async function withPassword(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!name.trim()) return setError('Enter your name first.');
    if (invite && invite !== 'bad' && password.length < invite.minPassword) return setError(`Use at least ${invite.minPassword} characters. A few words in a row works well.`);
    if (password !== again) return setError('The two passwords do not match.');
    setBusy('password');
    try {
      await finish({ password });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not finish.');
      setBusy(null);
    }
  }

  if (invite === null) return <section className="vs-card vs-narrow" aria-busy="true"><Spinner label="Checking your link" /></section>;
  if (invite === 'bad') {
    return (
      <section className="vs-card vs-narrow">
        <h1 className="vs-title">This link will not work</h1>
        <p className="vs-lede">It may have expired or already been used. Ask a portal administrator to send you a new one.</p>
      </section>
    );
  }

  const showPassword = usePassword || !keys;
  return (
    <section className="vs-card vs-narrow" aria-labelledby="vs-join">
      <h1 id="vs-join" className="vs-title">
        {invite.kind === 'recovery' ? 'Set up a new sign-in' : 'Finish your account'}
      </h1>
      <p className="vs-lede">
        Signing in as <strong>{invite.email}</strong>
        {invite.department ? `, ${invite.department}` : ''}.
      </p>

      <Field label="Your name">{(id) => <input id={id} type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />}</Field>

      {keys && (
        <>
          <button type="button" className="vs-btn vs-btn-primary vs-block" onClick={withPasskey} disabled={busy !== null}>
            {busy === 'key' ? <Spinner label="Waiting for your passkey" /> : <KeyRound size={17} aria-hidden="true" />} Create a passkey
          </button>
          <p className="vs-hint">Sign in with your fingerprint, face or device PIN. Nothing to remember. Recommended.</p>
        </>
      )}

      {keys && !usePassword && (
        <button type="button" className="vs-link" onClick={() => setUsePassword(true)}>
          Use a password instead
        </button>
      )}

      {showPassword && (
        <form onSubmit={withPassword} noValidate>
          <Field label="Choose a password" hint={`At least ${invite.minPassword} characters.`}>
            {(id) => <input id={id} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
          </Field>
          <Field label="Type it again">{(id) => <input id={id} type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />}</Field>
          <button type="submit" className={`vs-btn ${keys ? 'vs-btn-quiet' : 'vs-btn-primary'} vs-block`} disabled={busy !== null}>
            {busy === 'password' && <Spinner label="Saving" />} Create account
          </button>
        </form>
      )}
      <Alert>{error}</Alert>
    </section>
  );
}
