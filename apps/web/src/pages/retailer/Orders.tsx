import { useState } from 'react';
import type { Order, OrderStatus } from '@citrus/shared';
import { useSearchParams } from 'react-router';
import { api } from '../../lib/api';
import { setCached } from '../../lib/query';
import { dmy, dstr, num } from '../../lib/format';
import { POLICY } from '@citrus/shared';
import { avail, spec, useStyles } from '../../state/catalogue';
import { Garment } from '../../components/Garment';
import { Icon } from '../../components/Icon';
import { PcsChip, PtsChip, ValueTxt } from '../../components/Price';
import { SecHead } from '../../components/Bits';
import { ReorderSheet, type ReorderRef } from './ReorderSheet';
import { useT } from '../../lib/i18n';
import type { Page } from '../../lib/types';
import { soShown, useMyOrders } from '../../state/orders';
import { PLink } from '../../components/PLink';
import { CardSkeletons, ErrorNote, StatusBadge } from '../../components/Bits';

function HistoryCard({ o, inStock, note, onReorder }: { o: Order; inStock?: number; note?: string; onReorder?: () => void }) {
  const looks = [...new Map(o.lines.map(l => [l.styleId + '|' + l.color, l])).values()];
  const styles = useStyles(looks.map(l => l.styleId));
  return (
    <div className={`card hcard${onReorder ? '' : ' past'}`}>
      <PLink to={`/orders/${o.id}`} className="hc-top" data={`/api/orders/${o.id}`}>
        <div className="top"><b className="mono">{o.number}</b><span className="muted small">{dmy(o.placedAt)}</span></div>
        <span className={`colltag${o.collection && o.collection !== 'NOS' ? ' seas' : ''}`}>{o.collection && o.collection !== 'NOS' ? o.collection : 'NOS essentials'}</span>
        <div className="thumbs">{looks.slice(0, 4).map(l => <span key={l.styleId + l.color}><Garment spec={spec(styles[l.styleId], l.color)} /></span>)}{looks.length > 4 && <span className="more">+{looks.length - 4}</span>}</div>
        <div className="vrow"><PcsChip n={o.totalQty} /><ValueTxt amt={o.totalValue} /><PtsChip n={o.totalPoints} /></div>
      </PLink>
      {onReorder
        ? <div className="hc-act"><span className="ok-ink small"><Icon name="check" size={14} /> {inStock === o.totalQty ? 'All in stock' : `${num(inStock ?? 0)} of ${num(o.totalQty)} pcs in stock`}</span><button type="button" className="btn sm" onClick={onReorder}><Icon name="refresh" size={14} />Reorder</button></div>
        : <div className="hc-act"><span className="muted small">{note}</span></div>}
    </div>
  );
}

export function OrderCard({ o }: { o: Order }) {
  return (
    <PLink to={`/orders/${o.id}`} className="card qitem" style={{ color: 'inherit', textDecoration: 'none' }} data={`/api/orders/${o.id}`}>
      <div className="top"><b className="mono">{o.number}</b><StatusBadge status={o.status} /></div>
      <span className="muted small">{dstr(o.placedAt)}</span>
      <div className="vrow"><PcsChip n={o.totalQty} /><ValueTxt amt={o.totalValue} /><PtsChip n={o.totalPoints} /></div>
      {o.status === 'modified' && <b style={{ fontSize: 13 }}>Your answer needed: {o.distributorName} suggested changes</b>}
      {soShown(o) && <span className="muted xs">CITRUS order {soShown(o)}</span>}
    </PLink>
  );
}

const FILTERS: { key: string; label: string; sub: string; keys?: OrderStatus[] }[] = [
  { key: 'all', label: 'All', sub: 'Live status, updated at every step' },
  { key: 'pending', label: 'Pending review', sub: 'Waiting for your distributor to check', keys: ['placed', 'review'] },
  { key: 'answer', label: 'Your answer needed', sub: 'Your distributor suggested changes', keys: ['modified'] },
  { key: 'approved', label: 'Approved', sub: 'Approved, CITRUS order being created', keys: ['approved'] },
  { key: 'confirmed', label: 'Confirmed', sub: 'CITRUS order number issued', keys: ['confirmed'] },
  { key: 'processing', label: 'Processing', sub: 'Being packed at the warehouse', keys: ['processing'] },
  { key: 'dispatched', label: 'Dispatched', sub: 'With the courier', keys: ['dispatched'] },
];

