// Every order across distributors (Shopify index-table pattern): status tabs, search, one table, load more.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { Order } from '@citrus/shared';
import { retailerLabel } from '@citrus/shared';
import { usePaged } from '../../lib/query';
import { num } from '../../lib/format';
import { Icon } from '../../components/Icon';
import { ErrorNote } from '../../components/Bits';
import { OrdersTable, PageHeader } from './shared';

const FILTERS: [string, string][] = [
  ['', 'All'], ['attention', 'Needs attention'], ['review', 'With distributor'], ['modified', retailerLabel('modified')],
  ['approved', 'Creating SO'], ['confirmed', 'Confirmed'], ['dispatched', 'Dispatched'], ['rejected,cancelled', 'Rejected or cancelled'],
];

export default function AdminOrders() {
  const [sp, setSp] = useSearchParams();
  const status = sp.get('status') ?? '';
  const [q, setQ] = useState(sp.get('q') ?? '');
  // Debounced search into the URL, so back/forward and shared links keep the filter.
  useEffect(() => {
    const id = setTimeout(() => setSp(p => { const n = new URLSearchParams(p); if (q.trim()) n.set('q', q.trim()); else n.delete('q'); return n; }, { replace: true }), 250);
    return () => clearTimeout(id);
  }, [q, setSp]);
  const did = sp.get('distributorId');
  const qs = new URLSearchParams({ ...(sp.get('q') ? { q: sp.get('q')! } : {}), ...(status ? { status } : {}), ...(did ? { distributorId: did } : {}) }).toString();
  const { items, next, more, busy, error, refresh } = usePaged<Order>(`/api/admin/orders${qs ? `?${qs}` : ''}`);
  const known = FILTERS.some(([v]) => v === status);
  return (
    <>
      <PageHeader title="Orders" sub="Every order across distributors. Search by order number, SO number, store or store code." />
      <section className="ap-card">
        <div className="ap-tabs" role="group" aria-label="Filter by status">
          {FILTERS.map(([v, l]) => (
            <button type="button" key={v} className="ap-tab" aria-pressed={status === v}
              onClick={() => setSp(p => { const n = new URLSearchParams(p); if (v) n.set('status', v); else n.delete('status'); return n; }, { replace: true })}>
              {l}{status === v && items && <span className="ap-count num">{num(items.length)}{next ? '+' : ''}</span>}
            </button>
          ))}
          {!known && <button type="button" className="ap-tab" aria-pressed="true">{retailerLabel(status as Order['status']) ?? status}{items && <span className="ap-count num">{num(items.length)}</span>}</button>}
        </div>
        <div className="ap-toolbar">
          <label className="ap-search"><Icon name="search" size={16} /><span className="sr">Search orders</span>
            <input type="search" placeholder="Search orders" value={q} onChange={e => setQ(e.target.value)} /></label>
          {did && <span className="ap-fchip">Distributor: <b>{sp.get('dname') ?? did}</b>
            <button type="button" aria-label="Show all distributors" onClick={() => setSp(p => { const n = new URLSearchParams(p); n.delete('distributorId'); n.delete('dname'); return n; }, { replace: true })}><Icon name="x" size={12} /></button></span>}
        </div>
        {error && !items ? <div className="ap-card-b"><ErrorNote error={error} onRetry={refresh} /></div> : <OrdersTable orders={items} empty={q ? `No orders match “${q}”.` : 'No orders in this view.'} />}
        {items && items.length > 0 && (
          <div className="ap-foot">
            <span className="num">{num(items.length)} order{items.length === 1 ? '' : 's'}{next ? ' shown' : ''}</span>
            {next && <button type="button" className="ap-btn" onClick={more} disabled={busy}>{busy ? 'Loading…' : 'Load more'}</button>}
          </div>
        )}
      </section>
    </>
  );
}
