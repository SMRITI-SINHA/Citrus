import { useState } from 'react';
import type { Order } from '@citrus/shared';
import { api } from '../../lib/api';
import { setCached } from '../../lib/query';
import { dstr, inr, num } from '../../lib/format';
import { useT } from '../../lib/i18n';
import type { Page } from '../../lib/types';
import { soShown, useMyOrders } from '../../state/orders';
import { PLink } from '../../components/PLink';
import { CardSkeletons, ErrorNote, StatusBadge } from '../../components/Bits';
import { ContactButtons } from '../../components/Contact';

export function OrderCard({ o }: { o: Order }) {
  return (
    <PLink to={`/orders/${o.id}`} className="card qitem" style={{ color: 'inherit', textDecoration: 'none' }} data={`/api/orders/${o.id}`}>
      <div className="top"><b className="mono">{o.number}</b><StatusBadge status={o.status} /></div>
      <span className="muted" style={{ fontSize: 13 }}>{dstr(o.placedAt)} · {num(o.totalQty)} pcs · {inr(o.totalValue)}</span>
      {o.status === 'modified' && <b style={{ fontSize: 13 }}>Your answer needed: {o.distributorName} suggested changes</b>}
      {soShown(o) && <span className="muted xs">CITRUS order {soShown(o)}</span>}
    </PLink>
  );
}

export default function Orders() {
  const { t } = useT();
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
  const sorted = data ? [...data].sort((a, b) => (a.status === 'modified' ? -1 : 0) - (b.status === 'modified' ? -1 : 0) || b.placedAt.localeCompare(a.placedAt)) : undefined;
  return (
    <>
      <h1 className="title">{t('orders')}</h1>
      {error && !data && <ErrorNote error={error} onRetry={refresh} />}
      {!data && !error && <CardSkeletons n={4} h={86} />}
      {sorted && (sorted.length ? (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,280px),1fr))', gap: 12 }}>
          {sorted.map(o => <OrderCard key={o.id} o={o} />)}
        </div>
      ) : <div className="card empty"><h3>No orders yet</h3><p>Orders you place here appear with live status.</p><div style={{ marginTop: 14 }}><PLink to="/catalogue" className="btn">{t('browse')}</PLink></div></div>)}
      {nextCursor && <div className="row" style={{ justifyContent: 'center' }}><button type="button" className="btn sec" onClick={more} disabled={busy}>{busy ? 'Loading…' : 'Show older orders'}</button></div>}
      <ContactButtons context="Question about my CITRUS orders" />
    </>
  );
}
