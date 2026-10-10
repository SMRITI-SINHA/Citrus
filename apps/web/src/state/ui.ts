// Small shared UI state: quantity drafts per style-colour (shared by product page and quick add) and the quick-add sheet.
import { useSyncExternalStore } from 'react';

type Draft = Record<string, number>;
const drafts = new Map<string, Draft>();
let ver = 0;
const subs = new Set<() => void>();
const emit = () => { ver++; subs.forEach(f => f()); };
const sub = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

export const draft = {
  get: (styleId: string, color: string): Draft => drafts.get(`${styleId}|${color}`) ?? {},
  set(styleId: string, color: string, d: Draft) { drafts.set(`${styleId}|${color}`, d); emit(); },
  clear(styleId: string, color: string) { drafts.delete(`${styleId}|${color}`); emit(); },
};
export function useDraft(styleId: string, color: string): Draft {
  useSyncExternalStore(sub, () => ver);
  return draft.get(styleId, color);
}

export interface QuickState { styleId: string; color: string; mode: 'add' | 'edit' }
let quick: QuickState | null = null;
const qsubs = new Set<() => void>();
export const quickAdd = {
  open(s: QuickState) { quick = s; qsubs.forEach(f => f()); },
  close() { quick = null; qsubs.forEach(f => f()); },
  setColor(color: string) { if (quick) { quick = { ...quick, color }; qsubs.forEach(f => f()); } },
};
export function useQuick() {
  return useSyncExternalStore(f => { qsubs.add(f); return () => { qsubs.delete(f); }; }, () => quick);
}

// Sizes where the store typed more than is in stock. We never lower a typed number silently:
// the box turns red, says how many are available, and Add / Place order stay off until the store fixes it.
const over = new Map<string, number>(); // `${scope}|${styleId}|${color}|${size}` -> typed qty
let overVer = 0;
const osubs = new Set<() => void>();
const oemit = () => { overVer++; osubs.forEach(f => f()); };
export const overStock = {
  set(key: string, typed: number | null) {
    if (typed === null) { if (over.delete(key)) oemit(); } else if (over.get(key) !== typed) { over.set(key, typed); oemit(); }
  },
  /** Number of sizes over stock whose key starts with prefix (e.g. "draft|CS-1101|Olive|" or "cart|"). */
  count: (prefix: string) => [...over.keys()].filter(k => k.startsWith(prefix)).length,
  clear(prefix: string) { let ch = false; for (const k of [...over.keys()]) if (k.startsWith(prefix)) { over.delete(k); ch = true; } if (ch) oemit(); },
};
export function useOverCount(prefix: string) {
  useSyncExternalStore(f => { osubs.add(f); return () => { osubs.delete(f); }; }, () => overVer);
  return overStock.count(prefix);
}
