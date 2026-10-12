import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { staff, when } from './api';
import { Alert, Field } from './ui';
import { day } from './recordsLib';
import { useStaffData } from './useStaff';
import { checkUpdate, detail, draftOf, emptyUpdate, type UpdateDraft, type UpdateItem, type UpdatesReply } from './updatesLib';

type Choices = Pick<UpdatesReply, 'projects' | 'topics'>;

function UpdateForm({
  draft,
  choices,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  draft: UpdateDraft;
  choices: Choices;
  submitLabel: string;
  onSubmit: (d: UpdateDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const [d, setD] = useState(draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = <K extends keyof UpdateDraft>(k: K, v: UpdateDraft[K]) => setD((x) => ({ ...x, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = checkUpdate(d);
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
    <form className="vs-edit" onSubmit={submit} noValidate aria-label="Update">
      <Field label="Update" hint="Plain words, as residents will read them. Include the date or time when it matters.">
        {(id) => (
          <textarea
            id={id}
            value={d.text}
            rows={5}
            placeholder="The new pickleball courts at Grove Park are open. All eight courts are lit until 10 pm."
            onChange={(e) => set('text', e.target.value)}
          />
        )}
      </Field>
      <Field label="Headline" hint="Optional. Without one, the first line is used.">
        {(id) => <input id={id} value={d.title} maxLength={200} autoComplete="off" onChange={(e) => set('title', e.target.value)} />}
      </Field>
      <div className="vs-pair">
        <Field label="Date">{(id) => <input id={id} type="date" value={d.date} onChange={(e) => set('date', e.target.value)} />}</Field>
        <Field label="About" hint="A project shows this update on its card under the map.">
          {(id) => (
            <select id={id} value={d.topic} onChange={(e) => set('topic', e.target.value)}>
              <option value="">Nothing in particular</option>
              <optgroup label="Funded projects">
                {choices.projects.map((p) => (
                  <option key={p.key} value={`project:${p.key}`}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Topics">
                {choices.topics.map((t) => (
                  <option key={t.id} value={`topic:${t.id}`}>
                    {t.label}
                  </option>
                ))}
              </optgroup>
            </select>
          )}
        </Field>
      </div>
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

function Row({ u, choices, onChanged, onNotice, onError }: { u: UpdateItem; choices: Choices; onChanged: () => void; onNotice: (s: string) => void; onError: (s: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);

  async function remove() {
    onError('');
    try {
      await staff('/updates/remove', { body: { id: u.id } });
      onNotice('Removed. It is off the portal and out of search. You can undo it from Activity.');
      onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not remove that.');
      setConfirm(false);
    }
  }

  return (
    <li className="vs-person">
      <div className="vs-row">
        <div className="vs-row-main">
          <p className="vs-row-title">{u.title}</p>
          <p className="vs-row-sub">
            {day(u.date)}
            {u.topicLabel ? ` · ${u.topicLabel.replace(/^(Project|Topic): /, '')}` : ''}
          </p>
          {detail(u.title, u.text) && <p className="vs-row-sub">{detail(u.title, u.text)}</p>}
          <p className="vs-row-sub">
            Posted {when(u.updatedAt)}
            {u.postedBy ? ` by ${u.postedBy}` : ''}
          </p>
        </div>
      </div>
      <div className="vs-actions">
        {u.documentId && (
          <Link className="vs-btn vs-btn-small vs-btn-quiet" to={`/documents/${u.documentId}`} target="_blank" rel="noopener">
            <ExternalLink size={14} aria-hidden="true" /> View
          </Link>
        )}
        <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" onClick={() => setEditing(!editing)} aria-expanded={editing}>
          <Pencil size={14} aria-hidden="true" /> {editing ? 'Close' : 'Edit'}
        </button>
        {confirm ? (
          <>
            <button type="button" className="vs-btn vs-btn-small vs-btn-primary" onClick={remove}>
              Yes, remove it
            </button>
            <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" onClick={() => setConfirm(false)}>
              Keep it
            </button>
          </>
        ) : (
          <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" onClick={() => setConfirm(true)}>
            <Trash2 size={14} aria-hidden="true" /> Remove
          </button>
        )}
      </div>
      {editing && (
        <UpdateForm
          draft={draftOf(u)}
          choices={choices}
          submitLabel="Save"
          onCancel={() => setEditing(false)}
          onSubmit={async (d) => {
            await staff('/updates/edit', { body: { id: u.id, ...d } });
            setEditing(false);
            onNotice('Saved. The change is on the portal now.');
            onChanged();
          }}
        />
      )}
    </li>
  );
}

/** Updates: a short note such as "We finished the 400 North signal", searchable and shown on a project's card. */
export default function Updates() {
  const list = useStaffData<UpdatesReply>('/updates/list');
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const banner = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (notice) banner.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [notice]);
  const choices: Choices = { projects: list.data?.projects ?? [], topics: list.data?.topics ?? [] };

  return (
    <section className="vs-stack" aria-labelledby="vs-updates">
      <div>
        <h1 id="vs-updates" className="vs-title">
          Updates
        </h1>
        <p className="vs-lede">
          Post a short note, such as a finished project or a change to a service. It becomes a record residents can find in search and the assistant can cite, and it shows on the project's card under
          the map.
        </p>
      </div>

      {notice && (
        <p className="vs-ok" role="status" ref={banner}>
          {notice}
        </p>
      )}

      <div className="vs-card vs-stack">
        <div className="vs-actions">
          <button
            type="button"
            className="vs-btn vs-btn-quiet"
            aria-expanded={adding}
            disabled={!list.data}
            onClick={() => {
              setAdding(!adding);
              setNotice('');
            }}
          >
            <Plus size={16} aria-hidden="true" /> {adding ? 'Close' : 'Post an update'}
          </button>
        </div>
        {adding && list.data && (
          <UpdateForm
            draft={emptyUpdate(list.data.today)}
            choices={choices}
            submitLabel="Post update"
            onCancel={() => setAdding(false)}
            onSubmit={async (d) => {
              await staff('/updates/add', { body: d });
              setAdding(false);
              setNotice('Posted. It is on the portal and in search now.');
              list.reload();
            }}
          />
        )}
      </div>

      <div>
        <Alert>{error || list.error}</Alert>
        {list.data && list.data.items.length === 0 && <p className="vs-empty">No updates posted yet.</p>}
        <ul className="vs-list">
          {list.data?.items.map((u) => (
            <Row key={u.id} u={u} choices={choices} onNotice={setNotice} onError={setError} onChanged={list.reload} />
          ))}
        </ul>
      </div>
    </section>
  );
}
