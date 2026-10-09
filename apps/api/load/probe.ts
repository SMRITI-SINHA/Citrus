// Single-user latency probe: what one request costs with no contention.
import { SignJWT } from 'jose';
import { db } from '../src/db/knex.ts';
import { config } from '../src/config.ts';
const API = process.env.API_URL ?? 'http://localhost:4000';
const u = await db('users').where({ role: 'retailer' }).offset(Number(process.argv[2] ?? 500)).first();
const t = await new SignJWT({ role: u.role, rid: u.retailer_id }).setProtectedHeader({ alg: 'HS256' }).setSubject(u.id).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(config.jwtSecret));
const h = { authorization: `Bearer ${t}`, 'content-type': 'application/json' };
async function m(name: string, method: string, path: string, body?: unknown) {
  const out: number[] = [];
  for (let i = 0; i < 3; i++) { const s = performance.now(); const r = await fetch(API + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined }); await r.text(); out.push(Math.round(performance.now() - s)); }
  console.log(name.padEnd(14), out.join(' / '), 'ms');
}
await m('home', 'GET', '/api/home');
await m('catalogue', 'GET', '/api/catalogue?category=Shirts&inStock=1');
await m('search', 'GET', '/api/catalogue?q=navy%20slim');
await m('style', 'GET', '/api/styles/CS-1101');
await m('pairs', 'GET', '/api/styles/CS-1101/pairs?color=Navy');
await m('cart.put', 'PUT', '/api/cart/lines', { lines: [{ styleId: 'CS-1101', color: 'Navy', size: 'M', qty: 1 }] });
await m('cart.get', 'GET', '/api/cart');
await m('orders', 'GET', '/api/orders');
await db.destroy(); process.exit(0);
