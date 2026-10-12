import { useEffect, useRef } from 'react';

/**
 * A quick year picker: one row of year chips, newest first, that scrolls sideways on a phone and
 * never wraps. The chosen year is scrolled into view.
 */
export function YearChips({ years, value, onPick, all }: { years: Array<string | number>; value: string; onPick: (year: string) => void; /** Label of an "every year" chip (value ''); none when omitted. */ all?: string }) {
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = row.current;
    const on = box?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!box || !on) return;
    const left = on.offsetLeft - box.clientWidth / 2 + on.offsetWidth / 2;
    box.scrollLeft = Math.max(0, left);
  }, [value, years.length]);
  if (!years.length) return null;
  const chip = (v: string, label: string) => (
    <button key={v || 'all'} type="button" className="vc-ychip" aria-pressed={value === v} onClick={() => onPick(v)}>
      {label}
    </button>
  );
  return (
    <div className="vc-ychips" ref={row} role="group" aria-label="Year">
      {all !== undefined && chip('', all)}
      {years.map((y) => chip(String(y), String(y)))}
    </div>
  );
}
