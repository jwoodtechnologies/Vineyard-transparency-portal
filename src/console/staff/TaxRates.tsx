/**
 * Property tax rates: the certified rate for each fiscal year that the chat quotes, each tied to the record that prints it.
 * Rates already in the portal's code stay; a rate entered here for the same fiscal year replaces it.
 */
import { useState, type FormEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Alert, Field } from './ui';
import { CONFLICT, usePiece } from './usePiece';

interface Rate {
  fiscalYear: number;
  rate: string;
  adopted: string;
  docId: string;
  docTitle: string;
  docKind: 'minutes' | 'resolution';
  page: number;
}

const idFrom = (s: string) => s.match(/doc_[0-9a-f]{16}/)?.[0] ?? null;
const long = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export default function TaxRates() {
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const piece = usePiece<{ rates: Rate[] }>('taxRates', () => setError(CONFLICT));
  const rates = piece.value?.rates ?? [];
  const now = new Date();
  const [year, setYear] = useState(String(now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear()));
  const [rate, setRate] = useState('');
  const [adopted, setAdopted] = useState('');
  const [link, setLink] = useState('');
  const [page, setPage] = useState('');
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  async function add(e: FormEvent) {
    e.preventDefault();
    setFormError('');
    const id = idFrom(link);
    if (!/^\d{4}$/.test(year)) return setFormError('Type the fiscal year, for example 2027.');
    if (!/^0?\.\d{3,8}$/.test(rate.trim())) return setFormError('Type the rate as the record prints it, for example 0.003796.');
    if (!adopted) return setFormError('Choose the date the council adopted it.');
    if (!id) return setFormError('Paste the portal link to the record that states the rate. Open the record on the portal and copy its address.');
    if (!/^\d+$/.test(page)) return setFormError('Give the page where the rate is printed.');
    setBusy(true);
    try {
      const res = await fetch(`/api/documents/${id}`);
      if (!res.ok) throw new Error('That record is not in the portal. Check the link.');
      const doc = (await res.json()) as { title: string; documentType: string };
      const next: Rate = {
        fiscalYear: Number(year),
        rate: rate.trim(),
        adopted,
        docId: id,
        docTitle: doc.title,
        docKind: doc.documentType === 'resolution' ? 'resolution' : 'minutes',
        page: Number(page),
      };
      await piece.commit({ rates: [next, ...rates.filter((r) => r.fiscalYear !== next.fiscalYear)] });
      setNotice(`Saved the fiscal ${next.fiscalYear} rate. The chat uses it within a minute.`);
      setRate('');
      setLink('');
      setPage('');
      setAdopted('');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(r: Rate) {
    setError('');
    try {
      const rest = rates.filter((x) => x.fiscalYear !== r.fiscalYear);
      await piece.commit(rest.length ? { rates: rest } : null);
      setNotice(`Removed the fiscal ${r.fiscalYear} rate. You can undo it from Activity.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove that.');
    }
  }

  return (
    <section className="vs-stack vs-stack-flow" aria-labelledby="vs-tax">
      <div>
        <h1 id="vs-tax" className="vs-title">
          Property tax rate
        </h1>
        <p className="vs-lede">
          When the council adopts a new certified tax rate, add it here with the record that prints it. The chat quotes the rate and links that record. A newer Utah County tax rate record in the
          portal is still used when it is for a later year.
        </p>
      </div>
      <div role="status" className="vs-sr">
        {notice}
      </div>
      {notice && (
        <p className="vs-ok vs-ok-sticky" aria-hidden="true">
          {notice}
        </p>
      )}
      <Alert>{error || piece.error}</Alert>
      <form className="vs-card vs-stack" onSubmit={add} noValidate aria-label="Add a tax rate">
        <h2 className="vs-h2">
          <Plus size={16} aria-hidden="true" /> Add a rate
        </h2>
        <Field label="Fiscal year" hint="The year it ends: the rate adopted in June 2026 is the fiscal 2027 rate.">
          {(id) => <input id={id} inputMode="numeric" autoComplete="off" value={year} onChange={(e) => setYear(e.target.value)} />}
        </Field>
        <Field label="Rate">{(id) => <input id={id} inputMode="decimal" autoComplete="off" placeholder="0.003796" value={rate} onChange={(e) => setRate(e.target.value)} />}</Field>
        <Field label="Date adopted">{(id) => <input id={id} type="date" value={adopted} onChange={(e) => setAdopted(e.target.value)} />}</Field>
        <Field label="Record that states it" hint="Open the minutes or resolution on the portal and paste its address here.">
          {(id) => <input id={id} type="url" inputMode="url" autoCapitalize="none" spellCheck={false} value={link} onChange={(e) => setLink(e.target.value)} />}
        </Field>
        <Field label="Page">{(id) => <input id={id} inputMode="numeric" autoComplete="off" value={page} onChange={(e) => setPage(e.target.value)} />}</Field>
        <Alert>{formError}</Alert>
        <div className="vs-actions">
          <button type="submit" className="vs-btn vs-btn-primary" disabled={busy || piece.saving}>
            Save the rate
          </button>
        </div>
      </form>
      <div>
        <h2 className="vs-h2">Entered by staff</h2>
        {piece.current && rates.length === 0 && <p className="vs-empty">None yet. The fiscal 2026 rate, 0.003796, is built in.</p>}
        <ul className="vs-list">
          {rates.map((r) => (
            <li key={r.fiscalYear} className="vs-person">
              <div className="vs-row">
                <div className="vs-row-main">
                  <p className="vs-row-title">
                    Fiscal {r.fiscalYear}: {r.rate}
                  </p>
                  <p className="vs-row-sub">
                    Adopted {long(r.adopted)} · <a href={`/documents/${r.docId}?page=${r.page}`}>{r.docTitle}</a>, page {r.page}
                  </p>
                </div>
              </div>
              <div className="vs-actions">
                <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" disabled={piece.saving} aria-label={`Remove the fiscal ${r.fiscalYear} rate`} onClick={() => void remove(r)}>
                  <Trash2 size={14} aria-hidden="true" /> Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
