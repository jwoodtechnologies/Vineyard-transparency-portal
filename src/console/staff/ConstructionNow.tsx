import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Eye, EyeOff, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useJson } from '../api';
import { WORK_LIMITS, workRows, type ConstructionContent, type GlanceTable, type WorkFields, type WorkRow } from '@/lib/constructionRows';
import { Alert, Field } from './ui';
import { CONFLICT, refocus, usePiece } from './usePiece';

type Draft = WorkFields & { name: string };

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const copy = (c: ConstructionContent | null): ConstructionContent => ({ edits: { ...(c?.edits ?? {}) }, hidden: [...(c?.hidden ?? [])], added: [...(c?.added ?? [])] });
const tidy = (c: ConstructionContent): ConstructionContent | null => (Object.keys(c.edits).length || c.hidden.length || c.added.length ? c : null);

function check(d: Draft, named: boolean): string {
  if (named && !squash(d.name)) return 'Give the project a name.';
  if (squash(d.name).length > WORK_LIMITS.name) return `Keep the name under ${WORK_LIMITS.name} characters.`;
  if (squash(d.where).length > WORK_LIMITS.where) return `Keep "Where" under ${WORK_LIMITS.where} characters.`;
  if (squash(d.work).length > WORK_LIMITS.work) return `Keep "The work" under ${WORK_LIMITS.work} characters.`;
  if (squash(d.status).length > WORK_LIMITS.status) return `Keep the status under ${WORK_LIMITS.status} characters.`;
  if (squash(d.expected).length > WORK_LIMITS.expected) return `Keep the expected finish under ${WORK_LIMITS.expected} characters.`;
  return '';
}

