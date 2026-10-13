import { useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, Pencil, Plus, RotateCcw, Search, Trash2 } from 'lucide-react';
import { useJson } from '../api';
import { ALSO_FUNDED, CATEGORIES, alsoFunded, editOf, money, plansFrom, type AlsoFunded, type Plan, type PlanProps, type ProjectsContent } from '../construction';
import { StaffError, staff } from './api';
import { Alert, Field } from './ui';
import { useStaffData } from './useStaff';
import {
  ABOUT_MAX,
  ALSO_MAX,
  NAME_MAX,
  charsLeft,
  checkAlso,
  checkDraft,
  draftOf,
  editFrom,
  matches,
  moveItem,
  squash,
  withAlso,
  withItem,
  withPlan,
  withoutItem,
  withoutPlans,
  type AlsoDraft,
  type ProjectDraft,
} from './projectsLib';

interface Stored {
  value: ProjectsContent | null;
  updatedAt: string | null;
}

type Plans = { features: Array<{ properties?: PlanProps | null; geometry?: object | null }> };

const CONFLICT = 'Someone else saved a change a moment ago, so yours was not saved. The list now shows their version. Open the project again and make your change on top of it.';
const WAIT = 'Wait for the last save to finish, then try again.';

/** Puts focus back on a control after the thing that held it closed or moved, so a keyboard or screen reader user keeps their place. */
const refocus = (el: HTMLElement | null) => {
  if (el) requestAnimationFrame(() => el.focus());
};

