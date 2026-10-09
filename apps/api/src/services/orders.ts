// Order engine: placement with final validation, the approval state machine, and the ERP steps behind it.
//   placed --(Ginesys SO created with stock reserved)--> review --approve--> approved --(SO authorised)--> confirmed
//   review --modify--> modified --accept--> approved (lines reduced in Ginesys first) | --decline--> cancelled
//   review --reject--> rejected (SO cancelled, stock released)
//   confirmed --DC--> processing --invoice--> dispatched --delivery--> delivered (points credited)
// Every transition writes an order_event (audit trail) and queues its ERP call and messages in the same transaction.
import type { Knex } from 'knex';
import type { Order, OrderStatus, PlaceOrderRequest, StockConflict, CartLine, DistributorDecision } from '@citrus/shared';
import { POLICY, SIZES } from '@citrus/shared';
import { db } from '../db/knex.ts';
import { redis } from '../lib/redis.ts';
import { uid, maskPhone } from '../lib/ids.ts';
import { ApiError, bad, notFound, conflict, forbidden } from '../lib/errors.ts';
import { publish } from '../lib/bus.ts';
import { erp, ErpError, sku, unsku } from '../adapters/ginesys.ts';
import { TEMPLATES } from '../adapters/messaging.ts';
import { getCart, clearCart } from './cart.ts';
import { styles, dropAffinity } from './catalogue.ts';
import { setAvailability } from './stock.ts';
import { enqueue, register, runNow, poke, type Outcome } from './outbox.ts';
import { notify } from './notify.ts';
import { raiseException, resolveExceptions } from './exceptions.ts';

const rupees = (n: number) => '₹' + n.toLocaleString('en-IN');
const ACTIVE: OrderStatus[] = ['placed', 'review', 'modified', 'approved', 'confirmed', 'processing', 'dispatched'];
const RANK: Record<OrderStatus, number> = { placed: 0, review: 1, modified: 2, approved: 3, confirmed: 4, processing: 5, dispatched: 6, delivered: 7, rejected: 9, cancelled: 9 };

// ---------------------------------------------------------------- read model
export async function toOrders(rows: any[]): Promise<Order[]> {
  if (!rows.length) return [];
  const ids = rows.map(r => r.id);
  const [lines, events, rets, dists] = await Promise.all([
    db('order_lines').whereIn('order_id', ids).orderBy(['order_id', 'position']),
    db('order_events').whereIn('order_id', ids).orderBy('at'),
    db('retailers').whereIn('id', [...new Set(rows.map(r => r.retailer_id))]).select('id', 'store', 'city', 'code', 'owner', 'phone'),
    db('distributors').whereIn('id', [...new Set(rows.map(r => r.distributor_id))]).select('id', 'name', 'city'),
  ]);
  const L = group(lines, 'order_id'), E = group(events, 'order_id');
  const R = new Map(rets.map((r: any) => [r.id, r])), D = new Map(dists.map((d: any) => [d.id, d]));
  return rows.map(o => {
    const r: any = R.get(o.retailer_id), d: any = D.get(o.distributor_id);
    return {
      id: o.id, number: o.num, retailerId: o.retailer_id, store: r?.store, city: r?.city, retailerCode: r?.code, owner: r?.owner,
      distributorId: o.distributor_id, distributorName: d ? `${d.name}` : '',
      status: o.status, totalQty: Number(o.total_qty), totalValue: Number(o.total_value), totalPoints: Number(o.total_points),
      lines: (L.get(o.id) ?? []).map((l: any) => ({ styleId: l.style_id, name: l.name, color: l.color, size: l.size, qty: Number(l.qty), origQty: Number(l.orig_qty), rate: Number(l.rate), points: Number(l.points) })),
      note: o.note || undefined, po: o.po || undefined, reason: o.reason || undefined,
      changes: o.changes_json ? JSON.parse(o.changes_json) : undefined, changeReason: o.change_reason || undefined,
      erp: { reservationRef: o.erp_ref || undefined, soNumber: o.so_number || undefined, state: o.erp_state, erpStatus: o.erp_status || undefined, awb: o.awb || undefined, attempts: Number(o.erp_attempts), lastError: o.erp_error || undefined },
      placedAt: iso(o.placed_at), updatedAt: iso(o.updated_at),
      events: (E.get(o.id) ?? []).map((e: any) => ({ at: iso(e.at), type: e.type, actor: e.actor, message: e.message })),
    } as Order;
  });
}
const iso = (d: any) => new Date(d).toISOString();
function group(rows: any[], k: string) { const m = new Map<string, any[]>(); for (const r of rows) { const a = m.get(r[k]) ?? []; a.push(r); m.set(r[k], a); } return m; }

