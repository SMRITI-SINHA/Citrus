// A sideways row with big arrow buttons, so nobody has to guess that the row scrolls.
// Arrows show only when there is more to see in that direction; the row still swipes on touch.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Icon } from './Icon';

export function Rail({ children, style, label }: { children: ReactNode; style?: CSSProperties; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ l: false, r: false });
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const upd = () => setEdge({ l: el.scrollLeft > 4, r: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
    upd();
    el.addEventListener('scroll', upd, { passive: true });
    const ro = new ResizeObserver(upd); ro.observe(el);
    const mo = new MutationObserver(upd); mo.observe(el, { childList: true });
    return () => { el.removeEventListener('scroll', upd); ro.disconnect(); mo.disconnect(); };
  }, []);
  const go = (d: number) => { const el = ref.current; if (el) el.scrollBy({ left: d * Math.max(200, el.clientWidth * 0.85), behavior: 'smooth' }); };
  return (
    <div className="rail-wrap">
      <div ref={ref} className="hscroll" style={style} role="region" aria-label={label}>{children}</div>
      {edge.l && <button type="button" className="rail-btn l" onClick={() => go(-1)} aria-label="Show previous"><Icon name="back" size={20} /></button>}
      {edge.r && <button type="button" className="rail-btn r" onClick={() => go(1)} aria-label="Show more"><Icon name="fwd" size={20} /></button>}
    </div>
  );
}
