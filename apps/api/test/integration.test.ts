import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createHmac } from 'node:crypto';
import { boot, resetWorld, login, drain, db, erpState, snapshot, shutdown, waitFor } from './world.ts';

beforeEach(async () => { await boot(); await resetWorld(); });
afterAll(shutdown);

describe('cart', () => {
  it('an edit made on an older copy of the cart is refused with the latest cart', async () => {
    const u = await login('9847038812');
    const a = (await u.call('PUT', '/api/cart/lines', { lines: [{ styleId: 'CS-1101', color: 'Navy', size: 'M', qty: 2 }] })).json();
    await u.call('PUT', '/api/cart/lines', { lines: [{ styleId: 'CS-1101', color: 'Navy', size: 'L', qty: 1 }], version: a.version });
    const stale = await u.call('PUT', '/api/cart/lines', { lines: [{ styleId: 'CS-1101', color: 'Navy', size: 'S', qty: 1 }], version: a.version });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe('CART_CHANGED');
    expect(stale.json().cart.lines).toHaveLength(2);
  });
  it('quantities above live stock are capped and reported', async () => {
    const u = await login('9847038812');
    const r = await u.call('PUT', '/api/cart/lines', { lines: [{ styleId: 'CS-1101', color: 'Sky Blue', size: 'XL', qty: 50 }] });
    expect(r.json().lines[0].qty).toBe(4);
    expect(JSON.parse(String(r.headers['x-capped']))[0]).toMatchObject({ requested: 50, available: 4 });
  });
});

describe('Ginesys webhooks', () => {
  const sign = (body: string) => createHmac('sha256', 'dev-ginesys-secret').update(body).digest('hex');
  it('rejects unsigned calls and processes a duplicate delivery once', async () => {
    const a = await boot();
    const body = JSON.stringify({ event_name: 'customer.updated', refcode: 'RT-KL-0388', request_id: 'req-1', resource: JSON.stringify({ cust_code: 'RT-KL-0388', credit_limit: 250000, overdue_amount: 12000, overdue_days: 21 }) });
    expect((await a.inject({ method: 'POST', url: '/webhooks/ginesys', payload: body, headers: { 'content-type': 'application/json', 'x-ginesys-signature': 'bad' } })).statusCode).toBe(401);
    for (let i = 0; i < 2; i++) expect((await a.inject({ method: 'POST', url: '/webhooks/ginesys', payload: body, headers: { 'content-type': 'application/json', 'x-ginesys-signature': sign(body) } })).statusCode).toBe(200);
    expect(Number((await db('inbox').count({ n: '*' }).first())?.n)).toBe(1);
    await drain();
    const r = await db('retailers').where({ code: 'RT-KL-0388' }).first();
    expect(r).toMatchObject({ credit_limit: 250000, overdue_amount: 12000, overdue_days: 21 });
  });

  it('inventory snapshot never shows stock that our own newer orders already took', async () => {
    const u = await login('9847038812');
    // snapshot generated BEFORE the order: Ginesys free qty still includes the 3 pieces
    erpState.stock['CS-1101|Navy|M'] = 30;
    const before = erpState.stock;
    const snapId = await snapshot();
    void before;
    await u.call('PUT', '/api/cart/lines', { lines: [{ styleId: 'CS-1101', color: 'Navy', size: 'M', qty: 3 }] });
    const o = await u.call('POST', '/api/orders', { idempotencyKey: 'snap-test-1' });
    expect(o.statusCode).toBe(201);
    const { applySnapshot } = await import('../src/services/stock.ts');
    await applySnapshot(`http://localhost:4199/_files/inventory/${snapId}.json`).catch(() => null);
    // the webhook from snapshot() may have applied it too; either way the result must be 27, not 30
    await waitFor(async () => { await drain(); const r = await db('availability').where({ style_id: 'CS-1101', color: 'Navy', size: 'M' }).first(); return Number(r.available) === 27; });
  });
});

describe('WhatsApp approve button', () => {
  it('a distributor can approve from WhatsApp; a forged call is refused', async () => {
    const a = await boot();
    const u = await login('9847038812');
    await u.call('PUT', '/api/cart/lines', { lines: [{ styleId: 'CS-1101', color: 'Navy', size: 'M', qty: 1 }] });
    const o = (await u.call('POST', '/api/orders', { idempotencyKey: 'wa-test-1' })).json();
    const body = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id: 'wamid.1', from: '919847012345', type: 'interactive', interactive: { button_reply: { id: `approve:${o.id}` } } }] } }] }] });
    const sig = 'sha256=' + createHmac('sha256', 'dev-secret').update(body).digest('hex');
    expect((await a.inject({ method: 'POST', url: '/webhooks/whatsapp', payload: body, headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=00' } })).statusCode).toBe(401);
    expect((await a.inject({ method: 'POST', url: '/webhooks/whatsapp', payload: body, headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig } })).statusCode).toBe(200);
    await drain();
    await waitFor(async () => (await db('orders').where({ id: o.id }).first()).status === 'confirmed');
    const ev = await db('order_events').where({ order_id: o.id, type: 'approved' }).first();
    expect(ev.message).toContain('on WhatsApp');
  });
});
