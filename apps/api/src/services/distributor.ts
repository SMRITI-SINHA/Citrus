// Distributor panel: a short, oldest-first queue with everything needed to decide without a phone call.
import { db } from '../db/knex.ts';
import { notFound } from '../lib/errors.ts';
import { toOrders, page } from './orders.ts';

export async function queue(did: string) {
  const rows = await db('orders').where({ distributor_id: did }).whereIn('status', ['placed', 'review', 'modified', 'approved'])
    .orderBy('placed_at', 'asc').limit(200);
  const items = await toOrders(rows);
  return { items, counts: { review: items.filter(o => o.status === 'review').length, waitingRetailer: items.filter(o => o.status === 'modified').length } };
}

export const history = (did: string, cursor?: string) =>
  page(db('orders').where({ distributor_id: did }).whereNotIn('status', ['placed', 'review', 'modified']), cursor);

/** Retailer card for the approval screen: credit from the Ginesys customer master, and how this store usually buys. */
export async function retailerProfile(did: string, rid: string) {
  const r = await db('retailers').where({ id: rid }).first();
  if (!r || r.distributor_id !== did) throw notFound('Retailer not found');
  const since = new Date(Date.now() - 90 * 86_400_000);
  const agg = await db('orders').where({ retailer_id: rid }).where('placed_at', '>', since).whereNotIn('status', ['cancelled'])
    .select(db.raw('count(*) as n'), db.raw('avg(total_value) as avgv'), db.raw('max(placed_at) as lastat'),
      db.raw("sum(case when status = 'rejected' then 1 else 0 end) as rej")).first() as any;
  return {
    id: r.id, code: r.code, store: r.store, owner: r.owner, city: r.city, state: r.state, phone: r.phone, grade: r.grade ?? undefined,
    activated: r.status === 'active',
    credit: r.credit_limit != null ? { limit: Number(r.credit_limit), overdue: Number(r.overdue_amount ?? 0), overdueDays: Number(r.overdue_days ?? 0), asOf: r.credit_as_of ? new Date(r.credit_as_of).toISOString() : undefined, source: 'Ginesys customer master' } : undefined,
    stats: { orders90d: Number(agg?.n ?? 0), avgOrderValue: Math.round(Number(agg?.avgv ?? 0)), lastOrderAt: agg?.lastat ? new Date(agg.lastat).toISOString() : undefined, rejected90d: Number(agg?.rej ?? 0) },
  };
}

export async function retailers(did: string, q?: string, cursor?: string) {
  const qb = db('retailers').where({ distributor_id: did });
  if (q) qb.where(b => b.whereRaw('lower(store) like ?', [`%${q.toLowerCase()}%`]).orWhereRaw('lower(city) like ?', [`%${q.toLowerCase()}%`]).orWhere('code', q.toUpperCase()));
  const off = cursor ? Number(cursor) : 0;
  const rows = await qb.orderBy('store').offset(off).limit(51).select('id', 'code', 'store', 'owner', 'city', 'status', 'phone', 'invite_token');
  return { items: rows.slice(0, 50).map((r: any) => ({ id: r.id, code: r.code, store: r.store, owner: r.owner, city: r.city, activated: r.status === 'active', phone: r.phone, invite: r.invite_token })), nextCursor: rows.length > 50 ? String(off + 50) : undefined };
}