export async function getOrder(id: string) {
  const o = await db('orders').where({ id }).first();
  if (!o) throw notFound('Order not found');
  return (await toOrders([o]))[0];
}

/**
 * What a retailer sees: no internal ERP references, and the SO number only once the Sales Order is actually created
 * (before approval it is an unauthorised SO holding stock, which would read as "confirmed" to a retailer).
 */
export function forRetailer(o: Order): Order {
  const soVisible = ['confirmed', 'processing', 'dispatched', 'delivered'].includes(o.status);
  return { ...o, erp: { state: o.erp.state === 'failed' ? 'retrying' : o.erp.state, attempts: 0, soNumber: soVisible ? o.erp.soNumber : undefined, awb: o.erp.awb } };
}

/** Push the fresh order to everyone who may be looking at it: the retailer, their distributor and the control room. */
export async function publishOrder(id: string) {
  const o = await getOrder(id);
  await publish({ distributorId: o.distributorId, admins: true }, { type: 'order.updated', order: o });
  await publish({ retailerId: o.retailerId }, { type: 'order.updated', order: forRetailer(o) });
  return o;
}

/** Keyset pagination on (placed_at, id): stable and index-friendly at millions of rows. */
export async function page(q: Knex.QueryBuilder, cursor?: string, limit = 20) {
  if (cursor) {
    const [t, id] = Buffer.from(cursor, 'base64url').toString().split('|');
    q.where(b => b.where('placed_at', '<', new Date(t)).orWhere(w => w.where('placed_at', '=', new Date(t)).where('id', '<', id)));
  }
  const rows = await q.orderBy([{ column: 'placed_at', order: 'desc' }, { column: 'id', order: 'desc' }]).limit(limit + 1);
  const more = rows.length > limit; const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return { items: await toOrders(items), nextCursor: more ? Buffer.from(`${iso(last.placed_at)}|${last.id}`).toString('base64url') : undefined };
}

export const retailerOrders = async (rid: string, cursor?: string, status?: string) => {
  const q = db('orders').where({ retailer_id: rid });
  if (status === 'open') q.whereIn('status', ACTIVE); else if (status === 'done') q.whereIn('status', ['delivered', 'rejected', 'cancelled']);
  const p = await page(q, cursor);
  return { ...p, items: p.items.map(forRetailer) };
};
export async function retailerOrder(rid: string, id: string) {
  const o = await getOrder(id);
  if (o.retailerId !== rid) throw notFound('Order not found');
  return forRetailer(o);
}

async function event(trx: Knex | Knex.Transaction, orderId: string, type: string, actor: string, message: string) {
  await trx('order_events').insert({ id: uid(), order_id: orderId, at: new Date(), type, actor, message: message.slice(0, 400) });
}

// ---------------------------------------------------------------- order numbers
/** Order numbers come from Redis INCR (no hot row in the DB), seeded from the DB max if Redis lost the key. */
async function nextOrderNumber() {
  const k = 'ct:order-no';
  if (!(await redis.exists(k))) {
    const row = await db('counters').where({ name: 'order' }).first();
    await redis.set(k, String(row ? Number(row.value) : 10480), 'NX');
  }
  const n = await redis.incr(k);
  db('counters').where({ name: 'order' }).where('value', '<', n).update({ value: n }).catch(() => {});
  return `CT-${n}`;
}

