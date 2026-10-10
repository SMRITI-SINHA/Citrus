// CITRUS Trade API contract shared by the API and the PWA.
// Ginesys stays the source of truth; these types describe what CITRUS Trade owns and shows.

export type Role = 'retailer' | 'distributor' | 'admin';
export type Category = 'Shirts' | 'Trousers' | 'T-shirts';

/** Internal order status. Retailers see `retailerLabel(status)`; admins also see the ERP status. */
export type OrderStatus =
  | 'placed'      // submitted; final validation passed, ERP reservation in progress
  | 'review'      // stock reserved in the ERP, waiting for the distributor
  | 'modified'    // distributor proposed changes, waiting for the retailer
  | 'approved'    // distributor approved, Sales Order creation in progress
  | 'confirmed'   // Sales Order created in Ginesys ("SO Created")
  | 'processing'  // picking / invoicing
  | 'dispatched'
  | 'delivered'
  | 'rejected'    // by distributor
  | 'cancelled';  // by retailer (e.g. declined changes) or CITRUS

export type ErpSyncState = 'pending' | 'synced' | 'retrying' | 'failed';

export const RETAILER_STEPS: { key: OrderStatus; label: string }[] = [
  { key: 'placed', label: 'Order placed' },
  { key: 'review', label: 'Under review' },
  { key: 'approved', label: 'Approved' },
  { key: 'confirmed', label: 'Order confirmed' },
  { key: 'processing', label: 'Processing' },
  { key: 'dispatched', label: 'Dispatched' },
  { key: 'delivered', label: 'Delivered' },
];

export function retailerLabel(s: OrderStatus): string {
  return ({
    placed: 'Order placed', review: 'Under review', modified: 'Changes proposed', approved: 'Approved',
    confirmed: 'Order confirmed', processing: 'Processing', dispatched: 'Dispatched', delivered: 'Delivered',
    rejected: 'Rejected', cancelled: 'Cancelled',
  } as const)[s];
}

export const SIZES: Record<Category, string[]> = {
  Shirts: ['S', 'M', 'L', 'XL', 'XXL'],
  'T-shirts': ['S', 'M', 'L', 'XL', 'XXL'],
  Trousers: ['30', '32', '34', '36', '38'],
};
/** Default size ratio used by "split a total". Best-practice default, configurable per retailer later. */
export const DEFAULT_RATIO: Record<Category, number[]> = {
  Shirts: [1, 3, 3, 2, 1], 'T-shirts': [1, 3, 3, 2, 1], Trousers: [1, 3, 3, 2, 1],
};

// ---------- entities as returned by the API ----------
export interface Me {
  userId: string; role: Role; name: string; phone: string;
  retailer?: { id: string; code: string; store: string; city: string; state: string; gstin?: string; distributor: { id: string; name: string; city: string } };
  distributor?: { id: string; name: string; city: string; state: string };
  points?: number;
  /** true until the retailer accepts the data-use notice (DPDP) */
  consentRequired?: boolean;
  supportPhone?: string;
  repName?: string;
}
export interface StyleCard {
  id: string; name: string; category: Category; fit: string; fabric: string; pattern: string; kind: string;
  rate: number; mrp: number; points: number; isNew: boolean; colors: { name: string; hex: string; total: number }[];
  /** availability per colour per size, from the CITRUS Trade availability layer */
  stock: Record<string, Record<string, number>>;
  reason?: string; // recommendation reason
  /** for Complete the look: the colour of this style that goes with the piece being viewed */
  pairColor?: string;
  /** a running CITRUS scheme on this style: the trade rate after the scheme, and how it is described to retailers */
  offer?: Offer;
}
export interface Offer { rate: number; pct: number; label: string; ends?: string }
export interface Availability { styleId: string; color: string; size: string; available: number; updatedAt: string }

export interface CartLine { styleId: string; color: string; size: string; qty: number }
export interface Cart { lines: CartLine[]; note: string; po: string; updatedAt: string; version: number }

export interface OrderLine { styleId: string; name: string; color: string; size: string; qty: number; rate: number; points: number; /** as placed, before accepted changes */ origQty?: number }
export interface OrderChange { styleId: string; color: string; size: string; from: number; to: number }
export interface OrderEvent { at: string; type: string; actor: Role | 'system' | 'erp'; message: string }
export interface Order {
  id: string; number: string; retailerId: string; store: string; city: string; retailerCode?: string; owner?: string; distributorId: string; distributorName: string;
  status: OrderStatus; lines: OrderLine[]; totalQty: number; totalValue: number; totalPoints: number;
  note?: string; po?: string; reason?: string; changes?: OrderChange[]; changeReason?: string;
  erp: { reservationRef?: string; soNumber?: string; state: ErpSyncState; erpStatus?: string; awb?: string; attempts: number; lastError?: string };
  placedAt: string; updatedAt: string; events: OrderEvent[];
  /** 'NOS' (never out of stock) or the seasonal collection name; seasonal orders can be reordered only while stock lasts. */
  collection?: string;
}

