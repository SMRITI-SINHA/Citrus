// Retailer home: answers "what did I order last, what should I order now, how close am I to my reward".
// Every recommendation reason is computed from real data (no invented statistics). Recommendations are advisory.
import type { StyleCard } from '@citrus/shared';
import { POLICY, REWARD_TIERS, SIZES, DEFAULT_RATIO, mixOf10, type Category } from '@citrus/shared';
import { db } from '../db/knex.ts';
import { redis } from '../lib/redis.ts';
import { styles, cards, affinityFor, type StyleRow } from './catalogue.ts';
import { styleTotals } from './stock.ts';
import { toOrders } from './orders.ts';

export async function home(rid: string) {
  const r = await db('retailers').where({ id: rid }).first();
  const [buyAgain, recommended, newStyles, open, ratios] = await Promise.all([recentOrders(rid), recommendations(rid, r.state), newArrivals(rid), openOrders(rid), myRatios(rid)]);
  const { ratioInfo } = ratios;
  const points = Number(r.points);
  const next = REWARD_TIERS.find(t => t.at > points);
  // Complete the look: pair the first few tops the store is likely to buy with a bottom that goes with them.
  const tops = [...recommended, ...newStyles].filter(c => c.category !== 'Trousers' && c.colors.some(x => x.total > 0)).slice(0, 3);
  const looks = (await Promise.all(tops.map(async t => {
    const color = t.colors.find(x => x.total > 0)!.name;
    const b = (await pairs(t.id, color))[0];
    return b ? { top: { style: t, color }, bottom: { style: b, color: b.colors.find(x => x.total > 0)?.name ?? b.colors[0].name }, reason: b.reason } : null;
  }))).filter(Boolean);
  return {
    store: r.store, buyAgain, recommended, newStyles, openOrders: open, looks, ratios: ratios.ratios, ratioInfo,
    points, nextReward: next ? { ...next, remaining: next.at - points } : null, tiers: REWARD_TIERS,
  };
}

/** Reorder shortcut only for recent orders (ASSUMPTION 'reorder' window) and only where something is still in stock. */
async function recentOrders(rid: string) {
  const since = new Date(Date.now() - POLICY.reorderWindowDays * 86_400_000);
  const rows = await db('orders').where({ retailer_id: rid }).where('placed_at', '>', since).whereNotIn('status', ['rejected', 'cancelled'])
    .orderBy('placed_at', 'desc').limit(5);
  const orders = await toOrders(rows);
  const { byId } = await styles();
  const totals = await styleTotals();
  return orders.map(o => {
    const st = [...new Map(o.lines.filter(l => l.qty > 0).map(l => [`${l.styleId}|${l.color}`, l])).values()];
    return {
      orderId: o.id, number: o.number, placedAt: o.placedAt, status: o.status, totalQty: o.totalQty, totalValue: o.totalValue,
      styles: st.slice(0, 4).map(l => ({ styleId: l.styleId, name: l.name, color: l.color, kind: byId.get(l.styleId)?.kind, hex: byId.get(l.styleId)?.colors.find(c => c.name === l.color)?.hex })),
      moreStyles: Math.max(0, st.length - 4),
      inStockStyles: st.filter(l => (totals[l.styleId] ?? 0) > 0).length, totalStyles: st.length,
    };
  }).filter(o => o.inStockStyles > 0);
}

async function openOrders(rid: string) {
  const rows = await db('orders').where({ retailer_id: rid }).whereIn('status', ['placed', 'review', 'modified', 'approved', 'confirmed', 'processing', 'dispatched'])
    .orderBy('placed_at', 'desc').limit(5);
  return (await toOrders(rows)).map(o => ({ id: o.id, number: o.number, status: o.status, totalQty: o.totalQty, placedAt: o.placedAt, awaitingYou: o.status === 'modified' }));
}

