// Roadshow load test: N signed-in retailers browse the catalogue, open products, edit carts and place orders at once,
// while a few distributors approve. Tokens are minted with the dev JWT secret so the OTP rate limits are not the bottleneck.
// Usage: tsx load/roadshow.ts [retailers=300] [rampSeconds=0]   (ramp 0 = everyone at the same instant, worst case)
import { SignJWT } from 'jose';
import { db } from '../src/db/knex.ts';
import { config } from '../src/config.ts';

const API = process.env.API_URL ?? 'http://localhost:4000';
const N = Number(process.argv[2] ?? 300);
const RAMP = Number(process.argv[3] ?? 0);
const key = new TextEncoder().encode(config.jwtSecret);
const lat: Record<string, number[]> = {};
const codes: Record<string, Record<number, number>> = {};
async function hit(name: string, token: string, method: string, path: string, body?: unknown) {
  const t = performance.now();
  const res = await fetch(API + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await res.json().catch(() => ({}));
  (lat[name] ??= []).push(performance.now() - t);
  (codes[name] ??= {})[res.status] = ((codes[name] ??= {})[res.status] ?? 0) + 1;
  return { status: res.status, body: j as any };
}
const tok = (u: any) => new SignJWT({ role: u.role, rid: u.retailer_id ?? undefined, did: u.distributor_id ?? undefined }).setProtectedHeader({ alg: 'HS256' }).setSubject(u.id).setIssuedAt().setExpirationTime('1h').sign(key);

const users = await db('users').where({ role: 'retailer' }).limit(N);
const tokens = await Promise.all(users.map(tok));
for (const t of tokens) await hit('cart.clear', t, 'DELETE', '/api/cart');
lat['cart.clear'] = [];
console.log(`${users.length} retailers ready; starting`);
const t0 = performance.now();
const pickStyle = (items: any[]) => items[Math.floor(Math.random() * items.length)];
await Promise.all(tokens.map(async (t, i) => {
  if (RAMP) await new Promise(r => setTimeout(r, (i / tokens.length) * RAMP * 1000));
  await hit('home', t, 'GET', '/api/home');
  const cat = await hit('catalogue', t, 'GET', '/api/catalogue?category=Shirts&inStock=1');
  await hit('catalogue.next', t, 'GET', `/api/catalogue?category=Shirts&inStock=1&cursor=${cat.body.nextCursor}`);
  await hit('search', t, 'GET', '/api/catalogue?q=navy%20slim');
  const lines: any[] = [];
  for (let i = 0; i < 3; i++) {
    const s = pickStyle(cat.body.items);
    await hit('style', t, 'GET', `/api/styles/${s.id}`);
    const c = s.colors.find((x: any) => x.total > 0);
    if (!c) continue;
    for (const [size, avail] of Object.entries(s.stock[c.name])) if ((avail as number) > 0) lines.push({ styleId: s.id, color: c.name, size, qty: Math.min(2, avail as number) });
    await hit('cart.put', t, 'PUT', '/api/cart/lines', { lines });
  }
  const cart = await hit('cart.get', t, 'GET', '/api/cart');
  const o = await hit('order.place', t, 'POST', '/api/orders', { idempotencyKey: `load-${Math.random()}-${Date.now()}`, cartVersion: cart.body.version });
  if (o.status === 201) await hit('order.get', t, 'GET', `/api/orders/${o.body.id}`);
}));
const wall = (performance.now() - t0) / 1000;
const pct = (a: number[], p: number) => a.sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];
const rows = Object.entries(lat).filter(([, v]) => v.length).map(([k, v]) => ({ step: k, n: v.length, p50: Math.round(pct(v, 0.5)), p95: Math.round(pct(v, 0.95)), max: Math.round(Math.max(...v)), codes: JSON.stringify(codes[k]) }));
console.table(rows);
const total = Object.values(lat).reduce((a, v) => a + v.length, 0);
console.log(`wall ${wall.toFixed(1)}s · ${total} requests · ${(total / wall).toFixed(0)} req/s`);
// integrity: no SKU below zero, every placed order reserved exactly once in Ginesys
const neg = await db('availability').where('available', '<', 0).count({ n: '*' }).first();
const dupe = await db('orders').whereNotNull('so_number').where('placed_at', '>', new Date(Date.now() - 600_000)).groupBy('so_number').havingRaw('count(*) > 1').select('so_number');
console.log(`negative stock rows: ${neg?.n} · duplicate sales orders: ${dupe.length}`);
await db.destroy(); process.exit(0);
