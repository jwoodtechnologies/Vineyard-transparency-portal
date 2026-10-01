/**
 * The one piece of chrome every screen shares: the side menu, the wordmark, and on desktop the Calendar, People and Map links and a settings menu.
 * The side menu holds every record category; no footer, no explainer pages.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { CalendarDays, History, Map as MapIcon, Moon, Settings2, Sun, Trash2, Users } from 'lucide-react';
import { useTheme, type ThemePreference } from '@/hooks/useTheme';
import { Wordmark } from './Wordmark';
import { SiteMenu } from './SiteMenu';
import { clearChats, setHistoryEnabled, useChats, useHistoryEnabled } from './history';

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

export function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const { resolved, setPreference } = useTheme();
  const chats = useChats();
  const saving = useHistoryEnabled();
  const close = () => {
    setOpen(false);
    setConfirm(false);
  };
  const box = useDismiss(open, close);

  return (
    <div className="vc-settings" ref={box}>
      <button type="button" className="vc-ghost" data-icon-only="true" aria-label="Settings" aria-haspopup="dialog" aria-expanded={open} onClick={() => (open ? close() : setOpen(true))}>
        <Settings2 size={17} strokeWidth={1.8} />
      </button>
      {open && (
        <div className="vc-panel" role="dialog" aria-label="Settings">
          <p className="vc-panel-label">Appearance</p>
          <div className="vc-segment" role="radiogroup" aria-label="Theme">
            {THEMES.map(({ value, label, Icon }) => (
              <button key={value} type="button" role="radio" aria-checked={resolved === value} data-on={resolved === value} onClick={() => setPreference(value)}>
                <Icon size={14} strokeWidth={1.9} /> {label}
              </button>
            ))}
          </div>

          <p className="vc-panel-label">Chat history</p>
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
            {confirm ? `Delete all ${chats.length} chats?` : chats.length ? `Clear ${chats.length} saved ${chats.length === 1 ? 'chat' : 'chats'}` : 'No saved chats'}
          </button>
          <p className="vc-panel-note">Chats stay in this browser only. Nothing is stored on a server and there are no accounts.</p>
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
        <NavLink to="/meetings" className="vc-ghost vc-nav vc-hide-mobile" aria-label="Calendar" title="Calendar">
          <CalendarDays size={16} strokeWidth={1.8} />
          <span className="vc-nav-text">Calendar</span>
        </NavLink>
        <NavLink to="/people" className="vc-ghost vc-nav vc-hide-mobile" aria-label="People" title="People">
          <Users size={16} strokeWidth={1.8} />
          <span className="vc-nav-text">People</span>
        </NavLink>
        <NavLink to="/map" className="vc-ghost vc-nav vc-hide-mobile" aria-label="Map" title="Map">
          <MapIcon size={16} strokeWidth={1.8} />
          <span className="vc-nav-text">Map</span>
        </NavLink>
        <SettingsMenu />
        <SiteMenu />
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
