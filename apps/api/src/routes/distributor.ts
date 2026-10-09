import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from './auth.ts';
import * as dist from '../services/distributor.ts';
import { decide } from '../services/orders.ts';

export async function distributorRoutes(app: FastifyInstance) {
  const r = { preHandler: requireRole('distributor') };
  app.get('/api/distributor/queue', r, async req => dist.queue(req.claims!.did!));
  app.get<{ Querystring: { cursor?: string } }>('/api/distributor/history', r, async req => dist.history(req.claims!.did!, req.query.cursor));
  app.get<{ Querystring: { q?: string; cursor?: string } }>('/api/distributor/retailers', r, async req => dist.retailers(req.claims!.did!, req.query.q, req.query.cursor));
  app.get<{ Params: { id: string } }>('/api/distributor/retailers/:id', r, async req => dist.retailerProfile(req.claims!.did!, req.params.id));
  app.get<{ Params: { id: string } }>('/api/distributor/retailers/:id/credit', r, async req => {
    const p = await dist.retailerProfile(req.claims!.did!, req.params.id);
    return { ...(p.credit ?? {}), stats: p.stats, profile: p };
  });
  app.post<{ Params: { id: string } }>('/api/distributor/orders/:id/decision', r, async req => {
    const b = z.object({
      action: z.enum(['approve', 'modify', 'reject']), reason: z.string().max(200).optional(),
      lines: z.array(z.object({ styleId: z.string(), color: z.string(), size: z.string(), qty: z.number().int().min(0) })).max(500).optional(),
    }).parse(req.body);
    return decide(req.claims!.did!, req.params.id, b, 'app', req.id);
  });
}
