// Test world: a fresh schema, the demo masters, the in-process stand-in Ginesys and the API listening for its webhooks.
import { STYLES, COLORS, DISTRIBUTORS, RETAILERS, ADMINS } from '@citrus/shared/src/seed.ts';
import { app as mock, state as erpState, snapshot } from '../../mock-ginesys/src/server.ts';
import { db } from '../src/db/knex.ts';
import { up } from '../src/db/schema.ts';
import { redis } from '../src/lib/redis.ts';
import { buildApp } from '../src/server.ts';
import { bulkSet, warmCache } from '../src/services/stock.ts';
import { tick } from '../src/services/outbox.ts';
import { invalidateMaster } from '../src/services/catalogue.ts';

export { db, erpState, snapshot };
let api: Awaited<ReturnType<typeof buildApp>>;
let started = false;

export async function boot() {
  if (!started) {
    await mock.listen({ port: 4199, host: '127.0.0.1' });
    api = await buildApp();
    await api.listen({ port: 4198, host: '127.0.0.1' });
    started = true;
  }
  return api;
}

export async function resetWorld() {
  await db.raw('drop schema public cascade; create schema public');
  await up(db);
  await redis.flushdb();
  erpState.stock = (await import('@citrus/shared/src/seed.ts')).seedStock(); erpState.orders.clear(); erpState.byIntg.clear(); erpState.paused = false;
  await db('distributors').insert(DISTRIBUTORS.map(d => ({ id: d.id, code: d.code, name: d.name, city: d.city, state: d.state, phone: d.phone, contact: d.contact })));
  await db('retailers').insert(RETAILERS.map(x => ({ id: `R-${x.code}`, code: x.code, store: x.store, owner: x.owner, city: x.city, state: x.state, gstin: x.gstin, phone: x.phone, distributor_id: x.distributor, invite_token: x.invite, status: 'invited', points: 0 })));
  await db('users').insert([
    ...DISTRIBUTORS.map(d => ({ id: `U-${d.id}`, role: 'distributor', phone: d.phone, name: d.contact, distributor_id: d.id })),
    ...ADMINS.map((a, i) => ({ id: `U-ADMIN-${i}`, role: 'admin', phone: a.phone, name: a.name })),
  ]);
  await db('styles').insert(STYLES.map((s, i) => ({ id: s.id, name: s.name, category: s.category, kind: s.kind, fit: s.fit, pattern: s.pattern, fabric: s.fabric, rate: s.rate, mrp: s.mrp, points: s.points, is_new: !!s.isNew, rank: i })));
  await db('style_colors').insert(STYLES.flatMap(s => s.colors.map((c, i) => ({ style_id: s.id, color: c, hex: COLORS[c], position: i }))));
  await bulkSet(Object.entries(erpState.stock).map(([k, v]) => { const [styleId, color, size] = k.split('|'); return { styleId, color, size, available: v }; }));
  await db('sync_cursors').insert({ name: 'stock', cursor: new Date().toISOString() });
  await db('counters').insert({ name: 'order', value: 10480 });
  invalidateMaster();
  await warmCache();
}

/** Sign in by OTP and return an authorised request helper. */
export async function login(phone: string, invite?: string) {
  const a = await boot();
  const otp = await a.inject({ method: 'POST', url: '/api/auth/otp', payload: { phone, invite } });
  if (otp.statusCode !== 200) throw new Error(`otp ${otp.statusCode} ${otp.body}`);
  const { requestId, devCode } = otp.json();
  const v = await a.inject({ method: 'POST', url: '/api/auth/verify', payload: { requestId, code: devCode } });
  if (v.statusCode !== 200) throw new Error(`verify ${v.statusCode} ${v.body}`);
  const token = v.json().accessToken;
  const call = (method: string, url: string, payload?: unknown) => a.inject({ method: method as any, url, payload: payload as any, headers: { authorization: `Bearer ${token}` } });
  return { token, me: v.json().me, call, cookie: v.cookies.find(c => c.name === 'ct_refresh')!.value };
}

/** Run the outbox until idle (workers are off in tests so timing is deterministic). */
export async function drain(forceDue = true) {
  for (let i = 0; i < 10; i++) {
    if (forceDue) await db('outbox').whereIn('status', ['pending', 'running']).update({ next_at: new Date(Date.now() - 1000), status: 'pending' });
    await tick();
    const left = await db('outbox').whereIn('status', ['pending', 'running']).count({ n: '*' }).first();
    if (!Number(left?.n)) return;
  }
}

export async function setStock(styleId: string, color: string, size: string, qty: number, erpQty = qty) {
  erpState.stock[`${styleId}|${color}|${size}`] = erpQty;
  await bulkSet([{ styleId, color, size, available: qty }]);
  await warmCache();
}

export const waitFor = async (fn: () => Promise<boolean>, ms = 4000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await new Promise(r => setTimeout(r, 50)); }
  throw new Error('waitFor timed out');
};

export async function shutdown() {
  const { sub } = await import('../src/lib/redis.ts');
  if (started) { await api.close(); await mock.close(); }
  await db.destroy(); redis.disconnect(); sub.disconnect();
}
