// Precomputed buying signals. Heavy aggregates (regional popularity, "often ordered together") run in the background
// on one instance under a Redis lock and are read from Redis by requests, so a roadshow rush never triggers them.
import { db } from '../db/knex.ts';
import { redis } from '../lib/redis.ts';
import { log } from '../lib/log.ts';

const DAY = 86_400_000;

export async function refreshPopular() {
  const rows = await db('order_lines as l').join('orders as o', 'o.id', 'l.order_id').join('retailers as r', 'r.id', 'o.retailer_id')
    .where('o.placed_at', '>', new Date(Date.now() - 30 * DAY)).whereNotIn('o.status', ['rejected', 'cancelled'])
    .groupBy('r.state', 'l.style_id').select('r.state', 'l.style_id').countDistinct({ n: 'o.retailer_id' });
  const by = new Map<string, { id: string; stores: number }[]>();
  for (const r of rows as any[]) { const a = by.get(r.state) ?? []; a.push({ id: r.style_id, stores: Number(r.n) }); by.set(r.state, a); }
  const p = redis.pipeline();
  for (const [state, list] of by) p.set(`pop:${state}`, JSON.stringify(list.sort((a, b) => b.stores - a.stores).slice(0, 60)), 'EX', 3 * 3600);
  await p.exec();
  return by.size;
}

/** Top-bottom co-purchases in the last 90 days: for each style, the styles of the other kind most often in the same order. */
export async function refreshPairs() {
  const rows = await db.raw(`
    select a.style_id as a, b.style_id as b, count(distinct a.order_id) as n
    from order_lines a join order_lines b on a.order_id = b.order_id
    join orders o on o.id = a.order_id
    where o.placed_at > ? and o.status not in ('rejected','cancelled')
      and ((a.style_id like 'CT-%' and b.style_id not like 'CT-%') or (a.style_id not like 'CT-%' and b.style_id like 'CT-%'))
    group by a.style_id, b.style_id having count(distinct a.order_id) >= 3`, [new Date(Date.now() - 90 * DAY)]);
  const by = new Map<string, { id: string; n: number }[]>();
  for (const r of (rows.rows ?? rows) as any[]) { const x = by.get(r.a) ?? []; x.push({ id: r.b, n: Number(r.n) }); by.set(r.a, x); }
  const entries = [...by].map(([k, v]) => [k, JSON.stringify(v.sort((p, q) => q.n - p.n).slice(0, 6))] as const);
  for (let i = 0; i < entries.length; i += 500) {
    const p = redis.pipeline();
    for (const [k, v] of entries.slice(i, i + 500)) p.set(`cop:${k}`, v, 'EX', 6 * 3600);
    await p.exec();
  }
  return by.size;
}

export async function runInsights(force = false) {
  if (!force && !(await redis.set('ct:insights-lock', '1', 'EX', 900, 'NX'))) return;
  const t = Date.now();
  try {
    const states = await refreshPopular();
    const styles = await refreshPairs();
    log.info({ states, styles, ms: Date.now() - t }, 'insights refreshed');
  } catch (e) { log.error({ err: e }, 'insights failed'); }
}
