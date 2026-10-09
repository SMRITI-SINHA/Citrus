import type { Order, OrderStatus } from '@citrus/shared';
import { getCached, invalidate, setCached, updateWhere } from '../lib/query';
import { live$ } from '../lib/sse';
import { itemsOf, type Page } from '../lib/types';
import { useQuery } from '../lib/query';

const QUEUE_STATES: OrderStatus[] = ['placed', 'review', 'modified', 'approved'];

/** Merge an updated order into every cached view that shows it. */
export function upsertOrder(o: Order) {
  setCached(`/api/orders/${o.id}`, o);
  const merge = (list: Order[] | undefined, include = true) => {
    if (!list) return list;
    const i = list.findIndex(x => x.id === o.id);
    if (i >= 0) { const c = list.slice(); c[i] = o; return c; }
    return include ? [o, ...list] : list;
  };
  const mergePage = (pg: Order[] | Page<Order> | undefined, include = true): Order[] | Page<Order> | undefined =>
    !pg ? pg : Array.isArray(pg) ? merge(pg, include) : { ...pg, items: merge(pg.items, include) ?? pg.items };
  if (getCached('/api/orders')) setCached<Order[] | Page<Order>>('/api/orders', l => mergePage(l));
  // Distributor: queue holds orders under review; decided ones move to history.
  if (getCached('/api/distributor/queue')) setCached<Order[] | Page<Order>>('/api/distributor/queue', l => {
    const list = Array.isArray(l) ? l : l?.items ?? [];
    const rest = list.filter(x => x.id !== o.id);
    const next = QUEUE_STATES.includes(o.status) ? [...rest, o].sort((a, b) => a.placedAt.localeCompare(b.placedAt)) : rest;
    return Array.isArray(l) || !l ? next : { ...l, items: next };
  });
  if (getCached('/api/distributor/history') && !['placed', 'review', 'modified'].includes(o.status)) setCached<Order[] | Page<Order>>('/api/distributor/history', l => mergePage(l));
  updateWhere<Order[] | Page<Order>>('/api/admin/orders', pg => mergePage(pg, false) ?? pg);
}

live$.on(e => {
  if (e.type === 'order.updated') upsertOrder(e.order);
  else if (e.type === 'admin.updated') invalidate('/api/admin/');
});

export function statusTone(st: OrderStatus): 's-ok' | 's-warn' | 's-bad' | 's-info' {
  if (st === 'delivered' || st === 'approved' || st === 'confirmed' || st === 'dispatched') return 's-ok';
  if (st === 'rejected' || st === 'cancelled') return 's-bad';
  if (st === 'modified' || st === 'review') return 's-warn';
  return 's-info';
}

/** The Ginesys SO number is the retailer's order number only once the SO is created (confirmed or later).
 * Before approval Ginesys holds stock against an unauthorised SO, which retailers must not read as confirmed. */
export const soShown = (o: Order) => (['confirmed', 'processing', 'dispatched', 'delivered'] as OrderStatus[]).includes(o.status) ? o.erp.soNumber : undefined;
export const isOpen = (st: OrderStatus) => !['delivered', 'rejected', 'cancelled'].includes(st);

/** First page of the retailer's orders (newest first). Enough for badges, "last order" and the active-order strip. */
export function useMyOrders() {
  const q = useQuery<Order[] | Page<Order>>('/api/orders', { staleMs: 30_000 });
  return { ...q, data: itemsOf(q.data), nextCursor: q.data && !Array.isArray(q.data) ? q.data.nextCursor : undefined };
}
export function useQueue() {
  const q = useQuery<Order[] | Page<Order>>('/api/distributor/queue', { staleMs: 15_000 });
  return { ...q, data: itemsOf(q.data) };
}
