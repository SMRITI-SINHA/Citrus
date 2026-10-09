// CITRUS control room. Aggregates run in the database on indexed columns and are cached briefly in Redis,
// so 2,800 retailers and years of orders never get pulled into the API or the browser.
import { ASSUMPTIONS, POLICY } from '@citrus/shared';
import { db } from '../db/knex.ts';
import { redis } from '../lib/redis.ts';
import { breakerState } from '../adapters/ginesys.ts';
import { queueHealth } from './outbox.ts';
import { stockSyncAgeSeconds } from './stock.ts';
import { toOrders, page } from './orders.ts';
import { styles } from './catalogue.ts';
import { sqlDay, sqlSecondsBetween } from '../lib/sql.ts';

const rupees = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
const lakh = (n: number) => n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(1)} L` : rupees(n);
const day = 86_400_000;

export async function overview() {
  const hit = await redis.get('admin:overview');
  if (hit) return { ...JSON.parse(hit), live: await live() };
  const now = Date.now();
  const startToday = new Date(new Date().setHours(0, 0, 0, 0));
  const d30 = new Date(now - 30 * day), d60 = new Date(now - 60 * day);

  // 14-day daily series for orders and value
  const series = await db('orders').where('placed_at', '>=', new Date(startToday.getTime() - 13 * day)).whereNotIn('status', ['cancelled'])
    .select(db.raw(`${sqlDay('placed_at')} as d`)).count({ n: '*' }).sum({ v: 'total_value' }).groupByRaw(sqlDay('placed_at')).orderBy('d');
  const byDay = new Map(series.map((r: any) => [new Date(r.d).toDateString(), r]));
  const days = [...Array(14)].map((_, i) => byDay.get(new Date(startToday.getTime() - (13 - i) * day).toDateString()) as any);
  const ordersSeries = days.map(r => Number(r?.n ?? 0)), valueSeries = days.map(r => Number(r?.v ?? 0));

  const m30 = await db('orders').where('placed_at', '>=', d30).whereNotIn('status', ['cancelled'])
    .select(db.raw('count(*) as n'), db.raw('sum(total_value) as v'), db.raw('count(distinct retailer_id) as buyers')).first() as any;
  const p30 = await db('orders').where('placed_at', '>=', d60).where('placed_at', '<', d30).whereNotIn('status', ['cancelled'])
    .select(db.raw('count(*) as n'), db.raw('sum(total_value) as v')).first() as any;
  const retailers = await db('retailers').select(db.raw('count(*) as total'), db.raw("sum(case when status = 'active' then 1 else 0 end) as active")).first() as any;
  // repeat rate: of stores that ordered in the last 30 days, how many also ordered in the 30 before
  const repeat = await db.raw(`select count(*) as n from (select distinct retailer_id from orders where placed_at >= ? and status <> 'cancelled') a
    where exists (select 1 from orders b where b.retailer_id = a.retailer_id and b.placed_at >= ? and b.placed_at < ? and b.status <> 'cancelled')`, [d30, d60, d30]);
  const repeatN = Number((repeat.rows ?? repeat)[0]?.n ?? 0);
  // fill rate: pieces finally confirmed vs pieces asked for (distributor cuts + rejections reduce it)
  const fill = await db('order_lines as l').join('orders as o', 'o.id', 'l.order_id').where('o.placed_at', '>=', d30)
    .whereIn('o.status', ['confirmed', 'processing', 'dispatched', 'delivered', 'rejected']).select(
      db.raw("sum(case when o.status = 'rejected' then 0 else l.qty end) as got"), db.raw('sum(l.orig_qty) as asked')).first() as any;
  // approval time: placed -> decision, from the audit trail
  const appr = await db('order_events as e').join('orders as o', 'o.id', 'e.order_id').whereIn('e.type', ['approved', 'modified', 'rejected'])
    .where('e.at', '>=', d30).select(db.raw(`avg(${sqlSecondsBetween('e.at', 'o.placed_at')}) as s`)).first() as any;

  const dormant = await db('retailers as r').where('r.status', 'active')
    .whereNotExists(db('orders as o').whereRaw('o.retailer_id = r.id').where('o.placed_at', '>=', d30)).count({ n: '*' }).first() as any;
  const kpis = [
    { label: 'Orders, last 30 days', value: Number(m30.n).toLocaleString('en-IN'), sub: delta(Number(m30.n), Number(p30.n), 'vs previous 30 days'), series: ordersSeries },
    { label: 'Order value, last 30 days', value: lakh(Number(m30.v ?? 0)), sub: delta(Number(m30.v ?? 0), Number(p30.v ?? 0), 'vs previous 30 days'), series: valueSeries },
    { label: 'Average order value', value: rupees(Number(m30.n) ? Number(m30.v) / Number(m30.n) : 0), sub: `${Number(m30.buyers).toLocaleString('en-IN')} stores ordered` },
    { label: 'Retailers activated', value: `${Number(retailers.active).toLocaleString('en-IN')} / ${Number(retailers.total).toLocaleString('en-IN')}`, sub: 'signed in at least once', pct: Math.round((100 * Number(retailers.active)) / Math.max(1, Number(retailers.total))) },
    { label: 'Repeat ordering', value: `${Math.round((100 * repeatN) / Math.max(1, Number(m30.buyers)))}%`, sub: 'of this month’s buyers also ordered last month', pct: Math.round((100 * repeatN) / Math.max(1, Number(m30.buyers))) },
    { label: 'Dormant stores', value: Number(dormant.n).toLocaleString('en-IN'), sub: 'activated, but no order in 30 days', pct: Math.round((100 * Number(dormant.n)) / Math.max(1, Number(retailers.active))) },
    { label: 'Fill rate', value: `${fill?.asked ? Math.round((100 * Number(fill.got)) / Number(fill.asked)) : 100}%`, sub: 'pieces confirmed of pieces ordered', pct: fill?.asked ? Math.round((100 * Number(fill.got)) / Number(fill.asked)) : 100 },
    { label: 'Distributor decision time', value: appr?.s ? fmtDur(Number(appr.s)) : '—', sub: `average, target under ${POLICY.approvalSlaHours}h (assumption)` },
  ];

  const top = await db('order_lines as l').join('orders as o', 'o.id', 'l.order_id').where('o.placed_at', '>=', d30).whereNotIn('o.status', ['cancelled', 'rejected'])
    .groupBy('l.style_id', 'l.name').select('l.style_id', 'l.name').sum({ q: 'l.qty' }).orderBy('q', 'desc').limit(8);
  const regions = await db('orders as o').join('retailers as r', 'r.id', 'o.retailer_id').where('o.placed_at', '>=', d30).whereNotIn('o.status', ['cancelled', 'rejected'])
    .groupBy('r.state').select('r.state').sum({ v: 'o.total_value' }).count({ n: '*' }).orderBy('v', 'desc');
  const funnel = await db('orders').where('placed_at', '>=', d30).groupBy('status').select('status').count({ n: '*' });

  const base = {
    kpis, topStyles: top.map((t: any) => ({ styleId: t.style_id, name: t.name, qty: Number(t.q) })),
    regions: regions.map((r: any) => ({ name: r.state, value: Number(r.v), orders: Number(r.n) })),
    funnel: Object.fromEntries(funnel.map((f: any) => [f.status, Number(f.n)])),
    generatedAt: new Date().toISOString(),
  };
  await redis.set('admin:overview', JSON.stringify(base), 'EX', 15);
  return { ...base, live: await live() };
}
const delta = (a: number, b: number, s: string) => (b ? `${a >= b ? '+' : ''}${Math.round(((a - b) / b) * 100)}% ${s}` : s);
const fmtDur = (s: number) => (s < 3600 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);

/** Not cached: things an operator acts on. */
async function live() {
  const [exceptions, q, stockAge, pending] = await Promise.all([
    db('exceptions').whereNull('resolved_at').orderBy('created_at', 'desc').limit(50),
    queueHealth(), stockSyncAgeSeconds(),
    db('orders').whereIn('status', ['placed', 'review', 'modified', 'approved']).select('status').count({ n: '*' }).groupBy('status'),
  ]);
  const failedRefs = new Set((await db('outbox').where({ status: 'failed' }).whereIn('ref', exceptions.map((e: any) => e.order_id).filter(Boolean)).select('ref')).map((r: any) => r.ref));
  const orderNums = new Map((await db('orders').whereIn('id', exceptions.map((e: any) => e.order_id).filter(Boolean)).select('id', 'num')).map((o: any) => [o.id, o.num]));
  return {
    exceptions: exceptions.map((e: any) => ({ id: e.id, kind: e.kind, severity: e.severity, title: e.title, detail: e.detail, orderId: e.order_id ?? undefined, orderNumber: orderNums.get(e.order_id), at: new Date(e.created_at).toISOString(), canRetry: failedRefs.has(e.order_id) })),
    pipeline: Object.fromEntries(pending.map((p: any) => [p.status, Number(p.n)])),
    integration: { ginesys: breakerState() === 'open' ? 'down' : q.failed ? 'degraded' : 'ok', breaker: breakerState(), queue: q, stockSnapshotAgeSeconds: stockAge },
  };
}

export async function orders(qs: { status?: string; q?: string; cursor?: string; distributorId?: string; state?: string }) {
  const b = db('orders');
  if (qs.status === 'attention') b.where(w => w.whereIn('erp_state', ['retrying', 'failed']).orWhere('status', 'modified'));
  else if (qs.status) b.whereIn('status', qs.status.split(','));
  if (qs.distributorId) b.where({ distributor_id: qs.distributorId });
  if (qs.q) {
    const q = qs.q.trim();
    const rs = await db('retailers').whereRaw('lower(store) like ?', [`%${q.toLowerCase()}%`]).orWhere('code', q.toUpperCase()).select('id').limit(200);
    b.where(w => w.where('num', q.toUpperCase()).orWhere('so_number', q).orWhereIn('retailer_id', rs.map((r: any) => r.id)));
  }
  return page(b, qs.cursor, 30);
}

export async function retailersList(qs: { q?: string; state?: string; status?: string; cursor?: string }) {
  const b = db('retailers as r').join('distributors as d', 'd.id', 'r.distributor_id');
  if (qs.state) b.where('r.state', qs.state);
  if (qs.status) b.where('r.status', qs.status);
  if (qs.q) b.where(w => w.whereRaw('lower(r.store) like ?', [`%${qs.q!.toLowerCase()}%`]).orWhere('r.code', qs.q!.toUpperCase()).orWhereRaw('lower(r.city) like ?', [`%${qs.q!.toLowerCase()}%`]));
  const off = Number(qs.cursor ?? 0) || 0;
  const rows = await b.orderBy('r.code').offset(off).limit(51).select('r.id', 'r.code', 'r.store', 'r.city', 'r.state', 'r.status', 'r.points', 'r.invite_token', 'r.activated_at', 'd.name as dname');
  const ids = rows.map((r: any) => r.id);
  const last = await db('orders').whereIn('retailer_id', ids).groupBy('retailer_id').select('retailer_id').max({ t: 'placed_at' }).count({ n: '*' });
  const L = new Map(last.map((l: any) => [l.retailer_id, l]));
  return {
    items: rows.slice(0, 50).map((r: any) => ({ id: r.id, code: r.code, store: r.store, city: r.city, state: r.state, distributor: r.dname, activated: r.status === 'active', activatedAt: r.activated_at ? new Date(r.activated_at).toISOString() : undefined, points: Number(r.points), invite: r.invite_token, orders: Number((L.get(r.id) as any)?.n ?? 0), lastOrderAt: (L.get(r.id) as any)?.t ? new Date((L.get(r.id) as any).t).toISOString() : undefined })),
    nextCursor: rows.length > 50 ? String(off + 50) : undefined,
  };
}

/** Distributor scorecard: the biggest real-world risk is distributors not acting on app orders (HUL Shikhar's experience). */
export async function distributorsList() {
  const d30 = new Date(Date.now() - 30 * day);
  const dec = await db('order_events as e').join('orders as o', 'o.id', 'e.order_id').whereIn('e.type', ['approved', 'modified', 'rejected'])
    .where('e.actor', 'distributor').where('e.at', '>=', d30).groupBy('o.distributor_id').select('o.distributor_id')
    .select(db.raw(`avg(${sqlSecondsBetween('e.at', 'o.placed_at')}) as s`))
    .select(db.raw(`sum(case when ${sqlSecondsBetween('e.at', 'o.placed_at')} <= ? then 1 else 0 end) as insla`, [POLICY.approvalSlaHours * 3600])).count({ n: '*' });
  const overrides = await db('order_events as e').join('orders as o', 'o.id', 'e.order_id').where('e.actor', 'admin').where('e.at', '>=', d30)
    .groupBy('o.distributor_id').select('o.distributor_id').count({ n: '*' });
  const D = new Map(dec.map((x: any) => [x.distributor_id, x])), O = new Map(overrides.map((x: any) => [x.distributor_id, Number(x.n)]));
  return (await distributorsBase()).map(r => {
    const x: any = D.get(r.id);
    return { ...r, avgDecisionHours: x ? Math.round((Number(x.s) / 3600) * 10) / 10 : null, withinSlaPct: x ? Math.round((100 * Number(x.insla)) / Number(x.n)) : null, overrides30d: O.get(r.id) ?? 0 };
  });
}

async function distributorsBase() {
  const rows = await db('distributors as d').leftJoin('orders as o', function () { this.on('o.distributor_id', 'd.id').andOn('o.placed_at', '>=', db.raw('?', [new Date(Date.now() - 30 * day)])); })
    .groupBy('d.id', 'd.name', 'd.city', 'd.state').select('d.id', 'd.name', 'd.city', 'd.state').count({ n: 'o.id' })
    .select(db.raw("sum(case when o.status = 'review' then 1 else 0 end) as waiting"), db.raw("sum(case when o.status = 'rejected' then 1 else 0 end) as rejected"))
    .orderBy('d.state').orderBy('d.name');
  return rows.map((r: any) => ({ id: r.id, name: r.name, city: r.city, state: r.state, orders30d: Number(r.n), waiting: Number(r.waiting ?? 0), rejected30d: Number(r.rejected ?? 0) }));
}

export async function lowStock(limit = 100) {
  const { byId } = await styles();
  const rows = await db('availability').where('available', '<=', POLICY.lowStockThreshold).orderBy('available').limit(limit);
  // weight by recent demand so the list shows what actually matters
  const demand = await db('order_lines as l').join('orders as o', 'o.id', 'l.order_id').where('o.placed_at', '>=', new Date(Date.now() - 30 * day))
    .whereIn('l.style_id', [...new Set(rows.map((r: any) => r.style_id))]).groupBy('l.style_id', 'l.color', 'l.size').select('l.style_id', 'l.color', 'l.size').sum({ q: 'l.qty' });
  const D = new Map(demand.map((d: any) => [`${d.style_id}|${d.color}|${d.size}`, Number(d.q)]));
  return rows.map((r: any) => ({ styleId: r.style_id, name: byId.get(r.style_id)?.name, color: r.color, size: r.size, available: Number(r.available), sold30d: D.get(`${r.style_id}|${r.color}|${r.size}`) ?? 0 }))
    .sort((a, b) => b.sold30d - a.sold30d);
}

export async function orderDetail(id: string) {
  const o = (await toOrders(await db('orders').where({ id })))[0];
  const outbox = await db('outbox').where({ ref: id }).orderBy('created_at').select('topic', 'status', 'attempts', 'last_error', 'created_at', 'done_at', 'request_id');
  const notes = await db('notifications').where({ order_id: id }).orderBy('created_at').select('channel', 'template', 'status', 'created_at', 'to_phone');
  return { order: o, integration: outbox.map((x: any) => ({ ...x, created_at: new Date(x.created_at).toISOString(), done_at: x.done_at ? new Date(x.done_at).toISOString() : null })), notifications: notes.map((n: any) => ({ ...n, to_phone: '••' + String(n.to_phone).slice(-4), created_at: new Date(n.created_at).toISOString() })) };
}

export const assumptions = () => ASSUMPTIONS.map(a => ({ ...a, status: 'pending confirmation' }));
