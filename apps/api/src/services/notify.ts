// Notifications are recorded and queued in the same transaction as the order change, then sent by the outbox.
// Delivery never decides an order's state: a failed WhatsApp leaves the order exactly where it was.
import type { Knex } from 'knex';
import { db } from '../db/knex.ts';
import { uid } from '../lib/ids.ts';
import { sender, type Message } from '../adapters/messaging.ts';
import { enqueue, register } from './outbox.ts';
import { raiseException } from './exceptions.ts';

export async function notify(trx: Knex | Knex.Transaction, m: Message & { orderId?: string }) {
  const id = uid();
  await trx('notifications').insert({ id, channel: m.channel, to_phone: m.to, template: m.template, body: m.body, order_id: m.orderId ?? null, status: 'queued', created_at: new Date() });
  await enqueue(trx, 'notify', { id, buttons: m.buttons }, m.orderId);
}

register('notify', async ({ id, buttons }) => {
  const n = await db('notifications').where({ id }).first();
  if (!n || n.status === 'sent') return { ok: true };
  await sender(n.channel).send({ channel: n.channel, to: n.to_phone, template: n.template, body: n.body, buttons });
  await db('notifications').where({ id }).update({ status: 'sent' });
  return { ok: true };
}, async ({ id }, _row, err) => {
  const n = await db('notifications').where({ id }).first();
  await db('notifications').where({ id }).update({ status: 'failed' });
  await raiseException('notify', 'warn', 'Message not delivered', `${n?.template} to ${n?.to_phone?.slice(-4) ? '••' + n.to_phone.slice(-4) : 'unknown'} failed: ${err}`, n?.order_id ?? undefined);
});
