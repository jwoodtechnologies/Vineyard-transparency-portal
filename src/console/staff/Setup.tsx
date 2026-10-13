import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { staff } from './api';
import { proofs } from './useStaff';
import { Alert, Field, PasswordInput, Spinner } from './ui';
import Join from './Join';

/** The very first owner account, opened with the existing portal owner email and password. */
export default function Setup({ open }: { open: boolean }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    proofs.warm();
  }, []);

  if (token) return <Join token={token} />;
  if (!open) {
    return (
      <section className="vs-card vs-narrow">
        <h1 className="vs-title">Setup is finished</h1>
        <p className="vs-lede">
          The owner account already exists. <Link to="/staff">Sign in</Link>.
        </p>
      </section>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password) return setError(!email.trim() ? 'Enter the owner email address.' : 'Enter the owner password.');
    setBusy(true);
    try {
      const r = await staff<{ token: string }>('/bootstrap', { body: { email, password, pow: await proofs.take() } });
      setToken(r.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start setup.');
      setBusy(false);
    }
  }

  return (
    <section className="vs-card vs-narrow" aria-labelledby="vs-setup">
      <h1 id="vs-setup" className="vs-title">
        Create the owner account
      </h1>
      <p className="vs-lede">
        Enter the email and password of the portal owner, the same ones used for the private activity page. Next you will choose a passkey or password for your own staff sign-in and save your recovery
        codes. This only works once.
      </p>
      <form onSubmit={submit} noValidate>
        <Field label="Owner email">{(id) => <input id={id} type="email" autoComplete="username" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <Field label="Owner password">{(id) => <PasswordInput id={id} autoComplete="current-password" value={password} onChange={setPassword} />}</Field>
        <Alert>{error}</Alert>
        <button type="submit" className="vs-btn vs-btn-primary vs-block" disabled={busy}>
          {busy && <Spinner label="Checking" />} Continue
        </button>
      </form>
    </section>
  );
}
