// CITRUS Trade API. Stateless Fastify instances behind a load balancer; state lives in the DB and Redis.
import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { config } from './config.ts';
import { db } from './db/knex.ts';
import { redis } from './lib/redis.ts';
import { uid } from './lib/ids.ts';
import { ApiError } from './lib/errors.ts';
import { log } from './lib/log.ts';
import { authRoutes } from './routes/auth.ts';
import { retailerRoutes } from './routes/retailer.ts';
import { distributorRoutes } from './routes/distributor.ts';
import { adminRoutes } from './routes/admin.ts';
import { webhookRoutes } from './routes/webhooks.ts';
import { eventRoutes, sseClients } from './routes/events.ts';
import { tick } from './services/outbox.ts';
import { runJobs } from './services/jobs.ts';
import { runInsights } from './services/insights.ts';
import { styles } from './services/catalogue.ts';
import { styleTotals } from './services/stock.ts';
import './services/orders.ts';

export async function buildApp() {
  const app = Fastify({
    loggerInstance: log as any, trustProxy: true,
    genReqId: req => String(req.headers['x-request-id'] ?? uid()).slice(0, 40), requestIdHeader: false,
  });
  await app.register(cors, { origin: config.corsOrigin.split(','), credentials: true, exposedHeaders: ['x-request-id', 'x-capped', 'idempotent-replay'] });
  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute', redis, keyGenerator: req => req.headers.authorization?.slice(-24) ?? req.ip,
    errorResponseBuilder: (_req, ctx) => ({ statusCode: 429, code: 'SLOW_DOWN', message: `Too many requests. Please wait ${Math.ceil(ctx.ttl / 1000)} seconds.` }) });
  app.addHook('onSend', async (req, reply) => { reply.header('x-request-id', req.id); });

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof ApiError) return reply.code(err.status).send({ code: err.code, message: err.message, ...err.extra });
    if (err instanceof ZodError) return reply.code(400).send({ code: 'INVALID', message: err.issues[0]?.message ?? 'Invalid request', issues: err.issues.map(i => ({ path: i.path.join('.'), message: i.message })) });
    if (err.statusCode === 429) return reply.code(429).send({ code: 'SLOW_DOWN', message: err.message });
    if (err.validation || err.statusCode === 400) return reply.code(400).send({ code: 'INVALID', message: err.message });
    req.log.error({ err, requestId: req.id }, 'unhandled');
    return reply.code(500).send({ code: 'SERVER_ERROR', message: 'Something went wrong on our side. Your data is safe; please try again.', requestId: req.id });
  });

  app.get('/health', async () => ({ ok: true }));
  app.get('/ready', async (_req, reply) => {
    try { await db.raw(config.dbClient === 'oracledb' ? 'select 1 from dual' : 'select 1'); await redis.ping(); return { ok: true, sse: sseClients() }; }
    catch (e: any) { return reply.code(503).send({ ok: false, error: e.message }); }
  });
  await app.register(authRoutes);
  await app.register(retailerRoutes);
  await app.register(distributorRoutes);
  await app.register(adminRoutes);
  await app.register(eventRoutes);
  await app.register(webhookRoutes);
  return app;
}

export function startWorkers() {
  const timers = [
    setInterval(() => { tick().catch(() => {}); }, config.sync.outboxIntervalMs),
    setInterval(() => { runJobs().catch(() => {}); }, config.sync.jobsIntervalMs),
    setInterval(() => { runInsights().catch(() => {}); }, 15 * 60_000),
  ];
  return () => timers.forEach(clearInterval);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) {
  const app = await buildApp();
  await Promise.all([styles(), styleTotals()]); // warm caches before taking traffic
  if (config.workers) { startWorkers(); runInsights().catch(() => {}); }
  await app.listen({ port: config.port, host: '0.0.0.0' });
  const stop = async () => { await app.close(); await db.destroy(); redis.disconnect(); process.exit(0); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
