// Catalogue at CITRUS scale (thousands of styles, ~70k SKUs): the item master lives in memory on each API instance
// (a few MB, refreshed every 5 minutes), filtering and sorting run against it plus per-style stock totals, and
// per-size stock is only fetched for the page being returned. Nothing unbounded ever reaches the browser.
import type { StyleCard, Category } from '@citrus/shared';
import { DISCOUNT_STEPS, offerFor, PRICE_BANDS, SIZES } from '@citrus/shared';
import { db } from '../db/knex.ts';
import { redis } from '../lib/redis.ts';
import { stockFor, styleTotals } from './stock.ts';

export interface StyleRow {
  id: string; name: string; category: Category; kind: string; fit: string; pattern: string; fabric: string;
  rate: number; mrp: number; points: number; isNew: boolean; rank: number; colors: { name: string; hex: string }[]; hay: string;
}
interface Master { at: number; list: StyleRow[]; byId: Map<string, StyleRow> }
let master: Master | null = null;
let loading: Promise<Master> | null = null;

export async function styles(): Promise<Master> {
  if (master && Date.now() - master.at < 300_000) return master;
  if (loading) return master ?? loading; // serve stale while one refresh runs (no thundering herd)
  loading = (async (): Promise<Master> => {
    const rows = await db('styles').where({ active: true }).orderBy('rank');
    const cols = await db('style_colors').orderBy(['style_id', 'position']);
    const byStyle = new Map<string, { name: string; hex: string }[]>();
    for (const c of cols) { const a = byStyle.get(c.style_id) ?? []; a.push({ name: c.color, hex: c.hex }); byStyle.set(c.style_id, a); }
    const list: StyleRow[] = rows.map((r: any) => {
      const colors = byStyle.get(r.id) ?? [];
      return {
        id: r.id, name: r.name, category: r.category, kind: r.kind, fit: r.fit, pattern: r.pattern, fabric: r.fabric,
        rate: Number(r.rate), mrp: Number(r.mrp), points: Number(r.points), isNew: r.is_new === true || Number(r.is_new) === 1, rank: Number(r.rank),
        colors, hay: `${r.id} ${r.name} ${r.category} ${r.fit} ${r.pattern} ${r.fabric} ${r.kind} ${colors.map(c => c.name).join(' ')}`.toLowerCase(),
      };
    });
    const m: Master = { at: Date.now(), list, byId: new Map(list.map(s => [s.id, s])) };
    master = m;
    return m;
  })().finally(() => { loading = null; });
  return master ?? loading;
}
export const invalidateMaster = () => { if (master) master.at = 0; };

export async function cards(list: StyleRow[], reasons: Record<string, string> = {}): Promise<StyleCard[]> {
  if (!list.length) return [];
  const st = await stockFor(list.map(s => s.id));
  return list.map(s => {
    const stock: Record<string, Record<string, number>> = {};
    for (const c of s.colors) stock[c.name] = Object.fromEntries(SIZES[s.category].map(z => [z, st[s.id]?.[`${c.name}|${z}`] ?? 0]));
    return {
      id: s.id, name: s.name, category: s.category, fit: s.fit, fabric: s.fabric, pattern: s.pattern, kind: s.kind,
      rate: s.rate, mrp: s.mrp, points: s.points, isNew: s.isNew,
      colors: s.colors.map(c => ({ ...c, total: Object.values(stock[c.name]).reduce((a, b) => a + b, 0) })),
      stock, reason: reasons[s.id], offer: offerFor(s.id, s.rate),
    };
  });
}

// Hindi/Hinglish and trade-slang tolerant search terms. Retailers type the way they speak on the phone.
const SYN: Record<string, string> = {
  pant: 'trouser', pants: 'trouser', patloon: 'trouser', jeans: 'denim', tshirt: 't-shirt', 'tee': 't-shirt', tees: 't-shirt', banian: 't-shirt',
  kurta: 'mandarin', chinos: 'chino', shirts: 'shirt', kameez: 'shirt', formals: 'formal', checks: 'check', lines: 'stripe', lining: 'stripe',
  safed: 'white', sufaid: 'white', kala: 'black', kaala: 'black', neela: 'blue', nila: 'blue', laal: 'maroon', lal: 'maroon', hara: 'olive', bhura: 'khaki',
  slimfit: 'slim', linen: 'linen', 'कमीज': 'shirt', 'शर्ट': 'shirt', 'पैंट': 'trouser', 'जींस': 'denim', 'सफेद': 'white', 'काला': 'black', 'नीला': 'blue',
};
const norm = (t: string) => SYN[t] ?? (t.endsWith('s') && t.length > 3 ? t.slice(0, -1) : t);

export interface CatalogueQuery { category?: string; q?: string; fit?: string; pattern?: string; color?: string; inStock?: string; sort?: string; cursor?: string; limit?: string; isNew?: string; size?: string; fabric?: string; price?: string; discount?: string; offer?: string }