// ---------------------------------------------------------------- placement
export async function placeOrder(rid: string, userId: string, body: PlaceOrderRequest, requestId?: string): Promise<{ order: Order; replay: boolean }> {
  const key = String(body?.idempotencyKey ?? '').trim().slice(0, 80);
  if (key.length < 8) throw bad('IDEMPOTENCY_KEY', 'Missing idempotency key.');
  const existing = await db('orders').where({ retailer_id: rid, idem_key: key }).first();
  if (existing) return { order: forRetailer(await getOrder(existing.id)), replay: true };

  const cart = await getCart(rid);
  if (typeof body.cartVersion === 'number' && body.cartVersion !== cart.version)
    throw conflict('CART_CHANGED', 'Your cart was changed on another device. Please check it once more.', { cart });
  const lines = cart.lines.filter(l => l.qty > 0);
  if (!lines.length) throw bad('EMPTY_CART', 'Your cart is empty.');
  const { byId } = await styles();
  for (const l of lines) if (!byId.get(l.styleId)) throw bad('UNKNOWN_SKU', `${l.styleId} is no longer in the catalogue. Remove it and try again.`);
  const totalQty = lines.reduce((a, l) => a + l.qty, 0);
  const totalValue = lines.reduce((a, l) => a + l.qty * byId.get(l.styleId)!.rate, 0);
  if (POLICY.minOrderValue > 0 && totalValue < POLICY.minOrderValue) throw bad('BELOW_MINIMUM', `Minimum order is ${rupees(POLICY.minOrderValue)}.`);
  const retailer = await db('retailers').where({ id: rid }).first();
  const num = await nextOrderNumber();
  const id = uid();
  const now = new Date();
  let outboxId = '';
  try {
    await db.transaction(async trx => {
      // The cart row is the retailer's lock: two devices (or two tabs) submitting at once cannot both turn it into an order.
      const locked = await trx('carts').where({ retailer_id: rid }).forUpdate().first();
      if (!locked || Number(locked.version) !== cart.version) throw conflict('CART_CHANGED', 'Your cart was just changed or ordered from another device. Please check it once more.');
      // Final validation under row locks, in a fixed key order so concurrent orders never deadlock.
      const keys = [...lines].sort((a, b) => sku(a.styleId, a.color, a.size).localeCompare(sku(b.styleId, b.color, b.size)));
      const rows = await trx('availability').where(b => { for (const k of keys) b.orWhere({ style_id: k.styleId, color: k.color, size: k.size }); })
        .orderBy(['style_id', 'color', 'size']).forUpdate();
      const have = new Map(rows.map((r: any) => [sku(r.style_id, r.color, r.size), Number(r.available)]));
      const short: StockConflict['lines'] = [];
      for (const l of keys) { const a = have.get(sku(l.styleId, l.color, l.size)) ?? 0; if (a < l.qty) short.push({ styleId: l.styleId, color: l.color, size: l.size, requested: l.qty, available: a }); }
      if (short.length) throw new ApiError(409, 'STOCK_CHANGED', 'Some sizes sold out while you were ordering.', { lines: short });
      await setAvailability(keys.map(l => ({ styleId: l.styleId, color: l.color, size: l.size, available: have.get(sku(l.styleId, l.color, l.size))! - l.qty })), trx);
      await trx('orders').insert({
        id, num, retailer_id: rid, distributor_id: retailer.distributor_id, status: 'placed', idem_key: key,
        note: cart.note || null, po: cart.po || null, total_qty: totalQty, total_value: totalValue,
        total_points: lines.reduce((a, l) => a + l.qty * byId.get(l.styleId)!.points, 0),
        erp_state: 'pending', erp_attempts: 0, placed_at: now, updated_at: now, points_awarded: false,
      });
      await trx('order_lines').insert(lines.map((l, i) => {
        const s = byId.get(l.styleId)!;
        return { order_id: id, style_id: l.styleId, name: s.name, color: l.color, size: l.size, qty: l.qty, orig_qty: l.qty, rate: s.rate, points: s.points, position: i };
      }));
      await event(trx, id, 'placed', 'retailer', `Order placed: ${totalQty} pcs, ${rupees(totalValue)}`);
      await clearCart(rid, trx);
      outboxId = await enqueue(trx, 'erp.reserve', { orderId: id, userId }, id, 15, requestId);
    });
  } catch (e: any) {
    if (isUnique(e) || (e instanceof ApiError && e.code === 'CART_CHANGED')) {
      // the same key raced us (double tap / retry while the first was in flight): answer with the order it made
      const o = await db('orders').where({ retailer_id: rid, idem_key: key }).first();
      if (o) return { order: forRetailer(await getOrder(o.id)), replay: true };
    }
    if (e instanceof ApiError && e.code === 'CART_CHANGED') e.extra = { cart: await getCart(rid) };
    throw e;
  }
  publish({ retailerId: rid }, { type: 'cart.updated', cart: await getCart(rid) }).catch(() => {});
  dropAffinity(rid).catch(() => {});
  // Reserve in Ginesys now and wait briefly, so the retailer hears "reserved" or "these sizes just sold out" in the same tap.
  const res = await runNow(outboxId, 4000);
  if (res && 'ok' in res && res.data?.conflict) throw new ApiError(409, 'STOCK_CHANGED', 'Some sizes sold out while you were ordering.', { lines: res.data.conflict });
  return { order: forRetailer(await getOrder(id)), replay: false };
}
const isUnique = (e: any) => e?.code === '23505' || /ORA-00001/.test(String(e?.message));

