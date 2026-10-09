// The server-side cart, edited optimistically.
// Every edit shows immediately; edits are batched (~300ms) into PUT /api/cart/lines with the cart version,
// then reconciled with the server's answer (which may cap quantities at live stock).
// Unsent edits are kept on the device, so a lost connection never loses the cart.
import { useSyncExternalStore } from 'react';
import type { Cart, CartLine, StyleCard } from '@citrus/shared';
import { api, ApiError, request } from '../lib/api';
import { avail } from './catalogue';
import { toast } from './toast';
import { live$ } from '../lib/sse';

export type LineKey = string; // styleId|color|size
export const lkey = (l: { styleId: string; color: string; size: string }) => `${l.styleId}|${l.color}|${l.size}`;
const parse = (k: LineKey) => { const [styleId, color, size] = k.split('|'); return { styleId, color, size }; };

export type SaveStatus = 'saved' | 'saving' | 'offline' | 'error';
export interface CartView {
  ready: boolean;
  lines: CartLine[];
  note: string; po: string; version: number;
  status: SaveStatus;
  /** Capped / changed notes per line key, shown inline next to the size. */
  notes: Record<LineKey, string>;
  qty: (styleId: string, color: string, size: string) => number;
  pieces: number;
}

let server: Cart | null = null;
let pending = new Map<LineKey, number>();
let inflight: Map<LineKey, number> | null = null;
let pendingMeta: { note?: string; po?: string } = {};
let inflightMeta: { note?: string; po?: string } | null = null;
let notes: Record<LineKey, string> = {};
let status: SaveStatus = 'saved';
let timer: ReturnType<typeof setTimeout> | undefined;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let busy = false;
let loadPromise: Promise<void> | null = null;
const waiters: (() => void)[] = [];

const subs = new Set<() => void>();
let view: CartView = build();
function emit() { view = build(); persist(); subs.forEach(f => f()); }

function build(): CartView {
  const m = new Map<LineKey, CartLine>();
  for (const l of server?.lines ?? []) m.set(lkey(l), { ...l });
  const over = (src: Map<LineKey, number> | null) => src?.forEach((q, k) => {
    const prev = m.get(k);
    if (prev) prev.qty = q; else m.set(k, { ...parse(k), qty: q });
  });
  over(inflight); over(pending);
  const lines = [...m.values()].filter(l => l.qty > 0);
  const lookup = new Map(lines.map(l => [lkey(l), l.qty]));
  return {
    ready: !!server,
    lines,
    note: pendingMeta.note ?? inflightMeta?.note ?? server?.note ?? '',
    po: pendingMeta.po ?? inflightMeta?.po ?? server?.po ?? '',
    version: server?.version ?? 0,
    status,
    notes: { ...notes },
    qty: (s, c, z) => lookup.get(`${s}|${c}|${z}`) ?? 0,
    pieces: lines.reduce((a, l) => a + l.qty, 0),
  };
}

const STORE = 'ct.cart.pending';
function persist() {
  try {
    const all = new Map([...(inflight ?? []), ...pending]);
    if (!all.size && !Object.keys({ ...inflightMeta, ...pendingMeta }).length) localStorage.removeItem(STORE);
    else localStorage.setItem(STORE, JSON.stringify({ lines: [...all], meta: { ...inflightMeta, ...pendingMeta } }));
  } catch { /* storage unavailable */ }
}
function restore() {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return;
    const d = JSON.parse(raw) as { lines: [LineKey, number][]; meta: { note?: string; po?: string } };
    for (const [k, q] of d.lines ?? []) if (!pending.has(k)) pending.set(k, q);
    pendingMeta = { ...d.meta, ...pendingMeta };
  } catch { /* ignore corrupt */ }
}

function schedule(ms = 300) {
  clearTimeout(timer);
  timer = setTimeout(pump, ms);
}

async function pump() {
  if (busy || !server) return;
  if (!pending.size && !Object.keys(pendingMeta).length) {
    if (status !== 'saved') { status = 'saved'; emit(); }
    waiters.splice(0).forEach(f => f());
    return;
  }
  busy = true; clearTimeout(retryTimer);
  status = 'saving'; emit();
  try {
    if (pending.size) {
      inflight = pending; pending = new Map();
      const sent = inflight;
      const lines: CartLine[] = [...sent].map(([k, qty]) => ({ ...parse(k), qty }));
      const res = await request<Cart | { cart: Cart; capped?: CappedLine[] }>('PUT', '/api/cart/lines', { lines, version: server.version });
      const body = res.body;
      const next = 'cart' in body ? body.cart : body;
      server = next;
      inflight = null;
      reconcile(sent, next, res.headers.get('x-capped'), 'cart' in body ? body.capped : undefined);
    }
    if (Object.keys(pendingMeta).length) {
      inflightMeta = pendingMeta; pendingMeta = {};
      server = await api.put<Cart>('/api/cart/meta', { ...inflightMeta, version: server!.version });
      inflightMeta = null;
    }
    status = 'saved';
  } catch (e) {
    // Put unsent edits back underneath anything typed since.
    if (inflight) { for (const [k, q] of inflight) if (!pending.has(k)) pending.set(k, q); inflight = null; }
    if (inflightMeta) { pendingMeta = { ...inflightMeta, ...pendingMeta }; inflightMeta = null; }
    if (e instanceof ApiError && e.status === 409) {
      // Someone else (another device) changed the cart: take the latest and re-apply our edits on top.
      const fresh = (e.body as { cart?: Cart } | undefined)?.cart;
      toast('Your cart was changed on another device. Your latest edits are kept on top; please review it.', { ms: 6000 });
      if (fresh) server = fresh; else try { server = await api.get<Cart>('/api/cart'); } catch { /* retry below */ }
      busy = false; emit(); schedule(0); return;
    }
    if (e instanceof ApiError && (e.isNetwork || e.status >= 500 || e.status === 0)) {
      status = 'offline';
      retryTimer = setTimeout(pump, 5000);
    } else {
      status = 'error';
      if (e instanceof ApiError && e.status === 400) { pending.clear(); try { server = await api.get<Cart>('/api/cart'); } catch { /* keep */ } }
    }
  } finally {
    busy = false;
  }
  emit();
  if (status === 'saved' && (pending.size || Object.keys(pendingMeta).length)) schedule(0);
  else waiters.splice(0).forEach(f => f());
}