function PlanForm({
  p,
  edited,
  busy,
  onSave,
  onOriginal,
  onCancel,
}: {
  p: Plan;
  edited: boolean;
  busy: boolean;
  onSave: (d: ProjectDraft) => Promise<void>;
  onOriginal: () => Promise<void>;
  onCancel: () => void;
}) {
  const [d, setD] = useState<ProjectDraft>(() => draftOf(p));
  const [error, setError] = useState('');
  const set = <K extends keyof ProjectDraft>(k: K, v: ProjectDraft[K]) => setD((x) => ({ ...x, [k]: v }));

  async function run(fn: () => Promise<void>) {
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    }
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    const problem = checkDraft(d);
    if (problem) return setError(problem);
    void run(() => onSave(d));
  }

  return (
    <form className="vs-edit" onSubmit={submit} noValidate aria-label={`Change ${p.name}`}>
      <Field label="Name in the project list" hint="The map label keeps the city's own name for this project.">
        {(id) => <input id={id} autoComplete="off" value={d.name} maxLength={NAME_MAX + 20} onChange={(e) => set('name', e.target.value)} />}
      </Field>
      <Field label="Group">
        {(id) => (
          <select id={id} value={d.category} onChange={(e) => set('category', e.target.value as ProjectDraft['category'])}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Description" hint={`${charsLeft(d.about, ABOUT_MAX)}. State what it is and where it stands. Leave it blank to use the original description.`}>
        {(id) => <textarea id={id} rows={5} value={d.about} onChange={(e) => set('about', e.target.value)} />}
      </Field>
      <Alert>{error}</Alert>
      <div className="vs-actions">
        <button type="submit" className="vs-btn vs-btn-primary" disabled={busy}>
          Save
        </button>
        {edited && (
          <button type="button" className="vs-btn vs-btn-quiet" disabled={busy} onClick={() => void run(onOriginal)}>
            <RotateCcw size={14} aria-hidden="true" /> Use original wording
          </button>
        )}
        <button type="button" className="vs-btn vs-btn-quiet" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function PlanRow({
  p,
  hidden,
  edited,
  busy,
  onSave,
  onOriginal,
}: {
  p: Plan;
  hidden: boolean;
  edited: boolean;
  busy: boolean;
  onSave: (d: ProjectDraft) => Promise<void>;
  onOriginal: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const editBtn = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    refocus(editBtn.current);
  };
  return (
    <li className="vs-person" hidden={hidden}>
      <div className="vs-row">
        <div className="vs-row-main">
          <p className="vs-row-title">
            {p.name}
            <span className="vs-badge" data-tone="off">
              {p.category}
            </span>
            {edited && (
              <span className="vs-badge" data-tone="off">
                Edited
              </span>
            )}
            {!p.about && (
              <span className="vs-badge" data-tone="wait">
                No description
              </span>
            )}
          </p>
          <p className="vs-row-sub">{[p.stage, p.budget ? `${money(p.budget)} in the FY 2027 budget` : ''].filter(Boolean).join(' · ')}</p>
          <p className="vs-row-sub">{p.about ?? 'No description yet.'}</p>
        </div>
      </div>
      <div className="vs-actions">
        <button
          type="button"
          ref={editBtn}
          className="vs-btn vs-btn-small vs-btn-quiet"
          onClick={() => (open ? close() : setOpen(true))}
          aria-expanded={open}
          aria-label={`${open ? 'Close' : 'Edit'} ${p.name}`}
        >
          <Pencil size={14} aria-hidden="true" /> {open ? 'Close' : 'Edit'}
        </button>
      </div>
      {open && (
        <PlanForm
          p={p}
          edited={edited}
          busy={busy}
          onSave={async (d) => {
            await onSave(d);
            close();
          }}
          onOriginal={async () => {
            await onOriginal();
            close();
          }}
          onCancel={close}
        />
      )}
    </li>
  );
}

function AlsoForm({ draft, submitLabel, busy, onSubmit, onCancel }: { draft: AlsoDraft; submitLabel: string; busy: boolean; onSubmit: (d: AlsoDraft) => Promise<void>; onCancel: () => void }) {
  const [d, setD] = useState<AlsoDraft>(draft);
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = checkAlso(d);
    if (problem) return setError(problem);
    setError('');
    try {
      await onSubmit(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    }
  }
  return (
    <form className="vs-edit" onSubmit={submit} noValidate aria-label={draft.name ? `Change ${draft.name}` : 'Add a funded project'}>
      <Field label="Project name">{(id) => <input id={id} autoComplete="off" value={d.name} maxLength={NAME_MAX + 20} onChange={(e) => setD({ ...d, name: e.target.value })} />}</Field>
      <Field label="Description" hint={`Optional. ${charsLeft(d.about, ABOUT_MAX)}.`}>
        {(id) => <textarea id={id} rows={4} value={d.about} onChange={(e) => setD({ ...d, about: e.target.value })} />}
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

function AlsoRow({
  a,
  index,
  last,
  busy,
  onChange,
  onRemove,
  onMove,
}: {
  a: AlsoFunded;
  index: number;
  last: boolean;
  busy: boolean;
  onChange: (index: number, d: AlsoDraft) => Promise<void>;
  onRemove: (index: number) => Promise<void>;
  onMove: (index: number, by: -1 | 1) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const editBtn = useRef<HTMLButtonElement>(null);
  async function run(fn: () => Promise<void>) {
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change that.');
      setConfirm(false);
    }
  }
  const stopEditing = () => {
    setEditing(false);
    refocus(editBtn.current);
  };
  const move = (by: -1 | 1) =>
    void run(async () => {
      await onMove(index, by);
      refocus(editBtn.current);
    });
  return (
    <li className="vs-person">
      <div className="vs-row">
        <div className="vs-row-main">
          <p className="vs-row-title">{a.name}</p>
          <p className="vs-row-sub">{a.about || 'No description.'}</p>
        </div>
      </div>
      <div className="vs-actions">
        <button
          type="button"
          ref={editBtn}
          className="vs-btn vs-btn-small vs-btn-quiet"
          onClick={() => (editing ? stopEditing() : setEditing(true))}
          aria-expanded={editing}
          aria-label={`${editing ? 'Close' : 'Edit'} ${a.name}`}
        >
          <Pencil size={14} aria-hidden="true" /> {editing ? 'Close' : 'Edit'}
        </button>
        <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" disabled={busy || index === 0} onClick={() => move(-1)} aria-label={`Move ${a.name} up`}>
          <ArrowUp size={14} aria-hidden="true" /> Up
        </button>
        <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" disabled={busy || last} onClick={() => move(1)} aria-label={`Move ${a.name} down`}>
          <ArrowDown size={14} aria-hidden="true" /> Down
        </button>
        {confirm ? (
          <>
            <button type="button" className="vs-btn vs-btn-small vs-btn-primary" disabled={busy} onClick={() => void run(() => onRemove(index))}>
              Yes, remove
            </button>
            <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" disabled={busy} onClick={() => setConfirm(false)}>
              Keep
            </button>
          </>
        ) : (
          <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" disabled={busy} onClick={() => setConfirm(true)} aria-label={`Remove ${a.name}`}>
            <Trash2 size={14} aria-hidden="true" /> Remove
          </button>
        )}
      </div>
      <Alert>{error}</Alert>
      {editing && (
        <AlsoForm
          draft={{ name: a.name, about: a.about }}
          submitLabel="Save"
          busy={busy}
          onCancel={stopEditing}
          onSubmit={async (d) => {
            await onChange(index, d);
            stopEditing();
          }}
        />
      )}
    </li>
  );
}

type Tab = 'map' | 'also';
type Filter = 'all' | 'none' | 'edited';

/** Map projects: the name, group and description of each funded project beside the map, and the list of projects not drawn on it. */
export default function Projects() {
  const stored = useStaffData<Stored>('/content/get?key=projects');
  const gis = useJson<Plans>('/api/map/layers/projects?page=0&v=5');
  // What was last saved from this screen; it wins over the page load until the next reload, so a save needs no refetch.
  const [local, setLocal] = useState<Stored | null>(null);
  const current: Stored | null = local ?? stored.data;
  const content = current?.value ?? null;

  const [tab, setTab] = useState<Tab>('map');
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  // The project just saved stays in view even when the change moves it out of the current filter, so focus and the reader keep their place.
  const [pinned, setPinned] = useState<string | null>(null);
  const show = (f: Filter) => {
    setFilter(f);
    setPinned(null);
  };
  const [adding, setAdding] = useState(false);
  const [confirmList, setConfirmList] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  // One save at a time: every control that saves is off while one is in flight, so a double tap can never send a stale copy.
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  // Goes up when someone else's save is found; every open form is rebuilt from the new list so nothing stale can be saved over it.
  const [revision, setRevision] = useState(0);
  const addBtn = useRef<HTMLButtonElement>(null);

  const plans = useMemo(() => (gis.status === 'done' ? plansFrom(gis.data, content) : []), [gis, content]);
  const edits = content?.plans ?? {};
  const noDescription = plans.filter((p) => !p.about).length;
  const editedCount = plans.filter((p) => editOf(content, p.gis)).length;
  const onMap = new Set(plans.map((p) => p.gis));
  // Edits for a project the city has since renamed or taken off its map: they cannot be seen in the list, so they get their own line.
  const orphans = gis.status === 'done' && plans.length > 0 ? Object.keys(edits).filter((k) => !onMap.has(k)) : [];
  const list = alsoFunded(content);

  /** Saves the new working copy (null: nothing left to store, so the original wording comes back). */
  async function commit(next: ProjectsContent | null): Promise<void> {
    if (savingRef.current) throw new Error(WAIT);
    savingRef.current = true;
    setSaving(true);
    setNotice('');
    setError('');
    try {
      if (next === null) {
        if (current?.value) await staff('/content/reset', { body: { key: 'projects', base: current.updatedAt } });
        setLocal({ value: null, updatedAt: null });
      } else {
        const r = await staff<{ value: ProjectsContent; updatedAt: string }>('/content/save', { body: { key: 'projects', value: next, base: current?.updatedAt ?? null } });
        setLocal({ value: r.value, updatedAt: r.updatedAt });
      }
    } catch (e) {
      if (e instanceof StaffError && e.status === 409) {
        setLocal(null);
        stored.reload();
        setAdding(false);
        setConfirmList(false);
        setRevision((r) => r + 1);
        setError(CONFLICT);
        throw new Error(CONFLICT, { cause: e });
      }
      throw e;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const saved = (what: string) => setNotice(`${what} Visitors see it within a minute.`);

  const shown = (p: Plan) => p.gis === pinned || (matches(p, q) && (filter === 'all' || (filter === 'none' ? !p.about : Boolean(editOf(content, p.gis)))));
  const visible = plans.filter(shown).length;

  return (
    <section className="vs-stack vs-stack-flow" aria-labelledby="vs-projects">
      <div>
        <h1 id="vs-projects" className="vs-title">
          Map projects
        </h1>
        <p className="vs-lede">
          Fix the name, group or description of a funded project on the map page. Changes reach the portal within a minute, and the original wording can be put back at any time.
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
        <button type="button" aria-pressed={tab === 'map'} onClick={() => setTab('map')}>
          On the map
        </button>
        <button type="button" aria-pressed={tab === 'also'} onClick={() => setTab('also')}>
          Also funded
        </button>
      </div>

      <Alert>{error}</Alert>
      {stored.error && (
        <div className="vs-stack">
          <Alert>{stored.error}</Alert>
          <div className="vs-actions">
            <button type="button" className="vs-btn vs-btn-quiet" onClick={stored.reload}>
              Try again
            </button>
          </div>
        </div>
      )}
      {!current && !stored.error && (
        <p className="vs-empty" role="status">
          Loading...
        </p>
      )}

      {current && (
        <div hidden={tab !== 'map'}>
          <div className="vs-seg vs-seg-fit" role="group" aria-label="Show">
            <button type="button" aria-pressed={filter === 'all'} onClick={() => show('all')}>
              All {plans.length || ''}
            </button>
            <button type="button" aria-pressed={filter === 'none'} onClick={() => show('none')}>
              No description {noDescription || ''}
            </button>
            <button type="button" aria-pressed={filter === 'edited'} onClick={() => show('edited')}>
              Edited {editedCount || ''}
            </button>
          </div>
          <div className="vs-search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              aria-label="Search projects"
              placeholder="Search by name, group or place"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPinned(null);
              }}
            />
          </div>
          {gis.status === 'loading' && (
            <p className="vs-empty" role="status">
              Loading the projects from the city's map...
            </p>
          )}
          {gis.status === 'error' && <p className="vs-empty">The project list from the city's map did not load. Reload this page to try again.</p>}
          {gis.status === 'done' && plans.length === 0 && <p className="vs-empty">The city's map returned no projects just now. Try again in a few minutes.</p>}
          {gis.status === 'done' && plans.length > 0 && visible === 0 && <p className="vs-empty">No project matches that.</p>}
          <ul className="vs-list">
            {plans.map((p) => (
              <PlanRow
                key={`${revision}:${p.key}`}
                p={p}
                hidden={!shown(p)}
                edited={Boolean(editOf(content, p.gis))}
                busy={saving}
                onSave={async (d) => {
                  const edit = editFrom(p.gis, d);
                  if (JSON.stringify(edit) === JSON.stringify(editOf(content, p.gis) ?? null)) {
                    setNotice(`Nothing changed in ${p.name}, so there was nothing to save.`);
                    return;
                  }
                  await commit(withPlan(content, p.gis, edit));
                  setPinned(p.gis);
                  saved(`Saved ${squash(d.name)}.`);
                }}
                onOriginal={async () => {
                  await commit(withPlan(content, p.gis, null));
                  setPinned(p.gis);
                  saved(`Put back the original wording for ${p.name}.`);
                }}
              />
            ))}
          </ul>
          {orphans.length > 0 && (
            <div className="vs-card vs-stack">
              <p className="vs-hint">
                {orphans.length === 1 ? 'One saved edit belongs to a project that is' : `${orphans.length} saved edits belong to projects that are`} no longer on the city's map under the same name.{' '}
                {orphans.length === 1 ? 'It does' : 'They do'} not show anywhere.
              </p>
              <div className="vs-actions">
                <button
                  type="button"
                  className="vs-btn vs-btn-small vs-btn-quiet"
                  disabled={saving}
                  onClick={() =>
                    void commit(withoutPlans(content, orphans))
                      .then(() => saved('Cleared the unused edits.'))
                      .catch((e: Error) => setError(e.message))
                  }
                >
                  Clear {orphans.length === 1 ? 'it' : 'them'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {current && (
        <div className="vs-stack" hidden={tab !== 'also'}>
          <p className="vs-hint">These projects are funded this year but are not drawn on the city's plan map. They are listed under the map projects on the map page.</p>
          <div className="vs-card vs-stack">
            <div className="vs-actions">
              <button type="button" ref={addBtn} className="vs-btn vs-btn-quiet" aria-expanded={adding} disabled={list.length >= ALSO_MAX && !adding} onClick={() => setAdding(!adding)}>
                <Plus size={16} aria-hidden="true" /> {adding ? 'Close' : 'Add a funded project'}
              </button>
            </div>
            {list.length >= ALSO_MAX && !adding && <p className="vs-hint">The list is full at {ALSO_MAX} projects. Remove one to add another.</p>}
            {adding && (
              <AlsoForm
                key={revision}
                draft={{ name: '', about: '' }}
                submitLabel="Add project"
                busy={saving}
                onCancel={() => {
                  setAdding(false);
                  refocus(addBtn.current);
                }}
                onSubmit={async (d) => {
                  await commit(withAlso(content, withItem(list, -1, d)));
                  setAdding(false);
                  refocus(addBtn.current);
                  saved(`Added ${squash(d.name)}.`);
                }}
              />
            )}
          </div>
          {list.length === 0 && <p className="vs-empty">No other funded projects are listed.</p>}
          <ul className="vs-list">
            {list.map((a, i) => (
              <AlsoRow
                key={`${revision}:${a.id}`}
                a={a}
                index={i}
                last={i === list.length - 1}
                busy={saving}
                onChange={async (index, d) => {
                  if (squash(d.name) === a.name && squash(d.about) === a.about) {
                    setNotice(`Nothing changed in ${a.name}, so there was nothing to save.`);
                    return;
                  }
                  await commit(withAlso(content, withItem(list, index, d)));
                  saved(`Saved ${squash(d.name)}.`);
                }}
                onRemove={async (index) => {
                  await commit(withAlso(content, withoutItem(list, index)));
                  refocus(addBtn.current);
                  saved(`Removed ${a.name}. You can undo it from Activity.`);
                }}
                onMove={async (index, by) => {
                  await commit(withAlso(content, moveItem(list, index, by)));
                  setNotice(`Moved ${a.name} ${by < 0 ? 'up' : 'down'}.`);
                }}
              />
            ))}
          </ul>
          {content?.also && (
            <div>
              {confirmList ? (
                <div className="vs-confirm">
                  <p className="vs-hint">This replaces the list above with the {ALSO_FUNDED.length} projects the portal shipped with. You can undo it from Activity.</p>
                  <div className="vs-actions">
                    <button
                      type="button"
                      className="vs-btn vs-btn-small vs-btn-primary"
                      disabled={saving}
                      onClick={() =>
                        void commit(withAlso(content, null))
                          .then(() => {
                            setConfirmList(false);
                            saved('Put back the original list.');
                          })
                          .catch((e: Error) => {
                            setConfirmList(false);
                            setError(e.message);
                          })
                      }
                    >
                      Yes, use the original list
                    </button>
                    <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" disabled={saving} onClick={() => setConfirmList(false)}>
                      Keep my list
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" disabled={saving} onClick={() => setConfirmList(true)}>
                  <RotateCcw size={14} aria-hidden="true" /> Use the original list
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
