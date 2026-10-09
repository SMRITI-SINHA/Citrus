// Seeds a realistic CITRUS-sized dataset (SEED_SCALE=full, default) or the small demo set (SEED_SCALE=demo).
// Masters and stock come from the same generator the stand-in Ginesys uses, stock arrives through a real
// inventory snapshot, and a year of order history is synthesised so analytics, recommendations and load tests
// have something real to chew on. Requires the stand-in Ginesys to be running (npm run dev:mock).
import { STYLES, CURATED, COLORS, DISTRIBUTORS, RETAILERS, ADMINS, PAST_ORDERS, SCALE } from '@citrus/shared/src/seed.ts';
import { SIZES, DEFAULT_RATIO } from '@citrus/shared';
import { db } from './knex.ts';
import { redis } from '../lib/redis.ts';
import { config } from '../config.ts';
import { uid } from '../lib/ids.ts';
import { bulkSet, warmCache } from '../services/stock.ts';
import { erp, unsku } from '../adapters/ginesys.ts';

const t0 = Date.now();
const say = (m: string) => console.log(`[seed ${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);
function rng(seed: number) { let a = seed; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const r = rng(424242);
const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
const DEMO_RID = 'R-RT-KL-0417';
const day = 86_400_000;

// ---- wipe (children first) ----
for (const t of ['inbox', 'counters', 'sync_cursors', 'exceptions', 'points_ledger', 'notifications', 'outbox', 'order_events', 'order_lines', 'orders',
  'cart_lines', 'carts', 'availability', 'style_colors', 'styles', 'refresh_tokens', 'otp_requests', 'users', 'retailers', 'distributors']) await db(t).del();
await redis.flushdb();
say(`scale=${SCALE}: ${STYLES.length} styles, ${RETAILERS.length} retailers, ${DISTRIBUTORS.length} distributors`);

// ---- partners ----
await db.batchInsert('distributors', DISTRIBUTORS.map(d => ({ id: d.id, code: d.code, name: d.name, city: d.city, state: d.state, phone: d.phone, contact: d.contact })), 500);
const retRows = RETAILERS.map((x, i) => {
  const named = i < 7;
  // ASSUMPTION for sample data only: ~62% of stores already activated, credit limits ₹1.5–6 L, some overdue.
  const active = x.code !== 'RT-KL-0417' && (named || r() < 0.62);
  const limit = (15 + Math.floor(r() * 46)) * 10000;
  const overdue = r() < 0.18 ? Math.round(limit * (0.03 + r() * 0.2) / 100) * 100 : 0;
  return {
    id: `R-${x.code}`, code: x.code, store: x.store, owner: x.owner, city: x.city, state: x.state, gstin: x.gstin, phone: x.phone,
    distributor_id: x.distributor, invite_token: x.invite, status: active ? 'active' : 'invited', activated_at: active ? new Date(Date.now() - (30 + r() * 200) * day) : null,
    points: 0, consent_at: active ? new Date(Date.now() - 20 * day) : null, wa_marketing_opt_in: active && r() < 0.5,
    credit_limit: limit, overdue_amount: overdue, overdue_days: overdue ? 15 + Math.floor(r() * 60) : 0, credit_as_of: new Date(), grade: r() < 0.3 ? 'A' : 'B',
  };
});
await db.batchInsert('retailers', retRows, 500);
const users = [
  ...DISTRIBUTORS.map(d => ({ id: `U-${d.id}`, role: 'distributor', phone: d.phone, name: d.contact, distributor_id: d.id, created_at: new Date() })),
  ...ADMINS.map((a, i) => ({ id: `U-ADMIN-${i + 1}`, role: 'admin', phone: a.phone, name: a.name, created_at: new Date() })),
  ...retRows.filter(x => x.status === 'active').map(x => ({ id: `U-${x.id}`, role: 'retailer', phone: x.phone, name: x.owner, retailer_id: x.id, created_at: new Date() })),
];
await db.batchInsert('users', users, 500);
say(`partners: ${retRows.filter(x => x.status === 'active').length} active retailers, ${users.length} users`);

// ---- item master (would arrive via the Ginesys item webhook) ----
await db.batchInsert('styles', STYLES.map((s, i) => ({ id: s.id, name: s.name, category: s.category, kind: s.kind, fit: s.fit, pattern: s.pattern, fabric: s.fabric, rate: s.rate, mrp: s.mrp, points: s.points, is_new: !!s.isNew, rank: i, active: true })), 500);
await db.batchInsert('style_colors', STYLES.flatMap(s => s.colors.map((c, i) => ({ style_id: s.id, color: c, hex: COLORS[c], position: i }))), 1000);
say('item master loaded');

// ---- stock: through a real snapshot from the stand-in Ginesys ----
await fetch(`${config.ginesys.baseUrl}/_admin/reset`, { method: 'POST' });
const { id: snapId } = await (await fetch(`${config.ginesys.baseUrl}/_admin/snapshot`, { method: 'POST' })).json() as any;
const snap = await erp.snapshot(`${config.ginesys.baseUrl}/_files/inventory/${snapId}.json`);
await bulkSet(snap.items.map(i => ({ ...unsku(i.sku), available: i.qty })));
await db('sync_cursors').insert({ name: 'stock', cursor: snap.generatedAt, updated_at: new Date() });
say(`stock: ${snap.items.length} SKUs from snapshot`);

// ---- one year of order history ----
const byId = new Map(STYLES.map(s => [s.id, s]));
// popularity: curated styles and a Zipf-like head of the generated range sell most
const weights = STYLES.map((s, i) => (CURATED.some(c => c.id === s.id) ? 40 : 6 / Math.pow(1 + i / 60, 0.9)));
const cum: number[] = []; weights.reduce((a, w, i) => (cum[i] = a + w), 0);
const total = cum[cum.length - 1];
const drawStyle = () => { const x = r() * total; let lo = 0, hi = cum.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < x) lo = m + 1; else hi = m; } return STYLES[lo]; };

let num = 100000;
const orders: any[] = [], lines: any[] = [], events: any[] = [], ledger: any[] = [];
const points = new Map<string, number>();
const distName = new Map(DISTRIBUTORS.map(d => [d.id, d.name]));
const so = () => `SO/${pick(['KL', 'KA', 'TN', 'OD'])}/25-26/${String(10000 + Math.floor(r() * 89999))}`;

function addOrder(rt: any, at: Date, picks: [string, string, number][]) {
  const id = uid(); const n = `CT-${++num}`;
  let q = 0, v = 0, p = 0;
  picks.forEach(([sid, color, mult], pos) => {
    const s = byId.get(sid)!; const sizes = SIZES[s.category];
    sizes.forEach((z, k) => {
      const qty = DEFAULT_RATIO[s.category][k] * mult;
      if (!qty) return;
      lines.push({ order_id: id, style_id: sid, name: s.name, color, size: z, qty, orig_qty: qty, rate: s.rate, points: s.points, position: pos * 10 + k });
      q += qty; v += qty * s.rate; p += qty * s.points;
    });
  });
  const age = (Date.now() - at.getTime()) / day;
  const roll = r();
  const status = age > 12 ? (roll < 0.03 ? 'rejected' : roll < 0.04 ? 'cancelled' : 'delivered') : age > 6 ? 'dispatched' : age > 2.5 ? 'processing' : 'confirmed';
  const steps: [string, string, string, number][] = [['placed', 'retailer', `Order placed: ${q} pcs`, 0], ['reserved', 'erp', 'Stock reserved in Ginesys', 0.001]];
  if (status === 'rejected') steps.push(['rejected', 'distributor', `Not approved by ${distName.get(rt.distributor_id)}: Outstanding dues`, 0.08 + r() * 0.2]);
  else if (status === 'cancelled') steps.push(['changes_declined', 'retailer', 'Declined suggested changes', 0.5]);
  else {
    const decide = 0.02 + r() * 0.25; // distributor decision within minutes to ~6h
    steps.push(['approved', 'distributor', `Approved by ${distName.get(rt.distributor_id)}`, decide], ['confirmed', 'erp', 'Sales Order authorised in Ginesys', decide + 0.001]);
    if (['processing', 'dispatched', 'delivered'].includes(status)) steps.push(['processing', 'erp', 'Packing started', 1.5]);
    if (['dispatched', 'delivered'].includes(status)) steps.push(['dispatched', 'erp', 'Invoiced and dispatched', 3]);
    if (status === 'delivered') steps.push(['delivered', 'erp', 'Delivered', 6 + r() * 4]);
  }
  for (const [type, actor, message, dd] of steps) events.push({ id: uid(), order_id: id, at: new Date(at.getTime() + dd * day), type, actor, message });
  const last = new Date(at.getTime() + steps[steps.length - 1][3] * day);
  orders.push({
    id, num: n, retailer_id: rt.id, distributor_id: rt.distributor_id, status, idem_key: `hist-${id}`, total_qty: q, total_value: v, total_points: p,
    so_number: status === 'rejected' ? null : so(), erp_state: 'synced', erp_status: status === 'delivered' ? 'snd.logistics.delivered' : 'AUTHORIZED', erp_attempts: 1,
    reason: status === 'rejected' ? 'Outstanding dues' : status === 'cancelled' ? 'You declined the suggested changes' : null,
    placed_at: at, reserved_at: at, updated_at: last, points_awarded: status === 'delivered',
  });
  if (status === 'delivered') {
    ledger.push({ id: uid(), retailer_id: rt.id, delta: p, reason: 'order', order_id: id, created_at: last });
    // sample scheme season: only the last 60 days count towards the current balance (real scheme rules come from CITRUS)
    if (Date.now() - last.getTime() < 60 * day) points.set(rt.id, (points.get(rt.id) ?? 0) + p);
  }
}

const active = retRows.filter(x => x.status === 'active');
const histDays = SCALE === 'full' ? 365 : 90;
for (const rt of active) {
  // each store has a habit: a basket of favourite styles and a buying cycle of 2-6 weeks
  const fav = [...Array(8 + Math.floor(r() * 10))].map(() => drawStyle());
  const cycle = 14 + Math.floor(r() * 28);
  for (let d = histDays - Math.floor(r() * cycle); d > 1; d -= Math.max(5, Math.round(cycle * (0.7 + r() * 0.6)))) {
    // ~4 style-colours at 1:3:3:2:1 → ~40–50 pcs, ~₹30k per order: in line with a ₹100 cr brand across 2,800 stores
    const n = 2 + Math.floor(r() * 5);
    const set = new Map<string, [string, string, number]>();
    for (let i = 0; i < n; i++) {
      const s = r() < 0.75 ? pick(fav) : drawStyle();
      const c = pick(s.colors);
      set.set(`${s.id}|${c}`, [s.id, c, r() < 0.8 ? 1 : 2]);
    }
    addOrder(rt, new Date(Date.now() - d * day - r() * 8 * 3_600_000), [...set.values()]);
  }
}
// the demo store's own story (from the approved demo), so Buy Again and reorder have something familiar to show
const demo = retRows.find(x => x.id === DEMO_RID)!;
for (const po of [...PAST_ORDERS].reverse()) addOrder(demo, new Date(Date.now() - po.daysAgo * day), po.lines);
say(`history built: ${orders.length} orders, ${lines.length} lines, ${events.length} events`);

orders.sort((a, b) => a.placed_at - b.placed_at).forEach((o, i) => (o.num = `CT-${100001 + i}`));
// keep the demo's familiar numbers on its own orders
const demoOrders = orders.filter(o => o.retailer_id === DEMO_RID).sort((a, b) => b.placed_at - a.placed_at);
PAST_ORDERS.forEach((po, i) => { if (demoOrders[i]) demoOrders[i].num = po.number; });
await db.batchInsert('orders', orders, 1000);
await db.batchInsert('order_lines', lines, 2000);
await db.batchInsert('order_events', events, 2000);
await db.batchInsert('points_ledger', ledger, 2000);
for (const [rid, p] of points) await db('retailers').where({ id: rid }).update({ points: p });
// demo store starts close to its next reward, like the approved demo
await db('retailers').where({ id: DEMO_RID }).update({ points: 3640 });
await db('counters').insert({ name: 'order', value: 100000 + orders.length + 10 });
say('history written');

await warmCache();
if (config.dbClient === 'pg') await db.raw('analyze');
say('caches warmed, statistics updated');
console.log(`
Seeded logins (OTP code is shown on screen while OTP_DEV_ECHO=1):
  Retailer (first activation): open /i/sbm-kochi-7f3k, phone 9847041736  (Sree Balaji Menswear, Kochi)
  Retailer (already active):   phone ${RETAILERS[1].phone}  (${RETAILERS[1].store}, ${RETAILERS[1].city})
  Distributor:                 phone 9847012345  (Malabar Trade Links, Kozhikode)
  CITRUS admin:                phone 9845000001  (Hitesh Jain)
Next: npm run seed:queue -w apps/api  (places a few live orders waiting for Malabar's approval; API must be running)`);
await db.destroy(); process.exit(0);
