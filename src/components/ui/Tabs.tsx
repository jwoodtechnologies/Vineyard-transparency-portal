import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface TabDef {
  id: string;
  label: ReactNode;
  count?: number | null;
}

/** WAI-ARIA tabs with roving tabindex and arrow-key navigation. */
export function Tabs({
  tabs,
  value,
  onChange,
  label,
  className,
  children,
}: {
  tabs: TabDef[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  className?: string;
  children: (active: string, panelProps: { id: string; role: 'tabpanel'; 'aria-labelledby': string; tabIndex: 0 }) => ReactNode;
}) {
  const base = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
    if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = tabs.length - 1;
    if (next >= 0) {
      e.preventDefault();
      onChange(tabs[next].id);
      refs.current[next]?.focus();
    }
  };
  return (
    <div className={className}>
      <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto border-b border-line [scrollbar-width:none]">
        {tabs.map((t, i) => {
          const active = t.id === value;
          return (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              role="tab"
              id={`${base}-tab-${t.id}`}
              aria-selected={active}
              aria-controls={`${base}-panel-${t.id}`}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(t.id)}
              onKeyDown={(e) => onKey(e, i)}
              className={cn(
                '-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
                active ? 'border-accent text-fg' : 'border-transparent text-subtle hover:text-fg',
              )}
            >
              {t.label}
              {t.count != null && <span className="rounded bg-raised px-1.5 text-[11px] tabular-nums text-subtle">{t.count}</span>}
            </button>
          );
        })}
      </div>
      {children(value, {
        id: `${base}-panel-${value}`,
        role: 'tabpanel',
        'aria-labelledby': `${base}-tab-${value}`,
        tabIndex: 0,
      })}
    </div>
  );
}
