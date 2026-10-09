import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { boot, resetWorld, login, drain, setStock, waitFor, db, erpState, shutdown } from './world.ts';

const OM_SAI = '9847038812', RAJHANS = '9847035240', SBM = '9847041736', MALABAR = '9847012345', ADMIN = '9845000001';
const line = (qty: number, size = 'M') => ({ styleId: 'CS-1101', color: 'Sky Blue', size, qty });
const key = () => `k-${Math.random().toString(36).slice(2)}-${Date.now()}`;

async function cartAndPlace(u: Awaited<ReturnType<typeof login>>, lines: any[], k = key()) {
  const c = await u.call('PUT', '/api/cart/lines', { lines });
  expect(c.statusCode).toBe(200);
  return u.call('POST', '/api/orders', { idempotencyKey: k, cartVersion: c.json().version });
}

beforeEach(async () => { await boot(); await resetWorld(); });
afterAll(shutdown);

describe('placing orders', () => {
  it('two retailers racing for the last piece: exactly one gets it', async () => {
    await setStock('CS-1101', 'Sky Blue', 'M', 1);
    const [a, b] = await Promise.all([login(OM_SAI), login(RAJHANS)]);
    await a.call('PUT', '/api/cart/lines', { lines: [line(1)] });
    await b.call('PUT', '/api/cart/lines', { lines: [line(1)] });
    const [ra, rb] = await Promise.all([a.call('POST', '/api/orders', { idempotencyKey: key() }), b.call('POST', '/api/orders', { idempotencyKey: key() })]);
    const codes = [ra.statusCode, rb.statusCode].sort();
    expect(codes).toEqual([201, 409]);
    const lost = ra.statusCode === 409 ? ra : rb;
    expect(lost.json().code).toBe('STOCK_CHANGED');
    expect(lost.json().lines[0]).toMatchObject({ styleId: 'CS-1101', size: 'M', requested: 1, available: 0 });
    expect(erpState.orders.size).toBe(1);
    const av = await db('availability').where({ style_id: 'CS-1101', color: 'Sky Blue', size: 'M' }).first();
    expect(Number(av.available)).toBe(0);
  });

  it('50 concurrent orders on 20 pieces never oversell', async () => {
    await setStock('CS-1101', 'Sky Blue', 'M', 20);
    const users = await Promise.all([OM_SAI, RAJHANS, '9847029110'].map(p => login(p)));
    for (const u of users) await u.call('PUT', '/api/cart/lines', { lines: [line(1)] });
    // each user fires many submits with different keys; carts empty after the first success, so later ones are EMPTY_CART
    const res = await Promise.all([...Array(50)].map((_, i) => users[i % 3].call('POST', '/api/orders', { idempotencyKey: key() })));
    const ok = res.filter(r => r.statusCode === 201).length;
    expect(ok).toBe(3);
    const sold = await db('order_lines').sum({ q: 'qty' }).first();
    expect(Number(sold?.q)).toBe(3);
    const av = await db('availability').where({ style_id: 'CS-1101', color: 'Sky Blue', size: 'M' }).first();
    expect(Number(av.available)).toBe(17);
  });

  it('a retried submit with the same key returns the same order and creates one Sales Order', async () => {
    const u = await login(OM_SAI);
    const k = key();
    const first = await cartAndPlace(u, [line(3)], k);
    expect(first.statusCode).toBe(201);
    const again = await u.call('POST', '/api/orders', { idempotencyKey: k });
    expect(again.statusCode).toBe(200);
    expect(again.headers['idempotent-replay']).toBe('true');
    expect(again.json().id).toBe(first.json().id);
    // two simultaneous retries of a fresh key
    await u.call('PUT', '/api/cart/lines', { lines: [line(2, 'L')] });
    const k2 = key();
    const [x, y] = await Promise.all([u.call('POST', '/api/orders', { idempotencyKey: k2 }), u.call('POST', '/api/orders', { idempotencyKey: k2 })]);
    expect(x.json().id).toBe(y.json().id);
    expect(await db('orders').count({ n: '*' }).first()).toMatchObject({ n: '2' });
    expect(erpState.orders.size).toBe(2);
  });

  it('stale cart version from another device is refused', async () => {
    const u = await login(OM_SAI);
    const c = await u.call('PUT', '/api/cart/lines', { lines: [line(2)] });
    await u.call('PUT', '/api/cart/meta', { note: 'changed on phone' });
    const r = await u.call('POST', '/api/orders', { idempotencyKey: key(), cartVersion: c.json().version });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe('CART_CHANGED');
  });

  it('when Ginesys has less than our view, the retailer is told at once and keeps the cart', async () => {
    await setStock('CS-1101', 'Sky Blue', 'M', 10, 2); // we think 10, Ginesys really has 2
    const u = await login(OM_SAI);
    const r = await cartAndPlace(u, [line(5), line(1, 'L')]);
    expect(r.statusCode).toBe(409);
    expect(r.json().lines).toEqual([expect.objectContaining({ size: 'M', requested: 5, available: 2 })]);
    expect(Number((await db('orders').count({ n: '*' }).first())?.n)).toBe(0);
    const cart = (await u.call('GET', '/api/cart')).json();
    expect(cart.lines).toHaveLength(2);
    // nothing left reserved in Ginesys
    expect([...erpState.orders.values()].every(o => o.status === 'CANCELLED')).toBe(true);
    expect(erpState.stock['CS-1101|Sky Blue|L']).toBeGreaterThan(0);
  });

  it('Ginesys outage: order is accepted, retried, and reaches the distributor when Ginesys is back', async () => {
    const u = await login(OM_SAI);
    erpState.paused = true;
    const r = await cartAndPlace(u, [line(2)]);
    expect(r.statusCode).toBe(201);
    expect(r.json().status).toBe('placed');
    let o = await db('orders').where({ id: r.json().id }).first();
    expect(o.erp_state).toBe('retrying');
    erpState.paused = false;
    await drain();
    o = await db('orders').where({ id: r.json().id }).first();
    expect(o.status).toBe('review');
    expect(o.so_number).toMatch(/^SO\//);
    expect(erpState.orders.size).toBe(1);
  });
});

describe('approval and lifecycle', () => {
  it('place -> approve -> SO authorised -> DC -> invoice -> delivered, with points credited once', async () => {
    const u = await login(OM_SAI);
    const placed = (await cartAndPlace(u, [line(4), line(2, 'L')])).json();
    expect(placed.status).toBe('review');
    expect(placed.erp.reservationRef).toBeUndefined(); // internal ERP refs never reach retailers
    expect(placed.erp.soNumber).toBeUndefined();     // SO number only once the SO is authorised
    const d = await login(MALABAR);
    const q = (await d.call('GET', '/api/distributor/queue')).json();
    expect(q.items.map((o: any) => o.id)).toContain(placed.id);
    const ap = await d.call('POST', `/api/distributor/orders/${placed.id}/decision`, { action: 'approve' });
    expect(ap.statusCode).toBe(200);
    expect(ap.json().status).toBe('confirmed');
    expect(erpState.orders.get(erpState.byIntg.get(placed.id)!)!.status).toBe('AUTHORIZED');
    const again = await d.call('POST', `/api/distributor/orders/${placed.id}/decision`, { action: 'approve' });
    expect(again.json().code).toBe('ALREADY_DECIDED');
    const adv = async () => { await fetch(`http://localhost:4199/_admin/orders/${placed.id}/advance`, { method: 'POST' }); };
    for (const target of ['processing', 'dispatched', 'delivered']) {
      await adv();
      await waitFor(async () => { await drain(); return (await db('orders').where({ id: placed.id }).first()).status === target; });
    }
    const o = (await u.call('GET', `/api/orders/${placed.id}`)).json();
    expect(o.erp.awb).toBeTruthy();
    expect(o.events.map((e: any) => e.type)).toEqual(expect.arrayContaining(['placed', 'reserved', 'approved', 'confirmed', 'processing', 'dispatched', 'delivered']));
    const pts = 6 * 20;
    expect((await u.call('GET', '/api/me')).json().points).toBe(pts);
    // a duplicate delivery webhook does not credit again
    const { applyErpEvent } = await import('../src/services/orders.ts');
    await applyErpEvent('snd.logistics.delivered', { intgOrderId: placed.id }, 'delivered');
    expect((await u.call('GET', '/api/me')).json().points).toBe(pts);
  });

  it('modify -> retailer accepts -> Ginesys lines reduced, SO authorised, stock released', async () => {
    const u = await login(OM_SAI);
    const placed = (await cartAndPlace(u, [line(6), line(3, 'L')])).json();
    const before = Number((await db('availability').where({ style_id: 'CS-1101', color: 'Sky Blue', size: 'M' }).first()).available);
    const d = await login(MALABAR);
    const bad = await d.call('POST', `/api/distributor/orders/${placed.id}/decision`, { action: 'modify', reason: 'Credit limit', lines: [{ ...line(8) }] });
    expect(bad.json().code).toBe('ONLY_REDUCTIONS');
    const noReason = await d.call('POST', `/api/distributor/orders/${placed.id}/decision`, { action: 'modify', lines: [line(4)] });
    expect(noReason.json().code).toBe('REASON_REQUIRED');
    const m = await d.call('POST', `/api/distributor/orders/${placed.id}/decision`, { action: 'modify', reason: 'Credit limit', lines: [line(4)] });
    expect(m.json().status).toBe('modified');
    expect(m.json().changes).toEqual([{ styleId: 'CS-1101', color: 'Sky Blue', size: 'M', from: 6, to: 4 }]);
    const acc = await u.call('POST', `/api/orders/${placed.id}/changes`, { action: 'accept' });
    expect(acc.json().status).toBe('confirmed');
    expect(acc.json().totalQty).toBe(7);
    const so = erpState.orders.get(erpState.byIntg.get(placed.id)!)!;
    expect(so.status).toBe('AUTHORIZED');
    expect(so.lines.find(l => l.itemCode === 'CS-1101|Sky Blue|M')).toMatchObject({ orderQty: 6, cancelledQty: 2, reservedQty: 4 });
    const after = Number((await db('availability').where({ style_id: 'CS-1101', color: 'Sky Blue', size: 'M' }).first()).available);
    expect(after).toBe(before + 2);
  });

  it('reject needs a reason, cancels the SO and gives stock back', async () => {
    const u = await login(OM_SAI);
    const before = erpState.stock['CS-1101|Sky Blue|M'];
    const placed = (await cartAndPlace(u, [line(5)])).json();
    expect(erpState.stock['CS-1101|Sky Blue|M']).toBe(before - 5);
    const d = await login(MALABAR);
    expect((await d.call('POST', `/api/distributor/orders/${placed.id}/decision`, { action: 'reject' })).json().code).toBe('REASON_REQUIRED');
    const r = await d.call('POST', `/api/distributor/orders/${placed.id}/decision`, { action: 'reject', reason: 'Outstanding dues' });
    expect(r.json().status).toBe('rejected');
    await drain();
    expect(erpState.stock['CS-1101|Sky Blue|M']).toBe(before);
    expect(erpState.orders.get(erpState.byIntg.get(placed.id)!)!.status).toBe('CANCELLED');
  });

  it('a distributor cannot see or decide another distributor’s orders', async () => {
    const u = await login(OM_SAI);
    const placed = (await cartAndPlace(u, [line(1)])).json();
    const other = await login('9845023456'); // Shivaji, Bengaluru
    expect((await other.call('POST', `/api/distributor/orders/${placed.id}/decision`, { action: 'approve' })).statusCode).toBe(404);
    expect((await other.call('GET', '/api/distributor/queue')).json().items).toHaveLength(0);
    expect((await u.call('GET', '/api/distributor/queue')).statusCode).toBe(403);
  });

  it('CITRUS can decide on behalf of a slow distributor, and it is audited', async () => {
    const u = await login(OM_SAI);
    const placed = (await cartAndPlace(u, [line(1)])).json();
    const a = await login(ADMIN);
    const r = await a.call('POST', `/api/admin/orders/${placed.id}/decision`, { action: 'approve' });
    expect(r.json().status).toBe('confirmed');
    expect(r.json().events.find((e: any) => e.type === 'approved')).toMatchObject({ actor: 'admin' });
    expect(await db('audit_log').count({ n: '*' }).first()).toMatchObject({ n: '1' });
  });
});

describe('sign-in', () => {
  it('unknown numbers never get an account; wrong invite number goes to manual verification', async () => {
    const a = await boot();
    const r = await a.inject({ method: 'POST', url: '/api/auth/otp', payload: { phone: '9000000001' } });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe('UNKNOWN_NUMBER');
    const m = await a.inject({ method: 'POST', url: '/api/auth/otp', payload: { phone: '9847038812', invite: 'sbm-kochi-7f3k' } });
    expect(m.json().code).toBe('PHONE_MISMATCH');
    expect(Number((await db('exceptions').count({ n: '*' }).first())?.n)).toBe(2);
  });

  it('activation by invite binds the number to the existing store; second device reuses it', async () => {
    const s1 = await login(SBM, 'sbm-kochi-7f3k');
    expect(s1.me.retailer.code).toBe('RT-KL-0417');
    expect(s1.me.consentRequired).toBe(true);
    await db('otp_requests').del(); // skip the 30 s resend wait
    const s2 = await login(SBM);
    expect(s2.me.retailer.id).toBe(s1.me.retailer.id);
    expect(Number((await db('users').where({ phone: SBM }).count({ n: '*' }).first())?.n)).toBe(1);
  });

  it('OTP: wrong code counts attempts, resend is throttled', async () => {
    const a = await boot();
    const r1 = (await a.inject({ method: 'POST', url: '/api/auth/otp', payload: { phone: OM_SAI } })).json();
    const again = await a.inject({ method: 'POST', url: '/api/auth/otp', payload: { phone: OM_SAI } });
    expect(again.json().code).toBe('RESEND_TOO_SOON');
    for (let i = 0; i < 5; i++) await a.inject({ method: 'POST', url: '/api/auth/verify', payload: { requestId: r1.requestId, code: r1.devCode === '000000' ? '111111' : '000000' } });
    const locked = await a.inject({ method: 'POST', url: '/api/auth/verify', payload: { requestId: r1.requestId, code: r1.devCode } });
    expect(locked.json().code).toBe('TOO_MANY_ATTEMPTS');
  });

  it('refresh tokens rotate; replaying an old one signs the device out', async () => {
    const a = await boot();
    const s = await login(OM_SAI);
    const r1 = await a.inject({ method: 'POST', url: '/api/auth/refresh', cookies: { ct_refresh: s.cookie } });
    expect(r1.statusCode).toBe(200);
    const fresh = r1.cookies.find(c => c.name === 'ct_refresh')!.value;
    const replay = await a.inject({ method: 'POST', url: '/api/auth/refresh', cookies: { ct_refresh: s.cookie } });
    expect(replay.json().code).toBe('SESSION_REUSED');
    const afterTheft = await a.inject({ method: 'POST', url: '/api/auth/refresh', cookies: { ct_refresh: fresh } });
    expect(afterTheft.statusCode).toBe(401);
  });
});
