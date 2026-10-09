// Windowed product grid for long catalogues: only rows near the viewport are in the DOM.
// Column count follows the same breakpoints as the .grid CSS (2 / 3 / 4); row height is measured.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

function cols() { const w = window.innerWidth; return w >= 1400 ? 4 : w >= 768 ? 3 : 2; }
function rowGap() { return window.innerWidth >= 768 ? 18 : 12; }

export function VirtualGrid<T>({ items, render, keyOf, threshold = 40 }: { items: T[]; render: (t: T) => ReactNode; keyOf: (t: T) => string; threshold?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const firstRow = useRef<HTMLDivElement>(null);
  const [c, setC] = useState(cols);
  const [rh, setRh] = useState(0);
  const [range, setRange] = useState<[number, number]>([0, 6]);
  const virtual = items.length > threshold;
  const rows = Math.ceil(items.length / c);
  const gap = rowGap();

  useEffect(() => {
    const on = () => setC(cols());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);

  useLayoutEffect(() => {
    if (!virtual || !firstRow.current) return;
    const ro = new ResizeObserver(() => { const h = firstRow.current?.offsetHeight ?? 0; if (h) setRh(h); });
    ro.observe(firstRow.current);
    return () => ro.disconnect();
  });

  useEffect(() => {
    if (!virtual) return;
    let raf = 0;
    const calc = () => {
      raf = 0;
      const el = ref.current; if (!el || !rh) return;
      const top = el.getBoundingClientRect().top;
      const step = rh + gap;
      const vh = window.innerHeight;
      const a = Math.max(0, Math.floor(-top / step) - 3);
      const b = Math.min(rows, Math.ceil((vh - top) / step) + 3);
      setRange(r => (r[0] === a && r[1] === b ? r : [a, b]));
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(calc); };
    calc();
    window.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', on);
    return () => { window.removeEventListener('scroll', on); window.removeEventListener('resize', on); cancelAnimationFrame(raf); };
  }, [virtual, rh, gap, rows]);

  if (!virtual) return <div className="grid">{items.map(i => <div key={keyOf(i)} style={{ minWidth: 0 }}>{render(i)}</div>)}</div>;

  const [a, b] = rh ? range : [0, Math.min(rows, 4)];
  const step = rh + gap;
  const out: ReactNode[] = [];
  for (let r = a; r < b; r++) {
    const slice = items.slice(r * c, r * c + c);
    out.push(
      <div key={r} ref={r === a ? firstRow : undefined} className="grid" style={{ position: rh ? 'absolute' : 'relative', top: rh ? r * step : undefined, left: 0, right: 0 }} role="presentation">
        {slice.map(i => <div key={keyOf(i)} style={{ minWidth: 0 }}>{render(i)}</div>)}
      </div>,
    );
  }
  return <div ref={ref} style={{ position: 'relative', height: rh ? rows * step - gap : undefined }}>{out}</div>;
}