// ---------- requests / responses ----------
export interface InviteInfo { store: string; city: string; code: string; maskedPhone: string; distributor: string }
export interface OtpRequest { invite?: string; phone: string }
export interface OtpRequestResult { requestId: string; expiresIn: number; resendIn: number; devCode?: string }
export interface OtpVerify { requestId: string; code: string }
export interface Session { accessToken: string; expiresIn: number; me: Me }

export interface PlaceOrderRequest { idempotencyKey: string; cartVersion: number }
/** 409 when stock changed since the cart was built. Retailer fixes the cart and retries. */
export interface StockConflict { code: 'STOCK_CHANGED'; lines: { styleId: string; color: string; size: string; requested: number; available: number }[] }

export interface DistributorDecision {
  action: 'approve' | 'modify' | 'reject';
  reason?: string;                 // required for modify and reject
  lines?: { styleId: string; color: string; size: string; qty: number }[]; // modify: new quantities (can only reduce)
}
export interface RetailerChangeDecision { action: 'accept' | 'decline' }

export interface Page<T> { items: T[]; nextCursor?: string }
export interface Facet { value: string; n: number }
export interface CataloguePage extends Page<StyleCard> {
  total: number;
  facets: { fit: Facet[]; pattern: Facet[]; color: Facet[]; size?: Facet[]; fabric?: Facet[]; price?: Facet[]; discount?: Facet[]; offer?: Facet[] };
}

export interface PastOrderCard {
  orderId: string; number: string; placedAt: string; status: OrderStatus; totalQty: number; totalValue: number;
  styles: { styleId: string; name: string; color: string; kind?: string; hex?: string }[]; moreStyles: number; inStockStyles: number; totalStyles: number;
  /** pieces from last time that could be sent again today */
  inStockQty?: number;
}
export interface Look {
  top: { style: StyleCard; color: string }; bottom: { style: StyleCard; color: string }; reason?: string;
  /** what the look was built around: something in the cart, a style the store looked at, or a past order */
  source?: 'cart' | 'viewed' | 'ordered'; anchor?: 'top' | 'bottom';
}
export interface HomeResponse {
  store: string; buyAgain: PastOrderCard[]; recommended: StyleCard[]; newStyles: StyleCard[]; looks: Look[];
  openOrders: { id: string; number: string; status: OrderStatus; totalQty: number; placedAt: string; awaitingYou: boolean }[];
  points: number; nextReward: { at: number; name: string; remaining: number } | null; tiers: typeof REWARD_TIERS;
  /** the store's own size mix per category (falls back to DEFAULT_RATIO) */
  ratios: Record<Category, number[]>;
  /** where each category's mix comes from: the store saved it, it is computed from their last 6 months of orders, or the CITRUS standard */
  ratioInfo?: Record<Category, { source: 'saved' | 'orders' | 'standard'; fromOrders: number[]; pieces: number }>;
}
export interface ReorderLineNote { styleId: string; color: string; size: string; name: string; from?: number; to?: number }
export interface ReorderPreview { orderNumber: string; placedAt: string; lines: CartLine[]; skipped: ReorderLineNote[]; reduced: ReorderLineNote[]; totalQty: number; totalValue: number }

export interface Credit { limit: number; overdue: number; overdueDays: number; asOf?: string; source: string; outstanding?: number }
export interface RetailerProfile {
  id: string; code: string; store: string; owner: string; city: string; state: string; phone: string; grade?: string; activated: boolean;
  credit?: Credit; stats: { orders90d: number; avgOrderValue: number; lastOrderAt?: string; rejected90d: number };
}

