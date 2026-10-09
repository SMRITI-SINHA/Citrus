import type { FastifyInstance } from 'fastify';
import { requireRole } from './auth.ts';
import * as admin from '../services/admin.ts';
import { retryFor, poke } from '../services/outbox.ts';
import { getOrder, decide } from '../services/orders.ts';
import { z } from 'zod';
import { uid, normPhone } from '../lib/ids.ts';
import { bad } from '../lib/errors.ts';
import { db } from '../db/knex.ts';
import { notFound } from '../lib/errors.ts';
import { publish } from '../lib/bus.ts';
import { warmCache } from '../services/stock.ts';
import { config } from '../config.ts';

export async function adminRoutes(app: FastifyInstance) {
  const r = { preHandler: requireRole('admin') };
  app.get('/api/admin/overview', r, async () => admin.overview());
  app.get<{ Querystring: any }>('/api/admin/orders', r, async req => admin.orders(req.query as any));
  app.get<{ Params: { id: string } }>('/api/admin/orders/:id', r, async req => admin.orderDetail(req.params.id));
  app.post<{ Params: { id: string } }>('/api/admin/orders/:id/retry', r, async req => {
    const o = await db('orders').where({ id: req.params.id }).first();
    if (!o) throw notFound('Order not found');
    await db('orders').where({ id: o.id }).update({ erp_state: 'retrying', erp_error: null });
    await retryFor(o.id);
    await new Promise(res => setTimeout(res, 1200)); // most retries finish in this window; SSE covers the rest
    return getOrder(o.id);
  });
  app.post<{ Params: { id: string } }>('/api/admin/exceptions/:id/resolve', r, async req => {
    await db('exceptions').where({ id: req.params.id }).update({ resolved_at: new Date() });
    await publish({ admins: true }, { type: 'admin.updated' });
    return { ok: true };
  });
  app.get<{ Querystring: any }>('/api/admin/retailers', r, async req => admin.retailersList(req.query as any));
  app.get('/api/admin/distributors', r, async () => admin.distributorsList());
  // Escalation path when a distributor does not act: CITRUS decides on their behalf, recorded as such in the audit trail.
  app.post<{ Params: { id: string } }>('/api/admin/orders/:id/decision', r, async req => {
    const b = z.object({ action: z.enum(['approve', 'modify', 'reject']), reason: z.string().max(200).optional(),
      lines: z.array(z.object({ styleId: z.string(), color: z.string(), size: z.string(), qty: z.number().int().min(0) })).max(500).optional() }).parse(req.body);
    const o = await db('orders').where({ id: req.params.id }).first();
    if (!o) throw notFound('Order not found');
    const u = await db('users').where({ id: req.claims!.sub }).first();
    await db('audit_log').insert({ id: uid(), at: new Date(), actor_id: u.id, action: `order.${b.action}`, subject: o.id, detail: `${o.num} on behalf of distributor ${o.distributor_id}${b.reason ? ': ' + b.reason : ''}` });
    return decide(o.distributor_id, o.id, b, 'admin', req.id, u.name);
  });
  // Shop numbers change. Re-binding a store to a new mobile is an admin action, audited, and signs out old sessions.
  app.put<{ Params: { id: string } }>('/api/admin/retailers/:id/phone', r, async req => {
    const phone = normPhone(z.object({ phone: z.string() }).parse(req.body).phone);
    if (!/^[6-9]\d{9}$/.test(phone)) throw bad('INVALID_PHONE', 'Enter a 10-digit Indian mobile number.');
    const ret = await db('retailers').where({ id: req.params.id }).first();
    if (!ret) throw notFound('Retailer not found');
    if (await db('users').where({ phone }).whereNot({ retailer_id: ret.id }).first() || await db('retailers').where({ phone }).whereNot({ id: ret.id }).first())
      throw bad('PHONE_IN_USE', 'This number is already linked to another account.');
    await db.transaction(async trx => {
      await trx('retailers').where({ id: ret.id }).update({ phone });
      const users = await trx('users').where({ retailer_id: ret.id });
      await trx('users').where({ retailer_id: ret.id }).update({ phone });
      await trx('refresh_tokens').whereIn('user_id', users.map((x: any) => x.id)).whereNull('revoked_at').update({ revoked_at: new Date() });
      await trx('audit_log').insert({ id: uid(), at: new Date(), actor_id: req.claims!.sub, action: 'retailer.phone', subject: ret.id, detail: `${ret.code}: ••${ret.phone.slice(-4)} -> ••${phone.slice(-4)}` });
      await trx('exceptions').where({ kind: 'activation' }).whereNull('resolved_at').whereRaw('detail like ?', [`%${ret.code}%`]).update({ resolved_at: new Date() });
    });
    return { ok: true };
  });
  app.get('/api/admin/low-stock', r, async () => admin.lowStock());
  app.get('/api/admin/assumptions', r, async () => admin.assumptions());
  // Ask Ginesys for a fresh inventory snapshot (stand-in control); real Ginesys pushes snapshots on its own schedule.
  app.post('/api/admin/sync/stock', r, async () => {
    const res = await fetch(`${config.ginesys.baseUrl}/_admin/snapshot`, { method: 'POST' }).then(x => x.json()).catch(() => null);
    if (!res) { await warmCache(); poke(); return { requested: false, message: 'Ginesys stand-in not reachable; cache rebuilt from the database.' }; }
    return { requested: true, message: 'Snapshot requested from Ginesys; stock will refresh when it arrives.' };
  });
}
