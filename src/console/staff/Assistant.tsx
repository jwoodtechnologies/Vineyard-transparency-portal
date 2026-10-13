/**
 * "Tell us what changed": the staff assistant on the home screen. The person says what changed in plain words (and can attach
 * a file); the portal proposes ONE change as a card they can correct; nothing goes live until they press Publish, which uses
 * the same route, checks and activity log as the matching staff screen.
 */
import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Paperclip, Sparkles, X } from 'lucide-react';
import { rowKey, type ConstructionContent } from '@/lib/constructionRows';
import { StaffError, staff, staffUpload } from './api';
import { FILE_ACCEPT, MAX_FILE_BYTES, sizeLabel } from './recordsLib';
import { Alert, Field, Spinner } from './ui';

type Action = 'construction_add' | 'construction_change' | 'construction_hide' | 'notice' | 'event' | 'update' | 'record_note' | 'record_file';
interface Plan {
  action: Action;
  fields: Record<string, string>;
}

const TITLE: Record<Action, string> = {
  construction_add: 'Add to Construction now',
  construction_change: 'Change a project in Construction now',
  construction_hide: 'Take a project off Construction now',
  notice: 'Post a notice at the top of every page',
  event: 'Add an event to the calendar',
  update: 'Post an update',
  record_note: 'Add a text record',
  record_file: 'Add the file to Records',
};

const WHERE: Record<Action, { path: string; label: string }> = {
  construction_add: { path: '/staff/construction', label: 'Construction now' },
  construction_change: { path: '/staff/construction', label: 'Construction now' },
  construction_hide: { path: '/staff/construction', label: 'Construction now' },
  notice: { path: '/staff/notices', label: 'Notices' },
  event: { path: '/staff/events', label: 'Events' },
  update: { path: '/staff/updates', label: 'Updates' },
  record_note: { path: '/staff/records', label: 'Records' },
  record_file: { path: '/staff/records', label: 'Records' },
};

/** The fields shown for each action, in order, with labels and how to edit them. */
const FIELDS: Record<Action, Array<{ key: string; label: string; kind?: 'text' | 'area' | 'date' | 'time' | 'select'; options?: Array<[string, string]>; readOnly?: boolean }>> = {
  construction_add: [
    { key: 'name', label: 'Project name' },
    { key: 'where', label: 'Where' },
    { key: 'work', label: 'The work', kind: 'area' },
    { key: 'status', label: 'Status' },
    { key: 'expected', label: 'Expected finish' },
  ],
  construction_change: [
    { key: 'project', label: 'Project', readOnly: true },
    { key: 'where', label: 'Where' },
    { key: 'work', label: 'The work', kind: 'area' },
    { key: 'status', label: 'Status' },
    { key: 'expected', label: 'Expected finish' },
  ],
  construction_hide: [{ key: 'project', label: 'Project', readOnly: true }],
  notice: [
    { key: 'message', label: 'Message', kind: 'area' },
    {
      key: 'tone',
      label: 'Style',
      kind: 'select',
      options: [
        ['info', 'Information'],
        ['alert', 'Alert'],
      ],
    },
    { key: 'startsOn', label: 'First day', kind: 'date' },
    { key: 'endsOn', label: 'Last day', kind: 'date' },
  ],
  event: [
    { key: 'title', label: 'Title' },
    { key: 'date', label: 'Date', kind: 'date' },
    { key: 'startTime', label: 'Starts', kind: 'time' },
    { key: 'endTime', label: 'Ends', kind: 'time' },
    { key: 'location', label: 'Where' },
    { key: 'description', label: 'Details', kind: 'area' },
  ],
  update: [
    { key: 'title', label: 'Title' },
    { key: 'text', label: 'Update', kind: 'area' },
  ],
  record_note: [
    { key: 'title', label: 'Title' },
    { key: 'text', label: 'Text', kind: 'area' },
    { key: 'date', label: 'Date', kind: 'date' },
  ],
  record_file: [
    { key: 'title', label: 'Title' },
    {
      key: 'type',
      label: 'Type',
      kind: 'select',
      options: [
        ['agenda', 'Agenda'],
        ['minutes', 'Minutes'],
        ['ordinance', 'Ordinance'],
        ['resolution', 'Resolution'],
        ['contract', 'Contract'],
        ['bid_award', 'Bid award'],
        ['staff_report', 'Staff report'],
        ['budget', 'Budget'],
        ['notice', 'Public notice'],
        ['other', 'Other'],
      ],
    },
    { key: 'date', label: 'Date of the document', kind: 'date' },
  ],
};

