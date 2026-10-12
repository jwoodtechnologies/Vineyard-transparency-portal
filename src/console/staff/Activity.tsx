import { useCallback, useEffect, useState } from 'react';
import { Undo2 } from 'lucide-react';
import { canEditArea, canManageUsers, staff, when, AREA_NAME, type AuditItem, type Me } from './api';
import { Alert, Spinner } from './ui';
import { useStaffCtx } from './useStaff';

/** The change log: who changed what and when, with one-click undo where it is safe. */
export default function Activity() {
  const { user, load } = useStaffCtx();
  const me = user as Me;
  const [area, setArea] = useState('');
  const [items, setItems] = useState<AuditItem[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const areas = load.status === 'ready' ? load.data.areas.filter((a) => canEditArea(me, a.key)) : [];

  const fetchPage = useCallback((before?: number) => staff<{ items: AuditItem[] }>(`/audit?limit=30${area ? `&area=${area}` : ''}${before ? `&before=${before}` : ''}`), [area]);

  useEffect(() => {
    let live = true;
    fetchPage().then(
      (r) => {
        if (!live) return;
        setItems(r.items);
        setMore(r.items.length === 30);
      },
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [fetchPage]);

  async function older() {
    if (!items?.length) return;
    const r = await fetchPage(items[items.length - 1].id);
    setItems([...items, ...r.items]);
    setMore(r.items.length === 30);
  }

  async function undo(id: number) {
    setBusy(id);
    setError('');
    try {
      await staff('/audit/undo', { body: { id } });
      const r = await fetchPage();
      setItems(r.items);
      setMore(r.items.length === 30);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not undo that.');
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  }

  return (
    <section className="vs-stack" aria-labelledby="vs-activity">
      <div className="vs-head">
        <h1 id="vs-activity" className="vs-title">
          Activity
        </h1>
        <label className="vs-select">
          <span className="vs-sr">Show</span>
          <select value={area} onChange={(e) => { setItems(null); setArea(e.target.value); }}>
            <option value="">All areas</option>
            {areas.map((a) => (
              <option key={a.key} value={a.key}>
                {a.label}
              </option>
            ))}
            {canManageUsers(me) && <option value="accounts">Accounts</option>}
          </select>
        </label>
      </div>
      <p className="vs-lede">Every change made through the staff portal is recorded here. Undo puts the earlier version back for everyone.</p>
      <Alert>{error}</Alert>
      {items === null && !error && <Spinner label="Loading activity" />}
      {items?.length === 0 && <p className="vs-empty">Nothing has been changed yet.</p>}
      {items && items.length > 0 && (
        <ul className="vs-list">
          {items.map((i) => (
            <li key={i.id} className="vs-row" data-undone={Boolean(i.undone_at)}>
              <div className="vs-row-main">
                <p className="vs-row-title">{i.summary}</p>
                <p className="vs-row-sub">
                  {i.user_name ?? 'Someone'} · {AREA_NAME[i.area] ?? i.area} · {when(i.at)}
                  {i.undone_at ? ` · undone by ${i.undone_by ?? 'staff'}` : ''}
                </p>
              </div>
              {i.undoable &&
                (confirm === i.id ? (
                  <span className="vs-row-actions">
                    <button type="button" className="vs-btn vs-btn-small vs-btn-primary" onClick={() => undo(i.id)} disabled={busy === i.id}>
                      {busy === i.id ? 'Undoing' : 'Yes, undo'}
                    </button>
                    <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" onClick={() => setConfirm(null)}>
                      Keep
                    </button>
                  </span>
                ) : (
                  <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" onClick={() => setConfirm(i.id)}>
                    <Undo2 size={14} aria-hidden="true" /> Undo
                  </button>
                ))}
            </li>
          ))}
        </ul>
      )}
      {more && (
        <button type="button" className="vs-btn vs-btn-quiet" onClick={older}>
          Show older
        </button>
      )}
    </section>
  );
}
