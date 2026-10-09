// One server-side cart per retailer, autosaved on every edit so it survives devices, reloads and bad networks.
// Lines are absolute quantities per size (idempotent PUTs), capped at live availability.
import type { Cart, CartLine } from '@citrus/shared';
import { SIZES, DEFAULT_RATIO, POLICY } from '@citrus/shared';
import { db } from '../db/knex.ts';
import { stockFor } from './stock.ts';
import { styles } from './catalogue.ts';
import { bad, notFound, conflict } from '../lib/errors.ts';
import { publish } from '../lib/bus.ts';

export async function getCart(retailerId: string): Promise<Cart> {
  let c = await db('carts').where({ retailer_id: retailerId }).first();
  if (!c) { c = { retailer_id: retailerId, note: '', po: '', version: 0, updated_at: new Date() }; await db('carts').insert(c); }
  const lines = await db('cart_lines').where({ retailer_id: retailerId }).orderBy('position');
  return {
    lines: lines.map((l: any) => ({ styleId: l.style_id, color: l.color, size: l.size, qty: Number(l.qty) })),
    note: c.note ?? '', po: c.po ?? '', version: Number(c.version), updatedAt: new Date(c.updated_at).toISOString(),
  };
}

async function bump(retailerId: string, patch: Record<string, unknown> = {}) {
  await db('carts').where({ retailer_id: retailerId }).update({ ...patch, version: db.raw('version + 1'), updated_at: new Date() });
  const cart = await getCart(retailerId);
  publish({ retailerId }, { type: 'cart.updated', cart }).catch(() => {});
  return cart;
}

/** Set absolute quantities. Returns the cart plus any lines the server capped to live stock. */
export async function setLines(retailerId: string, lines: CartLine[], version?: number) {
  await getCart(retailerId);
  const { byId } = await styles();
  for (const l of lines) {
    const s = byId.get(l.styleId);
    if (!s || !s.colors.some(c => c.name === l.color) || !SIZES[s.category].includes(l.size)) throw bad('UNKNOWN_SKU', `Unknown item ${l.styleId} ${l.color} ${l.size}`);
    if (!Number.isInteger(l.qty) || l.qty < 0 || l.qty > 9999) throw bad('BAD_QTY', 'Quantity must be a whole number.');
  }
  const st = await stockFor([...new Set(lines.map(l => l.styleId))]);
  const capped: (CartLine & { requested: number })[] = [];
  const maxPos = Number((await db('cart_lines').where({ retailer_id: retailerId }).max('position as m').first())?.m ?? 0);
  let pos = maxPos;
  await db.transaction(async trx => {
    // optimistic concurrency: an edit made on an older copy of the cart (other tab/device) is refused, not silently merged
    const c = await trx('carts').where({ retailer_id: retailerId }).forUpdate().first();
    if (version !== undefined && Number(c.version) !== version) throw conflict('CART_CHANGED', 'Your cart was changed on another device. Here is the latest version.');
    for (const l of lines) {
      const avail = st[l.styleId]?.[`${l.color}|${l.size}`] ?? 0;
      const qty = Math.min(l.qty, avail);
      if (qty < l.qty) capped.push({ ...l, qty, requested: l.qty });
      const where = { retailer_id: retailerId, style_id: l.styleId, color: l.color, size: l.size };
      if (qty === 0) { await trx('cart_lines').where(where).del(); continue; }
      const n = await trx('cart_lines').where(where).update({ qty });
      if (!n) await trx('cart_lines').insert({ ...where, qty, position: ++pos });
    }
  });
  return { cart: await bump(retailerId), capped };
}

export async function setMeta(retailerId: string, meta: { note?: string; po?: string }, version?: number) {
  const cur = await getCart(retailerId);
  if (version !== undefined && cur.version !== version) throw conflict('CART_CHANGED', 'Your cart was changed on another device. Here is the latest version.', { cart: cur });
  const patch: Record<string, string> = {};
  if (meta.note !== undefined) patch.note = String(meta.note).slice(0, 300);
  if (meta.po !== undefined) patch.po = String(meta.po).slice(0, 40);
  return bump(retailerId, patch);
}

export async function clearCart(retailerId: string, trx = db) {
  await trx('cart_lines').where({ retailer_id: retailerId }).del();
  await trx('carts').where({ retailer_id: retailerId }).update({ note: '', po: '', version: trx.raw('version + 1'), updated_at: new Date() });
}

/** Reorder: rebuild a past order at the usual ratio against live stock, and say what changed before adding anything. */
export async function reorderPreview(retailerId: string, orderId: string) {
  const o = await db('orders').where({ id: orderId, retailer_id: retailerId }).first();
  if (!o) throw notFound('Order not found');
  if (Date.now() - new Date(o.placed_at).getTime() > POLICY.reorderWindowDays * 86_400_000) throw bad('TOO_OLD', `Only orders from the last ${POLICY.reorderWindowDays} days can be reordered. Browse the catalogue instead.`);
  const lines = await db('order_lines').where({ order_id: orderId });
  const st = await stockFor([...new Set(lines.map((l: any) => l.style_id as string))]);
  const out: CartLine[] = [], skipped: { styleId: string; color: string; size: string; name: string }[] = [], reduced: { styleId: string; color: string; size: string; name: string; from: number; to: number }[] = [];
  for (const l of lines) {
    const avail = st[l.style_id]?.[`${l.color}|${l.size}`] ?? 0;
    const want = Number(l.orig_qty ?? l.qty);
    if (!avail) { skipped.push({ styleId: l.style_id, color: l.color, size: l.size, name: l.name }); continue; }
    const q = Math.min(want, avail);
    if (q < want) reduced.push({ styleId: l.style_id, color: l.color, size: l.size, name: l.name, from: want, to: q });
    out.push({ styleId: l.style_id, color: l.color, size: l.size, qty: q });
  }
  const { byId } = await styles();
  return { orderNumber: o.num, placedAt: new Date(o.placed_at).toISOString(), lines: out, skipped, reduced, totalQty: out.reduce((a, l) => a + l.qty, 0), totalValue: out.reduce((a, l) => a + l.qty * (byId.get(l.styleId)?.rate ?? 0), 0) };
}

export async function reorder(retailerId: string, orderId: string) {
  const p = await reorderPreview(retailerId, orderId);
  const current = await getCart(retailerId);
  const merged = p.lines.map(l => {
    const ex = current.lines.find(c => c.styleId === l.styleId && c.color === l.color && c.size === l.size);
    return { ...l, qty: (ex?.qty ?? 0) + l.qty };
  });
  return setLines(retailerId, merged);
}

export { DEFAULT_RATIO };
