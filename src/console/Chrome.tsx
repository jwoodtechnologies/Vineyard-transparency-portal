/**
 * The one piece of chrome every screen shares: chat history on the left, the wordmark, and one menu on the right.
 * The menu holds the calendar, people, map, every record category, appearance and chat history.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, CalendarDays, FileText, History, Landmark, Layers, Map as MapIcon, Moon, Scale, ScrollText, Sun, Users } from 'lucide-react';
import { useTheme, type ThemePreference } from '@/hooks/useTheme';
import { Wordmark } from './Wordmark';
import { RECORD_CATEGORIES } from './categories';

function useScrolled() {
  const [scrolled, setScrolled] = useState(() => typeof window !== 'undefined' && window.scrollY > 8);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return scrolled;
}

function useDismiss(open: boolean, close: () => void) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
  return box;
}

const THEMES: Array<{ value: Exclude<ThemePreference, 'system'>; label: string; Icon: typeof Sun }> = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
];

/** The one menu mark: two offset strokes and a dot. */
function MenuMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M3 6h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M7 12h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="3.6" cy="12" r="1.25" fill="currentColor" />
    </svg>
  );
}

const CATEGORY_ICONS: Record<string, typeof FileText> = { meetings: FileText, finance: Landmark, laws: Scale, code: BookOpen, plans: Layers };

/**
 * The one menu, on desktop and phones: the calendar, people, map and every record category, then
 * appearance and chat history. A small panel that drops from the top right.
 */
export function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const { resolved, setPreference } = useTheme();
  const close = () => setOpen(false);
  const box = useDismiss(open, close);
  // Only one panel at a time: opening chat history closes the menu, and the other way round.
  useEffect(() => {
    const onHistory = () => setOpen(false);
    window.addEventListener('vc:history-open', onHistory);
    return () => window.removeEventListener('vc:history-open', onHistory);
  }, []);

  return (
    <div className="vc-settings" ref={box}>
      <button
        type="button"
        className="vc-ghost"
        data-icon-only="true"
        aria-label="Menu"
        title="Menu"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (open) return close();
          window.dispatchEvent(new Event('vc:menu-open'));
          setOpen(true);
        }}
      >
        <MenuMark />
      </button>
      {open && (
        <div className="vc-panel vc-menu-panel" role="dialog" aria-label="Menu" onClick={(e) => (e.target as HTMLElement).closest('a') && close()}>
          <div className="vc-menu-grid">
            <Link to="/meetings" className="vc-menu-tile">
              <CalendarDays size={17} strokeWidth={1.8} />
              <span>Calendar</span>
            </Link>
            <Link to="/people" className="vc-menu-tile">
              <Users size={17} strokeWidth={1.8} />
              <span>People</span>
            </Link>
            <Link to="/map" className="vc-menu-tile">
              <MapIcon size={17} strokeWidth={1.8} />
              <span>Map</span>
            </Link>
          </div>

          <p className="vc-panel-label">Records</p>
          <Link to="/records" className="vc-panel-row">
            <ScrollText size={15} strokeWidth={1.8} />
            <span>All records</span>
          </Link>
          {RECORD_CATEGORIES.map((c) => {
            const Icon = CATEGORY_ICONS[c.id] ?? FileText;
            return (
              <Link key={c.id} to={`/records?c=${c.id}`} className="vc-panel-row">
                <Icon size={15} strokeWidth={1.8} />
                <span>{c.label}</span>
              </Link>
            );
          })}

          <p className="vc-panel-label">Appearance</p>
          <div className="vc-segment" role="radiogroup" aria-label="Theme">
            {THEMES.map(({ value, label, Icon }) => (
              <button key={value} type="button" role="radio" aria-checked={resolved === value} data-on={resolved === value} onClick={() => setPreference(value)}>
                <Icon size={14} strokeWidth={1.9} /> {label}
              </button>
            ))}
          </div>

          <p className="vc-panel-note">Independent project, not an official Vineyard City website. No accounts, no tracking.</p>
        </div>
      )}
    </div>
  );
}

interface TopBarProps {
  onHome?: () => void;
  onHistory?: () => void;
  children?: ReactNode;
}

export function TopBar({ onHome, onHistory, children }: TopBarProps) {
  const scrolled = useScrolled();
  return (
    <header className="vc-topbar" data-scrolled={scrolled}>
      <div className="vc-topbar-start">
        {onHistory && (
          <button type="button" className="vc-ghost" data-icon-only="true" onClick={onHistory} aria-label="Chat history" title="Chat history">
            <History size={17} strokeWidth={1.8} />
          </button>
        )}
        {onHome ? (
          <button type="button" className="vc-wordmark-home" onClick={onHome} aria-label="Vineyard Transparency Portal, start over">
            <Wordmark />
          </button>
        ) : (
          <Link to="/" className="vc-wordmark-home" aria-label="Vineyard Transparency Portal home">
            <Wordmark />
          </Link>
        )}
      </div>
      <nav className="vc-topbar-actions" aria-label="Main">
        {children}
        <SettingsMenu />
      </nav>
    </header>
  );
}

/** Full page frame for the secondary screens (meetings, a meeting, a document). */
export function Frame({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="vc" data-state="page">
      <div className="vc-atmosphere" aria-hidden="true" />
      <TopBar />
      <main className="vc-page" data-wide={wide}>
        {children}
      </main>
    </div>
  );
}
