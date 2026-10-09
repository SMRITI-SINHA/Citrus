// Bottom sheet on phones, centred dialog on larger screens.
// Focus moves into the sheet, is trapped there, Escape closes, and focus returns to the opener.
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Sheet({ open, onClose, label, title, eyebrow, children, wide, initialFocus }: {
  open: boolean; onClose: () => void; label: string; title?: ReactNode; eyebrow?: ReactNode; children: ReactNode; wide?: boolean;
  /** CSS selector inside the sheet to focus first */ initialFocus?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    const el = ref.current!;
    const first = (initialFocus && el.querySelector<HTMLElement>(initialFocus)) || el;
    requestAnimationFrame(() => first.focus({ preventScroll: true }));
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.body.classList.add('sheet-open');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); return; }
      if (e.key !== 'Tab') return;
      const f = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(x => x.offsetParent !== null);
      if (!f.length) return;
      const a = f[0], z = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === a || document.activeElement === el)) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
      document.body.classList.remove('sheet-open');
      const o = opener.current as HTMLElement | null;
      if (o && document.contains(o)) o.focus({ preventScroll: true });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`sheet${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} ref={ref}>
        {(title || eyebrow) && (
          <div className="shead">
            <div style={{ minWidth: 0 }}>{eyebrow && <div className="eyebrow">{eyebrow}</div>}{title && <h3 style={{ marginTop: eyebrow ? 4 : 0 }}>{title}</h3>}</div>
            <button type="button" className="close" onClick={onClose} aria-label="Close"><Icon name="x" size={18} /></button>
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}
