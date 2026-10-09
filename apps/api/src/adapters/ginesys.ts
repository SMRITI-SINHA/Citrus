// Anti-corruption layer for Ginesys. Business logic calls the ErpGateway verbs only; this file maps them onto the
// endpoints Ginesys documents publicly (Ginesys Data Services, help space PUB, researched 8 Oct 2026):
//   reserve  -> POST /erp/gds/api/sales-order  (reservationRequired=Y, partialReservation=Y, intgOrderId = our order id)
//              partial reservation is used only to learn exactly which sizes fell short; any shortfall cancels the whole SO.
//   approve  -> PATCH /snd/SalesOrder/authorize (isAuthorize=true)
//   reduce   -> POST /snd/SalesOrder/cancel with per-line qty
//   release  -> POST /snd/SalesOrder/cancel with cancelFully
// Undocumented details (duplicate payload, base URL, rate limits, signing) are marked ASSUMPTION and listed in ASSUMPTIONS.
import { config } from '../config.ts';

export interface ErpLine { sku: string; qty: number; rate: number }
export class ErpError extends Error {
  constructor(public kind: 'insufficient' | 'locked' | 'unavailable' | 'rejected', message: string, public detail?: any) { super(message); }
}

const breaker = { failures: 0, openUntil: 0 };
function breakerCheck() { if (Date.now() < breaker.openUntil) throw new ErpError('unavailable', 'Ginesys is not responding (paused calls for 30 s)'); }
function breakerResult(ok: boolean) {
  if (ok) { breaker.failures = 0; return; }
  if (++breaker.failures >= 5) { breaker.openUntil = Date.now() + 30_000; breaker.failures = 0; }
}
export const breakerState = () => (Date.now() < breaker.openUntil ? 'open' : 'closed');

interface Envelope<T> { requestId: string; status: 0 | 1; result?: T; error?: { code: string; target: string; message?: string; [k: string]: unknown } }

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  breakerCheck();
  let res: Response;
  try {
    res = await fetch(config.ginesys.baseUrl + path, {
      method, headers: { 'content-type': 'application/json', Ginesys_Api_Key: `API ${config.ginesys.apiKey}` },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(config.ginesys.timeoutMs),
    });
  } catch (e: any) { breakerResult(false); throw new ErpError('unavailable', `Ginesys did not respond (${e.name === 'TimeoutError' ? 'timeout' : e.message})`); }
  if (res.status >= 500 || res.status === 429) { breakerResult(false); throw new ErpError('unavailable', `Ginesys returned ${res.status}`); }
  breakerResult(true);
  const env = (await res.json().catch(() => ({}))) as Envelope<T>;
  if (res.status >= 400 || env.status === 1) {
    const e = env.error ?? { code: String(res.status), target: '' };
    if (e.code === 'duplicate') throw new ErpError('locked', 'duplicate', e);
    throw new ErpError(res.status === 409 ? 'locked' : 'rejected', e.message ?? `${e.code} on ${e.target}`, e);
  }
  return env.result as T;
}

// Item code mapping. ASSUMPTION: one Ginesys item per style|colour|size; the real slot mapping (category1–6) comes from Jatin.
export const sku = (styleId: string, color: string, size: string) => `${styleId}|${color}|${size}`;
export const unsku = (s: string) => { const [styleId, color, size] = s.split('|'); return { styleId, color, size }; };

export interface ErpGateway {
  /** Create the SO with stock reserved. Idempotent on our order id. Throws ErpError('insufficient') listing short lines. */
  reserve(orderId: string, customerCode: string, lines: ErpLine[]): Promise<{ erpOrderId: string; erpOrderNo: string }>;
  /** Approve: authorise the SO in Ginesys. Idempotent. */
  approve(erpOrderId: string): Promise<void>;
  /** Reduce quantities (accepted distributor changes) by cancelling the difference per line. */
  reduce(erpOrderId: string, cuts: { sku: string; qty: number }[]): Promise<void>;
  /** Cancel the whole SO and release its reservation. Idempotent. */
  release(erpOrderId: string): Promise<void>;
  /** Fetch an inventory snapshot file announced by the site.inventory.allitem.refresh webhook. */
  snapshot(url: string): Promise<{ generatedAt: string; items: { sku: string; qty: number }[] }>;
}

interface SoResult { erpOrderId: string; erpOrderNo: string; items: { itemCode: string; orderQty: number; reservedQty: number }[] }

export const erp: ErpGateway = {
  async reserve(orderId, customerCode, lines) {
    let so: SoResult;
    try {
      so = await call<SoResult>('POST', '/erp/gds/api/sales-order', {
        intgOrderId: orderId, customerId: customerCode, ownerSiteCode: config.ginesys.siteCode, reservationRequired: 'Y', partialReservation: 'Y',
        items: lines.map(l => ({ itemCode: l.sku, qty: l.qty, rate: l.rate })),
      });
    } catch (e) {
      // A retry after a lost response hits Ginesys's duplicate check. ASSUMPTION: the rejection tells us the existing order.
      if (e instanceof ErpError && e.message === 'duplicate' && e.detail?.erpOrderId) return { erpOrderId: e.detail.erpOrderId, erpOrderNo: e.detail.erpOrderNo };
      throw e;
    }
    const short = so.items.filter(i => i.reservedQty < i.orderQty);
    if (short.length) {
      // All-or-nothing: an order is only placed when every size is reserved. Release what was reserved and report the gaps.
      await call('POST', '/snd/SalesOrder/cancel', { erpOrderId: so.erpOrderId, cancelFully: true }).catch(() => {});
      throw new ErpError('insufficient', 'Not enough stock in Ginesys', short.map(i => ({ sku: i.itemCode, requested: i.orderQty, available: i.reservedQty })));
    }
    return { erpOrderId: so.erpOrderId, erpOrderNo: so.erpOrderNo };
  },
  async approve(id) { await call('PATCH', '/snd/SalesOrder/authorize', { erpOrderId: id, isAuthorize: true }); },
  async reduce(id, cuts) { if (cuts.length) await call('POST', '/snd/SalesOrder/cancel', { erpOrderId: id, items: cuts.map(c => ({ itemCode: c.sku, cancelQty: c.qty })) }); },
  async release(id) { await call('POST', '/snd/SalesOrder/cancel', { erpOrderId: id, cancelFully: true }); },
  async snapshot(url) {
    // Only fetch from the configured Ginesys host: the URL arrives in a webhook body.
    if (!url.startsWith(config.ginesys.downloadPrefix)) throw new ErpError('rejected', 'Snapshot URL is not from Ginesys');
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new ErpError('unavailable', `Snapshot download returned ${res.status}`);
    const j: any = await res.json();
    return { generatedAt: j.generatedAt, items: (j.items ?? []).map((i: any) => ({ sku: i.itemCode, qty: Number(i.freeQty) })) };
  },
};

/** Webhook event -> CITRUS Trade order status. ASSUMPTION 'status': exact mapping to be confirmed with WFX. */
export const EVENT_TO_STATUS: Record<string, 'processing' | 'dispatched' | 'delivered' | undefined> = {
  'snd.deliverychallan.added': 'processing',
  'snd.invoice.added': 'dispatched',
  'snd.logistics.delivered': 'delivered',
};
