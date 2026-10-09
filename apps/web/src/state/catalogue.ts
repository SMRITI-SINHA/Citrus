// Style cards and live stock. Stock updates from SSE overlay the cached StyleCard numbers,
// so every tile, size grid and cart cell shows the same live figure.
import { useSyncExternalStore } from 'react';
import type { Availability, Category, HomeResponse, Order, StyleCard } from '@citrus/shared';
import { DEFAULT_RATIO, POLICY, SIZES } from '@citrus/shared';
import { getCached, setCached, useQuery } from '../lib/query';
import { api } from '../lib/api';
import { live$ } from '../lib/sse';
import type { GarmentSpec } from '../components/Garment';

const overrides = new Map<string, number>();
let stockVer = 0;
const subs = new Set<() => void>();
const k3 = (s: string, c: string, z: string) => `${s}|${c}|${z}`;

export function applyStock(items: Pick<Availability, 'styleId' | 'color' | 'size' | 'available'>[]) {
  if (!items.length) return;
  for (const i of items) overrides.set(k3(i.styleId, i.color, i.size), Math.max(0, i.available));
  stockVer++;
  subs.forEach(f => f());
}
live$.on(e => { if (e.type === 'stock.updated') applyStock(e.items); });

/** Re-render when live stock changes. */
export function useStockVersion() {
  return useSyncExternalStore(f => { subs.add(f); return () => { subs.delete(f); }; }, () => stockVer);
}

export const sizesOf = (s: Pick<StyleCard, 'category'>) => SIZES[s.category as Category] ?? Object.keys({});
/** The store's own size mix for the category (from /api/home), else the CITRUS default. */
export const ratioOf = (s: Pick<StyleCard, 'category'>) => {
  const own = getCached<HomeResponse>('/api/home')?.ratios?.[s.category as Category];
  return own && own.some(n => n > 0) ? own : DEFAULT_RATIO[s.category as Category] ?? [1, 3, 3, 2, 1];
};
/** True when the ratio comes from this store's own orders. */
export const ownRatio = (s: Pick<StyleCard, 'category'>) => {
  const own = getCached<HomeResponse>('/api/home')?.ratios?.[s.category as Category];
  return !!own && own.join(':') !== (DEFAULT_RATIO[s.category as Category] ?? []).join(':');
};
export const LOW = POLICY.lowStockThreshold;

export function avail(s: StyleCard, color: string, size: string): number {
  const o = overrides.get(k3(s.id, color, size));
  if (o !== undefined) return o;
  return s.stock?.[color]?.[size] ?? 0;
}
export function colorTotal(s: StyleCard, color: string) {
  return sizesOf(s).reduce((a, z) => a + avail(s, color, z), 0);
}
export function hexOf(s: StyleCard | undefined, color: string) {
  return s?.colors.find(c => c.name === color)?.hex ?? '#8C919A';
}
export function spec(s: StyleCard | undefined, color: string): GarmentSpec {
  return { kind: s?.kind ?? 'shirt', pattern: s?.pattern ?? 'Solid', fit: s?.fit ?? 'Regular', hex: hexOf(s, color), name: s?.name, color, fabric: s?.fabric, styleId: s?.id };
}

/** Seed the per-style cache from list responses so the product page opens instantly. */
export function seedStyles(list: StyleCard[] | undefined) {
  if (!list) return;
  for (const s of list) if (!getCached(`/api/styles/${s.id}`)) setCached(`/api/styles/${s.id}`, s);
}

export function useStyle(id: string | undefined) {
  return useQuery<StyleCard>(id ? `/api/styles/${encodeURIComponent(id)}` : null, { staleMs: 30_000 });
}

/** Load many styles (for cart lines and orders). Returns a lookup; missing ones load in the background. */
export function useStyles(idList: string[]): Record<string, StyleCard | undefined> {
  const ids = [...new Set(idList)].sort();
  const key = ids.length ? `styles:${ids.join(',')}` : null;
  useQuery<StyleCard[]>(key, {
    staleMs: 30_000,
    fetcher: async () => {
      const out = await Promise.all(ids.map(id => {
        const c = getCached<StyleCard>(`/api/styles/${id}`);
        return c ? Promise.resolve(c) : api.get<StyleCard>(`/api/styles/${encodeURIComponent(id)}`).then(s => { setCached(`/api/styles/${id}`, s); return s; }).catch(() => undefined);
      }));
      return out.filter(Boolean) as StyleCard[];
    },
  });
  useStockVersion();
  const map: Record<string, StyleCard | undefined> = {};
  for (const id of ids) map[id] = getCached<StyleCard>(`/api/styles/${id}`);
  return map;
}

/** What this store bought last time for a style-colour, per size, from their CITRUS Trade orders. */
export function lastOrderFor(orders: Order[] | undefined, styleId: string, color: string) {
  if (!orders) return null;
  const sorted = [...orders].filter(o => o.status !== 'cancelled' && o.status !== 'rejected').sort((a, b) => b.placedAt.localeCompare(a.placedAt));
  for (const o of sorted) {
    const ls = o.lines.filter(l => l.styleId === styleId && l.color === color);
    if (ls.length) return { number: o.number, placedAt: o.placedAt, q: Object.fromEntries(ls.map(l => [l.size, l.qty])) as Record<string, number> };
  }
  return null;
}
