// Contract types come from @citrus/shared. This file only re-exports them and adds small helpers.
import type { Look, PastOrderCard, Page, ReorderLineNote, StyleCard } from '@citrus/shared';

export type {
  CataloguePage, Credit, Facet, HomeResponse, Look, LowStockRow, Page, PastOrderCard, ReorderLineNote, ReorderPreview, RetailerProfile,
} from '@citrus/shared';
export type HomeData = import('@citrus/shared').HomeResponse;

export const pastId = (p: PastOrderCard) => p.orderId;

export function lookPart(p: Look['top']): { style?: StyleCard; color: string } {
  return { style: p?.style, color: p?.color ?? '' };
}

export function skipText(x: ReorderLineNote): string {
  const what = `${x.name ?? x.styleId}, ${x.color}, ${x.size}`;
  if (x.from !== undefined && x.to !== undefined) return `${what}: ${x.from} → ${x.to}`;
  return what;
}

/** Older endpoints may still return a bare array. */
export function itemsOf<T>(x: T[] | Page<T> | undefined | null): T[] | undefined {
  if (!x) return undefined;
  return Array.isArray(x) ? x : x.items;
}
