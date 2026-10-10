import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { Order } from '@citrus/shared';
import { api } from '../../lib/api';
import { setCached, useQuery } from '../../lib/query';
import { dstr, inr, num } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { itemsOf, type Page } from '../../lib/types';
import { ErrorNote } from '../../components/Bits';
import { Icon } from '../../components/Icon';
import { OrderRow, StatusPill, tabOf } from './ui';
import '../../panel-dist.css';

export default function History() {
  const { t } = useT();
  const nav = useNavigate();
  const { data, error, refresh } = useQuery<Order[] | Page<Order>>('/api/distributor/history', { staleMs: 30_000 });
  const items = itemsOf(data)?.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const next = data && !Array.isArray(data) ? data.nextCursor : undefined;
  const [busy, setBusy] = useState(false);
  const to = (o: Order) => `/queue/${o.id}${tabOf(o) === 'you' ? '' : `?tab=${tabOf(o)}`}`;
  async function more() {
    if (!next) return;
    setBusy(true);
    try {
      const pg = await api.get<Page<Order>>(`/api/distributor/history?cursor=${encodeURIComponent(next)}`);
      setCached<Order[] | Page<Order>>('/api/distributor/history', p => ({ items: [...(itemsOf(p) ?? []), ...pg.items], nextCursor: pg.nextCursor }));
    } finally { setBusy(false); }
  }
  return (
    <div className="dp">
      <header className="dp-ph">
        <div>
          <h1>{t('history')}</h1>
          <p className="dp-sub">Orders you approved or rejected, and orders the store answered</p>
        </div>
      </header>
      {error && !items && <ErrorNote error={error} onRetry={refresh} />}
      {!items && !error && <div className="dp-card dp-rows">{[0, 1, 2].map(i => <div key={i} className="dp-row skel-row"><span className="dp-skel" style={{ width: '40%' }} /><span className="dp-skel" style={{ width: '70%' }} /></div>)}</div>}
      {items && (items.length ? (
        <>
          <div className="dp-card dp-table-wrap dp-wide-only">
            <table className="dp-table">
              <thead><tr><th>Order</th><th>Store</th><th>Status</th><th className="r">Pcs</th><th className="r">Value</th><th>Placed</th><th>Last update</th></tr></thead>
              <tbody>
                {items.map(o => (
                  <tr key={o.id} tabIndex={0} onClick={() => nav(to(o))} onKeyDown={e => { if (e.key === 'Enter') nav(to(o)); }}>
                    <td><span className="dp-id">{o.number}</span></td>
                    <td><b>{o.store}</b><span className="muted"> · {o.city}</span>{o.reason && <div className="dp-why">{o.reason}</div>}</td>
                    <td><StatusPill o={o} /></td>
                    <td className="r num">{num(o.totalQty)}</td>
                    <td className="r num">{inr(o.totalValue)}</td>
                    <td className="muted nw">{dstr(o.placedAt)}</td>
                    <td className="muted nw">{dstr(o.updatedAt)}<Icon name="fwd" size={14} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="dp-card dp-rows dp-narrow-only">{items.map(o => <OrderRow key={o.id} o={o} to={to(o)} />)}</div>
        </>
      ) : <div className="dp-card dp-empty"><span className="dp-empty-ic"><Icon name="inbox" size={20} /></span><b>Nothing here yet</b><p>Orders you approve, modify or reject appear here.</p></div>)}
      {next && <div className="dp-more"><button type="button" className="dp-btn ghost" onClick={more} disabled={busy}>{busy ? 'Loading…' : 'Show older'}</button></div>}
    </div>
  );
}
