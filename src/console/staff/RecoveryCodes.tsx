import { useState } from 'react';
import { Check, Copy, Download, Printer } from 'lucide-react';
import { Alert } from './ui';

/**
 * A sheet of single-use recovery codes, shown once. A code gets a person back in when they have lost their
 * passkey and forgotten their password, so it is treated like a spare key: save it, print it, keep it private.
 */
export default function RecoveryCodes({ codes, email, onDone, doneLabel = 'Continue' }: { codes: string[]; email: string; onDone: () => void; doneLabel?: string }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const sheet = `Vineyard Transparency Portal staff recovery codes\nAccount: ${email}\n\nEach code works once. Keep this somewhere private.\n\n${codes.join('\n')}\n`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setCopied(true);
      setError('');
    } catch {
      setCopied(false);
      setError('Copy did not work here. Select the codes and copy them by hand, or use Download.');
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([sheet], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'vineyard-portal-recovery-codes.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setError('');
  }

  function done() {
    if (!saved) return setError('Tick the box once you have saved the codes. They are not shown again.');
    onDone();
  }

  return (
    <section className="vs-card vs-narrow vs-codes-card" aria-labelledby="vs-codes">
      <h1 id="vs-codes" className="vs-title">
        Save your recovery codes
      </h1>
      <p className="vs-lede">If you ever lose your passkey or forget your password, one of these codes gets you back in without asking anyone. Each code works once. They are shown only now.</p>
      <div className="vs-codes-sheet">
        <p className="vs-codes-head">
          Vineyard Transparency Portal recovery codes for <strong>{email}</strong>
        </p>
        <ol className="vs-codes" aria-label="Recovery codes">
          {codes.map((c) => (
            <li key={c}>
              <code>{c}</code>
            </li>
          ))}
        </ol>
      </div>
      <div className="vs-actions">
        <button type="button" className="vs-btn vs-btn-quiet vs-btn-small" onClick={copy}>
          {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />} {copied ? 'Copied' : 'Copy all'}
        </button>
        <button type="button" className="vs-btn vs-btn-quiet vs-btn-small" onClick={download}>
          <Download size={15} aria-hidden="true" /> Download
        </button>
        <button type="button" className="vs-btn vs-btn-quiet vs-btn-small" onClick={() => window.print()}>
          <Printer size={15} aria-hidden="true" /> Print
        </button>
      </div>
      <label className="vs-check vs-codes-ack">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        <span>I saved these codes somewhere safe, like a password manager.</span>
      </label>
      <Alert>{error}</Alert>
      <button type="button" className="vs-btn vs-btn-primary vs-block" onClick={done}>
        {doneLabel}
      </button>
    </section>
  );
}
