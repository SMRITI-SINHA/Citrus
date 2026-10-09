import { db } from '../db/knex.ts';
import { uid } from '../lib/ids.ts';
import { publish } from '../lib/bus.ts';

/** Exceptions are the CITRUS ops queue: things a person should look at. Errors stay inline here, never only in logs. */
export async function raiseException(kind: string, severity: 'bad' | 'warn' | 'info', title: string, detail: string, orderId?: string) {
  if (orderId) {
    const open = await db('exceptions').where({ kind, order_id: orderId }).whereNull('resolved_at').first();
    if (open) { await db('exceptions').where({ id: open.id }).update({ detail }); return; }
  }
  await db('exceptions').insert({ id: uid(), kind, severity, title, detail, order_id: orderId ?? null, created_at: new Date() });
  await publish({ admins: true }, { type: 'admin.updated' }).catch(() => {});
}
export async function resolveExceptions(kind: string, orderId: string) {
  await db('exceptions').where({ kind, order_id: orderId }).whereNull('resolved_at').update({ resolved_at: new Date() });
}
