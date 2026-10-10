// A row that drifts right to left on its own, like a shop window, and never gets in the way:
// it stops while you hover, touch, swipe or focus it, has arrows on either side to move it yourself,
// and picks up again on its own a few seconds after you let go.
import { Children, useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';

const SPEED = 28; // px per second: slow enough to read every label

export function Marquee({ children, label }: { children: ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hold = useRef(false);                        // hover / touch / focus
  const idleUntil = useRef(0);                       // resume after manual moves
  const items = Children.toArray(children);

  useEffect(() => {
    const el = ref.current; if (!el) return;
    let raf = 0, last = performance.now(), acc = 0;
    const setW = () => el.scrollWidth / 3;
    // Start in the middle copy so the row can loop both ways.
    el.scrollLeft = setW();
    const tick = (t: number) => {
      const dt = Math.min(64, t - last); last = t;
      const w = setW();
      if (!reduce && !hold.current && t > idleUntil.current) {
        acc += (SPEED * dt) / 1000;
        if (acc >= 1) { el.scrollLeft += Math.floor(acc); acc -= Math.floor(acc); }
      }
      if (el.scrollLeft >= w * 2) el.scrollLeft -= w;
      else if (el.scrollLeft < w * 0.5) el.scrollLeft += w;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduce]);

  const nudge = () => { idleUntil.current = performance.now() + 3500; };
  const go = (d: number) => {
    const el = ref.current; if (!el) return;
    nudge();
    const step = (el.querySelector('[data-mq-item]') as HTMLElement | null)?.offsetWidth ?? 120;
    el.scrollBy({ left: d * (step + 16) * 2, behavior: 'smooth' });
  };

  return (
    <div className="mq">
      <div ref={ref} className="mq-track" role="region" aria-label={label}
        onPointerEnter={e => { if (e.pointerType === 'mouse') hold.current = true; }}
        onPointerLeave={e => { if (e.pointerType === 'mouse') { hold.current = false; nudge(); } }}
        onTouchStart={() => { hold.current = true; }} onTouchEnd={() => { hold.current = false; nudge(); }}
        onWheel={nudge} onFocus={() => { hold.current = true; }} onBlur={() => { hold.current = false; nudge(); }}>
        {[0, 1, 2].map(copy => items.map((it, i) => (
          <div key={`${copy}-${i}`} className="mq-item" data-mq-item aria-hidden={copy !== 1 || undefined} inert={copy !== 1 ? true : undefined}>{it}</div>
        )))}
      </div>
      <button type="button" className="mq-btn mq-prev" onClick={() => go(-1)} aria-label="Move left"><Icon name="back" size={16} /></button>
      <button type="button" className="mq-btn mq-next" onClick={() => go(1)} aria-label="Move right"><Icon name="fwd" size={16} /></button>
    </div>
  );
}
