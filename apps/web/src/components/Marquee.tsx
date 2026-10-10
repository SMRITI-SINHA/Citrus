// A row that drifts right to left on its own, like a shop window, and never gets in the way:
// it keeps moving while you scroll or point at it, stops only while a finger is dragging it, has arrows
// on either side to move it yourself, and picks up again on its own a moment after you let go.
import { Children, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

const SPEED = 28; // px per second: slow enough to read every label

export function Marquee({ children, label }: { children: ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const hold = useRef(false);                        // a finger is on the row
  const idleUntil = useRef(0);                       // resume after manual moves
  const base = Children.toArray(children);
  // One loop "set" must be wider than the row itself, or the row hits its end before it can wrap
  // (a wide laptop showing every shelf at once). Repeat the shelves inside a set until it is.
  const [reps, setReps] = useState(1);
  useEffect(() => {
    const el = ref.current; if (!el || !base.length) return;
    const fit = () => {
      const one = el.querySelector('[data-mq-item]') as HTMLElement | null; if (!one) return;
      const itemW = one.offsetWidth + (parseFloat(getComputedStyle(el).columnGap) || 16);
      setReps(Math.max(1, Math.ceil((el.clientWidth + itemW * 2) / (base.length * itemW))));
    };
    fit();
    const ro = new ResizeObserver(fit); ro.observe(el);
    return () => ro.disconnect();
  }, [base.length]);
  const items = Array.from({ length: reps }, () => base).flat();

  useEffect(() => {
    const el = ref.current; if (!el) return;
    let raf = 0, last = performance.now();
    const setW = () => el.scrollWidth / 3;
    // Start in the middle copy so the row can loop both ways.
    el.scrollLeft = setW();
    // Keep our own fractional position: browsers round scrollLeft on zoomed or high-density screens,
    // so adding a pixel at a time could round back to the same spot and freeze the row.
    let pos = el.scrollLeft;
    const tick = (t: number) => {
      const dt = Math.min(64, t - last); last = t;
      const w = setW();
      // A swipe or arrow moved the row: carry on from wherever it is now.
      if (Math.abs(el.scrollLeft - pos) > 2) pos = el.scrollLeft;
      if (!hold.current && t > idleUntil.current) pos += (SPEED * dt) / 1000;
      if (pos >= w * 2) pos -= w;
      else if (pos < w * 0.5) pos += w;
      if (Math.round(pos) !== el.scrollLeft) el.scrollLeft = pos;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reps]);

  const nudge = () => { idleUntil.current = performance.now() + 1500; };
  const go = (d: number) => {
    const el = ref.current; if (!el) return;
    nudge();
    const step = (el.querySelector('[data-mq-item]') as HTMLElement | null)?.offsetWidth ?? 120;
    el.scrollBy({ left: d * (step + 16) * 2, behavior: 'smooth' });
  };

  return (
    <div className="mq">
      <div ref={ref} className="mq-track" role="region" aria-label={label}
        onTouchStart={() => { hold.current = true; }} onTouchEnd={() => { hold.current = false; nudge(); }}
        onTouchCancel={() => { hold.current = false; nudge(); }}>
        {[0, 1, 2].map(copy => items.map((it, i) => (
          <div key={`${copy}-${i}`} className="mq-item" data-mq-item aria-hidden={copy !== 1 || undefined}>{it}</div>
        )))}
      </div>
      <button type="button" className="mq-btn mq-prev" onClick={() => go(-1)} aria-label="Move left"><Icon name="back" size={16} /></button>
      <button type="button" className="mq-btn mq-next" onClick={() => go(1)} aria-label="Move right"><Icon name="fwd" size={16} /></button>
    </div>
  );
}