function WorkForm({
  draft,
  named,
  busy,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  draft: Draft;
  named: boolean;
  busy: boolean;
  submitLabel: string;
  onSubmit: (d: Draft) => Promise<void>;
  onCancel: () => void;
}) {
  const [d, setD] = useState(draft);
  const [error, setError] = useState('');
  const set = (k: keyof Draft, v: string) => {
    setD((x) => ({ ...x, [k]: v }));
    setError('');
  };
  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = check(d, named);
    if (problem) return setError(problem);
    try {
      await onSubmit(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    }
  }
  return (
    <form className="vs-edit" onSubmit={submit} noValidate aria-label={draft.name ? `Change ${draft.name}` : 'Add a project to Construction now'}>
      {named && <Field label="Project name">{(id) => <input id={id} autoComplete="off" value={d.name} onChange={(e) => set('name', e.target.value)} />}</Field>}
      <Field label="Where" hint="For example: 400 South between Main Street and Mill Road.">
        {(id) => <input id={id} autoComplete="off" value={d.where} onChange={(e) => set('where', e.target.value)} />}
      </Field>
      <Field label="The work" hint="What is being done and what drivers or neighbors should expect.">
        {(id) => <textarea id={id} rows={3} value={d.work} onChange={(e) => set('work', e.target.value)} />}
      </Field>
      <Field label="Status" hint="For example: Under construction, Starts November 3, Paused for winter.">
        {(id) => <input id={id} autoComplete="off" value={d.status} onChange={(e) => set('status', e.target.value)} />}
      </Field>
      <Field label="Expected finish" hint="For example: Spring 2027.">
        {(id) => <input id={id} autoComplete="off" value={d.expected} onChange={(e) => set('expected', e.target.value)} />}
      </Field>
      <Alert>{error}</Alert>
      <div className="vs-actions">
        <button type="submit" className="vs-btn vs-btn-primary" disabled={busy}>
          {submitLabel}
        </button>
        <button type="button" className="vs-btn vs-btn-quiet" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function Row({
  r,
  busy,
  onSave,
  onOriginal,
  onHide,
  onRemove,
}: {
  r: WorkRow;
  busy: boolean;
  onSave: (d: Draft) => Promise<void>;
  onOriginal: () => Promise<void>;
  onHide: (h: boolean) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const editBtn = useRef<HTMLButtonElement>(null);
  async function run(fn: () => Promise<void>) {
    setError('');
    try {
      await fn();
      refocus(editBtn.current);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change that.');
    }
    setConfirm(false);
  }
  const close = () => {
    setOpen(false);
    refocus(editBtn.current);
  };
  return (
    <li className="vs-person" data-off={r.hidden}>
      <div className="vs-row">
        <div className="vs-row-main">
          <p className="vs-row-title">
            {r.name}
            {!r.city && (
              <span className="vs-badge" data-tone="off">
                Added
              </span>
            )}
            {r.edited && (
              <span className="vs-badge" data-tone="off">
                Corrected
              </span>
            )}
            {r.hidden && (
              <span className="vs-badge" data-tone="wait">
                Hidden
              </span>
            )}
          </p>
          {r.where && <p className="vs-row-sub">{r.where}</p>}
          <p className="vs-row-sub">{[r.status, r.expected ? `Expected ${r.expected}` : ''].filter(Boolean).join(' · ') || 'No status yet.'}</p>
        </div>
      </div>
      <div className="vs-actions">
        <button
          type="button"
          ref={editBtn}
          className="vs-btn vs-btn-small vs-btn-quiet"
          aria-expanded={open}
          aria-label={`${open ? 'Close' : 'Edit'} ${r.name}`}
          onClick={() => (open ? close() : setOpen(true))}
        >
          <Pencil size={14} aria-hidden="true" /> {open ? 'Close' : 'Edit'}
        </button>
        <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" disabled={busy} aria-label={`${r.hidden ? 'Show' : 'Hide'} ${r.name}`} onClick={() => void run(() => onHide(!r.hidden))}>
          {r.hidden ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />} {r.hidden ? 'Show' : 'Hide'}
        </button>
        {r.edited && !open && (
          <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" disabled={busy} aria-label={`Use the city's wording for ${r.name}`} onClick={() => void run(onOriginal)}>
            <RotateCcw size={14} aria-hidden="true" /> City wording
          </button>
        )}
        {!r.city &&
          (confirm ? (
            <>
              <button type="button" className="vs-btn vs-btn-small vs-btn-primary" disabled={busy} onClick={() => void run(onRemove)}>
                Yes, remove
              </button>
              <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" onClick={() => setConfirm(false)}>
                Keep
              </button>
            </>
          ) : (
            <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" disabled={busy} aria-label={`Remove ${r.name}`} onClick={() => setConfirm(true)}>
              <Trash2 size={14} aria-hidden="true" /> Remove
            </button>
          ))}
      </div>
      <Alert>{error}</Alert>
      {open && (
        <WorkForm
          draft={{ name: r.name, where: r.where, work: r.work, status: r.status, expected: r.expected }}
          named={!r.city}
          busy={busy}
          submitLabel="Save"
          onCancel={close}
          onSubmit={async (d) => {
            await onSave(d);
            close();
          }}
        />
      )}
    </li>
  );
}

/** Construction now: the city's Construction Projects table, corrected and added to by staff. */
export default function ConstructionNow() {
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const piece = usePiece<ConstructionContent>('construction', () => {
    setRevision((r) => r + 1);
    setError(CONFLICT);
  });
  const page = useJson<{ available: boolean; city?: GlanceTable | null; asOf?: string | null }>('/api/construction');
  const [adding, setAdding] = useState(false);
  const addBtn = useRef<HTMLButtonElement>(null);
  const city = page.status === 'done' ? (page.data.city ?? null) : null;
  const rows = useMemo(() => workRows(city, piece.value), [city, piece.value]);

  async function save(next: ConstructionContent | null, what: string) {
    setError('');
    setNotice('');
    await piece.commit(next);
    setNotice(`${what} Visitors see it within a few minutes.`);
  }
  const fields = (d: Draft): WorkFields => ({ where: squash(d.where), work: squash(d.work), status: squash(d.status), expected: squash(d.expected) });

  return (
    <section className="vs-stack vs-stack-flow" aria-labelledby="vs-work">
      <div>
        <h1 id="vs-work" className="vs-title">
          Construction now
        </h1>
        <p className="vs-lede">
          The list of current construction beside the map. It starts from the city&apos;s Construction Projects page, read every five minutes. Add a project the page does not list yet, correct a row,
          or hide one that is finished.
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
      <Alert>{error}</Alert>
      {piece.error && (
        <div className="vs-stack">
          <Alert>{piece.error}</Alert>
          <div className="vs-actions">
            <button type="button" className="vs-btn vs-btn-quiet" onClick={piece.reload}>
              Try again
            </button>
          </div>
        </div>
      )}
      {!piece.current && !piece.error && (
        <p className="vs-empty" role="status">
          Loading...
        </p>
      )}
      {piece.current && (
        <>
          <div className="vs-card vs-stack">
            <div className="vs-actions">
              <button type="button" ref={addBtn} className="vs-btn vs-btn-quiet" aria-expanded={adding} onClick={() => setAdding(!adding)}>
                <Plus size={16} aria-hidden="true" /> {adding ? 'Close' : 'Add a project'}
              </button>
            </div>
            {adding && (
              <WorkForm
                key={revision}
                draft={{ name: '', where: '', work: '', status: '', expected: '' }}
                named
                busy={piece.saving}
                submitLabel="Add project"
                onCancel={() => {
                  setAdding(false);
                  refocus(addBtn.current);
                }}
                onSubmit={async (d) => {
                  const c = copy(piece.value);
                  c.added.push({ id: '', name: squash(d.name), ...fields(d) });
                  await save(c, `Added ${squash(d.name)}.`);
                  setAdding(false);
                  refocus(addBtn.current);
                }}
              />
            )}
          </div>
          {page.status === 'loading' && (
            <p className="vs-empty" role="status">
              Loading the city&apos;s page...
            </p>
          )}
          {page.status === 'done' && !city && <p className="vs-hint">The portal has not read a project table from the city&apos;s page yet. Projects you add still show.</p>}
          {rows.length === 0 && page.status !== 'loading' && <p className="vs-empty">Nothing is listed under Construction now.</p>}
          <ul className="vs-list">
            {rows.map((r) => (
              <Row
                key={`${revision}:${r.key}`}
                r={r}
                busy={piece.saving}
                onSave={async (d) => {
                  const c = copy(piece.value);
                  if (!r.city) {
                    c.added = c.added.map((a) => (a.id === r.key ? { ...a, name: squash(d.name), ...fields(d) } : a));
                    return save(c, `Saved ${squash(d.name)}.`);
                  }
                  const f = fields(d);
                  const edit: Partial<WorkFields> = {};
                  for (const k of Object.keys(f) as Array<keyof WorkFields>) if (f[k] !== (r.original?.[k] ?? '')) edit[k] = f[k];
                  if (Object.keys(edit).length) c.edits[r.key] = edit;
                  else delete c.edits[r.key];
                  if (JSON.stringify(c.edits[r.key] ?? null) === JSON.stringify(piece.value?.edits[r.key] ?? null)) return setNotice(`Nothing changed in ${r.name}, so there was nothing to save.`);
                  return save(tidy(c), `Saved ${r.name}.`);
                }}
                onOriginal={() => {
                  const c = copy(piece.value);
                  delete c.edits[r.key];
                  return save(tidy(c), `Put back the city's wording for ${r.name}.`);
                }}
                onHide={(h) => {
                  const c = copy(piece.value);
                  c.hidden = c.hidden.filter((x) => x !== r.key);
                  if (h) c.hidden.push(r.key);
                  return save(tidy(c), h ? `Hid ${r.name}.` : `${r.name} shows again.`);
                }}
                onRemove={async () => {
                  const c = copy(piece.value);
                  c.added = c.added.filter((a) => a.id !== r.key);
                  c.hidden = c.hidden.filter((x) => x !== r.key);
                  await save(tidy(c), `Removed ${r.name}. You can undo it from Activity.`);
                  refocus(addBtn.current);
                }}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