export async function catalogue(qs: CatalogueQuery, affinity: Record<string, number>) {
  const { list } = await styles();
  const totals = await styleTotals();
  let items = list;
  const q = (qs.q ?? '').trim().toLowerCase();
  if (q) {
    const terms = q.split(/\s+/).map(norm);
    items = items.filter(s => terms.every(t => s.hay.includes(t)));
  }
  if (qs.category) items = items.filter(s => s.category === qs.category);
  if (qs.isNew === '1') items = items.filter(s => s.isNew);
  // facets before the attribute filters so a retailer can always widen again
  const csv = (v?: string) => (v ? v.split(',').filter(Boolean) : []);
  const fits = csv(qs.fit), pats = csv(qs.pattern), cols = csv(qs.color), fabs = csv(qs.fabric), bands = csv(qs.price), sizes = csv(qs.size);
  const minPct = Number(qs.discount) || 0;
  const eff = (s: StyleRow) => offerFor(s.id, s.rate)?.rate ?? s.rate;
  const pct = (s: StyleRow) => offerFor(s.id, s.rate)?.pct ?? 0;
  const bandOf = (s: StyleRow) => PRICE_BANDS.find(b => eff(s) >= b.min && eff(s) <= b.max)?.key ?? '';
  if (fits.length) items = items.filter(s => fits.includes(s.fit));
  if (pats.length) items = items.filter(s => pats.includes(s.pattern));
  if (cols.length) items = items.filter(s => s.colors.some(c => cols.includes(c.name)));
  if (fabs.length) items = items.filter(s => fabs.includes(s.fabric));
  if (bands.length) items = items.filter(s => bands.includes(bandOf(s)));
  if (qs.offer === '1') items = items.filter(s => pct(s) > 0);
  if (minPct) items = items.filter(s => pct(s) >= minPct);
  if (qs.inStock === '1') items = items.filter(s => (totals[s.id] ?? 0) > 0);
  // sizes in stock: only for the styles still in play, so the per-size lookup stays bounded by the other filters
  let inSizes: Record<string, string[]> = {};
  if (sizes.length || items.length <= 400) {
    const st = await stockFor(items.map(s => s.id));
    inSizes = Object.fromEntries(items.map(s => [s.id, [...new Set(Object.entries(st[s.id] ?? {}).filter(([, n]) => n > 0).map(([k]) => k.split('|')[1]))]]));
    if (sizes.length) items = items.filter(s => (inSizes[s.id] ?? []).some(z => sizes.includes(z)));
  }
  const order = (vals: string[]) => (f: { value: string }) => vals.indexOf(f.value);
  const facets = {
    fit: count(items, s => [s.fit]), pattern: count(items, s => [s.pattern]), color: count(items, s => s.colors.map(c => c.name)), fabric: count(items, s => [s.fabric]),
    size: Object.keys(inSizes).length ? count(items, s => inSizes[s.id] ?? []).sort((a, b) => sizeRank(a.value) - sizeRank(b.value)) : [],
    price: count(items, s => [bandOf(s)]).sort((a, b) => order(PRICE_BANDS.map(x => x.key))(a) - order(PRICE_BANDS.map(x => x.key))(b)),
    discount: DISCOUNT_STEPS.map(d => ({ value: String(d), n: items.filter(s => pct(s) >= d).length })),
    offer: [{ value: '1', n: items.filter(s => pct(s) > 0).length }],
  };
  const sort = qs.sort ?? 'best';
  const t = (s: StyleRow) => totals[s.id] ?? 0;
  const sorted = items.slice();
  // 'best' (ASSUMPTION 'ranking'): the retailer's own history first, then sellable, then most available.
  if (sort === 'avail') sorted.sort((a, b) => t(b) - t(a));
  else if (sort === 'new') sorted.sort((a, b) => Number(b.isNew) - Number(a.isNew) || a.rank - b.rank);
  else if (sort === 'points') sorted.sort((a, b) => b.points - a.points || t(b) - t(a));
  else if (sort === 'offer') sorted.sort((a, b) => pct(b) - pct(a) || t(b) - t(a));
  else if (sort === 'price') sorted.sort((a, b) => eff(a) - eff(b));
  else sorted.sort((a, b) => (affinity[b.id] ?? 0) - (affinity[a.id] ?? 0) || Number(t(b) > 0) - Number(t(a) > 0) || a.rank - b.rank);
  const limit = Math.max(1, Math.min(Number(qs.limit ?? 24) || 24, 60));
  const start = qs.cursor ? Math.max(0, Number(Buffer.from(qs.cursor, 'base64url').toString()) || 0) : 0;
  const page = sorted.slice(start, start + limit);
  const next = start + limit < sorted.length ? Buffer.from(String(start + limit)).toString('base64url') : undefined;
  return { items: await cards(page), nextCursor: next, total: sorted.length, facets };
}

const SIZE_ORDER = ['S', 'M', 'L', 'XL', 'XXL', '28', '30', '32', '34', '36', '38', '40', '42', '44'];
const sizeRank = (z: string) => { const i = SIZE_ORDER.indexOf(z); return i < 0 ? 99 : i; };

function count(items: StyleRow[], f: (s: StyleRow) => string[]) {
  const m = new Map<string, number>();
  for (const s of items) for (const v of new Set(f(s))) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([value, n]) => ({ value, n }));
}

/** Per-retailer affinity (pieces bought per style in the last 180 days), cached 10 minutes. */
export async function affinityFor(retailerId: string): Promise<Record<string, number>> {
  const k = `aff:${retailerId}`;
  const hit = await redis.get(k);
  if (hit) return JSON.parse(hit);
  const rows = await db('order_lines as l').join('orders as o', 'o.id', 'l.order_id')
    .where('o.retailer_id', retailerId).where('o.placed_at', '>', new Date(Date.now() - 180 * 86_400_000))
    .whereNotIn('o.status', ['rejected', 'cancelled']).groupBy('l.style_id').select('l.style_id').sum({ q: 'l.qty' });
  const out = Object.fromEntries(rows.map((r: any) => [r.style_id, Number(r.q)]));
  await redis.set(k, JSON.stringify(out), 'EX', 600);
  return out;
}
export const dropAffinity = (retailerId: string) => redis.del(`aff:${retailerId}`);

export async function styleCard(id: string) {
  const { byId } = await styles();
  const s = byId.get(id);
  return s ? (await cards([s]))[0] : undefined;
}
