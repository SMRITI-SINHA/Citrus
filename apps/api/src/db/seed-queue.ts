// Places a few live orders through the real API as other Malabar Trade Links stores, so the distributor queue
// has fresh orders that exist in (stand-in) Ginesys and can be approved, modified or rejected end to end.
const API = process.env.API_URL ?? 'http://localhost:4000';
const stores = [
  { phone: '9847038812', lines: [['CS-1101', 'White', [2, 6, 6, 4, 2]], ['CT-2101', 'Navy', [1, 3, 3, 2, 1]]], note: 'Need before Onam sale', po: 'OSC/PO/218' },
  { phone: '9847035240', lines: [['CS-1104', 'Navy', [1, 2, 2, 1, 0]], ['CK-3101', 'Maroon', [2, 4, 4, 2, 1]], ['CT-2102', 'Black', [0, 2, 3, 2, 1]]], note: '', po: '' },
  { phone: '9847029110', lines: [['CS-1102', 'White', [1, 3, 3, 2, 1]]], note: 'Call before dispatch', po: '' },
] as const;
const SIZES: Record<string, string[]> = { CS: ['S', 'M', 'L', 'XL', 'XXL'], CK: ['S', 'M', 'L', 'XL', 'XXL'], CT: ['30', '32', '34', '36', '38'] };
async function j(path: string, init: RequestInit & { token?: string } = {}) {
  const res = await fetch(API + path, { ...init, headers: { 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} ${res.status} ${JSON.stringify(body)}`);
  return body as any;
}
for (const s of stores) {
  const otp = await j('/api/auth/otp', { method: 'POST', body: JSON.stringify({ phone: s.phone }) });
  const sess = await j('/api/auth/verify', { method: 'POST', body: JSON.stringify({ requestId: otp.requestId, code: otp.devCode }) });
  const lines = s.lines.flatMap(([styleId, color, q]) => SIZES[styleId.slice(0, 2)].map((size, i) => ({ styleId, color, size, qty: q[i] })).filter(l => l.qty));
  await j('/api/cart/lines', { method: 'PUT', token: sess.accessToken, body: JSON.stringify({ lines }) });
  const cart = await j('/api/cart/meta', { method: 'PUT', token: sess.accessToken, body: JSON.stringify({ note: s.note, po: s.po }) });
  const o = await j('/api/orders', { method: 'POST', token: sess.accessToken, body: JSON.stringify({ idempotencyKey: `seed-${s.phone}-${Date.now()}`, cartVersion: cart.version }) });
  console.log(`${o.number} ${o.store}: ${o.totalQty} pcs, ${o.status}, ${o.erp.soNumber ?? 'reserving'}`);
}
export {};
process.exit(0);
