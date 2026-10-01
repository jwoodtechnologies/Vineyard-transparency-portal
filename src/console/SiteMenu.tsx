/** The side menu (hamburger): every record category, plus Latest, Calendar, People and Map. */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { BookOpen, CalendarDays, FileText, History, Landmark, Layers, Map as MapIcon, Menu, MessageSquare, Moon, Scale, ScrollText, Sun, Users, X } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';
import { RECORD_CATEGORIES } from './categories';

const ICONS: Record<string, typeof FileText> = { meetings: FileText, finance: Landmark, laws: Scale, code: BookOpen, plans: Layers };

/** On phones this one menu holds everything; on desktop the top bar also shows the main links. */
export function SiteMenu({ onHistory }: { onHistory?: () => void }) {
  const [open, setOpen] = useState(false);
  const { resolved, setPreference } = useTheme();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  const sheet = open
    ? createPortal(
        <div className="vc-sidemenu" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" className="vc-sidemenu-scrim" aria-label="Close menu" onClick={() => setOpen(false)} />
          <nav className="vc-sidemenu-sheet" onClick={(e) => (e.target as HTMLElement).closest('a') && setOpen(false)}>
            <div className="vc-sidemenu-head">
              <span className="vc-sidemenu-title">Menu</span>
              <button type="button" className="vc-ghost" data-icon-only="true" aria-label="Close menu" onClick={() => setOpen(false)}>
                <X size={17} strokeWidth={1.8} />
              </button>
            </div>
            <Link to="/" className="vc-panel-row">
              <MessageSquare size={16} strokeWidth={1.8} /> Ask a question
            </Link>
            <p className="vc-panel-label">Browse records</p>
            <Link to="/records" className="vc-panel-row">
              <ScrollText size={16} strokeWidth={1.8} />
              <span className="vc-sidemenu-text">
                All records<span className="vc-sidemenu-hint">Every year, 1989 to today</span>
              </span>
            </Link>
            {RECORD_CATEGORIES.map((c) => {
              const Icon = ICONS[c.id] ?? FileText;
              return (
                <Link key={c.id} to={`/records?c=${c.id}`} className="vc-panel-row">
                  <Icon size={16} strokeWidth={1.8} />
                  <span className="vc-sidemenu-text">
                    {c.label}
                    <span className="vc-sidemenu-hint">{c.hint}</span>
                  </span>
                </Link>
              );
            })}
            <p className="vc-panel-label">Explore</p>
            <Link to="/meetings" className="vc-panel-row">
              <CalendarDays size={16} strokeWidth={1.8} /> Meetings and calendar
            </Link>
            <Link to="/people" className="vc-panel-row">
              <Users size={16} strokeWidth={1.8} /> People
            </Link>
            <Link to="/map" className="vc-panel-row">
              <MapIcon size={16} strokeWidth={1.8} /> City map
            </Link>
            <p className="vc-panel-label">This device</p>
            {onHistory && (
              <button
                type="button"
                className="vc-panel-row"
                onClick={() => {
                  setOpen(false);
                  onHistory();
                }}
              >
                <History size={16} strokeWidth={1.8} /> Chat history
              </button>
            )}
            <button type="button" className="vc-panel-row" onClick={() => setPreference(resolved === 'dark' ? 'light' : 'dark')}>
              {resolved === 'dark' ? <Sun size={16} strokeWidth={1.8} /> : <Moon size={16} strokeWidth={1.8} />} {resolved === 'dark' ? 'Light mode' : 'Dark mode'}
            </button>
            <p className="vc-panel-note">Independent project, not an official Vineyard City website.</p>
          </nav>
        </div>,
        // Inside the app root so the theme (colors, fonts, dark mode) applies.
        document.querySelector('.vc') ?? document.body,
      )
    : null;

  return (
    <>
      <button type="button" className="vc-ghost" data-icon-only="true" aria-label="Menu" aria-haspopup="dialog" aria-expanded={open} title="Menu" onClick={() => setOpen(true)}>
        <Menu size={18} strokeWidth={1.8} />
      </button>
      {sheet}
    </>
  );
}