// ---------------------------------------------------------------- ERP: reserve (create SO with reservation)
register('erp.reserve', async ({ orderId }, row, ctx): Promise<Outcome> => {
  const o = await db('orders').where({ id: orderId }).first();
  if (!o || o.status !== 'placed' || o.erp_ref) return { ok: true };
  const r = await db('retailers').where({ id: o.retailer_id }).first();
  const lines = await db('order_lines').where({ order_id: orderId });
  await db('orders').where({ id: orderId }).update({ erp_attempts: row.attempts + 1 });
  try {
    const so = await erp.reserve(orderId, r.code, lines.map((l: any) => ({ sku: sku(l.style_id, l.color, l.size), qty: Number(l.qty), rate: Number(l.rate) })));
    const d = await db('distributors').where({ id: o.distributor_id }).first();
    const dUsers = await db('users').where({ distributor_id: o.distributor_id, role: 'distributor' });
    await db.transaction(async trx => {
      const n = await trx('orders').where({ id: orderId, status: 'placed' }).update({ erp_ref: so.erpOrderId, so_number: so.erpOrderNo, erp_state: 'synced', erp_status: 'UNAUTHORIZED', erp_error: null, status: 'review', reserved_at: new Date(), updated_at: new Date() });
      if (!n) return;
      await event(trx, orderId, 'reserved', 'erp', `Stock reserved for this order. Sent to ${d.name} for approval.`);
      await notify(trx, { channel: 'whatsapp', to: r.phone, template: 'order_received', body: TEMPLATES.order_received({ num: o.num, qty: Number(o.total_qty), dist: d.name }), orderId });
      for (const u of dUsers.length ? dUsers : [{ phone: d.phone }])
        await notify(trx, {
          channel: 'whatsapp', to: u.phone, template: 'order_for_approval', orderId,
          body: TEMPLATES.order_for_approval({ num: o.num, store: r.store, city: r.city, qty: Number(o.total_qty), value: rupees(Number(o.total_value)), note: o.note ?? undefined }),
          buttons: [{ id: `approve:${orderId}`, title: 'Approve' }, { id: `modify:${orderId}`, title: 'Modify' }, { id: `reject:${orderId}`, title: 'Reject' }],
        });
    });
    await resolveExceptions('erp', orderId);
    poke(); await publishOrder(orderId);
    return { ok: true };
  } catch (e) {
    if (e instanceof ErpError && e.kind === 'insufficient') {
      const conflictLines = await compensateShortfall(o, lines, e.detail ?? [], ctx.interactive);
      return { ok: true, data: { conflict: conflictLines } }; // handled: not an integration failure
    }
    if (e instanceof ErpError && e.kind === 'unavailable') {
      await db('orders').where({ id: orderId }).update({ erp_state: 'retrying', erp_error: e.message.slice(0, 290), updated_at: new Date() });
      await publishOrder(orderId);
    }
    throw e;
  }
}, giveUpOrder('Could not reserve stock in Ginesys'));

/**
 * Ginesys could not reserve every size. Undo our side: return local stock, and either
 *  - interactive (retailer still waiting): delete the order and put the cart back, so the 409 says exactly what changed;
 *  - async (retailer already saw "placed"): cancel the order, restore the cart, and tell them.
 */
