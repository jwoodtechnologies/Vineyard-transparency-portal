/**
 * The search button in every page header. It opens one search field (a sheet under the header) that
 * searches every record and opens the results on the Records page (/records?q=...). On a keyboard,
 * "/" opens it from anywhere that is not already a text field; Escape closes it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { isSearchShortcut } from './searchShortcut';

export function HeaderSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isSearchShortcut(e, e.target)) {
        e.preventDefault();
        window.dispatchEvent(new Event('vc:search-open'));
        setOpen(true);
      }
    };
    // One panel at a time: the menu or chat history closes search.
    const onOther = () => setOpen(false);
    document.addEventListener('keydown', onKey);
    window.addEventListener('vc:menu-open', onOther);
    window.addEventListener('vc:history-open', onOther);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('vc:menu-open', onOther);
      window.removeEventListener('vc:history-open', onOther);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown, { passive: true });
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  return (
    <div className="vc-hsearch" ref={box}>
      <button
        type="button"
        className="vc-ghost"
        data-icon-only="true"
        aria-label="Search records"
        title="Search records (press /)"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          if (open) return close();
          window.dispatchEvent(new Event('vc:search-open'));
          setOpen(true);
        }}
      >
        <Search size={17} strokeWidth={1.8} />
      </button>
      {open && (
        <div className="vc-hsearch-sheet" role="dialog" aria-label="Search records">
          <form
            className="vc-hsearch-form"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              const text = q.trim();
              if (!text) return input.current?.focus();
              close();
              navigate(`/records?q=${encodeURIComponent(text)}`);
            }}
          >
            <Search size={16} strokeWidth={1.9} aria-hidden="true" />
            <input
              ref={input}
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search all records"
              aria-label="Search all records"
              enterKeyHint="search"
              autoComplete="off"
              maxLength={300}
            />
            <button type="button" className="vc-hsearch-x" aria-label="Close search" onClick={close}>
              <X size={16} />
            </button>
          </form>
          <p className="vc-hsearch-hint">Ordinances, resolutions, agendas, minutes and every other record. Press Enter to search.</p>
        </div>
      )}
    </div>
  );
}