async function newArrivals(rid: string) {
  const { list } = await styles();
  const totals = await styleTotals();
  const aff = await affinityFor(rid);
  const cats = new Set(Object.keys(aff).map(id => id.slice(0, 2)));
  const fresh = list.filter(s => s.isNew && (totals[s.id] ?? 0) > 0)
    .sort((a, b) => Number(cats.has(b.id.slice(0, 2))) - Number(cats.has(a.id.slice(0, 2))) || b.points - a.points).slice(0, 8);
  return cards(fresh, Object.fromEntries(fresh.map(s => [s.id, `New · +${s.points} points per piece`])));
}

/**
 * Three honest signals, cached 10 minutes per retailer:
 *  1. due again: styles this store reorders on a cycle and is now near/past its usual gap;
 *  2. popular nearby: most-ordered styles by stores in the same state in the last 30 days that this store has not bought recently;
 *  3. fill-ins for best-sellers that are in stock.
 */
async function recommendations(rid: string, state: string): Promise<StyleCard[]> {
  const ck = `rec:${rid}`;
  const hit = await redis.get(ck);
  let picks: { id: string; reason: string }[];
  if (hit) picks = JSON.parse(hit);
  else {
    picks = [];
    const { byId } = await styles();
    const totals = await styleTotals();
    const ok = (id: string) => byId.has(id) && (totals[id] ?? 0) > 0 && !picks.some(p => p.id === id);
    const hist = await db('order_lines as l').join('orders as o', 'o.id', 'l.order_id').where('o.retailer_id', rid)
      .where('o.placed_at', '>', new Date(Date.now() - 365 * 86_400_000)).whereNotIn('o.status', ['rejected', 'cancelled'])
      .select('l.style_id', 'o.id as oid', 'o.placed_at').groupBy('l.style_id', 'o.id', 'o.placed_at');
    const by = new Map<string, number[]>();
    for (const h of hist) { const a = by.get(h.style_id) ?? []; a.push(new Date(h.placed_at).getTime()); by.set(h.style_id, a); }
    const due: { id: string; over: number; gapW: number; ago: number }[] = [];
    for (const [id, ts] of by) {
      if (ts.length < 2) continue;
      ts.sort((a, b) => a - b);
      const gap = (ts[ts.length - 1] - ts[0]) / (ts.length - 1);
      const ago = Date.now() - ts[ts.length - 1];
      if (ago > gap * 0.8) due.push({ id, over: ago / gap, gapW: Math.max(1, Math.round(gap / (7 * 86_400_000))), ago: Math.round(ago / 86_400_000) });
    }
    for (const d of due.sort((a, b) => b.over - a.over).slice(0, 4)) if (ok(d.id)) picks.push({ id: d.id, reason: `You usually reorder this every ${d.gapW} week${d.gapW > 1 ? 's' : ''}; last ordered ${d.ago} days ago` });
    const recent = new Set([...by].filter(([, ts]) => Date.now() - Math.max(...ts) < 60 * 86_400_000).map(([id]) => id));
    const pop = await popularIn(state);
    for (const p of pop) { if (picks.length >= 8) break; if (!recent.has(p.id) && ok(p.id)) picks.push({ id: p.id, reason: `Ordered by ${p.stores} stores in ${state} this month` }); }
    await redis.set(ck, JSON.stringify(picks), 'EX', 600);
  }
  const { byId } = await styles();
  const rows = picks.map(p => byId.get(p.id)).filter(Boolean) as StyleRow[];
  return cards(rows, Object.fromEntries(picks.map(p => [p.id, p.reason])));
}

/** Styles ranked by how many distinct stores in a state ordered them in the last 30 days (precomputed, see insights.ts). */
export async function popularIn(state: string): Promise<{ id: string; stores: number }[]> {
  return JSON.parse((await redis.get(`pop:${state}`)) ?? '[]');
}

/**
 * Complete the look: bottoms for a top (or tops for a bottom). "Often ordered together" from real co-purchases in the
 * last 90 days when there is enough data, otherwise a simple colour-harmony rule. Cached 1 hour per style.
 */
