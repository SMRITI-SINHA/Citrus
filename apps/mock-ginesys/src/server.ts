// Stand-in for Ginesys, shaped on what Ginesys publicly documents (Ginesys Data Services, help space PUB):
//   POST  /erp/gds/api/sales-order         create SO, intgOrderId de-duplicated, reservationRequired / partialReservation, per-line reservedQty
//   PATCH /snd/SalesOrder/authorize         isAuthorize true/false
//   POST  /snd/SalesOrder/cancel            cancelFully or per-line qty; "Only pending orders are allowed"
//   Webhooks out: site.inventory.allitem.refresh (DownloadURL snapshot), snd.deliverychallan.added, snd.invoice.added
// Auth header `Ginesys_Api_Key: API <token>`; envelope { requestId, status 0|1, result, error{code,target} }.
// Where Ginesys does not document behaviour (e.g. how a duplicate intgOrderId is reported, delivery events, credit fields
// on the customer webhook) the stand-in picks something reasonable and the adapter treats it as an assumption.
// Fault injection: MOCK_FAIL_RATE (random 503s on writes), MOCK_LATENCY_MS, MOCK_WEBHOOK_DROP (drop rate for webhooks).
import Fastify from 'fastify';
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { STYLES, RETAILERS, seedStock } from '@citrus/shared/src/seed.ts';

type SoStatus = 'UNAUTHORIZED' | 'AUTHORIZED' | 'DC_CREATED' | 'INVOICED' | 'DELIVERED' | 'CANCELLED';
interface SoLine { itemCode: string; orderQty: number; reservedQty: number; cancelledQty: number; rate: number }
interface SalesOrder { erpOrderId: string; erpOrderNo: string; intgOrderId: string; customerId: string; lines: SoLine[]; status: SoStatus; awb?: string; trpCode?: string; at: number }

const PORT = Number(process.env.MOCK_GINESYS_PORT ?? 4100);
const FAIL_RATE = Number(process.env.MOCK_FAIL_RATE ?? 0);
const LATENCY_MS = Number(process.env.MOCK_LATENCY_MS ?? 120);
const WEBHOOK_DROP = Number(process.env.MOCK_WEBHOOK_DROP ?? 0);
const AUTO_ADVANCE_S = Number(process.env.MOCK_AUTO_ADVANCE_S ?? 0);
const SNAPSHOT_S = Number(process.env.MOCK_SNAPSHOT_S ?? 60);
const API_KEY = process.env.GINESYS_API_KEY ?? 'dev-key';
const WEBHOOK_URL = process.env.GINESYS_WEBHOOK_URL ?? 'http://localhost:4000/webhooks/ginesys';
const WEBHOOK_SECRET = process.env.GINESYS_WEBHOOK_SECRET ?? 'dev-ginesys-secret';
const SELF = process.env.MOCK_PUBLIC_URL ?? `http://localhost:${PORT}`;

export const state = {
  stock: seedStock(),                          // free (unreserved) qty per itemCode
  orders: new Map<string, SalesOrder>(),        // by erpOrderId
  byIntg: new Map<string, string>(),            // intgOrderId -> erpOrderId
  snapshots: new Map<string, { generatedAt: string; items: { itemCode: string; freeQty: number }[] }>(),
  seq: 4821,
  paused: false,                                // simulate an outage: every call 503
};
// Persist the stand-in's state so restarting it does not forget sales orders the API already knows about.
const STATE_FILE = process.env.MOCK_STATE_FILE ?? '';
if (STATE_FILE && existsSync(STATE_FILE)) {
  const j = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  state.stock = j.stock; state.seq = j.seq; state.orders = new Map(j.orders); state.byIntg = new Map(j.byIntg);
}
const persist = () => { if (STATE_FILE) writeFileSync(STATE_FILE, JSON.stringify({ stock: state.stock, seq: state.seq, orders: [...state.orders], byIntg: [...state.byIntg] })); };
if (STATE_FILE) { setInterval(persist, 3000).unref(); process.on('SIGTERM', () => { persist(); process.exit(0); }); process.on('SIGINT', () => { persist(); process.exit(0); }); }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const ok = (result: unknown) => ({ requestId: randomUUID(), status: 0, result });
const err = (code: string, target: string, message: string, extra?: object) => ({ requestId: randomUUID(), status: 1, error: { code, target, message, ...extra } });
const app = Fastify({ logger: false, bodyLimit: 5 * 1024 * 1024 });

app.addHook('onRequest', async (req, reply) => {
  if (req.url.startsWith('/health') || req.url.startsWith('/_admin') || req.url.startsWith('/_files')) return;
  if (req.headers['ginesys_api_key'] !== `API ${API_KEY}`) return reply.code(401).send(err('unauthorized', 'Ginesys_Api_Key', 'Invalid API key'));
  await sleep(LATENCY_MS);
  if (state.paused || (req.method !== 'GET' && FAIL_RATE > 0 && Math.random() < FAIL_RATE)) return reply.code(503).send(err('unavailable', 'server', 'Simulated Ginesys outage'));
});

