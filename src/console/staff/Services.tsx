import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Eye, EyeOff, Pencil, Plus, RotateCcw, Search, Trash2 } from 'lucide-react';
import {
  ADDED_KINDS,
  DIRECTORY_GROUPS,
  EDITABLE_LINKS,
  LINKS,
  contactsFrom,
  isPhoneLink,
  safeHref,
  serviceRows,
  type AddedKind,
  type ContactsContent,
  type LinkKey,
  type ServiceRow,
  type ServicesContent,
} from '@/lib/cityServices';
import { StaffError, staff } from './api';
import { Alert, Field } from './ui';
import { useStaffData } from './useStaff';
import {
  addedFrom,
  checkContact,
  checkService,
  contactDraftOf,
  contactEditFrom,
  hostOf,
  serviceEditFrom,
  withAdded,
  withContactEdit,
  withContactHidden,
  withHidden,
  withServiceEdit,
  withoutAdded,
  type ContactDraft,
  type ServiceDraft,
} from './servicesLib';

interface Stored<T> {
  value: T | null;
  updatedAt: string | null;
}

const CONFLICT = 'Someone else saved a change a moment ago, so yours was not saved. The list now shows their version. Make your change again on top of it.';
const WAIT = 'Wait for the last save to finish, then try again.';
const KIND_LABEL: Record<AddedKind, string> = { page: 'A web page', form: 'A form or application', pay: 'A payment page', map: 'A map' };

const refocus = (el: HTMLElement | null) => {
  if (el) requestAnimationFrame(() => el.focus());
};

