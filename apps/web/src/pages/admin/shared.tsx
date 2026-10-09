import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { AdminException, AdminOverview, Order } from '@citrus/shared';
import { ASSUMPTIONS } from '@citrus/shared';
import { api, ApiError } from '../../lib/api';
import { updateWhere, useQuery } from '../../lib/query';
import { upsertOrder } from '../../state/orders';
import { toast } from '../../state/toast';
import { Icon } from '../../components/Icon';
import { PLink } from '../../components/PLink';
import { StatusBadge } from '../../components/Bits';
import { age, inr, num } from '../../lib/format';

export type Exc = AdminException;
export type Overview = AdminOverview;
const SEV = { bad: 0, warn: 1, info: 2 } as const;
/** Most severe first, newest first within a severity. */
export const exceptionsOf = (o?: Overview): Exc[] => [...(o?.live?.exceptions ?? [])].sort((a, b) => SEV[a.severity] - SEV[b.severity] || b.at.localeCompare(a.at));
export const dropExc = (id: string) => updateWhere<Overview>('/api/admin/overview', ov => ({ ...ov, live: { ...ov.live, exceptions: ov.live.exceptions.filter(e => e.id !== id) } }));
const TONE = { bad: 's-bad', warn: 's-warn', info: 's-info' } as const;

export function erpText(o: Order): string {
  const e = o.erp;
  if (e.state === 'failed') return `Sync failed${e.lastError ? ` · ${e.lastError}` : ''}`;
  if (e.state === 'retrying') return `Retrying (attempt ${e.attempts})${e.lastError ? ` · ${e.lastError}` : ''}`;
  if (e.erpStatus) return [e.erpStatus === 'UNAUTHORIZED' ? 'Stock held (unauthorised SO)' : e.erpStatus === 'AUTHORIZED' ? 'SO authorised' : e.erpStatus.charAt(0) + e.erpStatus.slice(1).toLowerCase().replace(/_/g, ' '), e.soNumber, e.awb ? `AWB ${e.awb}` : ''].filter(Boolean).join(' · ');
  return {
    placed: `Reserving stock${e.reservationRef ? ` · ${e.reservationRef}` : ''}`, review: `Stock reserved${e.reservationRef ? ` · ${e.reservationRef}` : ''} · awaiting distributor`,
    modified: 'Modified · awaiting retailer', approved: 'Creating sales order', confirmed: `SO created${e.soNumber ? ` · ${e.soNumber}` : ''}`,
    processing: 'Processing · invoice pending', dispatched: `Dispatched${e.awb ? ` · AWB ${e.awb}` : ''}`, delivered: 'Delivered',
    rejected: 'Rejected · reservation released', cancelled: 'Cancelled · reservation released',
  }[o.status];
}

export function ExceptionRow({ x }: { x: Exc }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'failed'>('idle');
  const [err, setErr] = useState('');
  async function retry() {
    if (!x.orderId) return;
    setState('busy'); setErr('');
    try {
      const o = await api.post<Order>(`/api/admin/orders/${encodeURIComponent(x.orderId)}/retry`);
      upsertOrder(o);
      setState('done');
      if (o.erp.state !== 'failed') dropExc(x.id);
      toast(o.erp.state === 'synced' ? `${o.number}: Ginesys accepted it on retry` : `${o.number}: sent to Ginesys again`);
    } catch (e) {
      setState('failed'); setErr(e instanceof ApiError ? e.message : 'Retry failed');
    }
  }
  async function resolve() {
    setState('busy');
    try { await api.post(`/api/admin/exceptions/${encodeURIComponent(x.id)}/resolve`); dropExc(x.id); setState('done'); toast('Marked as resolved'); }
    catch (e) { setState('failed'); setErr(e instanceof ApiError ? e.message : 'Could not resolve'); }
  }
  return (
    <div className="exc">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className={`status ${TONE[x.severity]}`}>{x.title}</span>
        {x.canRetry && x.orderId && state !== 'done' && (
          <button type="button" className="btn sec sm" onClick={retry} disabled={state === 'busy'}><Icon name="refresh" size={14} />{state === 'busy' ? 'Retrying…' : 'Retry now'}</button>
        )}
        {state === 'done' && <span className="status s-ok">Done</span>}
      </div>
      <span>{x.orderNumber && <b className="mono">{x.orderNumber} · </b>}{x.detail}</span>
      <div className="row" style={{ gap: 14 }}>
        {x.orderId && x.kind === 'sla' && state !== 'done' && <PLink to={`/admin/orders/${encodeURIComponent(x.orderId)}?act=1`} className="btn sm">Decide for distributor</PLink>}
        {x.orderId && <PLink to={`/admin/orders/${encodeURIComponent(x.orderId)}`} className="linkbtn">Open order</PLink>}
        {state !== 'done' && <button type="button" className="linkbtn" onClick={resolve} disabled={state === 'busy'}>Mark resolved</button>}
      </div>
      {err && <span className="bad-ink small" role="alert">{err}</span>}
    </div>
  );
}