/** Makes the change the card describes, through the route the matching screen uses. */
async function publish(plan: Plan, file: File | null): Promise<string> {
  const f = plan.fields;
  switch (plan.action) {
    case 'construction_add':
    case 'construction_change':
    case 'construction_hide': {
      const cur = await staff<{ value: ConstructionContent | null; updatedAt: string | null }>('/content/get?key=construction');
      const c: ConstructionContent = { edits: { ...(cur.value?.edits ?? {}) }, hidden: [...(cur.value?.hidden ?? [])], added: [...(cur.value?.added ?? [])] };
      const work = { where: f.where ?? '', work: f.work ?? '', status: f.status ?? '', expected: f.expected ?? '' };
      if (plan.action === 'construction_add') c.added.push({ id: '', name: f.name ?? '', ...work });
      else {
        const mine = c.added.find((a) => a.name.toLowerCase() === (f.project ?? '').toLowerCase());
        if (plan.action === 'construction_hide') c.hidden.push(mine ? mine.id : rowKey(f.project ?? ''));
        else if (mine) Object.assign(mine, Object.fromEntries(Object.entries(work).filter(([, v]) => v)));
        else c.edits[rowKey(f.project ?? '')] = { ...(c.edits[rowKey(f.project ?? '')] ?? {}), ...Object.fromEntries(Object.entries(work).filter(([, v]) => v)) };
      }
      await staff('/content/save', { body: { key: 'construction', value: c, base: cur.updatedAt } });
      return 'It is on Construction now. Visitors see it within a few minutes.';
    }
    case 'notice':
      await staff('/notices/add', { body: { message: f.message, tone: f.tone === 'alert' ? 'alert' : 'info', startsOn: f.startsOn || null, endsOn: f.endsOn || null } });
      return 'The notice is live at the top of every page.';
    case 'event':
      await staff('/events/add', {
        body: { title: f.title, date: f.date, startTime: f.startTime || '', endTime: f.endTime || '', allDay: !f.startTime, location: f.location || '', description: f.description || '' },
      });
      return 'The event is on the public calendar.';
    case 'update':
      await staff('/updates/add', { body: { title: f.title || '', text: f.text } });
      return 'The update is posted.';
    case 'record_note':
      await staff('/records/note', { body: { title: f.title || '', text: f.text, date: f.date || '' } });
      return 'The record is added. It is searchable in a minute or two.';
    case 'record_file': {
      if (!file) throw new Error('Attach the file again, then publish.');
      const form = new FormData();
      form.append('file', file);
      form.append('type', f.type || 'other');
      if (f.title) form.append('title', f.title);
      if (f.date) form.append('date', f.date);
      await staffUpload('/records/file', form);
      return 'The file is added to Records. It is searchable once it has been read, usually within a few minutes.';
    }
  }
}

