// Dev-only stand-in for apps/api so the PWA can be exercised (and screenshotted) before the real API runs.
// Implements the docs/API.md contract over the shared seed data. Not used in production.
// Run: npm run mock -w apps/web   (port 4300), then VITE_MOCK=1 npm run dev -w apps/web
// The same handler also runs inside the browser for the hosted demo (src/demo/inbrowser.ts), so it uses no Node-only modules.
import type { Cart, CartLine, Category, Me, Order, OrderLine, OrderStatus, StyleCard, Look } from '@citrus/shared';
import { ASSUMPTIONS, DEFAULT_RATIO, DISCOUNT_STEPS, offerFor, PRICE_BANDS, REWARD_TIERS, SIZES } from '@citrus/shared';
import { partnersFor, type LookCtx, type LookStyle } from '@citrus/shared/src/looks.ts';
import { COLORS, DISTRIBUTORS, PAST_ORDERS, RECOMMENDATIONS, RETAILERS, STYLES, seedStock } from '@citrus/shared/src/seed.ts';

const env: Record<string, string | undefined> = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const randomUUID = () => globalThis.crypto.randomUUID();
/** The slice of Node's IncomingMessage / ServerResponse the handler uses, so the browser demo can supply its own. */
export interface MockReq { url?: string; method?: string; headers: Record<string, string | undefined>; on(ev: string, f: (chunk?: any) => void): void }
export interface MockRes { writeHead(status: number, headers: Record<string, string>): void; write(chunk: string): void; end(body?: string): void }
export const MOCK_INFO = () => ({ retailer: RET.phone, invite: RET.invite, distributor: DIST.phone, admin: '9845000001', code: '482916' });
const stock = seedStock();
const byId = new Map(STYLES.map(s => [s.id, s]));
const resolved = new Set<string>();
const RET = RETAILERS[0];
const DIST = DISTRIBUTORS.find(d => d.id === RET.distributor)!;
const users: Record<string, Me> = {
  [RET.phone]: { userId: 'u-r1', role: 'retailer', name: `${RET.owner} K.`, phone: RET.phone, points: 780, consentRequired: env.CONSENT === '1', supportPhone: '9845012345', repName: 'Imran Khan',
    retailer: { id: 'r1', code: RET.code, store: RET.store, city: RET.city, state: RET.state, gstin: RET.gstin, distributor: { id: DIST.id, name: DIST.name, city: DIST.city } } },
  [DIST.phone]: { userId: 'u-d1', role: 'distributor', name: DIST.contact, phone: DIST.phone, distributor: { id: DIST.id, name: DIST.name, city: DIST.city, state: DIST.state } },
  '9845000001': { userId: 'u-a1', role: 'admin', name: 'Hitesh Jain', phone: '9845000001' },
};
const sessions = new Map<string, string>(); // refresh token -> phone
const tokens = new Map<string, string>(); // access token -> phone
const otps = new Map<string, string>(); // requestId -> phone

const card = (id: string, reason?: string): StyleCard => {
  const s = byId.get(id)!;
  const st: Record<string, Record<string, number>> = {};
  for (const c of s.colors) st[c] = Object.fromEntries(SIZES[s.category].map(z => [z, stock[`${s.id}|${c}|${z}`] ?? 0]));
  return { id: s.id, name: s.name, category: s.category, fit: s.fit, fabric: s.fabric, pattern: s.pattern, kind: s.kind, rate: s.rate, mrp: s.mrp, points: s.points, isNew: !!s.isNew,
    colors: s.colors.map(c => ({ name: c, hex: COLORS[c] ?? '#888', total: Object.values(st[c]).reduce((a, b) => a + b, 0) })), stock: st, reason, offer: offerFor(s.id, s.rate) };
};