export async function pairs(styleId: string, color?: string): Promise<StyleCard[]> {
  const { byId, list } = await styles();
  const s = byId.get(styleId);
  if (!s) return [];
  const wantBottoms = s.category !== 'Trousers';
  const co: { id: string; n: number }[] = JSON.parse((await redis.get(`cop:${styleId}`)) ?? '[]');
  const picks = co.filter(p => byId.get(p.id) && (byId.get(p.id)!.category === 'Trousers') === wantBottoms).map(p => ({ id: p.id, reason: `Often ordered together (${p.n} orders)` }));
  const totals = await styleTotals();
  const chosen = picks.filter(p => (totals[p.id] ?? 0) > 0).slice(0, 4);
  if (chosen.length < 4) {
    const dark = ['Navy', 'Black', 'Charcoal', 'Maroon', 'Olive', 'Indigo', 'Bottle'].includes(color ?? s.colors[0]?.name);
    const preferred = wantBottoms ? (dark ? ['Khaki', 'Stone', 'Grey'] : ['Navy', 'Charcoal', 'Indigo']) : (dark ? ['White', 'Sky Blue', 'Stone'] : ['Navy', 'Black', 'Olive']);
    const pool = list.filter(x => (x.category === 'Trousers') === wantBottoms && x.id !== styleId && (totals[x.id] ?? 0) > 0 && x.colors.some(c => preferred.includes(c.name)));
    for (const x of pool.sort((a, b) => a.rank - b.rank)) {
      if (chosen.length >= 4) break;
      if (!chosen.some(c => c.id === x.id)) chosen.push({ id: x.id, reason: `Pairs with ${color ?? s.colors[0]?.name}: ${x.colors.find(c => preferred.includes(c.name))!.name}` });
    }
  }
  return cards(chosen.map(c => byId.get(c.id)!), Object.fromEntries(chosen.map(c => [c.id, c.reason])));
}

/** The store's own size mix per category over the last 180 days, as small whole numbers (e.g. 1:3:3:2:1). Default when no history. */
export async function myRatios(rid: string) {
  const [rows, saved] = await Promise.all([
    db('order_lines as l').join('orders as o', 'o.id', 'l.order_id').where('o.retailer_id', rid)
      .where('o.placed_at', '>', new Date(Date.now() - 180 * 86_400_000)).whereNotIn('o.status', ['rejected', 'cancelled'])
      .select(db.raw('substr(l.style_id, 1, 2) as p'), 'l.size').sum({ q: 'l.qty' }).groupByRaw('substr(l.style_id, 1, 2), l.size'),
    db('size_mix').where({ retailer_id: rid }),
  ]);
  const cat: Record<string, Category> = { CS: 'Shirts', CT: 'Trousers', CK: 'T-shirts' };
  const ratios = { ...DEFAULT_RATIO };
  const ratioInfo = {} as Record<Category, { source: 'saved' | 'orders' | 'standard'; fromOrders: number[]; pieces: number }>;
  for (const c of Object.keys(SIZES) as Category[]) {
    const q = SIZES[c].map(z => Number(rows.find((x: any) => cat[x.p] === c && x.size === z)?.q ?? 0));
    const pieces = q.reduce((a, b) => a + b, 0);
    // All pieces the store ordered in this category over the last 6 months, per size, scaled to "out of 10".
    // Under 20 pieces is too little history: the CITRUS standard mix is used instead.
    const fromOrders = pieces >= 20 ? mixOf10(q) : DEFAULT_RATIO[c];
    const own = saved.find((x: any) => x.category === c)?.ratio?.split(':').map(Number);
    const ok = own && own.length === SIZES[c].length && own.some((n: number) => n > 0);
    ratios[c] = ok ? own! : fromOrders;
    ratioInfo[c] = { source: ok ? 'saved' : pieces >= 20 ? 'orders' : 'standard', fromOrders, pieces };
  }
  return { ratios, ratioInfo };
}

export async function saveMix(rid: string, category: Category, ratio: number[] | null) {
  if (!ratio) { await db('size_mix').where({ retailer_id: rid, category }).del(); return myRatios(rid); }
  const row = { retailer_id: rid, category, ratio: ratio.join(':'), updated_at: new Date() };
  const n = await db('size_mix').where({ retailer_id: rid, category }).update({ ratio: row.ratio, updated_at: row.updated_at });
  if (!n) await db('size_mix').insert(row);
  return myRatios(rid);
}