export default function Orders() {
  const { t } = useT();
  const [sp, setSp] = useSearchParams();
  const { data, error, refresh, nextCursor } = useMyOrders();
  const [busy, setBusy] = useState(false);
  async function more() {
    if (!nextCursor) return;
    setBusy(true);
    try {
      const pg = await api.get<Page<Order>>(`/api/orders?cursor=${encodeURIComponent(nextCursor)}`);
      setCached<Order[] | Page<Order>>('/api/orders', p => {
        const prev = Array.isArray(p) ? p : p?.items ?? [];
        const seen = new Set(prev.map(o => o.id));
        return { items: [...prev, ...pg.items.filter(o => !seen.has(o.id))], nextCursor: pg.nextCursor };
      });
    } finally { setBusy(false); }
  }
  const all = data ?? [];
  const styles = useStyles(all.flatMap(o => o.lines.map(l => l.styleId)));
  const [reorder, setReorder] = useState<ReorderRef | null>(null);
  const active = all.filter(o => !['delivered', 'rejected', 'cancelled'].includes(o.status))
    .sort((a, b) => (a.status === 'modified' ? -1 : 0) - (b.status === 'modified' ? -1 : 0) || b.placedAt.localeCompare(a.placedAt));
  const done = all.filter(o => !active.includes(o)).sort((a, b) => b.placedAt.localeCompare(a.placedAt));
  const stockOf = (o: Order) => o.lines.reduce((a, l) => { const s = styles[l.styleId]; return a + (s ? Math.min(l.qty, avail(s, l.color, l.size)) : 0); }, 0);
  const isNos = (o: Order) => !o.collection || o.collection === 'NOS';
  const inWindow = (o: Order) => Date.now() - Date.parse(o.placedAt) < POLICY.reorderWindowDays * 864e5;
  const canReorder = (o: Order) => o.status === 'delivered' && inWindow(o) && stockOf(o) > 0;
  const again = done.filter(canReorder);
  const past = done.filter(o => !canReorder(o));
  const why = (o: Order) => o.status === 'rejected' ? `Not approved: ${o.reason ?? 'see the order for details'}` : o.status === 'cancelled' ? 'Cancelled.' : !isNos(o) ? `${o.collection} collection. These styles are sold out, so this order can't be repeated.`
    : !inWindow(o) ? `Older than ${POLICY.reorderWindowDays} days. Find these styles in the catalogue.` : 'None of these sizes are in stock right now.';
  const counts = (keys: OrderStatus[]) => active.filter(o => keys.includes(o.status)).length;
  const filt = FILTERS.find(f => f.key === sp.get('status')) ?? FILTERS[0];
  const shown = filt.keys ? active.filter(o => filt.keys!.includes(o.status)) : active;
  const tab = sp.get('tab') === 'history' ? 'history' : 'active';
  const set = (k: string, v: string | null) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  return (
    <>
      <h1 className="title">{t('orders')}</h1>
      {error && !data && <ErrorNote error={error} onRetry={refresh} />}
      {!data && !error && <CardSkeletons n={4} h={86} />}
      {data && !all.length && <div className="card empty"><h3>No orders yet</h3><p>Orders you place here appear with live status.</p><div style={{ marginTop: 14 }}><PLink to="/catalogue" className="btn">{t('browse')}</PLink></div></div>}
      {data && all.length > 0 && (
        <div className="otabs" role="tablist" aria-label="Orders">
          <button type="button" role="tab" aria-selected={tab === 'active'} className={tab === 'active' ? 'on' : ''} onClick={() => set('tab', null)}>Active orders <span className="ocount">{active.length}</span></button>
          <button type="button" role="tab" aria-selected={tab === 'history'} className={tab === 'history' ? 'on' : ''} onClick={() => set('tab', 'history')}>Order history <span className="ocount">{all.length}</span></button>
        </div>
      )}
      {data && all.length > 0 && tab === 'active' && (
        <section className="stack" style={{ gap: 12 }} role="tabpanel">
          <div className="ofilters" role="group" aria-label="Filter by status">
            {FILTERS.map(f => {
              const n = f.keys ? counts(f.keys) : active.length;
              return <button key={f.key} type="button" className={`ofchip${f === filt ? ' on' : ''}${f.key === 'answer' && n ? ' hot' : ''}`} aria-pressed={f === filt} onClick={() => set('status', f.key === 'all' ? null : f.key)}>{f.label}<span>{n}</span></button>;
            })}
          </div>
          <SecHead title={filt.key === 'all' ? 'Current orders' : `${filt.label} orders`} sub={filt.sub} />
          {shown.length ? <div className="ogrid">{shown.map(o => <OrderCard key={o.id} o={o} />)}</div>
            : <div className="card empty" style={{ padding: 22 }}><b>No orders {filt.key === 'all' ? 'on the way' : `at "${filt.label}"`} right now.</b><br />{filt.key === 'all' ? 'Place an order and follow every step here.' : <button type="button" className="linkbtn" onClick={() => set('status', null)}>Show all current orders</button>}</div>}
        </section>
      )}
      {data && all.length > 0 && tab === 'history' && (
        <div className="stack" style={{ gap: 22 }} role="tabpanel">
          <p className="muted" style={{ margin: 0 }}>Every order you have placed, newest first. Filters don't apply here.</p>
          {again.length > 0 && (
            <section className="stack" style={{ gap: 10 }}>
              <SecHead title="Order again" sub="NOS essentials, delivered in the last 90 days. Reorder in one tap, checked against today's stock." />
              <div className="ogrid">{again.map(o => <HistoryCard key={o.id} o={o} inStock={stockOf(o)} onReorder={() => setReorder({ orderId: o.id, number: o.number, placedAt: o.placedAt })} />)}</div>
            </section>
          )}
          {active.length > 0 && (
            <section className="stack" style={{ gap: 10 }}>
              <SecHead title="On the way" sub="Not delivered yet" />
              <div className="ogrid">{[...active].sort((a, b) => b.placedAt.localeCompare(a.placedAt)).map(o => <OrderCard key={o.id} o={o} />)}</div>
            </section>
          )}
          {past.length > 0 && (
            <section className="stack" style={{ gap: 10 }}>
              <SecHead title="Can't be reordered" sub="Out of stock, seasonal, older than 90 days, or not delivered" />
              <div className="ogrid">{past.map(o => <HistoryCard key={o.id} o={o} note={why(o)} />)}</div>
            </section>
          )}
        </div>
      )}
      <ReorderSheet card={reorder} onClose={() => setReorder(null)} />
      {nextCursor && <div className="row" style={{ justifyContent: 'center' }}><button type="button" className="btn sec" onClick={more} disabled={busy}>{busy ? 'Loading…' : 'Show older orders'}</button></div>}
    </>
  );
}
