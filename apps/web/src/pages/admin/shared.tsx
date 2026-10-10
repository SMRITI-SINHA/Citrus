import { useState, type ReactNode } from 'react';
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
export const exceptionsOf = (o?: Overview): Exc[] => [...(o?.live?.exceptions ?? [])].sort((a, b) => SEV[a.severity] - SEV[b.severity] || (b.at ?? '').localeCompare(a.at ?? ''));
export const dropExc = (id: string) => updateWhere<Overview>('/api/admin/overview', ov => ({ ...ov, live: { ...ov.live, exceptions: ov.live.exceptions.filter(e => e.id !== id) } }));

/** Page header in the Shopify/Stripe pattern: title and one-line context on the left, actions on the right. */
export function PageHeader({ title, sub, meta, actions, eyebrow }: { title: ReactNode; sub?: ReactNode; meta?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="ap-ph">
      <div className="ap-ph-t">
        {eyebrow && <div className="ap-ph-e">{eyebrow}</div>}
        <div className="ap-ph-row"><h1>{title}</h1>{meta}</div>
        {sub && <p>{sub}</p>}
      </div>
      {actions && <div className="ap-ph-a">{actions}</div>}
    </header>
  );
}

/** Card with a quiet header row: title, optional count and a link or action on the right. */
export function Panel({ title, count, action, children, className = '', sub, flush }: { title: ReactNode; count?: number; action?: ReactNode; children: ReactNode; className?: string; sub?: ReactNode; flush?: boolean }) {
  return (
    <section className={`ap-card ${className}`}>
      <div className="ap-card-h"><div className="ap-card-ht"><h2>{title}{count !== undefined && <span className="ap-count">{num(count)}</span>}</h2>{sub && <p>{sub}</p>}</div>{action}</div>
      <div className={flush ? 'ap-card-b flush' : 'ap-card-b'}>{children}</div>
    </section>
  );
}

/** Small "i" with a definition shown on hover or focus. */
export function Tip({ text }: { text: string }) {
  return <button type="button" className="ap-tip" aria-label={text} data-tip={text}><span aria-hidden="true">i</span></button>;
}

const ERP_TONE = { synced: 'ok', pending: 'idle', retrying: 'warn', failed: 'bad' } as const;
export function erpShort(o: Order): string {
  const e = o.erp;
  if (e.state === 'failed') return 'Sync failed';
  if (e.state === 'retrying') return `Retrying · ${e.attempts}`;
  if (e.awb) return 'Shipped';
  if (e.soNumber) return e.erpStatus === 'UNAUTHORIZED' ? 'SO on hold' : 'SO created';
  if (e.reservationRef) return 'Stock held';
  return e.state === 'synced' ? 'Synced' : 'Pending';
}
export function ErpTag({ o, full }: { o: Order; full?: boolean }) {
  return <span className={`ap-erp t-${ERP_TONE[o.erp.state]}`} title={erpText(o)}><i />{full ? erpText(o) : erpShort(o)}</span>;
}

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

/** One exception as an action-list row: severity, what happened, and the action that clears it. */
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
  const sevLabel = x.severity === 'bad' ? 'Action' : x.severity === 'warn' ? 'Check' : 'Info';
  return (
    <div className={`ap-exc sev-${x.severity}${state === 'done' ? ' done' : ''}`}>
      <span className="ap-exc-ic" aria-hidden="true"><Icon name={x.severity === 'info' ? 'check' : 'alert'} size={14} /></span>
      <div className="ap-exc-m">
        <div className="ap-exc-t"><b>{x.title}</b><span className="ap-sev">{sevLabel}</span>{state === 'done' && <span className="ap-sev ok">Done</span>}</div>
        <p>{x.orderNumber && <span className="ap-id">{x.orderNumber} </span>}{x.detail}</p>
        {state !== 'done' && (
          <div className="ap-exc-a">
            {x.canRetry && x.orderId && <button type="button" className="ap-btn sm" onClick={retry} disabled={state === 'busy'}><Icon name="refresh" size={14} />{state === 'busy' ? 'Retrying…' : 'Retry sync'}</button>}
            {x.orderId && x.kind === 'sla' && <PLink to={`/admin/orders/${encodeURIComponent(x.orderId)}?act=1`} className="ap-btn sm pri">Decide for distributor</PLink>}
            {x.orderId && <PLink to={`/admin/orders/${encodeURIComponent(x.orderId)}`} className="ap-btn sm ghost">Open order</PLink>}
            <button type="button" className="ap-btn sm ghost" onClick={resolve} disabled={state === 'busy'}>Mark resolved</button>
          </div>
        )}
        {err && <span className="bad-ink small" role="alert">{err}</span>}
      </div>
    </div>
  );
}

