// Distributor panel building blocks: status language ("who acts next"), the size-by-colour matrix,
// the activity timeline and the dense order row. Styled by ../../panel-dist.css under `.dp`.
import type { ReactNode } from 'react';
import type { Order, OrderEvent, OrderLine, OrderStatus } from '@citrus/shared';
import { POLICY } from '@citrus/shared';
import { age, hhmm, inr, minutesSince, num } from '../../lib/format';
import { PLink } from '../../components/PLink';
import { Icon, type IconName } from '../../components/Icon';
import '../../panel-dist.css';

// ---------- status, in the distributor's words ----------
export type Who = 'you' | 'store' | 'citrus' | 'none';
export interface StatusInfo { label: string; who: Who; next: string }

export function statusInfo(o: Order): StatusInfo {
  const s = o.store;
  switch (o.status) {
    case 'placed': return { label: 'Holding stock', who: 'citrus', next: 'Ginesys is holding the stock. It reaches you in a moment.' };
    case 'review': return { label: 'Waiting for you', who: 'you', next: 'Approve, lower quantities or reject. Stock stays held in Ginesys while you decide.' };
    case 'modified': return { label: 'Waiting for store', who: 'store', next: `${s} accepts or declines your changes in the app. A reminder goes after ${POLICY.changeReminderHours} hours.` };
    case 'approved': return { label: 'Approved', who: 'citrus', next: 'CITRUS is creating the sales order in Ginesys.' };
    case 'confirmed': return { label: 'Sales order created', who: 'citrus', next: 'The CITRUS warehouse packs the order next.' };
    case 'processing': return { label: 'Packing', who: 'citrus', next: 'Being packed at the CITRUS warehouse.' };
    case 'dispatched': return { label: 'Dispatched', who: 'citrus', next: 'On the way to the store.' };
    case 'delivered': return { label: 'Delivered', who: 'none', next: 'Delivered to the store. Nothing left to do.' };
    case 'rejected': return { label: 'Rejected', who: 'none', next: o.reason ? `Rejected: ${o.reason}` : 'Rejected. The held stock was released.' };
    case 'cancelled': return { label: declined(o) ? 'Store declined' : 'Cancelled', who: 'none', next: declined(o) ? `${s} declined your changes. The order was cancelled and the stock released.` : o.reason ?? 'Cancelled.' };
  }
}
const declined = (o: Order) => o.events.some(e => e.type === 'cancelled' && e.actor === 'retailer');
export const WHO_LABEL: Record<Who, string> = { you: 'You', store: 'Store', citrus: 'CITRUS', none: 'No one' };

export function Pill({ status, children, dot = true }: { status: OrderStatus | 'sla'; children: ReactNode; dot?: boolean }) {
  return <span className={`dp-pill st-${status}${dot ? '' : ' nodot'}`}>{children}</span>;
}
export function StatusPill({ o }: { o: Order }) { return <Pill status={o.status}>{statusInfo(o).label}</Pill>; }

export const overSla = (o: Order) => o.status === 'review' && minutesSince(o.placedAt) > POLICY.approvalSlaHours * 60;

// ---------- tabs ----------
export type TabKey = 'you' | 'store' | 'approved' | 'all';
export const TABS: { key: TabKey; label: string; short: string; match: (o: Order) => boolean }[] = [
  { key: 'you', label: 'Waiting for you', short: 'For you', match: o => o.status === 'review' || o.status === 'placed' },
  { key: 'store', label: 'Waiting for store', short: 'With store', match: o => o.status === 'modified' },
  { key: 'approved', label: 'Approved', short: 'Approved', match: o => ['approved', 'confirmed', 'processing', 'dispatched', 'delivered'].includes(o.status) },
  { key: 'all', label: 'All', short: 'All', match: () => true },
];
export const tabOf = (o: Order): TabKey => TABS.find(t => t.key !== 'all' && t.match(o))?.key ?? 'all';

// ---------- size matrix ----------
const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'];
const sizeRank = (z: string) => { const i = SIZE_ORDER.indexOf(z); return i < 0 ? 100 + (parseInt(z, 10) || 0) : i; };

export interface MxCell { size: string; idx: number; qty: number; was?: number; proposed?: number }
export interface MxRow { key: string; styleId: string; name: string; color: string; cells: (MxCell | null)[]; qty: number; value: number; rate: number }

