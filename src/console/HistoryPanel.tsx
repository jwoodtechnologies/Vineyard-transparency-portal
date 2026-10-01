import { useEffect, useRef, useState } from 'react';
import { History, MessageSquare, Plus, Trash2, X } from 'lucide-react';
import { clearChats, deleteChat, setHistoryEnabled, useChats, useHistoryEnabled, type SavedChat } from './history';

const DAY = 86_400_000;

function group(chats: SavedChat[]): Array<[string, SavedChat[]]> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const today = start.getTime();
  const buckets: Record<string, SavedChat[]> = {};
  const order = ['Today', 'Yesterday', 'Previous 7 days', 'Previous 30 days', 'Older'];
  for (const c of chats) {
    const t = c.updatedAt;
    const k = t >= today ? 'Today' : t >= today - DAY ? 'Yesterday' : t >= today - 7 * DAY ? 'Previous 7 days' : t >= today - 30 * DAY ? 'Previous 30 days' : 'Older';
    (buckets[k] ??= []).push(c);
  }
  return order.filter((k) => buckets[k]?.length).map((k) => [k, buckets[k]]);
}

interface Props {
  activeId: string | null;
  onOpen: (chat: SavedChat) => void;
  onNew: () => void;
  onClose: () => void;
}

export function HistoryPanel({ activeId, onOpen, onNew, onClose }: Props) {
  const chats = useChats();
  const saving = useHistoryEnabled();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    // Only one panel at a time: chat history closes the menu.
    window.dispatchEvent(new Event('vc:history-open'));
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <>
      <div className="vc-scrim" onClick={onClose} aria-hidden="true" />
      <aside className="vc-history" role="dialog" aria-modal="true" aria-label="Chat history">
        <div className="vc-history-head">
          <span className="vc-label" style={{ margin: 0 }}>
            Chats
          </span>
          <button ref={closeRef} type="button" className="vc-ghost" data-icon-only="true" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="vc-history-new">
          <button type="button" className="vc-secondary" onClick={onNew} style={{ width: '100%' }}>
            <Plus size={16} strokeWidth={2} /> New chat
          </button>
        </div>
        <div className="vc-history-body">
          {!saving && <p className="vc-history-empty">Saving chats is turned off. Turn it on below.</p>}
          {saving && !chats.length && <p className="vc-history-empty">Your chats will appear here. They are saved in this browser only.</p>}
          {group(chats).map(([label, items]) => (
            <section key={label} className="vc-history-group">
              <p className="vc-history-when">{label}</p>
              {items.map((c) => (
                <div key={c.id} className="vc-history-item" data-active={c.id === activeId}>
                  <button type="button" className="vc-history-open" onClick={() => onOpen(c)} title={c.title}>
                    <MessageSquare size={14} strokeWidth={1.8} />
                    <span>{c.title}</span>
                  </button>
                  <button type="button" className="vc-history-delete" onClick={() => deleteChat(c.id)} aria-label={`Delete chat: ${c.title}`} title="Delete">
                    <Trash2 size={14} strokeWidth={1.8} />
                  </button>
                </div>
              ))}
            </section>
          ))}
        </div>
        <div className="vc-history-foot">
          <label className="vc-panel-row vc-switch-row">
            <History size={15} strokeWidth={1.8} />
            <span>Save chats on this device</span>
            <input type="checkbox" className="vc-switch" checked={saving} onChange={(e) => setHistoryEnabled(e.target.checked)} />
          </label>
          <button
            type="button"
            className="vc-panel-row"
            data-danger={confirm}
            disabled={!chats.length}
            onClick={() => {
              if (!confirm) return setConfirm(true);
              clearChats();
              setConfirm(false);
            }}
          >
            <Trash2 size={15} strokeWidth={1.8} />
            {confirm ? `Delete all ${chats.length} chats?` : chats.length ? `Clear all ${chats.length} ${chats.length === 1 ? 'chat' : 'chats'}` : 'No saved chats'}
          </button>
          <p className="vc-panel-note">Chats stay in this browser only. Nothing is stored on a server.</p>
        </div>
      </aside>
    </>
  );
}
