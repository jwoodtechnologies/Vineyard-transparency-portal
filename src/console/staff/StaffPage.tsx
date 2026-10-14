/**
 * The staff portal: sign in, then edit whatever the account includes. Not linked from the public
 * site and kept out of search engines; the real protection is the sign-in behind it.
 */
import "../console.css";
import "./staff.css";
import { Suspense, useEffect, useRef, useState } from "react";
import {
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { ChevronDown, ExternalLink } from "lucide-react";
import { Wordmark } from "../Wordmark";
import { ROLE_LABEL } from "./api";
import { StaffProvider, useStaffCtx } from "./useStaff";
import { TourProvider, useTour } from "./Tour";
import { Spinner } from "./ui";
import { SECTIONS, visibleSections } from "./sections";
import Account from "./Account";
import Home from "./Home";
import Join from "./Join";
import Recover from "./Recover";
import SessionEnded from "./SessionEnded";
import Setup from "./Setup";
import SignIn from "./SignIn";

function useNoIndex() {
  useEffect(() => {
    const m = document.createElement("meta");
    m.name = "robots";
    m.content = "noindex, nofollow";
    document.head.appendChild(m);
    const title = document.title;
    document.title = "Staff | Vineyard Transparency Portal";
    return () => {
      m.remove();
      document.title = title;
    };
  }, []);
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (
    (parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")
  ).toUpperCase();
}

function UserMenu() {
  const { user, signOut } = useStaffCtx();
  const tour = useTour();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) =>
      box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  if (!user) return null;
  return (
    <div
      className="vs-user"
      ref={box}
      onBlur={(e) => {
        if (open && !e.currentTarget.contains(e.relatedTarget as Node | null))
          setOpen(false);
      }}
    >
      <button
        type="button"
        className="vs-user-btn"
        ref={button}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls="vs-user-menu"
        aria-label={`Account menu for ${user.name}`}
      >
        <span className="vs-avatar" aria-hidden="true">
          {initials(user.name)}
        </span>
        <span className="vs-user-name" aria-hidden="true">
          {user.name}
        </span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open && (
        <div
          className="vs-menu"
          id="vs-user-menu"
          onClick={(e) =>
            (e.target as HTMLElement).closest("a") && setOpen(false)
          }
        >
          <p className="vs-menu-who">
            {user.email}
            <br />
            {ROLE_LABEL[user.role]}
          </p>
          <Link to="/staff/account">Your account</Link>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              button.current?.focus();
              tour.start();
            }}
          >
            Take the tour
          </button>
          <a href="/">
            View public site <ExternalLink size={13} aria-hidden="true" />
          </a>
          <button type="button" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/** On every change of screen: the tab title names the screen, and focus moves to its heading so a screen reader starts there. */
function RouteFocus() {
  const { pathname } = useLocation();
  const first = useRef(true);
  useEffect(() => {
    let tries = 0;
    let timer = 0;
    const settle = () => {
      const h = document.querySelector<HTMLElement>("#vs-main h1");
      if (h) {
        document.title = `${h.textContent ?? "Staff"} | Staff | Vineyard Transparency Portal`;
        if (!first.current) {
          h.tabIndex = -1;
          h.focus({ preventScroll: true });
        }
        first.current = false;
        return;
      }
      if (tries++ < 20) timer = window.setTimeout(settle, 100);
    };
    timer = window.setTimeout(settle, 0);
    return () => window.clearTimeout(timer);
  }, [pathname]);
  return null;
}

function Nav() {
  const { user } = useStaffCtx();
  const { pathname } = useLocation();
  useEffect(() => {
    document
      .querySelector('.vs-nav [aria-current="page"]')
      ?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [pathname, user]);
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
  const { load, user, reload } = useStaffCtx();
  if (load.status === "loading") {
    return (
      <div className="vs-center" aria-busy="true">
        <Spinner label="Loading" />
      </div>
    );
  }
  if (load.status === "error") {
    return (
      <section className="vs-card vs-narrow">
        <h1 className="vs-title">Could not load</h1>
        <p className="vs-lede">Check your connection and try again.</p>
        <button
          type="button"
          className="vs-btn vs-btn-primary"
          onClick={() => void reload()}
        >
          Try again
        </button>
      </section>
    );
  }
  const { setupOpen } = load.data;
  return (
    <Routes>
      <Route path="join" element={<Join />} />
      <Route path="setup" element={<Setup open={setupOpen} />} />
      <Route path="recover" element={<Recover />} />
      {user ? (
        <>
          <Route index element={<Home />} />
          <Route path="account" element={<Account />} />
          {SECTIONS.map((s) => (
            <Route
              key={s.path}
              path={s.path}
              element={
                visibleSections(user).includes(s) ? (
                  <Suspense fallback={<Spinner label="Loading" />}>
                    <s.Component />
                  </Suspense>
                ) : (
                  <Navigate to="/staff" replace />
                )
              }
            />
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
      <TourProvider>
        <div className="vc vs" data-state="page">
          <a className="vs-skip" href="#vs-main">
            Skip to main content
          </a>
          <div className="vc-atmosphere" aria-hidden="true" />
          <header className="vs-top">
            <Link
              to="/staff"
              className="vs-brand"
              aria-label="Vineyard Transparency Portal Staff, home"
            >
              <Wordmark />
              <span className="vs-brand-tag">Staff</span>
            </Link>
            <UserMenu />
          </header>
          <Nav />
          <main className="vs-main" id="vs-main" tabIndex={-1}>
            <Body />
          </main>
          <RouteFocus />
          <SessionEnded />
        </div>
      </TourProvider>
    </StaffProvider>
  );
}
