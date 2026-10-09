import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { bad, notFound } from '../lib/errors.ts';
import { requireRole } from './auth.ts';
import { catalogue, affinityFor, styleCard } from '../services/catalogue.ts';
import { stockFor } from '../services/stock.ts';
import * as cart from '../services/cart.ts';
import * as orders from '../services/orders.ts';
import { home, pairs, saveMix } from '../services/home.ts';
import { SIZES, type Category } from '@citrus/shared';
import { COMING_SOON } from '@citrus/shared/src/seed.ts';

const line = z.object({ styleId: z.string().max(20), color: z.string().max(40), size: z.string().max(8), qty: z.number().int().min(0).max(9999) });

export async function retailerRoutes(app: FastifyInstance) {
  const r = { preHandler: requireRole('retailer') };
  app.get('/api/catalogue', r, async req => catalogue(req.query as any, await affinityFor(req.claims!.rid!)));
  app.get<{ Params: { id: string } }>('/api/styles/:id', r, async req => (await styleCard(req.params.id)) ?? Promise.reject(notFound('This style is not in the catalogue.')));
  app.get<{ Params: { id: string }; Querystring: { color?: string } }>('/api/styles/:id/pairs', r, async req => pairs(req.params.id, req.query.color));
  app.get<{ Querystring: { keys?: string } }>('/api/stock', r, async req => {
    const keys = (req.query.keys ?? '').split(',').filter(Boolean).slice(0, 100);
    const st = await stockFor([...new Set(keys.map(k => k.split('|')[0]))]);
    const now = new Date().toISOString();
    return keys.flatMap(k => { const [styleId, color] = k.split('|'); return Object.entries(st[styleId] ?? {}).filter(([ck]) => ck.startsWith(color + '|')).map(([ck, available]) => ({ styleId, color, size: ck.split('|')[1], available, updatedAt: now })); });
  });
  app.get('/api/home', r, async req => home(req.claims!.rid!));
  // The store's own size mix per category; null goes back to the mix from their orders.
  app.put('/api/me/size-mix', r, async req => {
    const b = z.object({ category: z.enum(Object.keys(SIZES) as [Category, ...Category[]]), ratio: z.array(z.number().int().min(0).max(99)).nullable() }).parse(req.body);
    if (b.ratio && (b.ratio.length !== SIZES[b.category].length || !b.ratio.some(n => n > 0))) throw bad('BAD_MIX', 'Type a number for at least one size.');
    return saveMix(req.claims!.rid!, b.category, b.ratio);
  });
  app.get('/api/catalogue/upcoming', r, async () => COMING_SOON);

  app.get('/api/cart', r, async req => cart.getCart(req.claims!.rid!));
  app.put('/api/cart/lines', r, async (req, reply) => {
    const b = z.object({ lines: z.array(line).max(500), version: z.number().int().optional() }).parse(req.body);
    let res;
    try { res = await cart.setLines(req.claims!.rid!, b.lines, b.version); }
    catch (e: any) { if (e.code === 'CART_CHANGED') e.extra = { cart: await cart.getCart(req.claims!.rid!) }; throw e; }
    if (res.capped.length) reply.header('x-capped', JSON.stringify(res.capped.map(c => ({ styleId: c.styleId, color: c.color, size: c.size, requested: c.requested, available: c.qty }))));
    return res.cart;
  });
  app.put('/api/cart/meta', r, async req => {
    const b = z.object({ note: z.string().max(300).optional(), po: z.string().max(40).optional(), version: z.number().int().optional() }).parse(req.body);
    return cart.setMeta(req.claims!.rid!, b, b.version);
  });
  app.post<{ Params: { id: string } }>('/api/cart/reorder/:id/preview', r, async req => cart.reorderPreview(req.claims!.rid!, req.params.id));
  app.post<{ Params: { id: string } }>('/api/cart/reorder/:id', r, async (req, reply) => {
    const res = await cart.reorder(req.claims!.rid!, req.params.id);
    if (res.capped.length) reply.header('x-capped', JSON.stringify(res.capped));
    return res.cart;
  });
  app.delete('/api/cart', r, async req => { await cart.clearCart(req.claims!.rid!); return cart.getCart(req.claims!.rid!); });

  app.post('/api/orders', { ...r, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = z.object({ idempotencyKey: z.string().min(8).max(80), cartVersion: z.number().int().optional() }).parse(req.body);
    const res = await orders.placeOrder(req.claims!.rid!, req.claims!.sub, b as any, req.id);
    return reply.code(res.replay ? 200 : 201).header('idempotent-replay', String(res.replay)).send(res.order);
  });
  app.get<{ Querystring: { cursor?: string; status?: string } }>('/api/orders', r, async req => orders.retailerOrders(req.claims!.rid!, req.query.cursor, req.query.status));
  app.get<{ Params: { id: string } }>('/api/orders/:id', r, async req => orders.retailerOrder(req.claims!.rid!, req.params.id));
  app.post<{ Params: { id: string } }>('/api/orders/:id/changes', r, async req => {
    const b = z.object({ action: z.enum(['accept', 'decline']) }).parse(req.body);
    return orders.answerChanges(req.claims!.rid!, req.params.id, b.action, req.id);
  });
}
