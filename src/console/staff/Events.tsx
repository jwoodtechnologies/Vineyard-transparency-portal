import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ExternalLink, MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import { staff, when } from './api';
import { Alert, Field } from './ui';
import { day } from './recordsLib';
import { useStaffData } from './useStaff';
import { DESCRIPTION_MAX, bodyOf, checkEvent, draftOf, emptyEvent, whenOf, type EventCategory, type EventDraft, type EventItem, type EventsReply } from './eventsLib';

function EventForm({
  draft,
  categories,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  draft: EventDraft;
  categories: EventCategory[];
  submitLabel: string;
  onSubmit: (d: EventDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const [d, setD] = useState(draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = <K extends keyof EventDraft>(k: K, v: EventDraft[K]) => setD((x) => ({ ...x, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = checkEvent(d);
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
    <form className="vs-edit" onSubmit={submit} noValidate aria-label="Event">
      <Field label="Name of the event">
        {(id) => <input id={id} value={d.title} maxLength={120} placeholder="Harvest Festival" autoComplete="off" onChange={(e) => set('title', e.target.value)} />}
      </Field>
      <div className="vs-pair">
        <Field label="Date">{(id) => <input id={id} type="date" value={d.date} onChange={(e) => set('date', e.target.value)} />}</Field>
        <Field label="Last day" hint="Only for an event that runs more than one day.">
          {(id) => <input id={id} type="date" value={d.endDate} min={d.date || undefined} onChange={(e) => set('endDate', e.target.value)} />}
        </Field>
      </div>
      <label className="vs-check">
        <input type="checkbox" checked={d.allDay} onChange={(e) => set('allDay', e.target.checked)} />
        <span>All day</span>
      </label>
      {!d.allDay && (
        <div className="vs-pair vs-pair-tight">
          <Field label="Starts">{(id) => <input id={id} type="time" value={d.startTime} onChange={(e) => set('startTime', e.target.value)} />}</Field>
          <Field label="Ends" hint="Optional.">
            {(id) => <input id={id} type="time" value={d.endTime} onChange={(e) => set('endTime', e.target.value)} />}
          </Field>
        </div>
      )}
      <Field label="Type" hint="Groups the event on the calendar.">
        {(id) => (
          <select id={id} value={d.category} onChange={(e) => set('category', e.target.value)}>
            {categories.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Where" hint="Optional.">
        {(id) => <input id={id} value={d.location} maxLength={150} placeholder="Vineyard Town Center" autoComplete="off" onChange={(e) => set('location', e.target.value)} />}
      </Field>
      <Field label="Details" hint={`Optional. ${DESCRIPTION_MAX - d.description.length} characters left.`}>
        {(id) => <textarea id={id} value={d.description} maxLength={DESCRIPTION_MAX} onChange={(e) => set('description', e.target.value)} />}
      </Field>
      <Field label="Link" hint="Optional. A page with more detail. Without one, the event links to the city calendar.">
        {(id) => <input id={id} type="url" inputMode="url" autoComplete="off" value={d.url} placeholder="https://" onChange={(e) => set('url', e.target.value)} />}
      </Field>
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

function Row({ e, categories, onChanged, onNotice, onError }: { e: EventItem; categories: EventCategory[]; onChanged: () => void; onNotice: (s: string) => void; onError: (s: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const label = categories.find((c) => c.key === e.category)?.label ?? e.category;

  async function remove() {
    onError('');
    try {
      await staff('/events/remove', { body: { id: e.id } });
      onNotice('Removed. It is off the calendar. You can undo it from Activity.');
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not remove that.');
      setConfirm(false);
    }
  }

  return (
    <li className="vs-person" data-off={e.past}>
      <div className="vs-row">
        <div className="vs-row-main">
          <p className="vs-row-title">{e.title}</p>
          <p className="vs-row-sub">
            <span className="vs-badge" data-tone={e.past ? 'off' : undefined}>
              {e.past ? 'Past' : 'Upcoming'}
            </span>{' '}
            <span className="vs-badge" data-tone="off">
              {label}
            </span>
          </p>
          <p className="vs-row-sub">{whenOf(e, day)}</p>
          {e.location && (
            <p className="vs-row-sub">
              <MapPin size={13} aria-hidden="true" /> {e.location}
            </p>
          )}
          {e.url && (
            <p className="vs-row-sub">
              <ExternalLink size={13} aria-hidden="true" /> {e.url}
            </p>
          )}
          <p className="vs-row-sub">
            Added {when(e.updatedAt)}
            {e.createdBy ? ` by ${e.createdBy}` : ''}
          </p>
        </div>
      </div>
      <div className="vs-actions">
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
        <EventForm
          draft={draftOf(e)}
          categories={categories}
          submitLabel="Save"
          onCancel={() => setEditing(false)}
          onSubmit={async (d) => {
            await staff('/events/edit', { body: { id: e.id, ...bodyOf(d) } });
            setEditing(false);
            onNotice('Saved. The change is on the calendar now.');
            onChanged();
          }}
        />
      )}
    </li>
  );
}

/** Events: add a community event, a special meeting or a closure day to the portal's calendar. */
export default function Events() {
  const list = useStaffData<EventsReply>('/events/list');
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const banner = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (notice) banner.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [notice]);

  const items = list.data?.items ?? [];
  const categories = list.data?.categories ?? [];
  // Soonest first for what is coming; the list arrives newest first.
  const upcoming = items.filter((e) => !e.past).sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? '').localeCompare(b.startTime ?? ''));
  const past = items.filter((e) => e.past);
  const row = (e: EventItem) => <Row key={e.id} e={e} categories={categories} onNotice={setNotice} onError={setError} onChanged={list.reload} />;

  return (
    <section className="vs-stack" aria-labelledby="vs-events">
      <div>
        <h1 id="vs-events" className="vs-title">
          Events
        </h1>
        <p className="vs-lede">
          Add an event the city calendar does not list, such as a community gathering, a special meeting or a closure day. It shows on the portal calendar next to the city's own events.
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
            <Plus size={16} aria-hidden="true" /> {adding ? 'Close' : 'Add an event'}
          </button>
        </div>
        {adding && list.data && (
          <EventForm
            draft={emptyEvent(list.data.today)}
            categories={categories}
            submitLabel="Add event"
            onCancel={() => setAdding(false)}
            onSubmit={async (d) => {
              await staff('/events/add', { body: bodyOf(d) });
              setAdding(false);
              setNotice('Added. It is on the calendar now.');
              list.reload();
            }}
          />
        )}
      </div>

      <div>
        <Alert>{error || list.error}</Alert>
        {list.data && items.length === 0 && <p className="vs-empty">No events added yet.</p>}
        {upcoming.length > 0 && (
          <>
            <h2 className="vs-h2">Coming up</h2>
            <ul className="vs-list">{upcoming.map(row)}</ul>
          </>
        )}
        {past.length > 0 && (
          <>
            <h2 className="vs-h2">Past</h2>
            <ul className="vs-list">{past.map(row)}</ul>
          </>
        )}
      </div>
    </section>
  );
}
