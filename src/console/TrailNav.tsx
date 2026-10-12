/**
 * Previous and next through one meeting's records, in agenda order (attachments included), under the viewer's
 * toolbar and in full screen: "3 of 12", the next record's title, and a list to jump to any record, the files
 * on the same agenda item first.
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, List } from 'lucide-react';

export interface TrailStep {
  id: string;
  title: string;
  item: string | null;
}

export interface TrailNavProps {
  steps: TrailStep[];
  /** Index of the record on screen in `steps`. */
  index: number;
  attachmentIds: Set<string>;
  onGo: (id: string) => void;
}

export function TrailNav({ steps, index, attachmentIds, onGo }: TrailNavProps) {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const prev = index > 0 ? steps[index - 1] : null;
  const next = index < steps.length - 1 ? steps[index + 1] : null;

  useEffect(() => {
    if (!open) return;
    // Esc closes the list first (full screen stays on); a tap outside closes it too.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      setOpen(false);
    };
    const onDown = (e: PointerEvent) => {
      if (panel.current && !panel.current.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('.vc-trail-list-btn')) setOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown);
    panel.current?.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  const go = (id: string) => {
    setOpen(false);
    onGo(id);
  };
  const attached = steps.filter((s) => attachmentIds.has(s.id));
  const row = (s: TrailStep) => (
    <li key={s.id}>
      <button type="button" className="vc-trail-row" aria-current={s.id === steps[index]?.id} onClick={() => go(s.id)}>
        <span className="vc-trail-row-n">{steps.indexOf(s) + 1}</span>
        <span className="vc-trail-row-t">{s.title}</span>
        {s.item && <span className="vc-trail-row-i">Item {s.item}</span>}
      </button>
    </li>
  );

  return (
    <nav className="vc-trail-nav" aria-label="Records from this meeting">
      <button type="button" className="vc-vbtn vc-trail-btn" onClick={() => prev && go(prev.id)} disabled={!prev} aria-label={prev ? `Previous record: ${prev.title}` : 'Previous record'} title={prev ? `Previous: ${prev.title}` : undefined}>
        <ChevronLeft size={18} strokeWidth={2.2} />
        <span className="vc-vbar-hide-sm">Previous</span>
      </button>
      <div className="vc-trail-mid">
        <span className="vc-trail-pos">
          {index + 1} of {steps.length}
        </span>
        <span className="vc-trail-next">{next ? `Next: ${next.title}` : 'Last record from this meeting'}</span>
      </div>
      <button type="button" className="vc-vbtn vc-trail-list-btn" aria-expanded={open} aria-label="All records from this meeting" title="All records from this meeting" onClick={() => setOpen((o) => !o)}>
        <List size={17} strokeWidth={2} />
        <span className="vc-vbar-hide-sm">List</span>
      </button>
      <button type="button" className="vc-vbtn vc-trail-btn vc-trail-next-btn" onClick={() => next && go(next.id)} disabled={!next} aria-label={next ? `Next record: ${next.title}` : 'Next record'} title={next ? `Next: ${next.title}` : undefined}>
        <span className="vc-vbar-hide-sm">Next</span>
        <ChevronRight size={18} strokeWidth={2.2} />
      </button>
      {open && (
        <div ref={panel} className="vc-trail-panel">
          {attached.length > 0 && (
            <>
              <p className="vc-trail-panel-h">Attachments</p>
              <ul>{attached.map(row)}</ul>
            </>
          )}
          <p className="vc-trail-panel-h">Every record from this meeting</p>
          <ul>{steps.map(row)}</ul>
        </div>
      )}
    </nav>
  );
}
