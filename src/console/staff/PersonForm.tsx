import { useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { Alert, Field } from './ui';
import { ELECTED_ROLES, KIND_CHOICES, checkPerson, type DirOptions, type PersonDraft, type PersonKind } from './directoryLib';

/** Add a person, or change one who is listed. The kind of person is chosen when adding and stays fixed after. */
export default function PersonForm({
  draft,
  options,
  adding,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  draft: PersonDraft;
  options: DirOptions;
  adding: boolean;
  submitLabel: string;
  onSubmit: (d: PersonDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const [d, setD] = useState<PersonDraft>(draft);
  const [other, setOther] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = <K extends keyof PersonDraft>(k: K, v: PersonDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const kind = d.kind;
  // Boards offered: the usual list, plus any this person already has that are not on it.
  const boardNames = [...options.boards, ...d.boards.filter((b) => !options.boards.includes(b))];
  const roles = d.role && !options.boardRoles.includes(d.role) ? [d.role, ...options.boardRoles] : options.boardRoles;

  function pickKind(k: PersonKind) {
    setD((x) => ({ ...x, kind: k, role: k === 'board' ? 'Member' : k === 'elected' ? 'Council Member' : '' }));
  }
  function toggleBoard(name: string) {
    setD((x) => ({ ...x, boards: x.boards.includes(name) ? x.boards.filter((b) => b !== name) : [...x.boards, name] }));
  }
  function addOther() {
    const n = other.replace(/\s+/g, ' ').trim();
    if (!n) return;
    setD((x) => (x.boards.some((b) => b.toLowerCase() === n.toLowerCase()) ? x : { ...x, boards: [...x.boards, n] }));
    setOther('');
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = checkPerson(d, adding);
    if (problem) return setError(problem);
    setBusy(true);
    setError('');
    try {
      await onSubmit(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
      setBusy(false);
    }
  }

  return (
    <form className="vs-edit" onSubmit={submit} noValidate aria-label={adding ? 'Add a person' : `Change ${draft.name}`}>
      {adding && (
        <fieldset className="vs-field vs-choice">
          <legend>Who are you adding?</legend>
          <div className="vs-seg" role="radiogroup" aria-label="Who are you adding?">
            {KIND_CHOICES.map((c) => (
              <button key={c.value} type="button" role="radio" aria-checked={kind === c.value} aria-pressed={kind === c.value} onClick={() => pickKind(c.value)}>
                {c.label}
              </button>
            ))}
          </div>
          <p className="vs-hint">{KIND_CHOICES.find((c) => c.value === kind)?.hint}</p>
        </fieldset>
      )}

      {adding || kind !== 'elected' ? (
        <Field label="Full name" hint={adding ? undefined : 'Photos still come from the city website.'}>
          {(id) => <input id={id} autoComplete="off" value={d.name} maxLength={80} onChange={(e) => set('name', e.target.value)} />}
        </Field>
      ) : (
        <Field label="Name" hint="A council member's name is how their votes are found in the minutes, so it is not changed here.">
          {(id) => <input id={id} value={d.name} readOnly aria-readonly="true" />}
        </Field>
      )}

      {kind === 'elected' && (
        <Field label="Role">
          {(id) => (
            <select id={id} value={d.role} onChange={(e) => set('role', e.target.value)}>
              {ELECTED_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      {kind === 'staff' && (
        <>
          <Field label="Job title">{(id) => <input id={id} autoComplete="off" value={d.role} maxLength={80} onChange={(e) => set('role', e.target.value)} />}</Field>
          <Field label="Department" hint="Optional. Pick a department already on the portal or type a new one.">
            {(id) => (
              <>
                <input id={id} list={`${id}-list`} autoComplete="off" value={d.department} maxLength={80} onChange={(e) => set('department', e.target.value)} />
                <datalist id={`${id}-list`}>
                  {options.departments.map((x) => (
                    <option key={x} value={x} />
                  ))}
                </datalist>
              </>
            )}
          </Field>
        </>
      )}
      {kind === 'board' && (
        <>
          <Field label="Role on the board">
            {(id) => (
              <select id={id} value={d.role} onChange={(e) => set('role', e.target.value)}>
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <fieldset className="vs-areas">
            <legend>Boards</legend>
            {boardNames.map((b) => (
              <label key={b} className="vs-check">
                <input type="checkbox" checked={d.boards.includes(b)} onChange={() => toggleBoard(b)} />
                <span>{b}</span>
              </label>
            ))}
            <div className="vs-roll-add">
              <input
                aria-label="Add another board"
                placeholder="Add another board"
                value={other}
                maxLength={80}
                onChange={(e) => setOther(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addOther();
                  }
                }}
              />
              <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" onClick={addOther} disabled={!other.trim()}>
                <Plus size={14} aria-hidden="true" /> Add
              </button>
            </div>
          </fieldset>
        </>
      )}

      {kind !== 'staff' && (
        <Field label="Term" hint={kind === 'board' ? 'End with the year the term ends, for example “Term ends December 2028”. After that year they are no longer shown unless the minutes show them still serving.' : 'For example “January 2026 to January 2030”.'}>
          {(id) => <input id={id} autoComplete="off" value={d.term} maxLength={80} onChange={(e) => set('term', e.target.value)} />}
        </Field>
      )}
      {kind !== 'board' && (
        <>
          <Field label="Email">{(id) => <input id={id} type="email" autoComplete="off" inputMode="email" value={d.email} maxLength={120} onChange={(e) => set('email', e.target.value)} />}</Field>
          <Field label="Phone">{(id) => <input id={id} type="tel" autoComplete="off" inputMode="tel" value={d.phone} maxLength={40} onChange={(e) => set('phone', e.target.value)} />}</Field>
        </>
      )}
      <Alert>{error}</Alert>
      <div className="vs-actions">
        <button type="submit" className="vs-btn vs-btn-primary" disabled={busy}>
          {submitLabel}
        </button>
        <button type="button" className="vs-btn vs-btn-quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
