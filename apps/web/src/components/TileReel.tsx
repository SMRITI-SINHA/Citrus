// A product photo that plays through its other shots, like the model videos on Amazon and Myntra tiles.
// Laptop: plays while the pointer rests on the tile. Phone: a touch starts it, and it stops once the tile
// scrolls away or after two rounds. Nothing sits on the photo except thin progress marks while it plays.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Garment, reelFor, type GarmentSpec } from './Garment';

const STEP = 1300;

export function TileReel({ spec }: { spec: GarmentSpec }) {
  const shots = useMemo(() => reelFor(spec), [spec.styleId, spec.color, spec.hex, spec.kind, spec.pattern]); // eslint-disable-line react-hooks/exhaustive-deps
  const [on, setOn] = useState(false);
  const [i, setI] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!on) { setI(0); return; }
    shots.forEach(x => { const im = new Image(); im.src = x.src; });
    let k = 0;
    const t = setInterval(() => { k++; if (k >= shots.length * 2) { setOn(false); return; } setI(k % shots.length); }, STEP);
    return () => clearInterval(t);
  }, [on, shots]);

  // On touch screens, stop when the tile leaves the screen.
  useEffect(() => {
    if (!on || !ref.current || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => { if (e.intersectionRatio < 0.4) setOn(false); }, { threshold: [0, 0.4] });
    io.observe(ref.current); return () => io.disconnect();
  }, [on]);

  const tile = () => ref.current?.closest('.ptile');
  useEffect(() => {
    const el = tile(); if (!el) return;
    const enter = (e: PointerEvent) => { if (e.pointerType === 'mouse') setOn(true); };
    const leave = (e: PointerEvent) => { if (e.pointerType === 'mouse') setOn(false); };
    const touch = () => setOn(true);
    el.addEventListener('pointerenter', enter as EventListener);
    el.addEventListener('pointerleave', leave as EventListener);
    ref.current!.addEventListener('touchstart', touch, { passive: true });
    const r = ref.current!;
    return () => { el.removeEventListener('pointerenter', enter as EventListener); el.removeEventListener('pointerleave', leave as EventListener); r.removeEventListener('touchstart', touch); };
  }, []);

  return (
    <span ref={ref} className={`reel${on ? ' on' : ''}`}>
      <Garment spec={spec} swatch={false} />
      {on && shots.slice(1).map((x, k) => (
        <img key={x.key} className={`reel-shot${i === k + 1 ? ' show' : ''}`} src={x.src} alt="" draggable={false} decoding="async"
          style={{ objectPosition: x.pos, ['--z' as string]: x.zoom, transformOrigin: x.pos }} />
      ))}
      {on && <span className="reel-bar" aria-hidden="true">{shots.map((x, k) => <i key={x.key} className={k < i ? 'done' : k === i ? 'now' : ''} />)}</span>}
    </span>
  );
}
