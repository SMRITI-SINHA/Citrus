// Loaders that only appear on a real wait, and use the wait to tell the store something useful.
// Nothing shows for the first few hundred milliseconds, so instant screens never flash a spinner.
// Lines are picked for the moment (placing an order, opening a screen) and personalised from the store's
// own data; later an AI endpoint can write them per store from its sales history. Same component, new source.
import { useEffect, useMemo, useState } from 'react';
import { useMe } from '../state/session';
import { useCart } from '../state/cart';
import { nextTier } from '../lib/rewards';
import { num } from '../lib/format';

export type LoadContext = 'placing' | 'opening' | 'reorder';

const TRADE_TIPS = [
  'Keep M and L the deepest. In menswear they sell out first.',
  'Navy, white and sky blue shirts are the backbone of a shirt wall. Never let them hit zero.',
  'Show a shirt with its trouser on the same hanger. A ready look sells two pieces, not one.',
  'Fold by size, hang by colour. Customers find their size faster and buy sooner.',
  'Book festive stock early. Onam and Christmas weeks sell out before the reorder lands.',
  'A missing size is a lost customer. Reorder best-sellers before they reach zero.',
  'Charcoal and black formal trousers move fastest in wedding season.',
  'Put new arrivals at eye level near the entrance. Regulars notice them first.',
  'Linen and linen-blend shirts sell best from March to June. Plan the summer drop now.',
  'Slim fit for under-30 customers, regular fit for office buyers. Stock both in your top colours.',
  'Count sizes, not styles: five colours with no XL is still a gap on the wall.',
  'NOS styles never go out of stock at CITRUS, so you can order small and often.',
];

function personal(me: ReturnType<typeof useMe>, pieces: number): string[] {
  const out: string[] = [];
  const pts = me.points ?? 0, tier = nextTier(pts);
  if (tier.away > 0) out.push(`You are ${num(tier.away)} points away from the ${tier.next.name}.`);
  if (pieces) out.push(`${num(pieces)} pieces in this order. Points are added the day it is delivered.`);
  const city = me.retailer?.city;
  if (city) out.push(`Your distributor serves ${city} stores the same day it approves an order.`);
  return out;
}

const STEPS: Record<LoadContext, string[]> = {
  placing: ['Checking live stock in every size', 'Holding your stock at the CITRUS warehouse', 'Sending it to your distributor for approval'],
  opening: ['Getting the latest stock', 'Picking styles for your store'],
  reorder: ['Matching your last order to today\'s stock', 'Working out what can be sent'],
};

function useRotating(lines: string[], ms: number) {
  const [i, setI] = useState(() => Math.floor(Math.random() * lines.length));
  useEffect(() => { const t = setInterval(() => setI(x => (x + 1) % lines.length), ms); return () => clearInterval(t); }, [lines.length, ms]);
  return lines[i % lines.length];
}

function useDelay(ms: number) {
  const [on, setOn] = useState(ms === 0);
  useEffect(() => { if (ms === 0) return; const t = setTimeout(() => setOn(true), ms); return () => clearTimeout(t); }, [ms]);
  return on;
}

/** A loader with a progress step and a rotating tip. `delay` keeps it hidden on quick loads. */
export function SmartLoader({ context = 'opening', delay = 400, overlay }: { context?: LoadContext; delay?: number; overlay?: boolean }) {
  const me = useMe();
  const { pieces } = useCart();
  const shown = useDelay(delay);
  const tips = useMemo(() => {
    const p = personal(me, context === 'placing' ? pieces : 0);
    // Mix the store's own facts in between trade tips so the line changes every time.
    const mixed = [...TRADE_TIPS].sort(() => Math.random() - 0.5);
    p.forEach((x, k) => mixed.splice(k * 3, 0, x));
    return mixed;
  }, [me, pieces, context]);
  const tip = useRotating(tips, 3200);
  const steps = STEPS[context];
  const [step, setStep] = useState(0);
  useEffect(() => { const t = setInterval(() => setStep(s => Math.min(s + 1, steps.length - 1)), 900); return () => clearInterval(t); }, [steps.length]);
  if (!shown) return null;
  const body = (
    <div className="sload" role="status" aria-live="polite">
      <span className="sl-ring" aria-hidden="true"><i /></span>
      <b className="sl-step">{steps[step]}…</b>
      <p className="sl-tip" key={tip}><span className="sl-kicker">Retail tip</span>{tip}</p>
    </div>
  );
  return overlay ? <div className="sload-veil">{body}</div> : body;
}