let cart: Cart = { lines: [], note: '', po: '', updatedAt: new Date().toISOString(), version: 1 };
let orderNo = 10480;
const mkLines = (spec: [string, string, number][]): OrderLine[] => spec.flatMap(([sid, c, m]) => {
  const s = byId.get(sid)!; return SIZES[s.category].map((z, i) => ({ styleId: sid, name: s.name, color: c, size: z, qty: DEFAULT_RATIO[s.category][i] * m * 2, rate: s.rate, points: s.points }));
});
const mkOrder = (num: string, lines: OrderLine[], status: OrderStatus, ago: number, store = RET.store, city = RET.city, rid = 'r1'): Order => {
  const at = new Date(Date.now() - ago * 60_000).toISOString();
  return { id: 'o-' + num, number: num, retailerId: rid, store, city, distributorId: DIST.id, distributorName: DIST.name, status, lines,
    totalQty: lines.reduce((a, l) => a + l.qty, 0), totalValue: lines.reduce((a, l) => a + l.qty * l.rate, 0), totalPoints: lines.reduce((a, l) => a + l.qty * l.points, 0),
    erp: { state: 'synced', attempts: 1, soNumber: status === 'delivered' ? `SO/KL/26-27/0${4000 + Number(num.slice(3)) % 900}` : undefined, erpStatus: status === 'delivered' ? 'Delivered' : undefined },
    placedAt: at, updatedAt: at, events: [{ at, type: 'placed', actor: 'retailer', message: `Order ${num} received. Sent to ${DIST.name} for review.` }] };
};
const orders: Order[] = PAST_ORDERS.map(p => mkOrder(p.number, mkLines(p.lines), 'delivered', p.daysAgo * 1440));
// Two seasonal (non-NOS) orders: their styles are no longer stocked, so they can be viewed but not reordered.
const seasonal = (sid: string, name: string, c: string, rate: number, m: number): OrderLine[] =>
  SIZES.Shirts.map((z, i) => ({ styleId: sid, name, color: c, size: z, qty: DEFAULT_RATIO.Shirts[i] * m * 2, rate, points: 20 }));
for (const [num, days, coll, lines] of [
  ['CT-10297', 96, "Onam Festive '26", [...seasonal('SF-7104', 'Kasavu Border Kurta Shirt', 'Off White', 890, 2), ...seasonal('SF-7108', 'Festive Jacquard Shirt', 'Maroon', 940, 1)]],
  ['CT-10214', 150, "Summer '26", [...seasonal('SS-6202', 'Resort Linen Shirt', 'Mint', 760, 2)]],
] as [string, number, string, OrderLine[]][]) orders.push({ ...mkOrder(num, lines, 'delivered', days * 1440), collection: coll });
for (const o of orders) if (!o.collection) o.collection = 'NOS';
// Stock has moved since the recent orders: a few sizes from the second one have sold out, and one style from the third is gone.
{
  const mine = orders.filter(o => o.retailerId === 'r1' && o.collection === 'NOS');
  const zero = (o: Order | undefined, styleNo: number, sizes?: string[]) => {
    const keys = [...new Set(o?.lines.map(l => `${l.styleId}|${l.color}`) ?? [])];
    const k = keys[styleNo]; if (!k) return;
    for (const l of o!.lines) if (`${l.styleId}|${l.color}` === k && (!sizes || sizes.includes(l.size))) stock[`${k}|${l.size}`] = 0;
  };
  for (const l of mine[0]?.lines ?? []) stock[`${l.styleId}|${l.color}|${l.size}`] = Math.max(stock[`${l.styleId}|${l.color}|${l.size}`] ?? 0, l.qty + 6);
  zero(mine[1], 0, ['40', '42', '44', 'L', 'XL', 'XXL', '36', '38']);
  zero(mine[2], 0); zero(mine[2], 1, ['40', '42', 'L', 'XL', '34', '36']);
}
// Orders still on their way, one at each stage, so the Orders tab can be filtered by status.
const step = (o: Order, plan: [string, number, string][]) => { for (const [type, ago, message] of plan) o.events.push({ at: new Date(Date.now() - ago * 60_000).toISOString(), type, actor: type === 'approved' ? 'distributor' : 'erp', message }); o.updatedAt = o.events[o.events.length - 1].at; return o; };
const so = (o: Order, n: number) => { o.erp.soNumber = `SO/KL/26-27/0${n}`; return o; };
const live: Order[] = [
  step(mkOrder('CT-10474', mkLines([['CS-1101', 'White', 1], ['CT-2102', 'Charcoal', 1]]), 'review', 26 * 60), [['reserved', 26 * 60 - 1, 'Stock held. Sent to the distributor.']]),
  step(mkOrder('CT-10466', mkLines([['CK-3101', 'Navy', 2]]), 'approved', 2 * 1440), [['reserved', 2 * 1440 - 1, 'Stock held.'], ['approved', 2 * 1440 - 200, 'Approved by the distributor.']]),
  so(step(mkOrder('CT-10459', mkLines([['CS-1105', 'Navy', 1], ['CT-2101', 'Khaki', 1]]), 'confirmed', 3 * 1440), [['reserved', 3 * 1440 - 1, 'Stock held.'], ['approved', 3 * 1440 - 180, 'Approved.'], ['confirmed', 3 * 1440 - 240, 'CITRUS order created.']]), 4811),
  so(step(mkOrder('CT-10452', mkLines([['CS-1103', 'Stone', 1], ['CK-3102', 'Black', 1]]), 'processing', 5 * 1440), [['reserved', 5 * 1440 - 1, 'Stock held.'], ['approved', 5 * 1440 - 120, 'Approved.'], ['confirmed', 5 * 1440 - 200, 'CITRUS order created.'], ['processing', 4 * 1440, 'Packing at the warehouse.']]), 4797),
  so(step(mkOrder('CT-10447', mkLines([['CT-2104', 'Indigo', 1], ['CS-1102', 'White', 1]]), 'dispatched', 8 * 1440), [['reserved', 8 * 1440 - 1, 'Stock held.'], ['approved', 8 * 1440 - 90, 'Approved.'], ['confirmed', 8 * 1440 - 150, 'CITRUS order created.'], ['processing', 7 * 1440, 'Packing at the warehouse.'], ['dispatched', 6 * 1440, 'Handed to the courier.']]), 4772),
  step(mkOrder('CT-10433', mkLines([['CS-1104', 'Sky Blue', 3]]), 'rejected', 26 * 1440), [['reserved', 26 * 1440 - 1, 'Stock held.'], ['rejected', 26 * 1440 - 300, 'Credit limit reached. Please clear the pending invoice and order again.']]),
];
live[5].reason = 'Credit limit reached. Please clear the pending invoice and order again.';
orders.push(...live);
const queue: Order[] = [
  mkOrder('CT-10479', mkLines([['CS-1102', 'White', 1], ['CT-2102', 'Charcoal', 1]]), 'review', 190, 'Om Sai Collection', 'Thrissur', 'r2'),
  mkOrder('CT-10476', mkLines([['CT-2104', 'Indigo', 2], ['CS-1105', 'Navy', 1], ['CK-3102', 'Black', 1]]), 'review', 302, 'Rajhans Garments', 'Kannur', 'r3'),
  mkOrder('CT-10478', mkLines([['CK-3101', 'Navy', 1]]), 'review', 40, 'Style Point', 'Kottayam', 'r4'),
];
queue[0].note = 'Need before Onam sale';
queue.push(live[0]);
const sseClients = new Set<MockRes>();
const push = (ev: unknown) => { for (const c of sseClients) c.write(`data: ${JSON.stringify(ev)}\n\n`); };
let failNext = env.STOCK_CONFLICT === '1';

