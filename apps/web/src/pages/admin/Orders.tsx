// Every order across distributors: search by order no., SO no., store or code; filter by status.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { Order } from '@citrus/shared';
import { retailerLabel } from '@citrus/shared';
import { usePaged } from '../../lib/query';
import { Icon } from '../../components/Icon';
import { ErrorNote } from '../../components/Bits';
import { OrdersTable } from './shared';

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
  return (
    <>
      <h1 className="title">Orders</h1>
      <div className="card panel">
        <label className="search" style={{ minHeight: 44 }}><Icon name="search" /><span className="sr">Search orders</span>
          <input type="search" placeholder="Order no., SO no., store or code" value={q} onChange={e => setQ(e.target.value)} /></label>
        <div className="chips" role="group" aria-label="Filter by status">
          {FILTERS.map(([v, l]) => (
            <button type="button" key={v} className="chip" aria-pressed={status === v}
              onClick={() => setSp(p => { const n = new URLSearchParams(p); if (v) n.set('status', v); else n.delete('status'); return n; }, { replace: true })}>{l}</button>
          ))}
        </div>
        {did && <div className="row"><span className="status s-info">Distributor: {sp.get('dname') ?? did}</span><button type="button" className="linkbtn" onClick={() => setSp(p => { const n = new URLSearchParams(p); n.delete('distributorId'); n.delete('dname'); return n; }, { replace: true })}>Show all distributors</button></div>}
        {error && !items ? <ErrorNote error={error} onRetry={refresh} /> : <OrdersTable orders={items} />}
        {next && <div className="row" style={{ justifyContent: 'center' }}><button type="button" className="btn sec" onClick={more} disabled={busy}>{busy ? 'Loading…' : 'Show more'}</button></div>}
      </div>
    </>
  );
}
