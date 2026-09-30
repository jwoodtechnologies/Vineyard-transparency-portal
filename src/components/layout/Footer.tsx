import { Link } from 'react-router-dom';
import { config } from '@/config/env';
import { Wordmark } from '@/components/brand/Logo';
import { useApp } from '@/app/AppContext';

const GROUPS = [
  {
    title: 'Research',
    links: [
      { to: '/', label: 'Ask a question' },
      { to: '/search', label: 'Search records' },
      { to: '/documents', label: 'All documents' },
      { to: '/browse', label: 'Browse' },
      { to: '/meetings', label: 'Meetings' },
      { to: '/code', label: 'Municipal code' },
    ],
  },
  {
    title: 'Archive',
    links: [
      { to: '/sources', label: 'Record sources' },
      { to: '/status', label: 'Archive status' },
      { to: '/about#how-archiving-works', label: 'How archiving works' },
      { to: '/about#how-ai-answers-work', label: 'How AI answers work' },
    ],
  },
  {
    title: 'You',
    links: [
      { to: '/saved', label: 'Saved on this device' },
      { to: '/about#privacy', label: 'Privacy' },
      { to: '/about', label: 'About this project' },
    ],
  },
];

export function Footer() {
  const { openReport } = useApp();
  return (
    <footer className="mt-auto border-t border-line bg-surface">
      <div className="container-wide grid gap-10 py-12 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div className="max-w-sm">
          <Wordmark />
          <p className="mt-4 text-[13px] leading-relaxed text-muted">{config.disclaimer}</p>
          <button onClick={() => openReport({})} className="link mt-4 text-[13px]">
            Report an issue
          </button>
        </div>
        {GROUPS.map((g) => (
          <nav key={g.title} aria-label={g.title}>
            <h2 className="eyebrow">{g.title}</h2>
            <ul className="mt-3 space-y-2">
              {g.links.map((l) => (
                <li key={l.to}>
                  <Link to={l.to} className="text-sm text-muted hover:text-fg">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-line">
        <div className="container-wide flex flex-col gap-2 py-5 text-xs text-subtle sm:flex-row sm:items-center sm:justify-between">
          <p>No accounts. No tracking. No advertising. Searches stay on your device.</p>
          <p>The archive is the authority. AI is the interface.</p>
        </div>
      </div>
    </footer>
  );
}
