import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { IconButton } from './Button';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** center: modal dialog; right: side panel; bottom: mobile sheet. */
  placement?: 'center' | 'right' | 'bottom' | 'responsive-right';
  className?: string;
  labelHidden?: boolean;
}

/**
 * Accessible dialog built on the native <dialog> element (focus containment, Escape to close,
 * top-layer rendering, and focus return are handled by the browser).
 */
export function Dialog({ open, onClose, title, description, children, footer, placement = 'center', className, labelHidden }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      document.documentElement.style.overflow = 'hidden';
    } else if (!open && el.open) {
      el.close();
    }
    return () => {
      document.documentElement.style.overflow = '';
    };
  }, [open]);

  const place =
    placement === 'right'
      ? 'm-0 ml-auto h-dvh max-h-dvh w-full max-w-lg rounded-none border-l animate-slide-in-right'
      : placement === 'bottom'
        ? 'mx-0 mb-0 mt-auto w-full max-w-none max-h-[88dvh] rounded-t-2xl border-t animate-slide-up'
        : placement === 'responsive-right'
          ? 'mx-0 mb-0 mt-auto w-full max-w-none max-h-[88dvh] rounded-t-2xl border-t animate-slide-up md:m-0 md:ml-auto md:h-dvh md:max-h-dvh md:max-w-xl md:rounded-none md:border-l md:border-t-0 md:animate-slide-in-right'
          : 'm-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border animate-rise';

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClose={() => open && onClose()}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cn('border-line bg-surface p-0 text-fg shadow-2xl', place, className)}
    >
      {open && (
        <div className="flex h-full max-h-[inherit] flex-col">
          <header className="flex items-start gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className={cn('text-base font-semibold', labelHidden && 'sr-only')}>
                {title}
              </h2>
              {description && (
                <p id={descId} className="mt-0.5 text-sm text-muted">
                  {description}
                </p>
              )}
            </div>
            <IconButton label="Close" size="sm" onClick={onClose} className="-mr-2 -mt-1">
              <X className="size-4" />
            </IconButton>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
          {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}
