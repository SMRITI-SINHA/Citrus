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