async function compensateShortfall(o: any, lines: any[], short: { sku: string; requested: number; available?: number }[], interactive: boolean) {
  const shortSet = new Set(short.map(s => s.sku));
  const realFree = new Map(short.map(s => [s.sku, s.available ?? 0]));
  const avail = await db('availability').where(b => { for (const l of lines) b.orWhere({ style_id: l.style_id, color: l.color, size: l.size }); });
  const A = new Map(avail.map((a: any) => [sku(a.style_id, a.color, a.size), Number(a.available)]));
  const restored = lines.map((l: any) => {
    const k = sku(l.style_id, l.color, l.size);
    // Ginesys had less than we thought for short lines: show what it could actually reserve (never over-show).
    return { styleId: l.style_id, color: l.color, size: l.size, available: shortSet.has(k) ? realFree.get(k)! : (A.get(k) ?? 0) + Number(l.qty) };
  });
  const conflictLines = lines.filter((l: any) => shortSet.has(sku(l.style_id, l.color, l.size)))
    .map((l: any) => ({ styleId: l.style_id, color: l.color, size: l.size, requested: Number(l.qty), available: realFree.get(sku(l.style_id, l.color, l.size)) ?? 0 }));
  const r = await db('retailers').where({ id: o.retailer_id }).first();
  await db.transaction(async trx => {
    await setAvailability(restored, trx);
    // put the order back in the cart, as the retailer built it
    for (const [i, l] of lines.entries()) {
      const where = { retailer_id: o.retailer_id, style_id: l.style_id, color: l.color, size: l.size };
      const n = await trx('cart_lines').where(where).update({ qty: Number(l.qty) });
      if (!n) await trx('cart_lines').insert({ ...where, qty: Number(l.qty), position: i });
    }
    await trx('carts').where({ retailer_id: o.retailer_id }).update({ note: o.note, po: o.po, version: trx.raw('version + 1'), updated_at: new Date() });
    if (interactive) {
      await trx('order_events').where({ order_id: o.id }).del();
      await trx('order_lines').where({ order_id: o.id }).del();
      await trx('notifications').where({ order_id: o.id }).del();
      await trx('outbox').where({ ref: o.id }).whereNot({ topic: 'erp.reserve' }).del();
      await trx('orders').where({ id: o.id }).del();
    } else {
      await trx('orders').where({ id: o.id }).update({ status: 'cancelled', reason: 'Some sizes sold out before CITRUS could reserve them', erp_state: 'synced', updated_at: new Date() });
      await event(trx, o.id, 'cancelled', 'erp', 'Ginesys could not reserve every size. Your cart has been restored so you can adjust and place it again.');
      await notify(trx, { channel: 'whatsapp', to: r.phone, template: 'order_rejected', body: TEMPLATES.order_rejected({ num: o.num, reason: 'some sizes sold out; your cart is saved, please review and place again' }), orderId: o.id });
    }
  });
  publish({ retailerId: o.retailer_id }, { type: 'cart.updated', cart: await getCart(o.retailer_id) }).catch(() => {});
  if (!interactive) { poke(); await publishOrder(o.id); }
  return conflictLines;
}

function giveUpOrder(title: string) {
  return async ({ orderId }: any, _row: any, err: string) => {
    await db('orders').where({ id: orderId }).update({ erp_state: 'failed', erp_error: err.slice(0, 290), updated_at: new Date() });
    const o = await db('orders').where({ id: orderId }).first();
    await raiseException('erp', 'bad', title, `${o?.num}: ${err}. Retry from the control room, or enter it in Ginesys manually.`, orderId);
    await publishOrder(orderId).catch(() => {});
  };
}

// ---------------------------------------------------------------- ERP: approve (authorise), with optional line reductions first
register('erp.approve', async ({ orderId, cuts }): Promise<Outcome> => {
  const o = await db('orders').where({ id: orderId }).first();
  if (!o || o.status !== 'approved') return { ok: true };
  try {
    if (cuts?.length && !o.erp_status?.startsWith('REDUCED')) {
      await erp.reduce(o.erp_ref, cuts);
      await db('orders').where({ id: orderId }).update({ erp_status: 'REDUCED' });
    }
    await erp.approve(o.erp_ref);
  } catch (e) {
    if (e instanceof ErpError && e.kind === 'unavailable') {
      await db('orders').where({ id: orderId }).update({ erp_state: 'retrying', erp_error: e.message.slice(0, 290), erp_attempts: Number(o.erp_attempts) + 1 });
      await publishOrder(orderId);
    }
    throw e;
  }
  const r = await db('retailers').where({ id: o.retailer_id }).first();
  await db.transaction(async trx => {
    const n = await trx('orders').where({ id: orderId, status: 'approved' }).update({ status: 'confirmed', erp_state: 'synced', erp_status: 'AUTHORIZED', erp_error: null, updated_at: new Date() });
    if (!n) return;
    await event(trx, orderId, 'confirmed', 'erp', `Sales Order ${o.so_number} authorised in Ginesys`);
    await notify(trx, { channel: 'whatsapp', to: r.phone, template: 'order_confirmed', body: TEMPLATES.order_confirmed({ num: o.num, so: o.so_number }), orderId });
    if (POLICY.pointsAwardOn === 'confirmed') await awardPoints(trx, o);
  });
  await resolveExceptions('erp', orderId);
  poke(); await publishOrder(orderId);
  return { ok: true };
}, giveUpOrder('Approved order not authorised in Ginesys'));