export interface AdminException { id: string; kind: string; severity: 'bad' | 'warn' | 'info'; title: string; detail: string; orderId?: string; orderNumber?: string; at: string; canRetry: boolean }
export interface AdminOverview {
  kpis: { label: string; value: string; sub: string; series?: number[]; pct?: number }[];
  topStyles: { styleId: string; name: string; qty: number }[];
  regions: { name: string; value: number; orders: number }[];
  funnel: Partial<Record<OrderStatus, number>>;
  generatedAt: string;
  live: {
    exceptions: AdminException[];
    pipeline: Partial<Record<OrderStatus, number>>;
    integration: { ginesys: 'ok' | 'degraded' | 'down'; breaker: 'open' | 'closed'; queue: { pending: number; running: number; failed: number; oldestDueSeconds: number }; stockSnapshotAgeSeconds: number | null };
  };
}
export interface LowStockRow { styleId: string; name?: string; color: string; size: string; available: number; sold30d: number }
export interface DistributorScore { id: string; name: string; city: string; state: string; orders30d: number; waiting: number; rejected30d: number; avgDecisionHours: number | null; withinSlaPct: number | null; overrides30d: number }

/** Server-sent event names on GET /api/events */
export type LiveEvent =
  | { type: 'order.updated'; order: Order }
  | { type: 'stock.updated'; items: Availability[] }
  | { type: 'points.updated'; points: number }
  | { type: 'admin.updated' }
  | { type: 'cart.updated'; cart: Cart };

export const REWARD_TIERS = [
  { at: 1000, name: 'Air fryer' }, { at: 4000, name: '₹4,000 credit note' },
  { at: 5000, name: 'Bangkok trip for two' }, { at: 10000, name: 'iPhone 18 Pro' },
];

/** Best-practice defaults, subject to CITRUS confirmation. Kept in one place so they can be changed. */
export const POLICY = {
  minOrderValue: 0,
  lowStockThreshold: 5,
  approvalSlaHours: 4,
  changeReminderHours: 24,
  otp: { ttlSeconds: 300, maxAttempts: 5, resendAfterSeconds: 30, maxPer15Min: 3, maxPerDay: 10 },
  /** units hidden per size to absorb sync lag (0 = show exact Ginesys free stock) */
  safetyBuffer: 0,
  outboxBackoffSeconds: [5, 30, 120, 600, 3600, 21600],
  /** "Reorder only for recent orders": how recent is not yet confirmed by CITRUS. */
  reorderWindowDays: 90,
  /** When product points are credited. Not yet confirmed by CITRUS. */
  pointsAwardOn: 'delivered' as 'delivered' | 'confirmed',
  rejectReasons: ['Credit limit exceeded', 'Outstanding dues', 'Duplicate order', 'Outside my territory', 'Retailer asked to cancel'],
  modifyReasons: ['Credit limit', 'Too much for this store', 'Retailer asked by phone', 'Size mix unusual'],
};

/** Scale counts per size to "pieces out of 10" (largest remainder), so a size mix reads the same for every store. */
export function mixOf10(q: number[]): number[] {
  const total = q.reduce((a, b) => a + b, 0);
  if (!total) return q.map(() => 0);
  const raw = q.map(x => (x * 10) / total), out = raw.map(Math.floor);
  let left = 10 - out.reduce((a, b) => a + b, 0);
  raw.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { out[i]++; left--; } });
  // a size the store does buy should never show as 0
  q.forEach((x, i) => { if (x > 0 && out[i] === 0) { const j = out.indexOf(Math.max(...out)); out[j]--; out[i] = 1; } });
  return out;
}

export function splitByRatio(total: number, ratio: number[], caps: number[]): number[] {
  const out = ratio.map(() => 0);
  let left = Math.min(total, caps.reduce((a, b) => a + b, 0));
  for (let guard = 0; left > 0 && guard < 20; guard++) {
    const act = ratio.map((_, i) => i).filter(i => ratio[i] > 0 && out[i] < caps[i]); // a size at 0 in the mix never gets pieces
    if (!act.length) break;
    const w = act.reduce((a, i) => a + ratio[i], 0);
    const raw = act.map(i => (left * ratio[i]) / w);
    act.forEach((i, j) => { const g = Math.min(Math.floor(raw[j]), caps[i] - out[i]); out[i] += g; left -= g; });
    const order = act.map((i, j) => ({ i, f: raw[j] - Math.floor(raw[j]) })).sort((a, b) => b.f - a.f || ratio[b.i] - ratio[a.i]);
    for (const o of order) { if (!left) break; if (out[o.i] < caps[o.i]) { out[o.i]++; left--; } }
  }
  return out;
}

/**
 * Assumptions register. Every behaviour CITRUS Trade uses that is NOT a confirmed CITRUS rule or documented
 * Ginesys behaviour is listed here, shown to admins, and must be confirmed before production.
 * kind: 'business' = best-practice default (configurable); 'erp' = adapter contract pending WFX/Ginesys docs.
 */
