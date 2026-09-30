import { useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { Bookmark, Menu } from 'lucide-react';
import { Wordmark } from '@/components/brand/Logo';
import { Dialog } from '@/components/ui/Dialog';
import { IconButton } from '@/components/ui/Button';
import { useLibrary } from '@/hooks/useLibrary';
import { cn } from '@/lib/cn';
import { ThemeToggle } from './ThemeToggle';

const PRIMARY_NAV = [
  { to: '/', label: 'Ask', end: true, match: ['/', '/ask'] },
  { to: '/search', label: 'Search' },
  { to: '/documents', label: 'Documents' },
  { to: '/browse', label: 'Browse', match: ['/browse', '/meetings', '/bodies', '/topics', '/code'] },
  { to: '/about', label: 'About', match: ['/about', '/sources', '/status'] },
];

function isActive(pathname: string, item: (typeof PRIMARY_NAV)[number]) {
  const prefixes = item.match ?? [item.to];
  return prefixes.some((p) => (p === '/' ? pathname === '/' : pathname === p || pathname.startsWith(`${p}/`)));
}

export function Header() {
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const { saved } = useLibrary();
  const savedCount = saved?.length ?? 0;

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/85 backdrop-blur-md supports-[backdrop-filter]:bg-surface/75">
      <div className="container-wide flex h-16 items-center gap-4">
        <Link to="/" className="-ml-1 rounded-lg p-1" aria-label="Vineyard Transparency Portal — home">
          <Wordmark compact />
        </Link>

        <nav aria-label="Primary" className="ml-6 hidden md:block">
          <ul className="flex items-center gap-1">
            {PRIMARY_NAV.map((item) => {
              const active = isActive(pathname, item);
              return (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'relative rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                      active ? 'text-fg' : 'text-subtle hover:text-fg',
                    )}
                  >
                    {item.label}
                    {active && <span aria-hidden className="absolute inset-x-3 -bottom-[13px] h-0.5 rounded-full bg-accent" />}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          <Link
            to="/saved"
            className={cn(
              'relative inline-flex size-10 items-center justify-center rounded-lg text-muted hover:bg-raised hover:text-fg',
              pathname === '/saved' && 'text-fg',
            )}
            aria-label={`Saved on this device${savedCount ? ` (${savedCount})` : ''}`}
            title="Saved on this device"
          >
            <Bookmark className="size-[18px]" />
            {savedCount > 0 && (
              <span className="absolute right-1.5 top-1.5 min-w-4 rounded-full bg-accent px-1 text-center text-[10px] font-semibold leading-4 text-on-accent">
                {savedCount > 99 ? '99+' : savedCount}
              </span>
            )}
          </Link>
          <div className="hidden md:block">
            <ThemeToggle />
          </div>
          <IconButton label="Open menu" className="md:hidden" onClick={() => setMenuOpen(true)} aria-haspopup="dialog" aria-expanded={menuOpen}>
            <Menu className="size-5" />
          </IconButton>
        </div>
      </div>

      <Dialog open={menuOpen} onClose={() => setMenuOpen(false)} title="Menu" placement="right">
        <nav aria-label="Mobile">
          <ul className="space-y-1">
            {[...PRIMARY_NAV, { to: '/meetings', label: 'Meetings' }, { to: '/sources', label: 'Sources' }, { to: '/saved', label: 'Saved on this device' }].map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={'end' in item ? item.end : undefined}
                  onClick={() => setMenuOpen(false)}
                  className={({ isActive: a }) =>
                    cn('block rounded-lg px-3 py-3 text-base font-medium', a ? 'bg-accent-soft text-accent-ink' : 'text-fg hover:bg-raised')
                  }
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="mt-6 flex items-center justify-between border-t border-line pt-5">
          <span className="text-sm text-muted">Theme</span>
          <ThemeToggle />
        </div>
      </Dialog>
    </header>
  );
}