function send(res: MockRes, status: number, body?: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'content-type': 'application/json', 'x-request-id': randomUUID(), ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
}
const err = (res: MockRes, status: number, code: string, message: string, extra: object = {}) => send(res, status, { code, message, ...extra });
const cookie = (req: MockReq) => Object.fromEntries((req.headers.cookie ?? '').split(';').map(c => c.trim().split('=')).filter(x => x[0]));
const who = (req: MockReq, url: URL) => {
  const t = (req.headers.authorization ?? '').replace('Bearer ', '') || url.searchParams.get('token') || '';
  const p = tokens.get(t); return p ? users[p] : undefined;
};
const body = (req: MockReq) => new Promise<any>(r => { let d = ''; req.on('data', c => (d += c)); req.on('end', () => { try { r(JSON.parse(d || '{}')); } catch { r({}); } }); });
const session = (phone: string, _res: MockRes) => {
  const at = randomUUID(), rt = randomUUID(); tokens.set(at, phone); sessions.set(rt, phone);
  return { s: { accessToken: at, expiresIn: 900, me: users[phone] }, h: { 'set-cookie': `ct_refresh=${rt}; HttpOnly; Path=/api/auth; SameSite=Lax` } };
};
const avail = (l: { styleId: string; color: string; size: string }) => stock[`${l.styleId}|${l.color}|${l.size}`] ?? 0;
const bump = () => { cart = { ...cart, updatedAt: new Date().toISOString(), version: cart.version + 1 }; };

// What this store buys, for Complete the look: styles it has ordered and how many pieces of each trouser/shirt type.
const tot = (id: string, c: string) => { const s = byId.get(id); return s ? SIZES[s.category].reduce((a, z) => a + (stock[`${id}|${c}|${z}`] ?? 0), 0) : 0; };
const lookCtx = (): LookCtx => {
  const bought = new Map<string, number>(), boughtKinds = new Map<string, number>();
  for (const o of orders) if (o.retailerId === 'r1' && o.status !== 'rejected' && o.status !== 'cancelled') {
    for (const id of new Set(o.lines.map(l => l.styleId))) bought.set(id, (bought.get(id) ?? 0) + 1);
    for (const l of o.lines) { const k = byId.get(l.styleId)?.kind; if (k) boughtKinds.set(k, (boughtKinds.get(k) ?? 0) + l.qty); }
  }
  return { stockOf: tot, bought, boughtKinds };
};

