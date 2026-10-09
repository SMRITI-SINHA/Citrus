// Server-Sent Events: one stream per signed-in tab, fed from Redis pub/sub so any API instance can serve any user.
// SSE (not WebSockets) because traffic is server -> client only, it reconnects by itself, and passes proxies/CDNs.
import type { FastifyInstance } from 'fastify';
import { verifyAccess } from '../services/auth.ts';
import { onEvent } from '../lib/bus.ts';
import { config } from '../config.ts';

let open = 0;
export const sseClients = () => open;

export async function eventRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { token?: string } }>('/api/events', async (req, reply) => {
    const c = await verifyAccess(req.query.token ?? '');
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive',
      'x-accel-buffering': 'no', 'access-control-allow-origin': config.corsOrigin, 'access-control-allow-credentials': 'true',
    });
    res.write(`retry: 3000\nevent: hello\ndata: {"ok":true}\n\n`);
    open++;
    const off = onEvent((aud, ev) => {
      const mine = aud.all || (aud.admins && c.role === 'admin') || (aud.retailerId && aud.retailerId === c.rid) || (aud.distributorId && aud.distributorId === c.did);
      if (mine) res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
    });
    const ping = setInterval(() => res.write(`: ping\n\n`), 20_000);
    // access tokens expire; close the stream then so the client reconnects with a fresh token
    const exp = setTimeout(() => res.end(), config.accessTtlSeconds * 1000);
    req.raw.on('close', () => { open--; off(); clearInterval(ping); clearTimeout(exp); });
  });
}
