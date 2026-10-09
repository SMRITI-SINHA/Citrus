import { useState } from 'react';
import type { Order } from '@citrus/shared';
import { api } from '../../lib/api';
import { setCached, useQuery } from '../../lib/query';
import { dstr, inr, num } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { itemsOf, type Page } from '../../lib/types';
import { CardSkeletons, ErrorNote, StatusBadge } from '../../components/Bits';

export default function History() {
  const { t } = useT();
  const { data, error, refresh } = useQuery<Order[] | Page<Order>>('/api/distributor/history', { staleMs: 30_000 });
  const items = itemsOf(data);
  const next = data && !Array.isArray(data) ? data.nextCursor : undefined;
  const [busy, setBusy] = useState(false);
  async function more() {
    if (!next) return;
    setBusy(true);
    try {
      const pg = await api.get<Page<Order>>(`/api/distributor/history?cursor=${encodeURIComponent(next)}`);
      setCached<Order[] | Page<Order>>('/api/distributor/history', p => ({ items: [...(itemsOf(p) ?? []), ...pg.items], nextCursor: pg.nextCursor }));
    } finally { setBusy(false); }
  }
  return (
    <>
      <h1 className="title">{t('history')}</h1>
      {error && !items && <ErrorNote error={error} onRetry={refresh} />}
      {!items && !error && <CardSkeletons n={3} h={64} />}
      {items && (items.length ? (
        <div className="card cq">
          <table className="tbl">
            <thead><tr><th>Order</th><th>Retailer</th><th className="r p3">Pcs</th><th className="r p1">Value</th><th>Status</th><th className="p2">Placed</th></tr></thead>
            <tbody>
              {items.map(o => (
                <tr key={o.id}>
                  <td className="mono nw">{o.number}</td><td>{o.store}<div className="muted xs">{o.city}<span className="np1">{num(o.totalQty)} pcs · {inr(o.totalValue)}</span></div></td>
                  <td className="r num p3">{num(o.totalQty)}</td><td className="r num nw p1">{inr(o.totalValue)}</td>
                  <td><StatusBadge status={o.status} label={o.status === 'modified' ? 'Modified, awaiting retailer' : undefined} />{o.reason && <div className="muted xs">{o.reason}</div>}</td>
                  <td className="nw muted p2">{dstr(o.placedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <div className="card empty"><h3>Nothing here yet</h3><p>Orders you approve, modify or reject appear here.</p></div>)}
      {next && <div className="row" style={{ justifyContent: 'center' }}><button type="button" className="btn sec" onClick={more} disabled={busy}>{busy ? 'Loading…' : 'Show older'}</button></div>}
    </>
  );
}