export async function handle(req: MockReq, res: MockRes) {
  const url = new URL(req.url!, 'http://x');
  const p = url.pathname, m = req.method!;
  // In the hosted demo the mock runs inside the page: answer at once so tabs switch instantly.
  const lat = Number(env.LATENCY ?? (typeof window === 'undefined' ? 120 : 0));
  if (lat) await new Promise(r => setTimeout(r, lat));
  try {
    if (p === '/api/auth/otp' && m === 'POST') {
      const b = await body(req); const phone = String(b.phone ?? '').replace(/\D/g, '').slice(-10);
      if (!users[phone]) return err(res, 403, 'UNKNOWN_NUMBER', 'This number is not registered with CITRUS. We have told the CITRUS team; your rep will call to verify.');
      const id = randomUUID(); otps.set(id, phone);
      return send(res, 200, { requestId: id, expiresIn: 300, resendIn: 30, devCode: '482916' });
    }
    if (p === '/api/auth/verify' && m === 'POST') {
      const b = await body(req); const phone = otps.get(b.requestId);
      if (!phone || b.code !== '482916') return err(res, 400, 'WRONG_CODE', 'That code is not right. 4 tries left.');
      const { s, h } = session(phone, res); return send(res, 200, s, h);
    }
    if (p === '/api/auth/refresh' && m === 'POST') {
      const phone = sessions.get(cookie(req).ct_refresh ?? '');
      if (!phone) return err(res, 401, 'NO_SESSION', 'Please sign in.');
      const { s, h } = session(phone, res); return send(res, 200, s, h);
    }
    if (p === '/api/auth/logout') { sessions.delete(cookie(req).ct_refresh ?? ''); return send(res, 204, undefined, { 'set-cookie': 'ct_refresh=; Max-Age=0; Path=/api/auth' }); }
    if (p.startsWith('/api/auth/invite/')) {
      const r = RETAILERS.find(x => x.invite === decodeURIComponent(p.split('/').pop()!));
      if (!r) return err(res, 404, 'INVITE_NOT_FOUND', 'This link is not valid. Ask your CITRUS rep for a new one.');
      const d = DISTRIBUTORS.find(x => x.id === r.distributor)!;
      return send(res, 200, { store: r.store, city: `${r.city}, ${r.state}`, code: r.code, maskedPhone: `${r.phone.slice(0, 2)}XXX XX${r.phone.slice(7)}`, distributor: d.name });
    }
    if (p === '/api/events') {
      if (!who(req, url)) return err(res, 401, 'NO_SESSION', 'Please sign in.');
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(': hi\n\n'); sseClients.add(res); req.on('close', () => sseClients.delete(res)); return;
    }
    const me = who(req, url);
    if (!me) return err(res, 401, 'NO_SESSION', 'Please sign in.');
    if (p === '/api/me') return send(res, 200, me);
    if (p === '/api/me/consent') { me.consentRequired = false; return send(res, 200, me); }

    // retailer
    if (p === '/api/home') {
      const recent = orders.filter(o => o.retailerId === 'r1' && o.status === 'delivered').slice(0, 3).map(o => {
        const st = [...new Map(o.lines.map(l => [`${l.styleId}|${l.color}`, l])).values()];
        return { orderId: o.id, number: o.number, placedAt: o.placedAt, status: o.status, totalQty: o.totalQty, totalValue: o.totalValue,
          styles: st.map(l => ({ styleId: l.styleId, name: l.name, color: l.color, kind: byId.get(l.styleId)!.kind, hex: COLORS[l.color] })),
          inStockStyles: st.filter(l => SIZES[byId.get(l.styleId)!.category].some(z => avail({ ...l, size: z }) > 0)).length, totalStyles: st.length,
          inStockQty: o.lines.reduce((a, l) => a + Math.min(l.qty, avail(l)), 0) };
      });
      return send(res, 200, { buyAgain: recent, recommended: RECOMMENDATIONS.map(r => card(r.styleId, r.reason)), newStyles: STYLES.filter(s => s.isNew).slice(0, 8).map(s => card(s.id)),
        looks: [],
        points: me.points ?? 0, nextReward: REWARD_TIERS.find(t => t.at > (me.points ?? 0)) });
    }
    if (p === '/api/catalogue') {
      const q = (url.searchParams.get('q') ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      const cat = url.searchParams.get('category');
      const csv = (k: string) => (url.searchParams.get(k) ?? '').split(',').filter(Boolean);
      let list = STYLES.filter(s => (q.length ? q.every(t => `${s.id} ${s.name} ${s.category} ${s.fit} ${s.pattern} ${s.fabric} ${s.kind} ${s.colors.join(' ')}`.toLowerCase().includes(t.replace('trouser', 'trouser'))) : !cat || s.category === cat));
      if (url.searchParams.get('isNew')) list = list.filter(s => s.isNew);
      const base = list;
      const fits = csv('fit'), pats = csv('pattern'), cols = csv('color'), fabs = csv('fabric'), bands = csv('price'), sizes = csv('size');
      const minPct = Number(url.searchParams.get('discount')) || 0;
      type S = typeof STYLES[number];
      const eff = (s: S) => offerFor(s.id, s.rate)?.rate ?? s.rate, pct = (s: S) => offerFor(s.id, s.rate)?.pct ?? 0;
      const bandOf = (s: S) => PRICE_BANDS.find(b => eff(s) >= b.min && eff(s) <= b.max)?.key ?? '';
      const inSizes = (s: S) => SIZES[s.category].filter(z => s.colors.some(c => (stock[`${s.id}|${c}|${z}`] ?? 0) > 0));
      if (fits.length) list = list.filter(s => fits.includes(s.fit));
      if (pats.length) list = list.filter(s => pats.includes(s.pattern));
      if (cols.length) list = list.filter(s => s.colors.some(c => cols.includes(c)));
      if (fabs.length) list = list.filter(s => fabs.includes(s.fabric));
      if (bands.length) list = list.filter(s => bands.includes(bandOf(s)));
      if (sizes.length) list = list.filter(s => inSizes(s).some(z => sizes.includes(z)));
      if (url.searchParams.get('offer')) list = list.filter(s => pct(s) > 0);
      if (minPct) list = list.filter(s => pct(s) >= minPct);
      const tot = (id: string) => byId.get(id)!.colors.reduce((a, c) => a + SIZES[byId.get(id)!.category].reduce((x, z) => x + (stock[`${id}|${c}|${z}`] ?? 0), 0), 0);
      if (url.searchParams.get('inStock')) list = list.filter(s => tot(s.id) > 0);
      const sort = url.searchParams.get('sort') ?? 'best';
      list = [...list].sort(sort === 'avail' ? (a, b) => tot(b.id) - tot(a.id) : sort === 'new' ? (a, b) => Number(!!b.isNew) - Number(!!a.isNew) : sort === 'points' ? (a, b) => b.points - a.points
        : sort === 'offer' ? (a, b) => pct(b) - pct(a) : sort === 'price' ? (a, b) => eff(a) - eff(b) : () => 0);
      const facet = (f: (s: S) => string[], from: S[] = base) => { const m = new Map<string, number>(); for (const s of from) for (const v of new Set(f(s))) m.set(v, (m.get(v) ?? 0) + 1); return [...m].map(([value, n]) => ({ value, n })).sort((a, b) => b.n - a.n); };
      const sizeOrder = (cat ? SIZES[cat as Category] : [...SIZES.Shirts, ...SIZES.Trousers]) ?? [];
      const limit = Math.min(Number(url.searchParams.get('limit') ?? 24), 60), start = Number(url.searchParams.get('cursor') ?? 0);
      return send(res, 200, { items: list.slice(start, start + limit).map(s => card(s.id)), nextCursor: start + limit < list.length ? String(start + limit) : undefined, total: list.length,
        facets: { fit: facet(s => [s.fit]), pattern: facet(s => [s.pattern]), color: facet(s => s.colors), fabric: facet(s => [s.fabric]),
          size: facet(inSizes, list).sort((a, b) => sizeOrder.indexOf(a.value) - sizeOrder.indexOf(b.value)),
          price: facet(s => [bandOf(s)], list).sort((a, b) => PRICE_BANDS.findIndex(x => x.key === a.value) - PRICE_BANDS.findIndex(x => x.key === b.value)),
          discount: DISCOUNT_STEPS.map(d => ({ value: String(d), n: list.filter(s => pct(s) >= d).length })), offer: [{ value: '1', n: list.filter(s => pct(s) > 0).length }] } });
    }
    const pr = p.match(/^\/api\/styles\/([^/]+)\/pairs$/);
    if (pr) {
      const s0 = byId.get(decodeURIComponent(pr[1])); if (!s0) return send(res, 200, []);
      const color = url.searchParams.get('color') ?? s0.colors[0];
      return send(res, 200, partnersFor(s0 as LookStyle, color, STYLES as LookStyle[], lookCtx(), 4).map(x => ({ ...card(x.style.id, x.reason), pairColor: x.color })));
    }
    if (p === '/api/looks') {
      // Built around what the store is buying now: cart first, then styles it looked at, then its last orders.
      const ctx = lookCtx(); const used = new Set<string>(); const out: Look[] = [];
      const anchors: { id: string; color: string; source: Look['source'] }[] = [];
      for (const [k, src] of [['cart', 'cart'], ['viewed', 'viewed']] as const) for (const a of (url.searchParams.get(k) ?? '').split(',').filter(Boolean)) { const [id, color] = a.split('|'); if (byId.has(id) && color) anchors.push({ id, color, source: src }); }
      for (const o of orders.filter(o => o.retailerId === 'r1' && o.status === 'delivered' && o.collection === 'NOS').slice(0, 2)) for (const l of o.lines) anchors.push({ id: l.styleId, color: l.color, source: 'ordered' });
      for (const a of anchors) {
        if (out.length >= 4) break;
        const key = `${a.id}|${a.color}`; if (used.has(key)) continue; used.add(key);
        const s = byId.get(a.id)!; const top = s.category !== 'Trousers';
        const pick = partnersFor(s as LookStyle, a.color, STYLES as LookStyle[], ctx, 6).find(x => !used.has(`${x.style.id}|${x.color}`));
        if (!pick) continue; used.add(`${pick.style.id}|${pick.color}`);
        const mine = { style: card(a.id), color: a.color }, other = { style: card(pick.style.id), color: pick.color };
        const lead = a.source === 'cart' ? `For the ${s.name} in your cart. ` : a.source === 'viewed' ? `You looked at the ${s.name}. ` : '';
        out.push({ top: top ? mine : other, bottom: top ? other : mine, reason: lead + pick.reason, source: a.source, anchor: top ? 'top' : 'bottom' });
      }
      return send(res, 200, out);
    }
    if (p.startsWith('/api/styles/')) { const id = decodeURIComponent(p.split('/')[3]); return byId.has(id) ? send(res, 200, card(id)) : err(res, 404, 'NOT_FOUND', 'Style not found'); }
    if (p === '/api/cart' && m === 'GET') return send(res, 200, cart);
    if (p === '/api/cart/lines' && m === 'PUT') {
      const b = await body(req);
      if (b.version !== cart.version) return err(res, 409, 'VERSION_CONFLICT', 'Cart changed elsewhere.');
      const capped: CartLine[] = [];
      for (const l of b.lines as CartLine[]) {
        const q = Math.min(l.qty, avail(l)); if (q < l.qty) capped.push({ ...l, qty: q });
        cart.lines = cart.lines.filter(x => !(x.styleId === l.styleId && x.color === l.color && x.size === l.size));
        if (q > 0) cart.lines.push({ ...l, qty: q });
      }
      bump(); return send(res, 200, cart, capped.length ? { 'x-capped': JSON.stringify(capped) } : {});
    }
    if (p === '/api/cart/meta' && m === 'PUT') { const b = await body(req); cart = { ...cart, note: b.note ?? cart.note, po: b.po ?? cart.po }; bump(); return send(res, 200, cart); }
    const ro = p.match(/^\/api\/cart\/reorder\/([^/]+)(\/preview)?$/);
    if (ro && m === 'POST') {
      const o = orders.find(x => x.id === decodeURIComponent(ro[1])); if (!o) return err(res, 404, 'NOT_FOUND', 'Order not found');
      const lines: CartLine[] = [], skipped: object[] = [], reduced: object[] = [];
      for (const l of o.lines) { const n = avail(l); if (!n) { skipped.push({ styleId: l.styleId, color: l.color, size: l.size, name: l.name }); continue; } const q = Math.min(n, l.qty); if (q < l.qty) reduced.push({ styleId: l.styleId, color: l.color, size: l.size, name: l.name, from: l.qty, to: q }); lines.push({ styleId: l.styleId, color: l.color, size: l.size, qty: q }); }
      if (ro[2]) return send(res, 200, { orderNumber: o.number, placedAt: o.placedAt, lines, skipped, reduced });
      for (const l of lines) { const e = cart.lines.find(x => x.styleId === l.styleId && x.color === l.color && x.size === l.size); if (e) e.qty = Math.min(avail(l), e.qty + l.qty); else cart.lines.push(l); }
      bump(); return send(res, 200, cart);
    }
    if (p === '/api/orders' && m === 'POST') {
      const b = await body(req);
      const dup = orders.find(o => (o as any).key === b.idempotencyKey); if (dup) return send(res, 201, dup);
      if (b.cartVersion !== cart.version) return err(res, 409, 'CART_CHANGED', 'Your cart was changed on another device.', { cart });
      if (failNext && cart.lines.length) {
        failNext = false; const big = [...cart.lines].sort((a, b) => b.qty - a.qty)[0]; const now = Math.max(1, Math.floor(big.qty / 2)); stock[`${big.styleId}|${big.color}|${big.size}`] = now;
        return err(res, 409, 'STOCK_CHANGED', 'Some sizes sold out while you were ordering.', { lines: [{ ...big, requested: big.qty, available: now }] });
      }
      const lines = cart.lines.map(l => { const s = byId.get(l.styleId)!; return { ...l, name: s.name, rate: offerFor(s.id, s.rate)?.rate ?? s.rate, points: s.points }; });
      const o = mkOrder(`CT-${++orderNo}`, lines, 'review', 0); o.note = cart.note; o.po = cart.po; (o as any).key = b.idempotencyKey;
      for (const l of lines) stock[`${l.styleId}|${l.color}|${l.size}`] -= l.qty;
      orders.unshift(o); queue.push(o); cart = { lines: [], note: '', po: '', updatedAt: new Date().toISOString(), version: cart.version + 1 };
      return send(res, 201, o);
    }
    if (p === '/api/orders') return send(res, 200, { items: orders.filter(o => o.retailerId === 'r1') });
    const od = p.match(/^\/api\/orders\/([^/]+)(\/changes)?$/);
    if (od) {
      const o = orders.find(x => x.id === od[1]) ?? queue.find(x => x.id === od[1]); if (!o) return err(res, 404, 'NOT_FOUND', 'Order not found');
      if (od[2]) { const b = await body(req); o.status = b.action === 'accept' ? 'approved' : 'cancelled'; push({ type: 'order.updated', order: o }); }
      return send(res, 200, o);
    }
    // distributor
    if (p === '/api/distributor/queue') return send(res, 200, { items: queue.filter(o => ['placed', 'review', 'modified', 'approved'].includes(o.status)) });
    if (p === '/api/distributor/history') return send(res, 200, { items: queue.filter(o => !['placed', 'review', 'modified'].includes(o.status)) });
    if (p.match(/^\/api\/distributor\/retailers\/[^/]+$/)) return send(res, 200, { id: p.split('/').pop(), phone: '9847038812', credit: { limit: 300000, outstanding: 112400, overdue: 0, source: 'Ginesys customer master' }, stats: { orders90d: 6, avgOrderValue: 38400, rejected90d: 0 } });
    const dd = p.match(/^\/api\/distributor\/orders\/([^/]+)\/decision$/);
    if (dd) {
      const o = queue.find(x => x.id === dd[1]); if (!o) return err(res, 404, 'NOT_FOUND', 'Order not found');
      if (o.status !== 'review') return err(res, 409, 'ALREADY_DECIDED', `This order is already ${o.status}.`, { order: o });
      const b = await body(req);
      if (b.action === 'approve') { o.status = 'approved'; setTimeout(() => { o.status = 'confirmed'; o.erp.soNumber = 'SO/KL/26-27/04821'; push({ type: 'order.updated', order: o }); }, 1500); }
      else if (b.action === 'reject') { o.status = 'rejected'; o.reason = b.reason; }
      else { o.changes = b.lines.map((l: any) => ({ ...l, from: o.lines.find(x => x.styleId === l.styleId && x.color === l.color && x.size === l.size)!.qty, to: l.qty })).filter((c: any) => c.from !== c.to); o.changeReason = b.reason; o.status = 'modified'; }
      push({ type: 'order.updated', order: o }); return send(res, 200, o);
    }
    // admin
    if (p === '/api/admin/overview') {
      const all = [...new Map([...queue, ...orders].map(o => [o.id, o])).values()].slice(0, 12);
      all[1] && (all[1] = { ...all[1], erp: { ...all[1].erp, state: 'failed', attempts: 3, lastError: 'Ginesys timeout' } });
      return send(res, 200, {
        kpis: [{ label: 'Retailers activated', value: '412', sub: 'of 2,800 · 14.7%', pct: 14.7 }, { label: 'Orders today', value: '38', sub: '+9 vs last Thursday', series: [22, 26, 24, 31, 29, 34, 38] }, { label: 'Order value today', value: '₹14.6 L', sub: 'Avg ₹39,400 per order', series: [9.1, 10.4, 9.8, 12.2, 11.6, 13.1, 14.6] }, { label: 'Median approval time', value: '1h 48m', sub: 'Target under 4h', series: [3.9, 3.4, 3.1, 2.6, 2.4, 2.1, 1.8] }, { label: 'Failed ERP submissions', value: '1', sub: 'Retries handled: 2', series: [2, 1, 1, 0, 1, 0, 1] }, { label: 'Order fill rate', value: '96.4%', sub: 'Dispatched vs ordered, 30 days', series: [93.1, 94, 94.8, 94.2, 95.6, 96, 96.4] }],
        funnel: { placed: 3, review: 11, modified: 2, approved: 1, confirmed: 64, dispatched: 41, delivered: 118, rejected: 4 },
        live: { pipeline: { placed: 3, review: 11, modified: 2, approved: 1 }, integration: { ginesys: 'ok', breaker: 'closed', queue: { pending: 0, failed: 1 }, stockSnapshotAgeSeconds: 42 },
        exceptions: [{ id: 'x1', severity: 'bad', title: 'Sync failed', detail: `${all[1]?.number}, ${all[1]?.store}: Ginesys did not respond after 3 automatic retries. Stock is still held.`, orderId: all[1]?.id, canRetry: true },
          { id: 'x2', severity: 'bad', title: 'Approval overdue', detail: `CT-10476, Rajhans Garments, waiting 5h 02m with ${DIST.name}.` },
          { id: 'x3', severity: 'warn', title: 'Unmatched mobile number', detail: '+91 97XXX XX512 tried to activate Om Sai Collection. Sent to manual verification.' },
          { id: 'x4', severity: 'info', title: 'ERP retry succeeded', detail: 'CT-10471 sales order created on second attempt after a timeout. No duplicate created.' }].filter(x => !resolved.has(x.id)) }, topStyles: [['Oxford Button-Down, Sky Blue', 412], ['Stretch Cotton Chino, Khaki', 366], ['Flat-Front Formal, Charcoal', 298], ['Piqué Polo, Navy', 241], ['Travel Trouser, Charcoal', 188]].map(([name, qty]) => ({ name, qty })),
        regions: [['Kerala', 4120000], ['Karnataka', 3380000], ['Tamil Nadu', 2750000], ['Odisha', 2290000], ['Andhra & Telangana', 1410000]].map(([name, value]) => ({ name, value })) });
    }
    if (p === '/api/admin/orders') {
      const q = (url.searchParams.get('q') ?? '').toLowerCase(), st = url.searchParams.get('status') ?? '';
      const all = [...new Map([...queue, ...orders].map(o => [o.id, o])).values()];
      const items = all.filter(o => (!q || `${o.number} ${o.store} ${o.erp.soNumber ?? ''}`.toLowerCase().includes(q)) && (!st || (st === 'attention' ? o.erp.state === 'failed' || o.status === 'review' : o.status === st)));
      return send(res, 200, { items: items.slice(0, 25), nextCursor: null });
    }
    const rx = p.match(/^\/api\/admin\/exceptions\/([^/]+)\/resolve$/);
    if (rx) { resolved.add(rx[1]); return send(res, 200, { ok: true }); }
    if (p === '/api/admin/assumptions') return send(res, 200, ASSUMPTIONS);
    if (p === '/api/admin/low-stock') {
      const rows: object[] = [];
      for (const s of STYLES.slice(0, 40)) for (const c of s.colors) for (const z of SIZES[s.category as Category]) { const q = stock[`${s.id}|${c}|${z}`] ?? 0; if (q <= 5) rows.push({ styleId: s.id, name: s.name, color: c, size: z, available: q, sku: `${s.id}-${c.slice(0, 3).toUpperCase()}-${z}` }); }
      return send(res, 200, { items: rows.slice(0, 30) });
    }
    if (p.match(/^\/api\/admin\/orders\/[^/]+\/retry$/)) { const o = [...queue, ...orders].find(x => x.id === p.split('/')[4])!; return send(res, 200, { ...o, erp: { ...o.erp, state: 'pending' } }); }
    if (p === '/api/admin/sync/stock') return send(res, 202, { ok: true });
    return err(res, 404, 'NOT_FOUND', `No mock for ${m} ${p}`);
  } catch (e) { console.error(e); return err(res, 500, 'MOCK_ERROR', String(e)); }
}
