import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { Eye, EyeOff, ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react';
import { staff, when } from './api';
import { Alert, Field } from './ui';
import { day } from './recordsLib';
import { useStaffData } from './useStaff';
import {
  DEFAULT_KINDS,
  EMPTY_NOTICE,
  KIND_COLOR,
  MESSAGE_MAX,
  PLACE_TITLE_MAX,
  SHAPE_LABEL,
  STATUS_LABEL,
  checkNotice,
  draftOf,
  noticeBody,
  whenLine,
  whereLine,
  type NoticeDraft,
  type NoticeItem,
  type NoticeKind,
  type Shape,
} from './noticesLib';

// The map code is large and only needed when someone places a notice on the map.
const PlacePicker = lazy(() => import('./PlacePicker'));

function NoticeForm({
  draft,
  kinds,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  draft: NoticeDraft;
  kinds: NoticeKind[];
  submitLabel: string;
  onSubmit: (d: NoticeDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const [d, setD] = useState(draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = <K extends keyof NoticeDraft>(k: K, v: NoticeDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const left = MESSAGE_MAX - d.message.length;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = checkNotice(d);
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
    <form className="vs-edit" onSubmit={submit} noValidate aria-label="Notice">
      <Field label="Notice" hint={left >= 0 ? `${left} characters left. Keep it short${d.onBar ? ': it shows at the top of every page' : ''}.` : `${-left} characters too many.`}>
        {(id) => <textarea id={id} value={d.message} onChange={(e) => set('message', e.target.value)} placeholder="City Hall is closed Monday, October 12." />}
      </Field>
      <fieldset className="vs-field">
        <legend>Where it shows</legend>
        <label className="vs-check">
          <input type="checkbox" checked={d.onBar} onChange={(e) => set('onBar', e.target.checked)} /> At the top of every page
        </label>
        <label className="vs-check">
          <input type="checkbox" checked={d.onMap} onChange={(e) => set('onMap', e.target.checked)} /> On the map, such as a road closure or detour
        </label>
      </fieldset>
      {d.onMap && (
        <div className="vs-mapbox">
          <Field label="Name on the map" hint={`Short, such as "Main Street closed". ${PLACE_TITLE_MAX - d.placeTitle.length} characters left.`}>
            {(id) => <input id={id} value={d.placeTitle} maxLength={PLACE_TITLE_MAX} placeholder="Main Street closed" onChange={(e) => set('placeTitle', e.target.value)} />}
          </Field>
          <Field label="What it is">
            {(id) => (
              <select id={id} value={d.placeKind} onChange={(e) => set('placeKind', e.target.value)}>
                {kinds.map((k) => (
                  <option key={k.key} value={k.key}>
                    {k.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <fieldset className="vs-field vs-choice">
            <legend>Marked as</legend>
            <div className="vs-seg" role="radiogroup" aria-label="Marked as">
              {(['Point', 'LineString', 'Polygon'] as Shape[]).map((sh) => (
                <button
                  key={sh}
                  type="button"
                  role="radio"
                  aria-checked={d.shape === sh}
                  aria-pressed={d.shape === sh}
                  onClick={() => setD((x) => ({ ...x, shape: sh, points: sh === 'Point' ? x.points.slice(0, 1) : x.points }))}
                >
                  {SHAPE_LABEL[sh]}
                </button>
              ))}
            </div>
          </fieldset>
          <Suspense fallback={<p className="vs-hint">Loading the map...</p>}>
            <PlacePicker shape={d.shape} points={d.points} color={KIND_COLOR[d.placeKind] ?? KIND_COLOR.other} onChange={(points) => set('points', points)} />
          </Suspense>
        </div>
      )}
      {d.onBar && (
        <fieldset className="vs-field vs-choice">
          <legend>Style</legend>
          <div className="vs-seg" role="radiogroup" aria-label="Style">
            {(['info', 'alert'] as const).map((t) => (
              <button key={t} type="button" role="radio" aria-checked={d.tone === t} aria-pressed={d.tone === t} onClick={() => set('tone', t)}>
                {t === 'info' ? 'Information' : 'Alert'}
              </button>
            ))}
          </div>
          <p className="vs-hint">{d.tone === 'alert' ? 'A warm color, shown before other notices. Use it for closures and changes that affect plans.' : 'A quiet color for general news.'}</p>
        </fieldset>
      )}
      <Field label="Link" hint="Optional. A page with more detail.">
        {(id) => <input id={id} type="url" inputMode="url" autoComplete="off" value={d.linkUrl} placeholder="https://" onChange={(e) => set('linkUrl', e.target.value)} />}
      </Field>
      {d.linkUrl.trim() && (
        <Field label="Link wording">{(id) => <input id={id} value={d.linkLabel} maxLength={40} placeholder="Learn more" onChange={(e) => set('linkLabel', e.target.value)} />}</Field>
      )}
      <div className="vs-pair">
        <Field label="First day" hint="Optional. Blank means now.">
          {(id) => <input id={id} type="date" value={d.startsOn} onChange={(e) => set('startsOn', e.target.value)} />}
        </Field>
        <Field label="Last day" hint="Optional. Blank means until you hide it.">
          {(id) => <input id={id} type="date" value={d.endsOn} onChange={(e) => set('endsOn', e.target.value)} />}
        </Field>
      </div>
      {d.onBar && d.message.trim() && (
        <div className="vs-preview" data-tone={d.tone} aria-label="How it will look">
          <span>{d.message.replace(/\s+/g, ' ').trim()}</span>
          {d.linkUrl.trim() && <strong>{d.linkLabel.trim() || 'Learn more'}</strong>}
        </div>
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

function Row({ n, kinds, onChanged, onNotice, onError }: { n: NoticeItem; kinds: NoticeKind[]; onChanged: () => void; onNotice: (s: string) => void; onError: (s: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);

  async function run(fn: () => Promise<unknown>, ok: string) {
    onError('');
    try {
      await fn();
      onNotice(ok);
      setConfirm(false);
      onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not change that.');
      setConfirm(false);
    }
  }

  return (
    <li className="vs-person" data-off={n.status === 'hidden' || n.status === 'ended'}>
      <div className="vs-row">
        <div className="vs-row-main">
          <p className="vs-row-title">{n.message}</p>
          <p className="vs-row-sub">
            <span className="vs-badge" data-tone={n.status === 'showing' ? undefined : n.status === 'scheduled' ? 'wait' : 'off'}>
              {STATUS_LABEL[n.status]}
            </span>{' '}
            {n.tone === 'alert' && (
              <span className="vs-badge" data-tone="wait">
                Alert
              </span>
            )}
          </p>
          <p className="vs-row-sub">{whenLine(n, day)}</p>
          <p className="vs-row-sub">
            {whereLine(n)}
            {n.place ? `: ${n.place.title}` : ''}
          </p>
          {n.linkUrl && (
            <p className="vs-row-sub">
              <ExternalLink size={13} aria-hidden="true" /> {n.linkLabel ?? 'Learn more'}: {n.linkUrl}
            </p>
          )}
          <p className="vs-row-sub">
            Posted {when(n.createdAt)}
            {n.createdBy ? ` by ${n.createdBy}` : ''}
          </p>
        </div>
      </div>
      <div className="vs-actions">
        <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" onClick={() => setEditing(!editing)} aria-expanded={editing}>
          <Pencil size={14} aria-hidden="true" /> {editing ? 'Close' : 'Edit'}
        </button>
        <button
          type="button"
          className="vs-btn vs-btn-small vs-btn-quiet"
          onClick={() => run(() => staff('/notices/edit', { body: { id: n.id, ...noticeBody(draftOf(n)), shown: !n.shown } }), n.shown ? 'Hidden. It is off the portal.' : 'It is showing again.')}
        >
          {n.shown ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />} {n.shown ? 'Hide' : 'Show'}
        </button>
        {confirm ? (
          <>
            <button type="button" className="vs-btn vs-btn-small vs-btn-primary" onClick={() => run(() => staff('/notices/remove', { body: { id: n.id } }), 'Removed. You can undo it from Activity.')}>
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
        <NoticeForm
          draft={draftOf(n)}
          kinds={kinds}
          submitLabel="Save"
          onCancel={() => setEditing(false)}
          onSubmit={async (d) => {
            await staff('/notices/edit', { body: { id: n.id, ...noticeBody(d), shown: n.shown } });
            setEditing(false);
            onNotice('Saved. The change is on the portal now.');
            onChanged();
          }}
        />
      )}
    </li>
  );
}

/** Notices: a short message at the top of every page of the portal. */
export default function Notices() {
  const list = useStaffData<{ items: NoticeItem[]; today: string; kinds?: NoticeKind[] }>('/notices/list');
  const kinds = list.data?.kinds ?? DEFAULT_KINDS;
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const banner = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (notice) banner.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [notice]);
  const showing = list.data?.items.filter((n) => n.status === 'showing' && n.onBar).length ?? 0;

  return (
    <section className="vs-stack" aria-labelledby="vs-notices">
      <div>
        <h1 id="vs-notices" className="vs-title">
          Notices
        </h1>
        <p className="vs-lede">
          Post a short message at the top of every page of the portal, such as an office closure or a change to a meeting, and mark a road closure, detour or work zone on the map. Residents can close
          the message for their visit. Up to three show at the top at once, alerts first.
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
            onClick={() => {
              setAdding(!adding);
              setNotice('');
            }}
          >
            <Plus size={16} aria-hidden="true" /> {adding ? 'Close' : 'Post a notice'}
          </button>
        </div>
        {adding && (
          <NoticeForm
            draft={EMPTY_NOTICE}
            kinds={kinds}
            submitLabel="Post notice"
            onCancel={() => setAdding(false)}
            onSubmit={async (d) => {
              await staff('/notices/add', { body: noticeBody(d) });
              setAdding(false);
              setNotice('Posted. It is on the portal now.');
              list.reload();
            }}
          />
        )}
      </div>

      <div>
        <Alert>{error || list.error}</Alert>
        {showing > 3 && <p className="vs-hint">{showing} notices are showing. Only the first three show on the portal. Hide one you no longer need.</p>}
        {list.data && list.data.items.length === 0 && <p className="vs-empty">No notices yet.</p>}
        <ul className="vs-list">
          {list.data?.items.map((n) => (
            <Row key={n.id} n={n} kinds={kinds} onNotice={setNotice} onError={setError} onChanged={list.reload} />
          ))}
        </ul>
      </div>
    </section>
  );
}