/** Assumptions register: unconfirmed rules the system currently runs on. Admin only, never shown to retailers. */
export function PendingConfirmation({ compact }: { compact?: boolean }) {
  const { data } = useQuery<typeof ASSUMPTIONS>('/api/admin/assumptions', { staleMs: 300_000 });
  const list = data ?? ASSUMPTIONS;
  const shown = compact ? list.slice(0, 5) : list;
  return (
    <div className="card panel">
      <div className="sec-h"><div><h3>Pending confirmation</h3><div className="sub">Rules the system runs on today that CITRUS has not confirmed yet. Not shown to retailers.</div></div>
        <span className="status s-warn">{list.length} open</span></div>
      <div className="cq">
        <table className="tbl">
          <thead><tr><th>Rule</th><th>Current behaviour</th><th className="p2">Owner</th><th className="p1">Kind</th></tr></thead>
          <tbody>{shown.map(a => (
            <tr key={a.id}><td><b>{a.title}</b><div className="np1 muted xs">{a.kind === 'erp' ? 'ERP' : 'Business'} · {a.owner}</div></td><td>{a.current}</td><td className="nw p2">{a.owner}</td><td className="p1"><span className={`status ${a.kind === 'erp' ? 's-info' : 's-warn'}`}>{a.kind === 'erp' ? 'ERP' : 'Business'}</span></td></tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Orders table with column priorities: the container decides which columns fit, so nothing is ever cut off.
 * Always: order, retailer, retailer status. Then Ginesys, value, pieces and age, distributor.
 */
export function OrdersTable({ orders, empty = 'No orders match.' }: { orders: Order[] | undefined; empty?: string }) {
  const nav = useNavigate();
  if (!orders) return <div className="skel" style={{ height: 240 }} aria-busy="true" />;
  if (!orders.length) return <div className="empty">{empty}</div>;
  return (
    <div className="cq">
      <table className="tbl otbl">
        <thead><tr><th className="p0">Order</th><th>Retailer</th><th className="p4">Distributor</th><th className="r p3">Pcs</th><th className="r p2">Value</th><th>Retailer sees</th><th className="p1">Ginesys</th><th className="r p3">Age</th></tr></thead>
        <tbody>{orders.map(o => {
          const href = `/admin/orders/${encodeURIComponent(o.id)}`;
          return (
            <tr key={o.id} className={o.erp.state === 'failed' ? 'row-bad clickrow' : 'clickrow'} onClick={e => { if (!(e.target as HTMLElement).closest('a,button')) nav(href, { viewTransition: true }); }}>
              <td className="mono nw p0"><PLink to={href} data={`/api/admin/orders/${o.id}`}>{o.number}</PLink></td>
              <td><PLink to={href} className="np0 mono xs">{o.number}</PLink>{o.store}<div className="muted xs">{o.city}</div></td>
              <td className="muted p4">{o.distributorName}</td>
              <td className="r num p3">{num(o.totalQty)}</td>
              <td className="r num nw p2">{inr(o.totalValue)}</td>
              <td><StatusBadge status={o.status} /><div className="np1 muted xs">{erpText(o)}</div></td>
              <td className="p1 erpcell">{erpText(o)}</td>
              <td className="r num nw p3">{age(o.placedAt)}</td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}
