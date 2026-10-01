/** The side menu (hamburger): every record category, plus Latest, Calendar, People and Map. */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { BookOpen, CalendarDays, FileText, Landmark, Layers, Map as MapIcon, MessageSquare, Scale, ScrollText, Users, X } from 'lucide-react';
import { RECORD_CATEGORIES } from './categories';

const ICONS: Record<string, typeof FileText> = { meetings: FileText, finance: Landmark, laws: Scale, code: BookOpen, plans: Layers };

/** Two offset strokes and a dot: the menu mark (not the usual three lines). */
function MenuMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M3 6h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M7 12h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="3.6" cy="12" r="1.25" fill="currentColor" />
    </svg>
  );
}

/** The side menu: every record category plus Meetings, People and the Map. On phones it holds the main links. */
export function SiteMenu() {
  const [open, setOpen] = useState(false);
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
            <p className="vc-panel-note">Independent project, not an official Vineyard City website.</p>
          </nav>
        </div>,
        // Inside the app root so the theme (colors, fonts, dark mode) applies.
        document.querySelector('.vc') ?? document.body,
      )
    : null;

  return (
    <>
      <button type="button" className="vc-menu-btn" aria-label="Menu" aria-haspopup="dialog" aria-expanded={open} title="Menu" onClick={() => setOpen(true)}>
        <MenuMark />
        <span className="vc-menu-btn-text">Menu</span>
      </button>
      {sheet}
    </>
  );
}