// ---------------------------------------------------------------- ERP: release (reject / decline / cancel)
register('erp.release', async ({ orderId }): Promise<Outcome> => {
  const o = await db('orders').where({ id: orderId }).first();
  if (!o || !['rejected', 'cancelled'].includes(o.status) || o.erp_status === 'CANCELLED') return { ok: true };
  if (o.erp_ref) {
    try { await erp.release(o.erp_ref); }
    catch (e) {
      if (e instanceof ErpError && e.kind === 'rejected' && /Only pending/i.test(e.message)) {
        await raiseException('erp', 'bad', 'Cancelled order already in the warehouse', `${o.num}: Ginesys says it is no longer pending. Stop the dispatch manually.`, orderId);
        return { ok: true };
      }
      throw e;
    }
  }
  // Give the units back on our availability layer straight away; the next Ginesys snapshot confirms it.
  const lines = await db('order_lines').where({ order_id: orderId });
  await db.transaction(async trx => {
    const avail = await trx('availability').where(b => { for (const l of lines) b.orWhere({ style_id: l.style_id, color: l.color, size: l.size }); }).forUpdate();
    const A = new Map(avail.map((a: any) => [sku(a.style_id, a.color, a.size), Number(a.available)]));
    await setAvailability(lines.map((l: any) => ({ styleId: l.style_id, color: l.color, size: l.size, available: (A.get(sku(l.style_id, l.color, l.size)) ?? 0) + Number(l.qty) })), trx);
    await trx('orders').where({ id: orderId }).update({ erp_status: 'CANCELLED', erp_state: 'synced', erp_error: null, updated_at: new Date() });
    await event(trx, orderId, 'released', 'erp', o.erp_ref ? `Sales Order ${o.so_number} cancelled in Ginesys; stock released` : 'Stock released');
  });
  await resolveExceptions('erp', orderId);
  await publishOrder(orderId);
  return { ok: true };
}, giveUpOrder('Rejected order not cancelled in Ginesys'));

