// Inbound webhooks: verify the signature on the raw bytes, store once in the inbox (de-duplicated on the sender's id),
// answer 200 immediately, and process asynchronously through the outbox. Providers time out fast and retry.
import type { FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { config } from '../config.ts';
import { db } from '../db/knex.ts';
import { hmac, normPhone } from '../lib/ids.ts';
import { ApiError } from '../lib/errors.ts';
import { enqueue, register, poke, type Outcome } from '../services/outbox.ts';
import { decide, applyErpEvent } from '../services/orders.ts';
import { applySnapshot } from '../services/stock.ts';
import { sender } from '../adapters/messaging.ts';
import { EVENT_TO_STATUS } from '../adapters/ginesys.ts';
import { raiseException } from '../services/exceptions.ts';

const safeEq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

async function intoInbox(id: string, source: string, payload: string) {
  try {
    await db.transaction(async trx => {
      await trx('inbox').insert({ id: `${source}:${id}`.slice(0, 120), source, payload, status: 'pending', created_at: new Date() });
      await enqueue(trx, 'inbox', { id: `${source}:${id}`.slice(0, 120) });
    });
    poke();
    return true;
  } catch (e: any) {
    if (e?.code === '23505' || /ORA-00001/.test(String(e?.message))) return false; // duplicate delivery: already have it
    throw e;
  }
}

export async function webhookRoutes(app: FastifyInstance) {
  app.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: 2 * 1024 * 1024 }, (_req, body, done) => done(null, body));

  // Meta Cloud API verification handshake
  app.get<{ Querystring: Record<string, string> }>('/webhooks/whatsapp', async (req, reply) => {
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === config.whatsapp.verifyToken) return reply.send(req.query['hub.challenge']);
    return reply.code(403).send();
  });

  app.post('/webhooks/whatsapp', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async (req, reply) => {
    const raw = req.body as string;
    const sig = String(req.headers['x-hub-signature-256'] ?? '');
    if (!safeEq(sig, 'sha256=' + hmac(config.whatsapp.appSecret, raw))) throw new ApiError(401, 'BAD_SIGNATURE', 'Signature mismatch');
    const body = JSON.parse(raw);
    for (const entry of body.entry ?? []) for (const ch of entry.changes ?? []) for (const m of ch.value?.messages ?? [])
      await intoInbox(m.id, 'wa', JSON.stringify(m));
    return reply.code(200).send({ ok: true });
  });

  // Ginesys Connected App webhook. ASSUMPTION: HMAC-SHA256 of the body with the webhook secret (scheme not public).
  app.post('/webhooks/ginesys', { config: { rateLimit: { max: 1200, timeWindow: '1 minute' } } }, async (req, reply) => {
    const raw = req.body as string;
    const sig = String(req.headers['x-ginesys-signature'] ?? '');
    if (!safeEq(sig, hmac(config.ginesys.webhookSecret, raw))) throw new ApiError(401, 'BAD_SIGNATURE', 'Signature mismatch');
    const body = JSON.parse(raw);
    await intoInbox(body.request_id ?? `${body.event_name}:${body.refcode}`, 'gin', raw);
    return reply.code(200).send({ ok: true });
  });
}

register('inbox', async ({ id }): Promise<Outcome> => {
  const row = await db('inbox').where({ id }).first();
  if (!row || row.status === 'done') return { ok: true };
  if (row.source === 'wa') await handleWhatsApp(JSON.parse(row.payload));
  else await handleGinesys(JSON.parse(row.payload));
  await db('inbox').where({ id }).update({ status: 'done', done_at: new Date() });
  return { ok: true };
}, async ({ id }, _row, err) => {
  await db('inbox').where({ id }).update({ status: 'failed' });
  await raiseException('webhook', 'warn', 'Incoming update not processed', `${id}: ${err}`);
});

async function handleWhatsApp(m: any) {
  const payload: string = m.interactive?.button_reply?.id ?? m.button?.payload ?? '';
  const phone = normPhone(m.from ?? '');
  const [action, orderId] = payload.split(':');
  if (!['approve', 'modify', 'reject'].includes(action) || !orderId) return;
  const u = await db('users').where({ phone, role: 'distributor' }).first();
  const reply = (body: string) => sender('whatsapp').send({ channel: 'whatsapp', to: phone, template: 'reply', body });
  if (!u) { await raiseException('activation', 'warn', 'WhatsApp action from unknown number', `••${phone.slice(-4)} tapped ${action}.`); return; }
  const o = await db('orders').where({ id: orderId }).first();
  const link = `${config.appUrl}/d/orders/${orderId}`;
  if (action === 'approve') {
    try { await decide(u.distributor_id, orderId, { action: 'approve' }, 'whatsapp'); await reply(`Approved ${o?.num}. The retailer has been told.`); }
    catch (e: any) { await reply(e instanceof ApiError ? `${o?.num ?? 'Order'}: ${e.message}` : `Could not approve ${o?.num}. Open ${link}`); }
  } else {
    // Modify and Reject need a reason (and line edits), which WhatsApp buttons cannot carry: open the order in the app.
    await reply(`To ${action} ${o?.num}, open ${link} and choose a reason. It takes a few seconds.`);
  }
}

async function handleGinesys(ev: { event_name: string; refcode: string; resource: string }) {
  const res = typeof ev.resource === 'string' ? JSON.parse(ev.resource) : ev.resource;
  if (ev.event_name === 'site.inventory.allitem.refresh') { await applySnapshot(res.DownloadURL); return; }
  const target = EVENT_TO_STATUS[ev.event_name];
  if (target) { await applyErpEvent(ev.event_name, res, target); return; }
  if (ev.event_name.startsWith('customer.')) { await customerMaster(res); return; }
  // other events (item master, price list) are recorded in the inbox for audit; handling arrives with the real field mapping
}

/** Customer master: credit limit and overdue, as Ginesys reports them (field names per the public webhook sample). */
async function customerMaster(c: any) {
  const code = c.cust_code ?? c.code;
  if (!code) return;
  await db('retailers').where({ code }).update({
    credit_limit: c.credit_limit != null ? Math.round(Number(c.credit_limit)) : undefined,
    overdue_amount: c.overdue_amount != null ? Math.round(Number(c.overdue_amount)) : undefined,
    overdue_days: c.overdue_days != null ? Number(c.overdue_days) : undefined, credit_as_of: new Date(),
  });
}