type CappedLine = { styleId: string; color: string; size: string; qty?: number; available?: number; requested?: number };
function reconcile(sent: Map<LineKey, number>, cart: Cart, cappedHeader: string | null, cappedBody?: CappedLine[]) {
  const got = new Map(cart.lines.map(l => [lkey(l), l.qty]));
  const fromHeader = new Map<LineKey, number>();
  for (const c of cappedBody ?? []) fromHeader.set(lkey(c), c.available ?? c.qty ?? 0);
  if (cappedHeader && !cappedBody) {
    try {
      const arr = JSON.parse(cappedHeader) as { styleId: string; color: string; size: string; available?: number; qty?: number }[];
      for (const c of arr) fromHeader.set(lkey(c), c.available ?? c.qty ?? 0);
    } catch { /* header format not JSON: fall back to comparing quantities */ }
  }
  for (const [k, want] of sent) {
    if (pending.has(k)) continue; // user has typed again since
    const have = got.get(k) ?? 0;
    if (have < want || fromHeader.has(k)) {
      const n = fromHeader.get(k) ?? have;
      notes[k] = n === 0 ? 'Sold out just now, removed' : `Only ${n} available, set to ${n}`;
    }
  }
}

function edit(k: LineKey, q: number) {
  delete notes[k];
  pending.set(k, Math.max(0, Math.floor(q)));
}

export const cart = {
  get: () => view,
  load(force = false): Promise<void> {
    if (loadPromise && !force) return loadPromise;
    loadPromise = api.get<Cart>('/api/cart').then(c => { server = c; restore(); emit(); if (pending.size || Object.keys(pendingMeta).length) schedule(0); })
      .catch(e => { loadPromise = null; throw e; });
    return loadPromise;
  },
  /** Set an absolute quantity, capped at live stock when the style is known. Returns the quantity set. */
  set(styleId: string, color: string, size: string, qty: number, style?: StyleCard): number {
    const k = `${styleId}|${color}|${size}`;
    let q = Math.max(0, Math.floor(qty || 0));
    if (style) { const n = avail(style, color, size); if (q > n) { q = n; edit(k, q); notes[k] = n === 0 ? 'Out of stock' : `Only ${n} available, set to ${n}`; emit(); schedule(); return q; } }
    edit(k, q); emit(); schedule();
    return q;
  },
  /** Set many at once (e.g. remove a style, move colours, undo). */
  setMany(lines: CartLine[]) { for (const l of lines) edit(lkey(l), l.qty); emit(); schedule(); },
  /** Add quantities to what is already in the cart, capped at stock. Returns pieces actually added and sizes capped. */
  add(lines: CartLine[], styles: Record<string, StyleCard | undefined>) {
    let added = 0, capped = 0;
    for (const l of lines) {
      if (!l.qty) continue;
      const cur = view.qty(l.styleId, l.color, l.size);
      const s = styles[l.styleId];
      const cap = s ? avail(s, l.color, l.size) : Infinity;
      const next = Math.min(cur + l.qty, cap);
      if (next < cur + l.qty) capped++;
      added += Math.max(0, next - cur);
      edit(lkey(l), next);
      view = build();
    }
    emit(); schedule();
    return { added, capped };
  },
  setMeta(meta: { note?: string; po?: string }) { pendingMeta = { ...pendingMeta, ...meta }; emit(); schedule(600); },
  clearNote(k: LineKey) { delete notes[k]; emit(); },
  /** Send everything now and resolve with the confirmed server cart. */
  async flush(): Promise<Cart> {
    if (!server) await cart.load();
    clearTimeout(timer);
    if (pending.size || Object.keys(pendingMeta).length || busy) {
      const done = new Promise<void>(r => waiters.push(r));
      pump();
      await Promise.race([done, new Promise<void>((_, rej) => setTimeout(() => rej(new ApiError('NETWORK', 'Could not save your cart. Check your connection.', 0)), 15000))]);
    }
    if (status === 'offline') throw new ApiError('NETWORK', 'No connection. Your cart is saved on this phone.', 0);
    if (status === 'error') throw new ApiError('CART_SAVE', 'Some cart changes could not be saved. Please check the cart and try again.', 0);
    return server!;
  },
  /** Replace with a server cart returned by another endpoint (reorder, place order). */
  replace(c: Cart) { server = c; pending.clear(); notes = {}; emit(); },
  reset() { server = null; pending.clear(); inflight = null; pendingMeta = {}; notes = {}; status = 'saved'; loadPromise = null; emit(); },
};

// Another device (or a reorder) changed the cart: take the newer server copy; unsent local edits stay on top.
live$.on(e => {
  if (e.type !== 'cart.updated' || !server || e.cart.version <= server.version || busy) return;
  server = e.cart; emit();
});

if (typeof window !== 'undefined') window.addEventListener('online', () => { if (status === 'offline') pump(); });

export function useCart(): CartView {
  return useSyncExternalStore(f => { subs.add(f); return () => { subs.delete(f); }; }, () => view);
}