// ---------------------------------------------------------------- distributor decisions
export async function decide(did: string, orderId: string, d: DistributorDecision, via: 'app' | 'whatsapp' | 'admin' = 'app', requestId?: string, adminName?: string) {
  const o = await db('orders').where({ id: orderId }).first();
  if (!o || o.distributor_id !== did) throw notFound('Order not found');
  if (o.status === 'placed') throw conflict('NOT_READY', 'Stock is still being reserved for this order. Try again in a moment.');
  if (o.status !== 'review') throw conflict('ALREADY_DECIDED', `This order is already ${o.status}.`, { order: await getOrder(orderId) });
  const reason = String(d.reason ?? '').trim().slice(0, 200);
  const r = await db('retailers').where({ id: o.retailer_id }).first();
  const dist = await db('distributors').where({ id: did }).first();
  const viaText = via === 'whatsapp' ? ' on WhatsApp' : via === 'admin' ? ` (decided by CITRUS: ${adminName ?? 'admin'}, on behalf of the distributor)` : '';
  const actor = via === 'admin' ? 'admin' : 'distributor';
  let runId = '';
  if (d.action === 'approve') {
    await db.transaction(async trx => {
      const n = await trx('orders').where({ id: orderId, status: 'review' }).update({ status: 'approved', updated_at: new Date() });
      if (!n) throw conflict('ALREADY_DECIDED', 'This order was just decided by someone else.');
      await event(trx, orderId, 'approved', actor, `Approved by ${dist.name}${viaText}`);
      runId = await enqueue(trx, 'erp.approve', { orderId }, orderId, 15, requestId);
    });
  } else if (d.action === 'reject') {
    if (!reason) throw bad('REASON_REQUIRED', 'Please choose a reason so the retailer knows why.');
    await db.transaction(async trx => {
      const n = await trx('orders').where({ id: orderId, status: 'review' }).update({ status: 'rejected', reason, updated_at: new Date() });
      if (!n) throw conflict('ALREADY_DECIDED', 'This order was just decided by someone else.');
      await event(trx, orderId, 'rejected', actor, `Not approved by ${dist.name}${viaText}: ${reason}`);
      await notify(trx, { channel: 'whatsapp', to: r.phone, template: 'order_rejected', body: TEMPLATES.order_rejected({ num: o.num, reason }), orderId });
      runId = await enqueue(trx, 'erp.release', { orderId }, orderId, 15, requestId);
    });
  } else if (d.action === 'modify') {
    if (!reason) throw bad('REASON_REQUIRED', 'Please choose a reason so the retailer knows why.');
    const lines = await db('order_lines').where({ order_id: orderId });
    const changes: { styleId: string; color: string; size: string; from: number; to: number }[] = [];
    for (const nl of d.lines ?? []) {
      const l = lines.find((x: any) => x.style_id === nl.styleId && x.color === nl.color && x.size === nl.size);
      if (!l) throw bad('UNKNOWN_LINE', `${nl.styleId} ${nl.color} ${nl.size} is not in this order.`);
      if (!Number.isInteger(nl.qty) || nl.qty < 0 || nl.qty > Number(l.qty)) throw bad('ONLY_REDUCTIONS', 'You can reduce or remove quantities. To add items, ask the retailer to place a new order.');
      if (nl.qty !== Number(l.qty)) changes.push({ styleId: nl.styleId, color: nl.color, size: nl.size, from: Number(l.qty), to: nl.qty });
    }
    if (!changes.length) throw bad('NO_CHANGES', 'Nothing was changed. Use Approve instead.');
    const left = lines.reduce((a: number, l: any) => a + (changes.find(c => c.styleId === l.style_id && c.color === l.color && c.size === l.size)?.to ?? Number(l.qty)), 0);
    if (left === 0) throw bad('USE_REJECT', 'All quantities are zero. Use Reject instead.');
    await db.transaction(async trx => {
      const n = await trx('orders').where({ id: orderId, status: 'review' }).update({ status: 'modified', change_reason: reason, changes_json: JSON.stringify(changes), reminded_at: null, updated_at: new Date() });
      if (!n) throw conflict('ALREADY_DECIDED', 'This order was just decided by someone else.');
      await event(trx, orderId, 'modified', actor, `${dist.name} suggested ${changes.length} change${changes.length > 1 ? 's' : ''}: ${reason}`);
      await notify(trx, { channel: 'whatsapp', to: r.phone, template: 'changes_proposed', body: TEMPLATES.changes_proposed({ num: o.num, dist: dist.name }), orderId });
    });
  } else throw bad('BAD_ACTION', 'Unknown action.');
  await resolveExceptions('sla', orderId);
  poke();
  if (runId) await runNow(runId, 2500); // usually confirmed before we answer; if Ginesys is slow, SSE brings it
  return publishOrder(orderId);
}

// ---------------------------------------------------------------- retailer answers suggested changes
export async function answerChanges(rid: string, orderId: string, action: 'accept' | 'decline', requestId?: string) {
  const o = await db('orders').where({ id: orderId }).first();
  if (!o || o.retailer_id !== rid) throw notFound('Order not found');
  if (o.status !== 'modified') throw conflict('NOT_PENDING', 'There are no changes waiting for you on this order.', { order: await getOrder(orderId) });
  const changes: { styleId: string; color: string; size: string; from: number; to: number }[] = JSON.parse(o.changes_json ?? '[]');
  let runId = '';
  await db.transaction(async trx => {
    if (action === 'accept') {
      const n = await trx('orders').where({ id: orderId, status: 'modified' }).update({ status: 'approved', updated_at: new Date() });
      if (!n) throw conflict('NOT_PENDING', 'This order changed. Please refresh.');
      for (const c of changes) {
        if (c.to === 0) await trx('order_lines').where({ order_id: orderId, style_id: c.styleId, color: c.color, size: c.size }).update({ qty: 0 });
        else await trx('order_lines').where({ order_id: orderId, style_id: c.styleId, color: c.color, size: c.size }).update({ qty: c.to });
      }
      const lines = await trx('order_lines').where({ order_id: orderId });
      await trx('orders').where({ id: orderId }).update({
        total_qty: lines.reduce((a: number, l: any) => a + Number(l.qty), 0), total_value: lines.reduce((a: number, l: any) => a + Number(l.qty) * Number(l.rate), 0),
        total_points: lines.reduce((a: number, l: any) => a + Number(l.qty) * Number(l.points), 0),
      });
      // released units go back on the shelf for other retailers right away
      const avail = await trx('availability').where(b => { for (const c of changes) b.orWhere({ style_id: c.styleId, color: c.color, size: c.size }); }).forUpdate();
      const A = new Map(avail.map((a: any) => [sku(a.style_id, a.color, a.size), Number(a.available)]));
      await setAvailability(changes.map(c => ({ styleId: c.styleId, color: c.color, size: c.size, available: (A.get(sku(c.styleId, c.color, c.size)) ?? 0) + (c.from - c.to) })), trx);
      await event(trx, orderId, 'changes_accepted', 'retailer', 'You accepted the suggested changes');
      runId = await enqueue(trx, 'erp.approve', { orderId, cuts: changes.map(c => ({ sku: sku(c.styleId, c.color, c.size), qty: c.from - c.to })) }, orderId, 15, requestId);
    } else {
      const n = await trx('orders').where({ id: orderId, status: 'modified' }).update({ status: 'cancelled', reason: 'You declined the suggested changes', updated_at: new Date() });
      if (!n) throw conflict('NOT_PENDING', 'This order changed. Please refresh.');
      await event(trx, orderId, 'changes_declined', 'retailer', 'You declined the suggested changes; order cancelled');
      runId = await enqueue(trx, 'erp.release', { orderId }, orderId, 15, requestId);
    }
  });
  await resolveExceptions('changes', orderId);
  if (runId) await runNow(runId, 2500);
  return forRetailer(await publishOrder(orderId));
}

