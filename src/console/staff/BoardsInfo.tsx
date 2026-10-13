/**
 * Board details: what each board or commission does, when it meets, and where to apply, shown on the public Boards page.
 * Members still come from People and boards; meetings come from the city's agenda portal.
 */
import { useRef, useState, type FormEvent } from 'react';
import { Pencil } from 'lucide-react';
import { useJson } from '../api';
import { Alert, Field } from './ui';
import { CONFLICT, refocus, usePiece } from './usePiece';

interface Info {
  about?: string;
  schedule?: string;
  applyUrl?: string;
}
type Content = { boards: Record<string, Info> };

function Row({ id, name, info, busy, onSave }: { id: string; name: string; info: Info; busy: boolean; onSave: (next: Info) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [about, setAbout] = useState(info.about ?? '');
  const [schedule, setSchedule] = useState(info.schedule ?? '');
  const [apply, setApply] = useState(info.applyUrl ?? '');
  const [error, setError] = useState('');
  const btn = useRef<HTMLButtonElement>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (about.length > 400) return setError('Keep "What it does" under 400 characters.');
    try {
      await onSave({ ...(about.trim() ? { about: about.trim() } : {}), ...(schedule.trim() ? { schedule: schedule.trim() } : {}), ...(apply.trim() ? { applyUrl: apply.trim() } : {}) });
      setOpen(false);
      refocus(btn.current);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    }
  }
  return (
    <li className="vs-person">
      <div className="vs-row">
        <div className="vs-row-main">
          <p className="vs-row-title">{name}</p>
          <p className="vs-row-sub">{[info.schedule ? `Meets ${info.schedule}` : '', info.about ? 'Description added' : 'No description yet'].filter(Boolean).join(' · ')}</p>
        </div>
      </div>
      <div className="vs-actions">
        <button type="button" ref={btn} className="vs-btn vs-btn-small vs-btn-quiet" aria-expanded={open} aria-label={`${open ? 'Close' : 'Edit'} ${name}`} onClick={() => setOpen(!open)}>
          <Pencil size={14} aria-hidden="true" /> {open ? 'Close' : 'Edit'}
        </button>
      </div>
      {open && (
        <form className="vs-edit" onSubmit={submit} noValidate aria-label={`Details of ${name}`} data-board={id}>
          <Field label="What it does" hint="One or two plain sentences, for example: Reviews site plans and zoning requests and makes recommendations to the City Council.">
            {(fid) => <textarea id={fid} rows={3} value={about} onChange={(e) => setAbout(e.target.value)} />}
          </Field>
          <Field label="When it meets" hint="For example: the second Tuesday of each month at 6 p.m.">
            {(fid) => <input id={fid} autoComplete="off" value={schedule} onChange={(e) => setSchedule(e.target.value)} />}
          </Field>
          <Field label="Where to apply" hint="Optional. The full address of the application form.">
            {(fid) => <input id={fid} type="url" inputMode="url" autoCapitalize="none" spellCheck={false} value={apply} onChange={(e) => setApply(e.target.value)} />}
          </Field>
          <Alert>{error}</Alert>
          <div className="vs-actions">
            <button type="submit" className="vs-btn vs-btn-primary" disabled={busy}>
              Save
            </button>
            <button type="button" className="vs-btn vs-btn-quiet" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </li>
  );
}

export default function BoardsInfo() {
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const piece = usePiece<Content>('boards', () => setError(CONFLICT));
  const list = useJson<{ boards: Array<{ id: string; name: string }> }>('/api/boards');
  const boards = piece.value?.boards ?? {};
  return (
    <section className="vs-stack vs-stack-flow" aria-labelledby="vs-boards">
      <div>
        <h1 id="vs-boards" className="vs-title">
          Board details
        </h1>
        <p className="vs-lede">What each board and commission does, when it meets, and where to apply. It shows on the public Boards page. Members are kept under People and boards.</p>
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
      {list.status === 'loading' && (
        <p className="vs-empty" role="status">
          Loading...
        </p>
      )}
      <ul className="vs-list">
        {list.status === 'done' &&
          piece.current &&
          list.data.boards.map((b) => (
            <Row
              key={`${b.id}:${JSON.stringify(boards[b.id] ?? {})}`}
              id={b.id}
              name={b.name}
              info={boards[b.id] ?? {}}
              busy={piece.saving}
              onSave={async (next) => {
                setError('');
                const all = { ...boards };
                if (Object.keys(next).length) all[b.id] = next;
                else delete all[b.id];
                await piece.commit(Object.keys(all).length ? { boards: all } : null);
                setNotice(`Saved ${b.name}. The Boards page shows it within a few minutes.`);
              }}
            />
          ))}
      </ul>
    </section>
  );
}
