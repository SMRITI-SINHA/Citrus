// Distributor scorecard: who decides quickly, who lets orders wait, and how often CITRUS had to step in.
import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { DistributorScore } from '@citrus/shared';
import { POLICY } from '@citrus/shared';
import { useQuery } from '../../lib/query';
import { num } from '../../lib/format';
import { PLink } from '../../components/PLink';
import { ErrorNote } from '../../components/Bits';
import { PageHeader, Panel } from './shared';

type SortKey = 'waiting' | 'slow' | 'sla' | 'orders' | 'name';
const SORTS: [SortKey, string][] = [['waiting', 'Most waiting'], ['slow', 'Slowest'], ['sla', 'Lowest within time'], ['orders', 'Most orders'], ['name', 'Name']];

export default function Distributors() {
  const nav = useNavigate();
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
  const tone = (d: DistributorScore) => d.withinSlaPct == null ? 'idle' : d.withinSlaPct >= 90 ? 'ok' : d.withinSlaPct >= 70 ? 'warn' : 'bad';
  const waiting = data?.reduce((a, d) => a + d.waiting, 0) ?? 0;
  const orders = data?.reduce((a, d) => a + d.orders30d, 0) ?? 0;
  const slaRows = data?.filter(d => d.withinSlaPct != null) ?? [];
  const sla = slaRows.length ? slaRows.reduce((a, d) => a + d.withinSlaPct! * d.orders30d, 0) / Math.max(1, slaRows.reduce((a, d) => a + d.orders30d, 0)) : null;
  const overrides = data?.reduce((a, d) => a + d.overrides30d, 0) ?? 0;
  const href = (d: DistributorScore) => `/admin/orders?status=review&distributorId=${encodeURIComponent(d.id)}&dname=${encodeURIComponent(d.name)}`;
  return (
    <>
      <PageHeader title="Distributors" sub={`Approval scorecard, last 30 days. Target: a decision within ${POLICY.approvalSlaHours} hours.`} />
      {data && (
        <div className="ap-kpis ap-kpis-4">
          <div className="ap-kpi"><div className="ap-kpi-l">Distributors</div><div className="ap-kpi-v num">{num(data.length)}</div><div className="ap-kpi-s">{num(orders)} orders in 30 days</div></div>
          <div className="ap-kpi"><div className="ap-kpi-l">Waiting for a decision</div><div className="ap-kpi-v num">{num(waiting)}</div><div className="ap-kpi-s">Orders across all distributors</div></div>
          <div className="ap-kpi"><div className="ap-kpi-l">Decided within {POLICY.approvalSlaHours}h</div><div className="ap-kpi-v num">{sla == null ? '—' : `${sla.toFixed(1)}%`}</div><div className="ap-kpi-s">Weighted by order count</div></div>
          <div className="ap-kpi"><div className="ap-kpi-l">CITRUS stepped in</div><div className="ap-kpi-v num">{num(overrides)}</div><div className="ap-kpi-s">Decisions taken for a distributor</div></div>
        </div>
      )}
      {error && !data && <ErrorNote error={error} onRetry={refresh} />}
      {!data && !error && <div className="ap-card ap-skel" style={{ height: 360 }} />}
      {rows && (
        <Panel title="Scorecard" count={rows.length} flush
          action={<label className="ap-sel"><span>Sort</span><select value={sort} onChange={e => setSort(e.target.value as SortKey)}>{SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>}>
          <div className="ap-tw">
            <table className="ap-t ap-t-dist">
              <thead><tr><th className="c-name">Distributor</th><th className="c-wait r">Waiting</th><th className="c-avg r">Avg decision</th><th className="c-sla">Within time</th><th className="c-ord r">Orders</th><th className="c-rej r">Rejected</th><th className="c-ovr r">Stepped in</th></tr></thead>
              <tbody>{rows.map(d => (
                <tr key={d.id} className={d.waiting ? undefined : 'noclick'} onClick={e => { if (d.waiting && !(e.target as HTMLElement).closest('a,button')) nav(href(d)); }}>
                  <td className="c-name"><span className="ap-store"><b>{d.name}</b><span>{d.city}, {d.state}</span></span></td>
                  <td className="c-wait r">{d.waiting ? <PLink to={href(d)} className={`ap-pill t-${d.waiting > 3 ? 'warn' : 'idle'} num`}>{num(d.waiting)} waiting</PLink> : <span className="muted num">0</span>}</td>
                  <td className="c-avg r num">{d.avgDecisionHours == null ? <span className="muted">—</span> : <span className={d.avgDecisionHours > POLICY.approvalSlaHours ? 'bad-ink' : ''}>{d.avgDecisionHours.toFixed(1)} h</span>}</td>
                  <td className="c-sla">{d.withinSlaPct == null ? <span className="muted">—</span> : <span className={`ap-slab t-${tone(d)}`}><span className="ap-gauge"><i style={{ width: `${d.withinSlaPct}%` }} /></span><span className="num">{d.withinSlaPct}%</span></span>}</td>
                  <td className="c-ord r num">{num(d.orders30d)}</td>
                  <td className="c-rej r num">{d.rejected30d ? num(d.rejected30d) : <span className="muted">0</span>}</td>
                  <td className="c-ovr r num">{d.overrides30d ? <b>{num(d.overrides30d)}</b> : <span className="muted">0</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Panel>
      )}
    </>
  );
}