app.get('/health', async () => ({ ok: true }));

// ---- documented: create sales order with optional reservation ----
interface CreateBody { intgOrderId: string; customerId: string; ownerSiteCode?: string; agentCode?: string; reservationRequired?: 'Y' | 'N'; partialReservation?: 'Y' | 'N'; items: { itemCode: string; qty: number; rate: number }[] }
app.post<{ Body: CreateBody }>('/erp/gds/api/sales-order', async (req, reply) => {
  const b = req.body;
  if (!b?.intgOrderId || !b.customerId || !Array.isArray(b.items) || !b.items.length) return reply.code(400).send(err('invalid_value', 'items', 'intgOrderId, customerId and items are required'));
  if (!RETAILERS.some(r => r.code === b.customerId)) return reply.code(400).send(err('business_rule', 'customerId', 'Customer not found'));
  const dup = state.byIntg.get(b.intgOrderId);
  // Ginesys documents that a duplicate intgOrderId is rejected; it does not document the payload. We return the existing order number.
  if (dup) { const so = state.orders.get(dup)!; return reply.code(409).send(err('duplicate', 'intgOrderId', 'Order with this intgOrderId already exists', { erpOrderId: so.erpOrderId, erpOrderNo: so.erpOrderNo })); }
  for (const it of b.items) if (!(it.itemCode in state.stock)) return reply.code(400).send(err('invalid_value', 'itemCode', `Unknown item ${it.itemCode}`));
  const reserve = b.reservationRequired === 'Y', partial = b.partialReservation === 'Y';
  const canFull = b.items.every(it => state.stock[it.itemCode] >= it.qty);
  const lines: SoLine[] = b.items.map(it => {
    const free = state.stock[it.itemCode];
    const r = !reserve ? 0 : canFull ? it.qty : partial ? Math.min(free, it.qty) : 0;
    state.stock[it.itemCode] = free - r;
    return { itemCode: it.itemCode, orderQty: it.qty, reservedQty: r, cancelledQty: 0, rate: it.rate };
  });
  const id = randomUUID();
  const so: SalesOrder = { erpOrderId: id, erpOrderNo: `SO/KL/26-27/${String(++state.seq).padStart(5, '0')}`, intgOrderId: b.intgOrderId, customerId: b.customerId, lines, status: 'UNAUTHORIZED', at: Date.now() };
  state.orders.set(id, so); state.byIntg.set(b.intgOrderId, id);
  return reply.code(201).send(ok({ erpOrderId: so.erpOrderId, erpOrderNo: so.erpOrderNo, items: lines }));
});

// ---- documented: authorise / unauthorise ----
app.patch<{ Body: { erpOrderId: string; isAuthorize: boolean } }>('/snd/SalesOrder/authorize', async (req, reply) => {
  const so = state.orders.get(req.body?.erpOrderId);
  if (!so) return reply.code(400).send(err('invalid_value', 'erpOrderId', 'Order not found'));
  if (so.status === 'CANCELLED') return reply.code(400).send(err('business_rule', 'erpOrderId', 'Cancelled order cannot be authorized'));
  if (req.body.isAuthorize && so.status === 'UNAUTHORIZED') { so.status = 'AUTHORIZED'; so.at = Date.now(); }
  else if (!req.body.isAuthorize && so.status === 'AUTHORIZED') so.status = 'UNAUTHORIZED';
  return ok({ erpOrderId: so.erpOrderId, erpOrderNo: so.erpOrderNo, status: so.status });
});

// ---- documented: cancel fully or by line quantity (only pending quantities) ----
app.post<{ Body: { erpOrderId: string; cancelFully?: boolean; items?: { itemCode: string; cancelQty: number }[] } }>('/snd/SalesOrder/cancel', async (req, reply) => {
  const so = state.orders.get(req.body?.erpOrderId);
  if (!so) return reply.code(400).send(err('invalid_value', 'erpOrderId', 'Order not found'));
  if (so.status === 'CANCELLED') return ok({ erpOrderId: so.erpOrderId, status: so.status });
  if (!['UNAUTHORIZED', 'AUTHORIZED'].includes(so.status)) return reply.code(400).send(err('business_rule', 'erpOrderId', 'Only pending orders are allowed'));
  const cancelLine = (l: SoLine, q: number) => {
    const pending = l.orderQty - l.cancelledQty; const c = Math.min(q, pending);
    const rel = Math.min(c, l.reservedQty); l.reservedQty -= rel; state.stock[l.itemCode] += rel; l.cancelledQty += c;
  };
  if (req.body.cancelFully) { for (const l of so.lines) cancelLine(l, l.orderQty); so.status = 'CANCELLED'; }
  else {
    for (const c of req.body.items ?? []) {
      const l = so.lines.find(x => x.itemCode === c.itemCode);
      if (!l || c.cancelQty < 0 || c.cancelQty > l.orderQty - l.cancelledQty) return reply.code(400).send(err('invalid_value', 'cancelQty', `Cannot cancel ${c.cancelQty} of ${c.itemCode}`));
    }
    for (const c of req.body.items ?? []) cancelLine(so.lines.find(x => x.itemCode === c.itemCode)!, c.cancelQty);
    if (so.lines.every(l => l.cancelledQty >= l.orderQty)) so.status = 'CANCELLED';
  }
  return ok({ erpOrderId: so.erpOrderId, status: so.status, items: so.lines });
});

