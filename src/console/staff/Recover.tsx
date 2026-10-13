import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { staff } from './api';
import { proofs } from './useStaff';
import { Alert, Field, Spinner } from './ui';
import Join from './Join';

/** Lost a passkey and forgot the password: a recovery code opens the same "set up a new sign-in" step. */
export default function Recover() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [trap, setTrap] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    proofs.warm();
  }, []);

  if (token) return <Join token={token} />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!email.trim()) return setError('Enter your work email address.');
    if (code.replace(/[^A-Za-z0-9]/g, '').length < 16) return setError('Enter one of your 16 character recovery codes.');
    setBusy(true);
    try {
      const r = await staff<{ token: string }>('/recover', { body: { email, code, website: trap, pow: await proofs.take() } });
      setToken(r.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not recover the account.');
      setBusy(false);
    }
  }

  return (
    <section className="vs-card vs-narrow" aria-labelledby="vs-recover">
      <h1 id="vs-recover" className="vs-title">
        Recover your account
      </h1>
      <p className="vs-lede">Enter your work email and one of the recovery codes you saved when you set up your account. You will then choose a new passkey or password. Each code works once.</p>
      <form onSubmit={submit} noValidate>
        <Field label="Email">{(id) => <input id={id} type="email" autoComplete="username" inputMode="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <Field label="Recovery code" hint="Looks like K7QM-4XWD-9TZC-2HNR. Capitals and dashes do not matter.">
          {(id) => (
            <input
              id={id}
              className="vs-code-input"
              type="text"
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          )}
        </Field>
        <div className="vs-trap" aria-hidden="true">
          <label>
            Website
            <input type="text" tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} />
          </label>
        </div>
        <Alert>{error}</Alert>
        <button type="submit" className="vs-btn vs-btn-primary vs-block" disabled={busy}>
          {busy && <Spinner label="Checking" />} Continue
        </button>
      </form>
      <p className="vs-small">
        No codes saved? Ask a portal administrator to reset your sign-in and send you a new link. <Link to="/staff">Back to sign in</Link>.
      </p>
    </section>
  );
}
