// Distributor scorecard: who decides quickly, who lets orders wait, and how often CITRUS had to step in.
import { useState } from 'react';
import type { DistributorScore } from '@citrus/shared';
import { POLICY } from '@citrus/shared';
import { useQuery } from '../../lib/query';
import { num } from '../../lib/format';
import { PLink } from '../../components/PLink';
import { CardSkeletons, ErrorNote } from '../../components/Bits';

type SortKey = 'waiting' | 'slow' | 'sla' | 'orders' | 'name';
const SORTS: [SortKey, string][] = [['waiting', 'Most waiting'], ['slow', 'Slowest'], ['sla', 'Lowest within time'], ['orders', 'Most orders'], ['name', 'Name']];

export default function Distributors() {
  const { data, error, refresh } = useQuery<DistributorScore[]>('/api/admin/distributors', { staleMs: 60_000 });
  const [sort, setSort] = useState<SortKey>('waiting');
  const rows = data && [...data].sort((a, b) => {
    switch (sort) {
      case 'waiting': return b.waiting - a.waiting || (b.avgDecisionHours ?? 0) - (a.avgDecisionHours ?? 0);
      case 'slow': return (b.avgDecisionHours ?? -1) - (a.avgDecisionHours ?? -1);
      case 'sla': return (a.withinSlaPct ?? 101) - (b.withinSlaPct ?? 101);
      case 'orders': return b.orders30d - a.orders30d;
      default: return a.name.localeCompare(b.name);
    }
  });
  const tone = (d: DistributorScore) => d.withinSlaPct == null ? '' : d.withinSlaPct >= 90 ? 's-ok' : d.withinSlaPct >= 70 ? 's-warn' : 's-bad';
  return (
    <>
      <div className="sec-h"><div><h1 className="title">Distributors</h1><div className="sub">Last 30 days. Approval time target: {POLICY.approvalSlaHours} hours.</div></div></div>
      <div className="chips" role="group" aria-label="Sort">{SORTS.map(([k, l]) => <button type="button" key={k} className="chip" aria-pressed={sort === k} onClick={() => setSort(k)}>{l}</button>)}</div>
      {error && !data && <ErrorNote error={error} onRetry={refresh} />}
      {!data && !error && <CardSkeletons n={1} h={360} />}
      {rows && (
        <div className="card panel cq">
          <table className="tbl">
            <thead><tr><th>Distributor</th><th className="r">Waiting now</th><th className="r p1">Avg decision</th><th className="r">Within time</th><th className="r p2">Orders</th><th className="r p3">Rejected</th><th className="r p2">CITRUS stepped in</th></tr></thead>
            <tbody>{rows.map(d => (
              <tr key={d.id}>
                <td><b>{d.name}</b><div className="muted xs">{d.city}, {d.state}</div></td>
                <td className="r num">{d.waiting ? <PLink to={`/admin/orders?status=review&distributorId=${encodeURIComponent(d.id)}&dname=${encodeURIComponent(d.name)}`} className={`status ${d.waiting > 3 ? 's-warn' : 's-info'}`}>{num(d.waiting)}</PLink> : <span className="muted">0</span>}</td>
                <td className="r num nw p1">{d.avgDecisionHours == null ? <span className="muted">-</span> : `${d.avgDecisionHours}h`}</td>
                <td className="r">{d.withinSlaPct == null ? <span className="muted">-</span> : <span className={`status ${tone(d)}`}>{d.withinSlaPct}%</span>}</td>
                <td className="r num p2">{num(d.orders30d)}</td>
                <td className="r num p3">{num(d.rejected30d)}</td>
                <td className="r num p2">{d.overrides30d ? <b>{num(d.overrides30d)}</b> : <span className="muted">0</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </>
  );
}
