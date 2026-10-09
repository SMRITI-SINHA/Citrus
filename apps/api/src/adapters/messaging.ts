// SMS and WhatsApp senders behind one interface so the BSP (Gupshup / Meta Cloud API) and SMS gateway (DLT templates)
// can be plugged in without touching business logic. Console mode logs messages and stores them for the UI.
import { config } from '../config.ts';

export interface Message { channel: 'sms' | 'whatsapp' | 'voice'; to: string; template: string; body: string; buttons?: { id: string; title: string }[] }
export interface Sender { send(m: Message): Promise<{ providerId: string }> }

const consoleSender: Sender = {
  async send(m) {
    if (config.env !== 'test') console.log(`[${m.channel}] -> ${m.to} (${m.template}) ${m.body}${m.buttons ? ' [' + m.buttons.map(b => b.title).join(' | ') + ']' : ''}`);
    return { providerId: 'console-' + Date.now() };
  },
};

export function sender(_channel: 'sms' | 'whatsapp' | 'voice'): Sender {
  // Production: return gupshupSender / metaCloudSender / msg91Sender based on config.whatsapp.provider / config.sms.provider.
  return consoleSender;
}

/** Utility templates (no offers inside, so Meta keeps them in the Utility category). */
export const TEMPLATES = {
  otp: (code: string) => `${code} is your CITRUS Trade code. It expires in 5 minutes. Do not share it.`,
  order_received: (o: { num: string; qty: number; dist: string }) => `Order ${o.num} received: ${o.qty} pcs. ${o.dist} will review it shortly.`,
  order_for_approval: (o: { num: string; store: string; city: string; qty: number; value: string; note?: string }) =>
    `New order ${o.num} from ${o.store}, ${o.city}. ${o.qty} pcs · ${o.value}.${o.note ? ` Note: "${o.note}"` : ''}`,
  changes_proposed: (o: { num: string; dist: string }) => `${o.dist} suggested changes to order ${o.num}. Open CITRUS Trade to accept or cancel.`,
  changes_reminder: (o: { num: string }) => `Reminder: order ${o.num} is waiting for your answer on the suggested changes.`,
  order_confirmed: (o: { num: string; so: string }) => `Order ${o.num} is confirmed. CITRUS order ref ${o.so}.`,
  order_rejected: (o: { num: string; reason: string }) => `Order ${o.num} was not approved. Reason: ${o.reason}.`,
  order_dispatched: (o: { num: string; awb?: string }) => `Order ${o.num} has been dispatched.${o.awb ? ` Courier AWB ${o.awb}.` : ''}`,
  order_delivered: (o: { num: string; points: number; total: number }) => `Order ${o.num} delivered. +${o.points} points added, total ${o.total}.`,
  approval_overdue: (o: { num: string; store: string; hours: number }) => `Order ${o.num} from ${o.store} has been waiting ${o.hours}h for approval.`,
};
