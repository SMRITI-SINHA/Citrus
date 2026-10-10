// The retailer's live order timeline. Each step fills in as the order moves (distributor, CITRUS, warehouse, courier);
// updates arrive live, so the order-placed screen and the order page both tick forward on their own.
import type { Order, OrderStatus } from '@citrus/shared';
import { RETAILER_STEPS, retailerLabel } from '@citrus/shared';
import { dstr } from '../lib/format';
import { soShown } from '../state/orders';
import { Icon } from './Icon';

const IDX = Object.fromEntries(RETAILER_STEPS.map((s, i) => [s.key, i])) as Record<string, number>;

export function when(o: Order, k: OrderStatus): string | undefined {
  if (k === 'placed') return o.placedAt;
  // Status times come from the event trail (API event types: reserved, approved, changes_accepted, confirmed, ...).
  const types: Partial<Record<OrderStatus, string[]>> = { review: ['reserved'], approved: ['approved', 'changes_accepted'] };
  const want = types[k] ?? [k];
  return [...o.events].reverse().find(e => want.includes(e.type))?.at;
}

/** What each step means, shown under steps that haven't happened yet. */
function ahead(k: OrderStatus, o: Order): string {
  return {
    placed: 'Stock checked and held for you',
    review: `${o.distributorName} checks the order. If they suggest a change, nothing goes ahead without your OK.`,
    approved: `${o.distributorName} approves it`,
    confirmed: 'CITRUS confirms it and sends your order number',
    processing: 'Packed at the CITRUS warehouse',
    dispatched: 'Courier tracking on WhatsApp',
    delivered: 'Points are added to your account',
    modified: '', rejected: '', cancelled: '',
  }[k];
}

export function OrderTimeline({ o }: { o: Order }) {
  const ended = o.status === 'rejected' || o.status === 'cancelled';
  const cur = o.status === 'modified' ? IDX.review : IDX[o.status] ?? 0;
  const extra = (k: OrderStatus): string => {
    if (k === 'placed' && o.status === 'placed') return 'Holding your stock';
    if (k === 'review') return o.distributorName;
    if (k === 'approved' && o.status === 'approved') return 'Creating your CITRUS order';
    if (k === 'confirmed' && soShown(o)) return `CITRUS order ${soShown(o)}`;
    if (k === 'dispatched' && o.erp.awb) return `Courier AWB ${o.erp.awb}`;
    return '';
  };
  if (ended) {
    return (
      <div className="tl">
        {RETAILER_STEPS.slice(0, 2).map(s => (
          <div key={s.key} className="st done"><span className="dot"><Icon name="check" size={16} /></span><div><div className="lbl">{s.label}</div><div className="when">{when(o, s.key) ? dstr(when(o, s.key)!) : ''}</div></div></div>
        ))}
        <div className="st bad"><span className="dot"><Icon name="x" size={16} /></span><div><div className="lbl">{o.status === 'cancelled' ? 'Cancelled' : `Not approved by ${o.distributorName}`}</div><div className="when">{dstr(o.updatedAt)}{o.reason ? ` · ${o.reason}` : ''}</div></div></div>
      </div>
    );
  }
  return (
    <div className="tl" aria-live="polite">
      {RETAILER_STEPS.map((s, i) => {
        const isDone = i < cur || o.status === 'delivered' || (i === cur && i === 0 && o.status !== 'placed');
        const isNow = !isDone && i === cur;
        const w = when(o, s.key);
        const ex = extra(s.key);
        const label = s.key === 'review' && o.status === 'modified' ? retailerLabel('modified') : s.label;
        return (
          <div key={s.key} className={`st${isDone ? ' done' : isNow ? ' now' : ' later'}`}>
            <span className="dot">{isDone && <Icon name="check" size={16} />}</span>
            <div>
              <div className="lbl">{label}{isNow && <span className="nowtag">Now</span>}</div>
              <div className="when">{isDone || isNow ? <>{w ? dstr(w) : isNow ? 'In progress' : ''}{ex ? `${w || isNow ? ' · ' : ''}${ex}` : ''}</> : ahead(s.key, o)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
