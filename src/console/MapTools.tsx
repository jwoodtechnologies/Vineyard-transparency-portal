/**
 * The map's Tools button beside the search bar: one button that opens a small menu of Layers, My location,
 * Measure and Street view, so the search bar keeps the room. Each item is 44 px tall with its icon. The
 * menu works from the keyboard (arrows, Home, End, Escape) and closes on a pick, a tap outside, or Tab.
 * Street view can also be dragged out of the menu onto the map (pegman.ts), as from Google's person.
 */
import { forwardRef, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ChevronDown, Crosshair, Layers, PersonStanding, Ruler, Wrench } from 'lucide-react';

interface Props {
  layersOn: boolean;
  measuring: boolean;
  streetView: boolean;
  /** Street view waits for the map. */
  ready: boolean;
  onLayers: () => void;
  onLocate: () => void;
  onMeasure: () => void;
  onStreetView: () => void;
  /** The Street view item, for dragging the person onto the map. */
  personRef: RefObject<HTMLButtonElement | null>;
  /** The click that ends a drag of the person is not a pick. */
  personDragged: () => boolean;
  onOpenChange: (open: boolean) => void;
}

export const MapTools = forwardRef<HTMLButtonElement, Props>(function MapTools({ layersOn, measuring, streetView, ready, onLayers, onLocate, onMeasure, onStreetView, personRef, personDragged, onOpenChange }, buttonRef) {
  const [open, setOpenState] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const setOpen = (v: boolean) => {
    setOpenState(v);
    onOpenChange(v);
  };
  const button = () => (typeof buttonRef === 'object' ? buttonRef?.current : null);

  // A tap or click outside closes the menu.
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) {
        setOpenState(false);
        onOpenChange(false);
      }
    };
    document.addEventListener('pointerdown', down);
    // Opened from the keyboard or a tap: the first item takes focus.
    menu.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
    return () => document.removeEventListener('pointerdown', down);
  }, [open, onOpenChange]);

  const items = () => [...(menu.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])') ?? [])];
  const onKey = (e: React.KeyboardEvent) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      button()?.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = list.length;
      list[(i + (e.key === 'ArrowDown' ? 1 : -1) + n) % n]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      list[e.key === 'Home' ? 0 : list.length - 1]?.focus();
    } else if (e.key === 'Tab') setOpen(false);
  };
  const pick = (run: () => void) => () => {
    setOpen(false);
    run();
  };
  const active = layersOn || measuring || streetView;

  return (
    <div ref={box} className="vc-map-tools">
      <button
        ref={buttonRef}
        type="button"
        className="vc-map-fab"
        data-on={active || undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Wrench size={17} strokeWidth={1.9} aria-hidden="true" />
        <span>Tools</span>
        <ChevronDown size={14} className="vc-map-chev" data-open={open} aria-hidden="true" />
      </button>
      {open && (
        <div ref={menu} className="vc-map-tools-menu" role="menu" aria-label="Map tools" onKeyDown={onKey}>
          <Item icon={<Layers size={18} strokeWidth={1.9} />} checked={layersOn} onClick={pick(onLayers)}>
            Layers
          </Item>
          <Item icon={<Crosshair size={18} strokeWidth={1.9} />} onClick={pick(onLocate)}>
            My location
          </Item>
          <Item icon={<Ruler size={18} strokeWidth={1.9} />} checked={measuring} onClick={pick(onMeasure)}>
            Measure
          </Item>
          <Item
            ref={personRef}
            className="vc-pegman"
            icon={<PersonStanding size={18} strokeWidth={1.9} />}
            checked={streetView}
            disabled={!ready && !streetView}
            title={ready ? 'Street view (or drag it onto the map, or press and hold on the map)' : 'Street view: the map is loading'}
            onClick={() => {
              if (personDragged()) return;
              pick(onStreetView)();
            }}
          >
            Street view
          </Item>
        </div>
      )}
    </div>
  );
});

interface ItemProps {
  icon: ReactNode;
  children: ReactNode;
  onClick: () => void;
  /** For the tools that stay on (Layers, Measure, Street view): whether it is on now. */
  checked?: boolean;
  disabled?: boolean;
  className?: string;
  title?: string;
}

const Item = forwardRef<HTMLButtonElement, ItemProps>(function Item({ icon, children, onClick, checked, disabled, className, title }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
      aria-checked={checked}
      className={`vc-map-tools-item${className ? ` ${className}` : ''}`}
      disabled={disabled}
      title={title}
      tabIndex={-1}
      onClick={onClick}
    >
      <span className="vc-map-tools-icon" aria-hidden="true">
        {icon}
      </span>
      <span>{children}</span>
      {checked && <span className="vc-map-tools-on">On</span>}
    </button>
  );
});
