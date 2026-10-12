/**
 * The staff portal: sign in, then edit whatever the account includes. Not linked from the public
 * site and kept out of search engines; the real protection is the sign-in behind it.
 */
import '../console.css';
import './staff.css';
import { Suspense, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { ChevronDown, ExternalLink } from 'lucide-react';
import { Wordmark } from '../Wordmark';
import { ROLE_LABEL } from './api';
import { StaffProvider, useStaffCtx } from './useStaff';
import { Spinner } from './ui';
import { SECTIONS, visibleSections } from './sections';
import Account from './Account';
import Home from './Home';
import Join from './Join';
import Setup from './Setup';
import SignIn from './SignIn';

function useNoIndex() {
  useEffect(() => {
    const m = document.createElement('meta');
    m.name = 'robots';
    m.content = 'noindex, nofollow';
    document.head.appendChild(m);
    const title = document.title;
    document.title = 'Staff | Vineyard Transparency Portal';
    return () => {
      m.remove();
      document.title = title;
    };
  }, []);
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

function UserMenu() {
  const { user, signOut } = useStaffCtx();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  if (!user) return null;
  return (
    <div className="vs-user" ref={box}>
      <button type="button" className="vs-user-btn" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="true">
        <span className="vs-avatar" aria-hidden="true">
          {initials(user.name)}
        </span>
        <span className="vs-user-name">{user.name}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open && (
        <div className="vs-menu" role="menu" onClick={(e) => (e.target as HTMLElement).closest('a') && setOpen(false)}>
          <p className="vs-menu-who">
            {user.email}
            <br />
            {ROLE_LABEL[user.role]}
          </p>
          <Link to="/staff/account" role="menuitem">
            Your account
          </Link>
          <a href="/" role="menuitem">
            View public site <ExternalLink size={13} aria-hidden="true" />
          </a>
          <button type="button" role="menuitem" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function Nav() {
  const { user } = useStaffCtx();
  if (!user) return null;
  return (
    <nav className="vs-nav" aria-label="Staff">
      <NavLink to="/staff" end>
        Home
      </NavLink>
      {visibleSections(user).map((s) => (
        <NavLink key={s.path} to={`/staff/${s.path}`}>
          {s.label}
        </NavLink>
      ))}
    </nav>
  );
}

function Body() {
  const { load, user } = useStaffCtx();
  if (load.status === 'loading') {
    return (
      <div className="vs-center" aria-busy="true">
        <Spinner label="Loading" />
      </div>
    );
  }
  if (load.status === 'error') {
    return (
      <section className="vs-card vs-narrow">
        <h1 className="vs-title">Could not load</h1>
        <p className="vs-lede">Check your connection and reload the page.</p>
      </section>
    );
  }
  const { setupOpen } = load.data;
  return (
    <Routes>
      <Route path="join" element={<Join />} />
      <Route path="setup" element={<Setup open={setupOpen} />} />
      {user ? (
        <>
          <Route index element={<Home />} />
          <Route path="account" element={<Account />} />
          {SECTIONS.map((s) => (
            <Route key={s.path} path={s.path} element={visibleSections(user).includes(s) ? <Suspense fallback={<Spinner label="Loading" />}><s.Component /></Suspense> : <Navigate to="/staff" replace />} />
          ))}
          <Route path="*" element={<Navigate to="/staff" replace />} />
        </>
      ) : (
        <>
          <Route index element={<SignIn setupOpen={setupOpen} />} />
          <Route path="*" element={<Navigate to="/staff" replace />} />
        </>
      )}
    </Routes>
  );
}

export default function StaffPage() {
  useNoIndex();
  return (
    <StaffProvider>
      <div className="vc vs" data-state="page">
        <div className="vc-atmosphere" aria-hidden="true" />
        <header className="vs-top">
          <Link to="/staff" className="vs-brand" aria-label="Staff portal home">
            <Wordmark />
            <span className="vs-brand-tag">Staff</span>
          </Link>
          <UserMenu />
        </header>
        <Nav />
        <main className="vs-main" id="vs-main">
          <Body />
        </main>
      </div>
    </StaffProvider>
  );
}