/** Assumptions register: unconfirmed rules the system currently runs on. Admin only, never shown to retailers. */
export function PendingConfirmation({ compact }: { compact?: boolean }) {
  const { data } = useQuery<typeof ASSUMPTIONS>('/api/admin/assumptions', { staleMs: 300_000 });
  const list = data ?? ASSUMPTIONS;
  const shown = compact ? list.slice(0, 5) : list;
  return (
    <Panel title="Pending confirmation" count={list.length} flush
      sub="Rules the system runs on today that CITRUS has not confirmed yet. Not shown to retailers."
      action={compact && list.length > shown.length ? <PLink to="/admin/exceptions" className="ap-link">View all {num(list.length)}</PLink> : undefined}>
      <div className="ap-tw">
        <table className="ap-t ap-t-rules">
          <thead><tr><th>Rule</th><th>Current behaviour</th><th>Owner</th><th>Kind</th></tr></thead>
          <tbody>{shown.map(a => (
            <tr key={a.id}>
              <td className="c-rule">{a.title}</td>
              <td className="c-cur">{a.current}</td>
              <td className="c-own nw">{a.owner}</td>
              <td className="c-kind"><span className="ap-pill">{a.kind === 'erp' ? 'ERP' : 'Business'}</span></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </Panel>
  );
}

/**
 * Orders index table (Stripe payments pattern): monospace ID, store, money right-aligned in tabular figures,
 * status pill, ERP state and age. Whole row opens the order. Under 600px of container it becomes stacked rows.
 */
export function OrdersTable({ orders, empty = 'No orders match.', dense }: { orders: Order[] | undefined; empty?: string; dense?: boolean }) {
  const nav = useNavigate();
  if (!orders) return <div className="ap-skel-rows" aria-busy="true">{Array.from({ length: 6 }, (_, i) => <i key={i} />)}</div>;
  if (!orders.length) return <div className="ap-empty"><Icon name="search" size={18} /><span>{empty}</span></div>;
  return (
    <div className="ap-tw">
      <table className={`ap-t ap-t-orders${dense ? ' dense' : ''}`}>
        <thead><tr><th className="c-ord">Order</th><th className="c-ret">Retailer</th><th className="c-dist">Distributor</th><th className="c-pcs r">Pcs</th><th className="c-val r">Amount</th><th className="c-st">Status</th><th className="c-erp">Ginesys</th><th className="c-age r">Placed</th></tr></thead>
        <tbody>{orders.map(o => {
          const href = `/admin/orders/${encodeURIComponent(o.id)}`;
          return (
            <tr key={o.id} className={o.erp.state === 'failed' ? 'is-bad' : undefined} onClick={e => { if (!(e.target as HTMLElement).closest('a,button')) nav(href); }}>
              <td className="c-ord"><PLink to={href} data={`/api/admin/orders/${o.id}`} className="ap-id">{o.number}</PLink></td>
              <td className="c-ret"><span className="ap-store" title={`${o.store}, ${o.city}`}><b>{o.store}</b><span>{o.city}</span></span></td>
              <td className="c-dist"><span className="ap-ell" title={o.distributorName}>{o.distributorName}</span></td>
              <td className="c-pcs r num">{num(o.totalQty)}</td>
              <td className="c-val r num">{inr(o.totalValue)}</td>
              <td className="c-st"><StatusBadge status={o.status} /></td>
              <td className="c-erp"><ErpTag o={o} /></td>
              <td className="c-age r num">{age(o.placedAt)}</td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}