/** One stored piece of site wording: the copy on screen, and a save that runs one at a time and spots someone else's save. */
function usePiece<T>(key: string, onConflict: () => void) {
  const stored = useStaffData<Stored<T>>(`/content/get?key=${key}`);
  const [local, setLocal] = useState<Stored<T> | null>(null);
  const current = local ?? stored.data;
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  async function commit(next: T | null): Promise<void> {
    if (lock.current) throw new Error(WAIT);
    lock.current = true;
    setSaving(true);
    try {
      if (next === null) {
        if (current?.value) await staff('/content/reset', { body: { key, base: current.updatedAt } });
        setLocal({ value: null, updatedAt: null });
      } else {
        const r = await staff<{ value: T; updatedAt: string }>('/content/save', { body: { key, value: next, base: current?.updatedAt ?? null } });
        setLocal({ value: r.value, updatedAt: r.updatedAt });
      }
    } catch (e) {
      if (e instanceof StaffError && e.status === 409) {
        setLocal(null);
        stored.reload();
        onConflict();
        throw new Error(CONFLICT, { cause: e });
      }
      throw e;
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }
  return { current, value: current?.value ?? null, error: stored.error, reload: stored.reload, saving, commit };
}

function ServiceForm({
  draft,
  added,
  busy,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  draft: ServiceDraft;
  added: boolean;
  busy: boolean;
  submitLabel: string;
  onSubmit: (d: ServiceDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const [d, setD] = useState(draft);
  const [error, setError] = useState('');
  const set = <K extends keyof ServiceDraft>(k: K, v: ServiceDraft[K]) => {
    setD((x) => ({ ...x, [k]: v }));
    setError('');
  };
  const testable = safeHref(d.href);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = checkService(d);
    if (problem) return setError(problem);
    setError('');
    try {
      await onSubmit(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    }
  }
  return (
    <form className="vs-edit" onSubmit={submit} noValidate aria-label={draft.label ? `Change ${draft.label}` : 'Add a service link'}>
      <Field label="Name">{(id) => <input id={id} autoComplete="off" value={d.label} onChange={(e) => set('label', e.target.value)} />}</Field>
      <Field label="Short note" hint="Optional. Shown under the name, for example: Fillable form for the City Recorder.">
        {(id) => <input id={id} autoComplete="off" value={d.hint} onChange={(e) => set('hint', e.target.value)} />}
      </Field>
      <Field label="Web address" hint="The page or form it opens. Paste the full address.">
        {(id) => <input id={id} type="url" inputMode="url" autoComplete="off" autoCapitalize="none" spellCheck={false} value={d.href} onChange={(e) => set('href', e.target.value)} />}
      </Field>
      {testable && (
        <p className="vs-hint vs-testlink">
          <a href={testable} target="_blank" rel="noopener noreferrer">
            Test this link
          </a>{' '}
          (opens in a new tab)
        </p>
      )}
      <Field label="Group">
        {(id) => (
          <select id={id} value={d.group} onChange={(e) => set('group', e.target.value as ServiceDraft['group'])}>
            {DIRECTORY_GROUPS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        )}
      </Field>
      {added && (
        <Field label="What it is">
          {(id) => (
            <select id={id} value={d.kind} onChange={(e) => set('kind', e.target.value as AddedKind)}>
              {ADDED_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      <Field label="Words that find it" hint="Optional. Separate with commas, for example: dog license, pet license. When a resident's question uses one, this link shows under the answer.">
        {(id) => <input id={id} autoComplete="off" value={d.words} onChange={(e) => set('words', e.target.value)} />}
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

const draftOfRow = (r: ServiceRow): ServiceDraft => ({
  label: r.entry.label,
  hint: r.entry.hint ?? '',
  href: r.entry.href,
  group: r.entry.group,
  kind: (r.entry.kind as AddedKind) ?? 'page',
  words: r.words.join(', '),
});

function ServiceRowView({
  r,
  hidden,
  busy,
  onSave,
  onOriginal,
  onHide,
  onRemove,
}: {
  r: ServiceRow;
  hidden: boolean;
  busy: boolean;
  onSave: (d: ServiceDraft) => Promise<void>;
  onOriginal: () => Promise<void>;
  onHide: (hidden: boolean) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const editBtn = useRef<HTMLButtonElement>(null);
  const name = r.entry.label;
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
    <li className="vs-person" data-off={r.hidden} hidden={hidden}>
      <div className="vs-row">
        <div className="vs-row-main">
          <p className="vs-row-title">
            {name}
            {r.added && (
              <span className="vs-badge" data-tone="off">
                Added
              </span>
            )}
            {r.edited && (
              <span className="vs-badge" data-tone="off">
                Edited
              </span>
            )}
            {r.hidden && (
              <span className="vs-badge" data-tone="wait">
                Hidden
              </span>
            )}
          </p>
          <p className="vs-row-sub">{[r.entry.hint, hostOf(r.entry.href)].filter(Boolean).join(' · ')}</p>
        </div>
      </div>
      <div className="vs-actions">
        <button
          type="button"
          ref={editBtn}
          className="vs-btn vs-btn-small vs-btn-quiet"
          aria-expanded={open}
          aria-label={`${open ? 'Close' : 'Edit'} ${name}`}
          onClick={() => (open ? close() : setOpen(true))}
        >
          <Pencil size={14} aria-hidden="true" /> {open ? 'Close' : 'Edit'}
        </button>
        <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" disabled={busy} aria-label={`${r.hidden ? 'Show' : 'Hide'} ${name}`} onClick={() => void run(() => onHide(!r.hidden))}>
          {r.hidden ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />} {r.hidden ? 'Show' : 'Hide'}
        </button>
        {r.edited && !open && (
          <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" disabled={busy} aria-label={`Use the original wording for ${name}`} onClick={() => void run(onOriginal)}>
            <RotateCcw size={14} aria-hidden="true" /> Original
          </button>
        )}
        {r.added &&
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
            <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" disabled={busy} aria-label={`Remove ${name}`} onClick={() => setConfirm(true)}>
              <Trash2 size={14} aria-hidden="true" /> Remove
            </button>
          ))}
      </div>
      <Alert>{error}</Alert>
      {open && (
        <ServiceForm
          draft={draftOfRow(r)}
          added={r.added}
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

function ContactForm({ k, draft, busy, onSubmit, onCancel }: { k: LinkKey; draft: ContactDraft; busy: boolean; onSubmit: (d: ContactDraft) => Promise<void>; onCancel: () => void }) {
  const [d, setD] = useState(draft);
  const [error, setError] = useState('');
  const phone = isPhoneLink(k);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = checkContact(k, d);
    if (problem) return setError(problem);
    setError('');
    try {
      await onSubmit(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    }
  }
  return (
    <form className="vs-edit" onSubmit={submit} noValidate aria-label={`Change ${draft.label}`}>
      <Field label="Name">{(id) => <input id={id} autoComplete="off" value={d.label} onChange={(e) => setD({ ...d, label: e.target.value })} />}</Field>
      {phone ? (
        <Field label="Phone number" hint="10 digits, like 801-226-1929. Tapping it calls this number.">
          {(id) => <input id={id} type="tel" inputMode="tel" autoComplete="off" value={d.phone} onChange={(e) => setD({ ...d, phone: e.target.value })} />}
        </Field>
      ) : (
        <>
          <Field label="Short note">{(id) => <input id={id} autoComplete="off" value={d.hint} onChange={(e) => setD({ ...d, hint: e.target.value })} />}</Field>
          <Field label="Web address">
            {(id) => <input id={id} type="url" inputMode="url" autoComplete="off" autoCapitalize="none" spellCheck={false} value={d.href} onChange={(e) => setD({ ...d, href: e.target.value })} />}
          </Field>
        </>
      )}
      <Alert>{error}</Alert>
      <div className="vs-actions">
        <button type="submit" className="vs-btn vs-btn-primary" disabled={busy}>
          Save
        </button>
        <button type="button" className="vs-btn vs-btn-quiet" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function ContactRow({
  k,
  content,
  busy,
  onCommit,
  onDone,
}: {
  k: LinkKey;
  content: ContactsContent | null;
  busy: boolean;
  onCommit: (next: ContactsContent | null) => Promise<void>;
  onDone: (what: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const editBtn = useRef<HTMLButtonElement>(null);
  const link = contactsFrom(content)[k];
  const edited = Boolean(content?.edits[k]);
  const hidden = Boolean(link.hidden);
  async function run(next: ContactsContent | null, what: string) {
    setError('');
    try {
      await onCommit(next);
      onDone(what);
      refocus(editBtn.current);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change that.');
    }
  }
  const close = () => {
    setOpen(false);
    refocus(editBtn.current);
  };
  return (
    <li className="vs-person" data-off={hidden}>
      <div className="vs-row">
        <div className="vs-row-main">
          <p className="vs-row-title">
            {link.label}
            {edited && (
              <span className="vs-badge" data-tone="off">
                Edited
              </span>
            )}
            {hidden && (
              <span className="vs-badge" data-tone="wait">
                Hidden
              </span>
            )}
          </p>
          <p className="vs-row-sub">{isPhoneLink(k) ? link.hint : [link.hint, hostOf(link.href)].filter(Boolean).join(' · ')}</p>
        </div>
      </div>
      <div className="vs-actions">
        <button
          type="button"
          ref={editBtn}
          className="vs-btn vs-btn-small vs-btn-quiet"
          aria-expanded={open}
          aria-label={`${open ? 'Close' : 'Edit'} ${link.label}`}
          onClick={() => (open ? close() : setOpen(true))}
        >
          <Pencil size={14} aria-hidden="true" /> {open ? 'Close' : 'Edit'}
        </button>
        <button
          type="button"
          className="vs-btn vs-btn-small vs-btn-quiet"
          disabled={busy}
          aria-label={`${hidden ? 'Show' : 'Hide'} ${link.label}`}
          onClick={() => void run(withContactHidden(content, k, !hidden), hidden ? `${link.label} shows again.` : `Hid ${link.label}.`)}
        >
          {hidden ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />} {hidden ? 'Show' : 'Hide'}
        </button>
        {edited && !open && (
          <button
            type="button"
            className="vs-btn vs-btn-small vs-btn-quiet"
            disabled={busy}
            aria-label={`Use the original for ${link.label}`}
            onClick={() => void run(withContactEdit(content, k, null), `Put back the original ${LINKS[k].label}.`)}
          >
            <RotateCcw size={14} aria-hidden="true" /> Original
          </button>
        )}
      </div>
      <Alert>{error}</Alert>
      {open && (
        <ContactForm
          k={k}
          draft={contactDraftOf(link)}
          busy={busy}
          onCancel={close}
          onSubmit={async (d) => {
            const edit = contactEditFrom(k, d);
            if (JSON.stringify(edit) !== JSON.stringify(content?.edits[k] ?? null)) {
              await onCommit(withContactEdit(content, k, edit));
              onDone(`Saved ${d.label.trim()}.`);
            }
            close();
          }}
        />
      )}
    </li>
  );
}

type Tab = 'services' | 'contacts';
type Filter = 'all' | 'edited' | 'hidden';

/** Service links: the buttons on the Services page and under answers, and the phone numbers and quick links. */
export default function Services() {
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const conflict = () => {
    setRevision((r) => r + 1);
    setError(CONFLICT);
  };
  const svc = usePiece<ServicesContent>('services', conflict);
  const con = usePiece<ContactsContent>('contacts', conflict);
  const [tab, setTab] = useState<Tab>('services');
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const addBtn = useRef<HTMLButtonElement>(null);
  const busy = svc.saving || con.saving;

  const rows = useMemo(() => serviceRows(svc.value), [svc.value]);
  const needle = q.trim().toLowerCase();
  const shown = (r: ServiceRow) =>
    (!needle || `${r.entry.label} ${r.entry.hint ?? ''} ${r.entry.href} ${r.words.join(' ')}`.toLowerCase().includes(needle)) &&
    (filter === 'all' || (filter === 'edited' ? r.edited || r.added : r.hidden));
  const visible = rows.filter(shown);
  const done = (what: string) => setNotice(`${what} Visitors see it within a minute.`);
  async function save(next: ServicesContent | null, what: string) {
    setError('');
    setNotice('');
    await svc.commit(next);
    done(what);
  }

  return (
    <section className="vs-stack vs-stack-flow" aria-labelledby="vs-services">
      <div>
        <h1 id="vs-services" className="vs-title">
          Service links
        </h1>
        <p className="vs-lede">
          The buttons on the Services page and under answers, and the city phone numbers. Fix a name or address, hide one, or add a new service. The original list can be put back at any time.
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

      <div className="vs-seg" role="group" aria-label="Which list">
        <button type="button" aria-pressed={tab === 'services'} onClick={() => setTab('services')}>
          Services
        </button>
        <button type="button" aria-pressed={tab === 'contacts'} onClick={() => setTab('contacts')}>
          Phones and links
        </button>
      </div>

      <Alert>{error}</Alert>
      {(svc.error || con.error) && (
        <div className="vs-stack">
          <Alert>{svc.error || con.error}</Alert>
          <div className="vs-actions">
            <button
              type="button"
              className="vs-btn vs-btn-quiet"
              onClick={() => {
                svc.reload();
                con.reload();
              }}
            >
              Try again
            </button>
          </div>
        </div>
      )}
      {(!svc.current || !con.current) && !svc.error && !con.error && (
        <p className="vs-empty" role="status">
          Loading...
        </p>
      )}

      {svc.current && (
        <div hidden={tab !== 'services'}>
          <div className="vs-card vs-stack">
            <div className="vs-actions">
              <button type="button" ref={addBtn} className="vs-btn vs-btn-quiet" aria-expanded={adding} onClick={() => setAdding(!adding)}>
                <Plus size={16} aria-hidden="true" /> {adding ? 'Close' : 'Add a service link'}
              </button>
            </div>
            {adding && (
              <ServiceForm
                key={revision}
                draft={{ label: '', hint: '', href: '', group: DIRECTORY_GROUPS[0], kind: 'page', words: '' }}
                added
                busy={busy}
                submitLabel="Add service"
                onCancel={() => {
                  setAdding(false);
                  refocus(addBtn.current);
                }}
                onSubmit={async (d) => {
                  await save(withAdded(svc.value, addedFrom(d)), `Added ${d.label.trim()}.`);
                  setAdding(false);
                  refocus(addBtn.current);
                }}
              />
            )}
          </div>
          <div className="vs-seg vs-seg-fit" role="group" aria-label="Show">
            <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
              All {rows.length}
            </button>
            <button type="button" aria-pressed={filter === 'edited'} onClick={() => setFilter('edited')}>
              Changed {rows.filter((r) => r.edited || r.added).length || ''}
            </button>
            <button type="button" aria-pressed={filter === 'hidden'} onClick={() => setFilter('hidden')}>
              Hidden {rows.filter((r) => r.hidden).length || ''}
            </button>
          </div>
          <div className="vs-search">
            <Search size={16} aria-hidden="true" />
            <input type="search" aria-label="Search service links" placeholder="Search by name, note or address" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {visible.length === 0 && <p className="vs-empty">No service matches that.</p>}
          {DIRECTORY_GROUPS.map((g) => {
            const list = rows.filter((r) => r.entry.group === g);
            const any = list.some(shown);
            return (
              <div key={`${revision}:${g}`} hidden={!any}>
                <h2 className="vs-h2">{g}</h2>
                <ul className="vs-list">
                  {list.map((r) => (
                    <ServiceRowView
                      key={r.entry.id}
                      hidden={!shown(r)}
                      r={r}
                      busy={busy}
                      onSave={async (d) => {
                        if (r.added) return save(withAdded(svc.value, addedFrom(d, r.entry.id)), `Saved ${d.label.trim()}.`);
                        const edit = serviceEditFrom(r.entry.id, d);
                        if (JSON.stringify(edit) === JSON.stringify(svc.value?.edits[r.entry.id] ?? null)) return setNotice(`Nothing changed in ${r.entry.label}, so there was nothing to save.`);
                        return save(withServiceEdit(svc.value, r.entry.id, edit), `Saved ${d.label.trim()}.`);
                      }}
                      onOriginal={() => save(withServiceEdit(svc.value, r.entry.id, null), `Put back the original wording for ${r.builtIn?.label ?? r.entry.label}.`)}
                      onHide={(hide) => save(withHidden(svc.value, r.entry.id, hide), hide ? `Hid ${r.entry.label}.` : `${r.entry.label} shows again.`)}
                      onRemove={async () => {
                        await save(withoutAdded(svc.value, r.entry.id), `Removed ${r.entry.label}. You can undo it from Activity.`);
                        refocus(addBtn.current);
                      }}
                    />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      {con.current && (
        <div className="vs-stack" hidden={tab !== 'contacts'}>
          <p className="vs-hint">These show as buttons under answers. City Hall&apos;s number is also used on staff cards and in the assistant&apos;s answers.</p>
          <ul className="vs-list">
            {EDITABLE_LINKS.map((k) => (
              <ContactRow
                key={`${revision}:${k}`}
                k={k}
                content={con.value}
                busy={busy}
                onCommit={async (next) => {
                  setError('');
                  setNotice('');
                  await con.commit(next);
                }}
                onDone={done}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