// ---- webhooks out (signed with HMAC-SHA256 of the raw body; Ginesys's actual signing scheme is not public) ----
async function emit(event_name: string, refcode: string, resource: unknown) {
  if (WEBHOOK_DROP > 0 && Math.random() < WEBHOOK_DROP) return; // Ginesys does not document retries: simulate lost deliveries
  const body = JSON.stringify({ event_name, refcode, request_id: randomUUID(), resource: JSON.stringify(resource) });
  const sig = createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
  await fetch(WEBHOOK_URL, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ginesys-signature': sig }, body, signal: AbortSignal.timeout(5000) }).catch(() => {});
}

export async function snapshot() {
  const id = randomUUID();
  state.snapshots.set(id, { generatedAt: new Date().toISOString(), items: Object.entries(state.stock).map(([itemCode, freeQty]) => ({ itemCode, freeQty })) });
  if (state.snapshots.size > 5) state.snapshots.delete(state.snapshots.keys().next().value!);
  await emit('site.inventory.allitem.refresh', 'CITRUS-WH-BLR', { siteCode: 'CITRUS-WH-BLR', generatedAt: state.snapshots.get(id)!.generatedAt, DownloadURL: `${SELF}/_files/inventory/${id}.json` });
  return id;
}
app.get<{ Params: { id: string } }>('/_files/inventory/:id.json', async (req, reply) => {
  const s = state.snapshots.get(req.params.id);
  return s ?? reply.code(404).send({ error: 'expired' });
});

// ---- test/demo controls: move an authorised order through warehouse steps, the way WMS/billing would ----
async function advance(so: SalesOrder) {
  const at = new Date().toISOString();
  if (so.status === 'AUTHORIZED') {
    so.status = 'DC_CREATED'; so.trpCode = 'TRP-DTDC';
    await emit('snd.deliverychallan.added', so.erpOrderNo, { dc_no: `DC/${so.erpOrderNo.slice(-5)}`, order_code: so.erpOrderNo, intgOrderId: so.intgOrderId, trp_code: so.trpCode, dc_date: at });
  } else if (so.status === 'DC_CREATED') {
    so.status = 'INVOICED'; so.awb = String(14902286553 + state.seq);
    await emit('snd.invoice.added', so.erpOrderNo, { invoice_no: `INV/${so.erpOrderNo.slice(-5)}`, order_code: so.erpOrderNo, intgOrderId: so.intgOrderId, awb_no: so.awb, invoice_date: at });
  } else if (so.status === 'INVOICED') {
    so.status = 'DELIVERED';
    // Not a documented event name: Ginesys documents "update delivery date" on logistics. Treated as an assumption.
    await emit('snd.logistics.delivered', so.erpOrderNo, { order_code: so.erpOrderNo, intgOrderId: so.intgOrderId, delivered_date: at });
  }
  so.at = Date.now();
  return so;
}
app.post<{ Params: { id: string } }>('/_admin/orders/:id/advance', async (req, reply) => {
  const id = state.byIntg.get(req.params.id) ?? req.params.id;
  const so = state.orders.get(id);
  return so ? advance(so) : reply.code(404).send({ error: 'NOT_FOUND' });
});
app.get<{ Params: { id: string } }>('/_admin/orders/:id', async (req, reply) => {
  const so = state.orders.get(state.byIntg.get(req.params.id) ?? req.params.id);
  return so ?? reply.code(404).send({ error: 'NOT_FOUND' });
});
app.post<{ Body: { itemCode: string; qty: number } }>('/_admin/stock', async req => { state.stock[req.body.itemCode] = req.body.qty; return { ok: true }; });
app.post('/_admin/snapshot', async () => ({ id: await snapshot() }));
app.post<{ Body: { paused: boolean } }>('/_admin/outage', async req => { state.paused = !!req.body.paused; return { paused: state.paused }; });
app.post('/_admin/reset', async () => {
  state.stock = seedStock(); state.orders.clear(); state.byIntg.clear(); state.snapshots.clear(); state.paused = false; return { ok: true };
});

if (AUTO_ADVANCE_S > 0) setInterval(() => {
  for (const so of state.orders.values()) if (['AUTHORIZED', 'DC_CREATED', 'INVOICED'].includes(so.status) && Date.now() - so.at > AUTO_ADVANCE_S * 1000) advance(so);
}, 2000).unref();
if (SNAPSHOT_S > 0) setInterval(() => { snapshot().catch(() => {}); }, SNAPSHOT_S * 1000).unref();

export { app };
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) {
  app.listen({ port: PORT, host: '0.0.0.0' }).then(() => console.log(`stand-in Ginesys on :${PORT} (${STYLES.length} styles, ${Object.keys(state.stock).length} SKUs)`));
}
