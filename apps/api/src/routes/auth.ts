import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Role } from '@citrus/shared';
import { config } from '../config.ts';
import { ApiError } from '../lib/errors.ts';
import * as auth from '../services/auth.ts';

declare module 'fastify' { interface FastifyRequest { claims?: auth.Claims } }

const COOKIE = 'ct_refresh';
const cookieOpts = () => ({ httpOnly: true, sameSite: 'lax' as const, secure: config.env === 'production', path: '/api/auth', maxAge: config.refreshTtlDays * 86_400 });

export function requireRole(...roles: Role[]) {
  return async (req: FastifyRequest) => {
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) throw new ApiError(401, 'NO_SESSION', 'Please sign in.');
    req.claims = await auth.verifyAccess(h.slice(7));
    if (roles.length && !roles.includes(req.claims.role)) throw new ApiError(403, 'FORBIDDEN', 'This page is not available for your account.');
  };
}

export async function authRoutes(app: FastifyInstance) {
  const strict = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };
  app.get<{ Params: { token: string } }>('/api/auth/invite/:token', async req => auth.inviteInfo(req.params.token));
  app.post('/api/auth/otp', strict, async req => {
    const b = z.object({ phone: z.string().min(10).max(16), invite: z.string().max(60).optional(), channel: z.enum(['sms', 'whatsapp', 'voice']).optional() }).parse(req.body);
    return auth.requestOtp(b.phone, b.invite, req.ip, b.channel);
  });
  app.post('/api/auth/verify', strict, async (req, reply: FastifyReply) => {
    const b = z.object({ requestId: z.string().uuid(), code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') }).parse(req.body);
    const s = await auth.verifyOtp(b.requestId, b.code, req.headers['user-agent'] ?? '');
    reply.setCookie(COOKIE, s.refresh, cookieOpts());
    return { accessToken: s.accessToken, expiresIn: s.expiresIn, me: s.me };
  });
  app.post('/api/auth/refresh', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!req.cookies[COOKIE]) return reply.code(204).send(); // not signed in on this browser: nothing to refresh
    try {
      const s = await auth.refreshSession(req.cookies[COOKIE], req.headers['user-agent'] ?? '');
      reply.setCookie(COOKIE, s.refresh, cookieOpts());
      return { accessToken: s.accessToken, expiresIn: s.expiresIn, me: s.me };
    } catch (e) { reply.clearCookie(COOKIE, { path: '/api/auth' }); throw e; }
  });
  app.post('/api/auth/logout', async (req, reply) => {
    await auth.logout(req.cookies[COOKIE]);
    reply.clearCookie(COOKIE, { path: '/api/auth' });
    return reply.code(204).send();
  });
  app.get('/api/me', { preHandler: requireRole() }, async req => auth.me(req.claims!.sub));
  app.post('/api/me/consent', { preHandler: requireRole('retailer') }, async req => {
    const b = z.object({ waMarketing: z.boolean().optional() }).parse(req.body ?? {});
    await auth.recordConsent(req.claims!.rid!, !!b.waMarketing);
    return auth.me(req.claims!.sub);
  });
}