export default function Assistant() {
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ text: string; where: { path: string; label: string } } | null>(null);
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  function reset() {
    setPlan(null);
    setMessage('');
    setError('');
  }

  async function prepare(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!text.trim() && !file) return setError('Say what changed, or attach a file.');
    reset();
    setDone(null);
    setBusy(true);
    try {
      const r = await staff<{ plan: Plan | null; message: string }>('/assist/plan', { body: { text, fileName: file?.name ?? '' } });
      setPlan(r.plan);
      setMessage(r.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not prepare that.');
    } finally {
      setBusy(false);
    }
  }

  async function go() {
    if (!plan || busy) return;
    setBusy(true);
    setError('');
    try {
      const said = await publish(plan, file);
      setDone({ text: said, where: WHERE[plan.action] });
      setPlan(null);
      setMessage('');
      setText('');
      setFile(null);
    } catch (err) {
      setError(
        err instanceof StaffError && err.status === 409
          ? 'Someone else saved a change to that list a moment ago. Press Publish again.'
          : err instanceof Error
            ? err.message
            : 'Could not publish that.',
      );
    } finally {
      setBusy(false);
    }
  }

  const set = (k: string, v: string) => setPlan((p) => (p ? { ...p, fields: { ...p.fields, [k]: v } } : p));

  return (
    <div className="vs-card vs-stack vs-assist">
      <form className="vs-stack" onSubmit={prepare} noValidate aria-label="Tell us what changed">
        <Field
          label="Tell us what changed"
          hint='For example: "Add the 400 South waterline to Construction now. It starts November 3 and should finish in spring 2027." Nothing goes live until you check it and press Publish.'
        >
          {(id) => <textarea id={id} ref={box} rows={3} value={text} onChange={(e) => setText(e.target.value)} />}
        </Field>
        <input
          ref={picker}
          className="vs-sr"
          type="file"
          accept={FILE_ACCEPT}
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            e.target.value = '';
            if (f && f.size > MAX_FILE_BYTES) return setError(`That file is ${sizeLabel(f.size)}. Files up to ${sizeLabel(MAX_FILE_BYTES)} can be added.`);
            setFile(f);
            setError('');
          }}
        />
        {file && (
          <p className="vs-assist-file">
            <Paperclip size={14} aria-hidden="true" /> {file.name} <span className="vs-row-sub">{sizeLabel(file.size)}</span>
            <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" aria-label={`Remove the file ${file.name}`} onClick={() => setFile(null)}>
              <X size={14} aria-hidden="true" />
            </button>
          </p>
        )}
        <div className="vs-actions">
          <button type="submit" className="vs-btn vs-btn-primary" disabled={busy}>
            {busy && !plan ? <Spinner /> : <Sparkles size={16} aria-hidden="true" />} Prepare
          </button>
          <button type="button" className="vs-btn vs-btn-quiet" onClick={() => picker.current?.click()}>
            <Paperclip size={16} aria-hidden="true" /> {file ? 'Change file' : 'Attach a file'}
          </button>
        </div>
      </form>

      <div role="status" className="vs-sr">
        {done?.text ?? (plan ? `Ready to check: ${TITLE[plan.action]}` : message)}
      </div>
      <Alert>{error}</Alert>
      {!plan && message && <p className="vs-hint">{message}</p>}
      {done && (
        <p className="vs-ok">
          {done.text} <Link to={done.where.path}>Open {done.where.label}</Link> to see or undo it.
        </p>
      )}

      {plan && (
        <section className="vs-assist-plan" aria-label="Check before publishing">
          <h2 className="vs-h2">{TITLE[plan.action]}</h2>
          {message && <p className="vs-hint">{message}</p>}
          {FIELDS[plan.action].map((d) => (
            <Field key={d.key} label={d.label}>
              {(id) =>
                d.readOnly ? (
                  <input id={id} value={plan.fields[d.key] ?? ''} readOnly />
                ) : d.kind === 'area' ? (
                  <textarea id={id} rows={3} value={plan.fields[d.key] ?? ''} onChange={(e) => set(d.key, e.target.value)} />
                ) : d.kind === 'select' ? (
                  <select id={id} value={plan.fields[d.key] ?? d.options![0][0]} onChange={(e) => set(d.key, e.target.value)}>
                    {d.options!.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input id={id} type={d.kind === 'date' ? 'date' : d.kind === 'time' ? 'time' : 'text'} value={plan.fields[d.key] ?? ''} onChange={(e) => set(d.key, e.target.value)} />
                )
              }
            </Field>
          ))}
          {plan.action === 'record_file' && file && <p className="vs-hint">File: {file.name}</p>}
          <div className="vs-actions">
            <button type="button" className="vs-btn vs-btn-primary" disabled={busy} onClick={() => void go()}>
              {busy ? <Spinner /> : null} Publish
            </button>
            <button
              type="button"
              className="vs-btn vs-btn-quiet"
              disabled={busy}
              onClick={() => {
                reset();
                box.current?.focus();
              }}
            >
              Start over
            </button>
          </div>
          <p className="vs-hint">This uses the same checks as the {WHERE[plan.action].label} screen, and it shows in Activity.</p>
        </section>
      )}
    </div>
  );
}