// ---------------------------------------------------------------- status from Ginesys webhooks (DC, invoice, delivery)
export async function applyErpEvent(eventName: string, res: any, target: OrderStatus) {
  const o = res.intgOrderId ? await db('orders').where({ id: res.intgOrderId }).first() : await db('orders').where({ so_number: res.order_code }).first();
  if (!o) { await raiseException('erp', 'warn', 'Ginesys event for an unknown order', `${eventName} for ${res.order_code ?? res.intgOrderId}`); return false; }
  if (RANK[target] <= RANK[o.status as OrderStatus] || ['rejected', 'cancelled'].includes(o.status)) return false; // forward only, idempotent
  const r = await db('retailers').where({ id: o.retailer_id }).first();
  await db.transaction(async trx => {
    const patch: any = { status: target, updated_at: new Date(), erp_status: eventName };
    if (res.awb_no) patch.awb = res.awb_no;
    await trx('orders').where({ id: o.id }).update(patch);
    const msg = target === 'processing' ? `Packing started (delivery challan ${res.dc_no ?? ''})` : target === 'dispatched' ? `Invoiced and dispatched${res.awb_no ? `, AWB ${res.awb_no}` : ''}` : 'Delivered';
    await event(trx, o.id, target, 'erp', msg.trim());
    if (target === 'dispatched') await notify(trx, { channel: 'whatsapp', to: r.phone, template: 'order_dispatched', body: TEMPLATES.order_dispatched({ num: o.num, awb: res.awb_no }), orderId: o.id });
    if (target === 'delivered' && POLICY.pointsAwardOn === 'delivered') {
      const pts = await awardPoints(trx, o);
      const total = Number((await trx('retailers').where({ id: o.retailer_id }).first()).points);
      await notify(trx, { channel: 'whatsapp', to: r.phone, template: 'order_delivered', body: TEMPLATES.order_delivered({ num: o.num, points: pts, total }), orderId: o.id });
    }
  });
  poke();
  await publishOrder(o.id);
  if (target === 'delivered') {
    const p = await db('retailers').where({ id: o.retailer_id }).first();
    await publish({ retailerId: o.retailer_id }, { type: 'points.updated', points: Number(p.points) });
  }
  return true;
}

/** Points ledger is append-only and unique per (order, reason): replays and duplicate webhooks never double-credit. */
async function awardPoints(trx: Knex.Transaction, o: any) {
  const pts = (await trx('order_lines').where({ order_id: o.id })).reduce((a: number, l: any) => a + Number(l.qty) * Number(l.points), 0);
  const exists = await trx('points_ledger').where({ order_id: o.id, reason: 'order' }).first();
  if (exists || !pts) return 0;
  await trx('points_ledger').insert({ id: uid(), retailer_id: o.retailer_id, delta: pts, reason: 'order', order_id: o.id, created_at: new Date() });
  await trx('retailers').where({ id: o.retailer_id }).increment('points', pts);
  await trx('orders').where({ id: o.id }).update({ points_awarded: true });
  return pts;
}

export { ACTIVE, RANK, maskPhone, forbidden, unsku, SIZES };
export type { CartLine };