/** Lines grouped style x colour with one column per size. `changes` are shown as proposed (status modified) or agreed (after). */
export function buildMatrix(o: Order) {
  const proposing = o.status === 'modified';
  const changes = o.changes ?? [];
  const lines: (OrderLine & { idx: number })[] = o.lines.map((l, idx) => ({ ...l, idx }));
  // After the store accepted, lines cut to 0 are gone from the order: keep them visible as "0, was N".
  if (!proposing) for (const c of changes) if (c.to === 0 && !lines.some(l => l.styleId === c.styleId && l.color === c.color && l.size === c.size)) {
    const twin = lines.find(l => l.styleId === c.styleId);
    lines.push({ styleId: c.styleId, name: twin?.name ?? c.styleId, color: c.color, size: c.size, qty: 0, rate: twin?.rate ?? 0, points: 0, idx: -1 });
  }
  const sizes = [...new Set(lines.map(l => l.size))].sort((a, b) => sizeRank(a) - sizeRank(b));
  const rows = new Map<string, MxRow>();
  for (const l of lines) {
    const k = `${l.styleId}|${l.color}`;
    if (!rows.has(k)) rows.set(k, { key: k, styleId: l.styleId, name: l.name, color: l.color, cells: sizes.map(() => null), qty: 0, value: 0, rate: l.rate });
    const r = rows.get(k)!;
    const c = changes.find(x => x.styleId === l.styleId && x.color === l.color && x.size === l.size);
    const cell: MxCell = { size: l.size, idx: l.idx, qty: l.qty };
    if (c && proposing) cell.proposed = c.to;
    else if (c && !proposing && l.qty === c.to) cell.was = c.from;
    r.cells[sizes.indexOf(l.size)] = cell;
    r.qty += l.qty; r.value += l.qty * l.rate;
  }
  return { sizes, rows: [...rows.values()] };
}

// ---------- activity ----------
const EV: Record<string, { title: string; icon: IconName; tone: string }> = {
  placed: { title: 'Order placed', icon: 'cart', tone: 'info' },
  reserved: { title: 'Stock held in Ginesys', icon: 'lock', tone: 'muted' },
  modified: { title: 'Changes proposed', icon: 'edit', tone: 'answer' },
  accepted: { title: 'Store accepted the changes', icon: 'check', tone: 'ok' },
  approved: { title: 'Approved', icon: 'check', tone: 'ok' },
  confirmed: { title: 'CITRUS sales order created', icon: 'file', tone: 'confirmed' },
  processing: { title: 'Packing', icon: 'box', tone: 'muted' },
  dispatched: { title: 'Dispatched', icon: 'truck', tone: 'muted' },
  delivered: { title: 'Delivered', icon: 'check', tone: 'ok' },
  rejected: { title: 'Rejected', icon: 'x', tone: 'bad' },
  cancelled: { title: 'Cancelled', icon: 'x', tone: 'bad' },
};
function actorOf(e: OrderEvent, o: Order) {
  switch (e.actor) {
    case 'retailer': return o.store;
    case 'distributor': return 'You';
    case 'admin': return 'CITRUS team';
    case 'erp': return 'Ginesys';
    default: return 'CITRUS Trade';
  }
}
function dayLabel(d: Date) {
  const today = new Date(); const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

export function Activity({ o }: { o: Order }) {
  const evs = o.events.map((e, i) => ({ e, i })).sort((a, b) => b.e.at.localeCompare(a.e.at) || b.i - a.i).map(x => x.e);
  const days: { label: string; evs: OrderEvent[] }[] = [];
  for (const e of evs) {
    const l = dayLabel(new Date(e.at));
    if (days[days.length - 1]?.label !== l) days.push({ label: l, evs: [] });
    days[days.length - 1].evs.push(e);
  }
  return (
    <div className="dp-tl">
      {days.map(d => (
        <section key={d.label}>
          <h4 className="dp-tl-day">{d.label}</h4>
          <ol>
            {d.evs.map((e, i) => {
              const k = EV[e.type] ?? { title: e.type, icon: 'spark' as IconName, tone: 'muted' };
              const title = e.type === 'cancelled' && e.actor === 'retailer' ? 'Store declined the changes' : e.type === 'confirmed' && o.erp.soNumber ? 'CITRUS sales order created' : k.title;
              return (
                <li key={e.at + i} className={`t-${k.tone}`}>
                  <span className="dp-tl-ic" aria-hidden><Icon name={k.icon} size={13} /></span>
                  <div className="dp-tl-b">
                    <div className="dp-tl-h"><b>{title}</b><time dateTime={e.at} title={new Date(e.at).toLocaleString('en-IN')}>{hhmm(e.at)}</time></div>
                    <p>{e.message}</p>
                    <span className="dp-tl-who">{actorOf(e, o)}</span>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}

// ---------- order row (queue + history) ----------
export function OrderRow({ o, to, current, showStatus = true }: { o: Order; to: string; current?: boolean; showStatus?: boolean }) {
  const late = overSla(o);
  return (
    <PLink to={to} className={`dp-row${current ? ' on' : ''}`} aria-current={current ? 'true' : undefined}>
      <div className="dp-row-a">
        <b className="dp-row-store">{o.store}</b>
        <span className="dp-row-val">{inr(o.totalValue)}</span>
      </div>
      <div className="dp-row-b">
        <span className="dp-row-meta"><span className="dp-id">{o.number}</span><span className="sep" />{o.city}<span className="sep" />{num(o.totalQty)} pcs</span>
        {o.status === 'review'
          ? <span className={`dp-wait${late ? ' late' : minutesSince(o.placedAt) > 120 ? ' warm' : ''}`}>{late && <Icon name="alert" size={12} />}{minutesSince(o.placedAt) < 1 ? 'Just now' : age(o.placedAt)}</span>
          : showStatus ? <StatusPill o={o} /> : null}
      </div>
      {o.note && o.status === 'review' && <div className="dp-row-note">“{o.note}”</div>}
    </PLink>
  );
}