// ---------- Schemes (offers) ----------
// ASSUMPTION 'schemes': CITRUS runs trade schemes as a % off the trade rate for a period. The real source (Ginesys
// promotion / price list, or a CITRUS Trade schemes screen) is not confirmed; until then this deterministic sample is used.
const SCHEME_FIXED: Record<string, number> = { 'CS-1104': 10, 'CS-1105': 12, 'CT-2102': 8, 'CK-3101': 15, 'CK-3102': 10, 'CT-2104': 5 };
const SCHEME_NAMES = ['Festive scheme', 'Diwali stock-up', 'Season opener', 'Clearance on NOS'];
function hash32(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }
export function offerFor(styleId: string, rate: number): Offer | undefined {
  const h = hash32(styleId);
  const pct = SCHEME_FIXED[styleId] ?? (/^(CS-110|CT-210|CK-310)\d$/.test(styleId) ? 0 : h % 100 < 22 ? [5, 8, 10, 12, 15][h % 5] : 0);
  if (!pct) return undefined;
  return { rate: Math.round(rate * (1 - pct / 100)), pct, label: SCHEME_NAMES[h % SCHEME_NAMES.length], ends: '2026-10-31' };
}
/** Trade-rate bands used by the price filter (applied to the rate after any scheme). */
export const PRICE_BANDS: { key: string; label: string; min: number; max: number }[] = [
  { key: 'u500', label: 'Under ₹500', min: 0, max: 499 }, { key: '500-699', label: '₹500 – ₹699', min: 500, max: 699 },
  { key: '700-899', label: '₹700 – ₹899', min: 700, max: 899 }, { key: '900+', label: '₹900 and above', min: 900, max: Infinity },
];
export const DISCOUNT_STEPS = [5, 10, 15];

export const ASSUMPTIONS: { id: string; kind: 'business' | 'erp'; title: string; current: string; owner: 'Hitesh' | 'Jatin' }[] = [
  { id: 'schemes', kind: 'business', title: 'Schemes and offers', current: 'Shown as % off the trade rate until a date; sample schemes until CITRUS confirms the source', owner: 'Hitesh' },
  { id: 'moq', kind: 'business', title: 'Minimum order', current: 'No minimum order value or quantity', owner: 'Hitesh' },
  { id: 'sla', kind: 'business', title: 'Distributor approval time', current: 'Flag to CITRUS after 4 hours without a decision', owner: 'Hitesh' },
  { id: 'changes', kind: 'business', title: 'Retailer ignores suggested changes', current: 'Reminder after 24 hours, then escalate to CITRUS; never auto-cancel', owner: 'Hitesh' },
  { id: 'reorder', kind: 'business', title: 'Reorder window', current: 'Orders from the last 90 days can be reordered', owner: 'Hitesh' },
  { id: 'points', kind: 'business', title: 'Points rules and reward catalogue', current: 'Points per piece from the item master, credited on delivery; sample reward tiers', owner: 'Hitesh' },
  { id: 'ranking', kind: 'business', title: 'Catalogue ranking', current: 'Retailer’s own buying history first, then most available', owner: 'Hitesh' },
  { id: 'lowstock', kind: 'business', title: 'Low-stock message', current: '"Only N left" shown at 5 pieces or fewer per size', owner: 'Hitesh' },
  { id: 'dispatch', kind: 'business', title: 'Dispatch', current: 'Whole order dispatched together', owner: 'Hitesh' },
  { id: 'reserve', kind: 'erp', title: 'How Ginesys reserves stock at placement', current: 'Adapter calls reserve(order) at submit; stand-in models it as an unauthorised sales order', owner: 'Jatin' },
  { id: 'so', kind: 'erp', title: 'Sales Order creation after approval', current: 'Adapter calls createSalesOrder(reservation) after distributor approval', owner: 'Jatin' },
  { id: 'modify', kind: 'erp', title: 'What a distributor may change', current: 'Reduce or remove quantities only, before the SO is created', owner: 'Jatin' },
  { id: 'atp', kind: 'erp', title: 'Sellable stock (ATP) field', current: 'Free stock per SKU from a delta feed, polled every 15 seconds', owner: 'Jatin' },
  { id: 'status', kind: 'erp', title: 'Ginesys status mapping', current: 'SO created → Invoiced → Dispatched (AWB) → Delivered, polled every 10 seconds', owner: 'Jatin' },
  { id: 'credit', kind: 'erp', title: 'Credit and outstanding for distributors', current: 'Read-only lookup per retailer; never blocks an order by itself', owner: 'Jatin' },
];
