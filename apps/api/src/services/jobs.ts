// Time-based rules, run every minute by one instance (Redis lock). All thresholds are POLICY defaults (see ASSUMPTIONS).
import { POLICY } from '@citrus/shared';
import { db } from '../db/knex.ts';
import { redis } from '../lib/redis.ts';
import { TEMPLATES } from '../adapters/messaging.ts';
import { notify } from './notify.ts';
import { poke } from './outbox.ts';
import { raiseException } from './exceptions.ts';
import { uid } from '../lib/ids.ts';
import { log } from '../lib/log.ts';

export async function runJobs() {
  // single runner across API instances
  const got = await redis.set('ct:jobs-lock', '1', 'EX', 50, 'NX');
  if (!got) return;
  try {
    await approvalSla();
    await changeReminders();
    await reconcile();
  } catch (e) { log.error({ err: e }, 'jobs failed'); }
}

/** Orders waiting for the distributor beyond the SLA: remind the distributor once, and flag to CITRUS. */
async function approvalSla() {
  const cutoff = new Date(Date.now() - POLICY.approvalSlaHours * 3_600_000);
  const late = await db('orders as o').join('retailers as r', 'r.id', 'o.retailer_id').join('distributors as d', 'd.id', 'o.distributor_id')
    .where('o.status', 'review').where('o.placed_at', '<', cutoff).whereNull('o.reminded_at')
    .select('o.id', 'o.num', 'o.placed_at', 'o.distributor_id', 'r.store', 'd.name as dname', 'd.phone as dphone').limit(500);
  for (const o of late) {
    const hours = Math.floor((Date.now() - new Date(o.placed_at).getTime()) / 3_600_000);
    await db.transaction(async trx => {
      await trx('orders').where({ id: o.id }).update({ reminded_at: new Date() });
      const users = await trx('users').where({ distributor_id: o.distributor_id, role: 'distributor' });
      for (const u of users.length ? users : [{ phone: o.dphone }])
        await notify(trx, { channel: 'whatsapp', to: u.phone, template: 'approval_overdue', body: TEMPLATES.approval_overdue({ num: o.num, store: o.store, hours }), orderId: o.id,
          buttons: [{ id: `approve:${o.id}`, title: 'Approve' }, { id: `modify:${o.id}`, title: 'Modify' }, { id: `reject:${o.id}`, title: 'Reject' }] });
      await trx('order_events').insert({ id: uid(), order_id: o.id, at: new Date(), type: 'sla', actor: 'system', message: `Waiting ${hours}h for ${o.dname}; reminder sent and CITRUS informed` });
    });
    await raiseException('sla', 'warn', 'Approval overdue', `${o.num} from ${o.store} has waited ${hours}h for ${o.dname}.`, o.id);
  }
  if (late.length) poke();
}

/** Retailer has not answered suggested changes: remind at 24h, escalate to CITRUS at 48h. Never auto-cancel. */
async function changeReminders() {
  const remindAt = new Date(Date.now() - POLICY.changeReminderHours * 3_600_000);
  const due = await db('orders as o').join('retailers as r', 'r.id', 'o.retailer_id')
    .where('o.status', 'modified').where('o.updated_at', '<', remindAt).whereNull('o.reminded_at').select('o.id', 'o.num', 'r.phone', 'r.store').limit(500);
  for (const o of due) {
    await db.transaction(async trx => {
      await trx('orders').where({ id: o.id }).update({ reminded_at: new Date() });
      await notify(trx, { channel: 'whatsapp', to: o.phone, template: 'changes_reminder', body: TEMPLATES.changes_reminder({ num: o.num }), orderId: o.id });
    });
  }
  const escalate = await db('orders as o').join('retailers as r', 'r.id', 'o.retailer_id')
    .where('o.status', 'modified').where('o.reminded_at', '<', remindAt).select('o.id', 'o.num', 'r.store').limit(500);
  for (const o of escalate) await raiseException('changes', 'warn', 'Retailer has not answered changes', `${o.num} (${o.store}) has not accepted or declined the distributor's changes for 2 days. Please call the store.`, o.id);
  if (due.length) poke();
}

/**
 * Ginesys does not document webhook retries, so a lost event must not leave an order stuck silently.
 * Flag orders that have not moved for longer than is normal for their stage.
 */
async function reconcile() {
  const h = (n: number) => new Date(Date.now() - n * 3_600_000);
  const stuck = await db('orders').where(b => b
    .where(w => w.where('status', 'placed').where('placed_at', '<', h(0.25)))
    .orWhere(w => w.where('status', 'approved').where('updated_at', '<', h(0.25)))
    .orWhere(w => w.where('status', 'confirmed').where('updated_at', '<', h(72)))
    .orWhere(w => w.where('status', 'dispatched').where('updated_at', '<', h(24 * 10))))
    .whereNot('erp_state', 'failed').where(b => b.whereNotNull('erp_ref').orWhere('status', 'placed')) // imported history has no live ERP link
    .select('id', 'num', 'status').limit(200);
  for (const o of stuck)
    await raiseException('stuck', 'info', 'Order not moving', `${o.num} has been "${o.status}" longer than usual. Check it in Ginesys; a status update may have been missed.`, o.id);
}
