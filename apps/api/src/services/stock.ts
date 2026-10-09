// Availability layer: a near-live copy of Ginesys free stock in the DB (durable) and Redis (fast reads).
// Reads never hit Ginesys. Writes come from the stock delta feed and from our own order transactions.
import type { Knex } from 'knex';
import type { Availability } from '@citrus/shared';
import { POLICY } from '@citrus/shared';
import { db } from '../db/knex.ts';
import { redis } from '../lib/redis.ts';
import { erp, unsku } from '../adapters/ginesys.ts';
import { publish } from '../lib/bus.ts';
import { config } from '../config.ts';

const key = (styleId: string) => `av:${styleId}`;
const shown = (n: number) => Math.max(0, n - POLICY.safetyBuffer);

/** Map of "color|size" -> available, for many styles in one round trip. Falls back to the DB on a cold cache. */
export async function stockFor(styleIds: string[]): Promise<Record<string, Record<string, number>>> {
  const pipe = redis.pipeline();
  for (const id of styleIds) pipe.hgetall(key(id));
  const res = (await pipe.exec()) ?? [];
  const out: Record<string, Record<string, number>> = {};
  const missing: string[] = [];
  styleIds.forEach((id, i) => {
    const h = (res[i]?.[1] ?? {}) as Record<string, string>;
    if (!Object.keys(h).length) { missing.push(id); return; }
    out[id] = Object.fromEntries(Object.entries(h).map(([k, v]) => [k, shown(Number(v))]));
  });
  if (missing.length) {
    const rows = await db('availability').whereIn('style_id', missing);
    const fill: Record<string, Record<string, string>> = {};
    for (const r of rows) {
      (out[r.style_id] ??= {})[`${r.color}|${r.size}`] = shown(Number(r.available));
      (fill[r.style_id] ??= {})[`${r.color}|${r.size}`] = String(r.available);
    }
    const p = redis.pipeline(); for (const [id, h] of Object.entries(fill)) p.hset(key(id), h); await p.exec();
  }
  return out;
}

export async function availableOf(styleId: string, color: string, size: string) {
  const m = await stockFor([styleId]); return m[styleId]?.[`${color}|${size}`] ?? 0;
}

/** Apply absolute quantities (from Ginesys or from our own transaction) to DB + cache and broadcast. */
export async function setAvailability(items: { styleId: string; color: string; size: string; available: number }[], trx?: Knex.Transaction, broadcast = true) {
  if (!items.length) return;
  const q = trx ?? db;
  const now = new Date();
  for (const it of items) {
    const n = await q('availability').where({ style_id: it.styleId, color: it.color, size: it.size }).update({ available: it.available, updated_at: now });
    if (!n) await q('availability').insert({ style_id: it.styleId, color: it.color, size: it.size, available: it.available, updated_at: now });
  }
  const write = async () => {
    const p = redis.pipeline();
    for (const it of items) p.hset(key(it.styleId), `${it.color}|${it.size}`, String(it.available));
    await p.exec();
    await refreshTotals([...new Set(items.map(i => i.styleId))]);
    if (broadcast) await publish({ all: true }, { type: 'stock.updated', items: items.map(i => ({ ...i, available: shown(i.available), updatedAt: now.toISOString() })) as Availability[] });
  };
  if (trx) trx.executionPromise.then(write).catch(() => {}); else await write();
}

/**
 * Apply a Ginesys inventory snapshot (site.inventory.allitem.refresh). Ginesys documents full snapshots only, so:
 * available = snapshot free qty − our reservations Ginesys had not made yet when the snapshot was generated.
 * Conservative by design: when in doubt it shows less, never more; the next snapshot corrects it.
 */
export async function applySnapshot(url: string) {
  const snap = await erp.snapshot(url);
  const T = new Date(snap.generatedAt);
  const cur = await db('sync_cursors').where({ name: 'stock' }).first();
  if (cur && new Date(cur.cursor).getTime() >= T.getTime()) return { applied: 0, skipped: 'older than current' };
  const t0 = new Date();
  const pendingAdj = await reservedAfter(T);
  const current = new Map<string, number>();
  for (const r of await db('availability').select('style_id', 'color', 'size', 'available')) current.set(`${r.style_id}|${r.color}|${r.size}`, Number(r.available));
  const changed: { styleId: string; color: string; size: string; available: number }[] = [];
  for (const i of snap.items) {
    const v = Math.max(0, i.qty - (pendingAdj.get(i.sku) ?? 0));
    if (current.get(i.sku) !== v) changed.push({ ...unsku(i.sku), available: v });
  }
  await bulkSet(changed);
  // Orders placed while we were applying may have been overwritten: subtract them again (worst case: shows a little less).
  const late = await reservedAfter(t0, true);
  if (late.size) for (const [k, q] of late) { const { styleId, color, size } = unsku(k); await db('availability').where({ style_id: styleId, color, size }).update({ available: db.raw('GREATEST(available - ?, 0)', [q]) }); }
  const touched = [...new Set([...changed.map(c => c.styleId), ...[...late.keys()].map(k => unsku(k).styleId)])];
  await reloadStyles(touched);
  if (cur) await db('sync_cursors').where({ name: 'stock' }).update({ cursor: T.toISOString(), updated_at: new Date() });
  else await db('sync_cursors').insert({ name: 'stock', cursor: T.toISOString(), updated_at: new Date() });
  for (let i = 0; i < changed.length; i += 500)
    await publish({ all: true }, { type: 'stock.updated', items: changed.slice(i, i + 500).map(c => ({ ...c, available: shown(c.available), updatedAt: new Date().toISOString() })) });
  return { applied: changed.length, total: snap.items.length, generatedAt: T.toISOString() };
}

/** sku -> qty held by our orders that Ginesys had not reserved at time T (or created after T when byCreation). */
async function reservedAfter(T: Date, byCreation = false) {
  const q = db('order_lines as l').join('orders as o', 'o.id', 'l.order_id').whereNotIn('o.status', ['rejected', 'cancelled'])
    .select('l.style_id', 'l.color', 'l.size').sum({ q: 'l.qty' }).groupBy('l.style_id', 'l.color', 'l.size');
  if (byCreation) q.where('o.placed_at', '>=', T);
  else q.where(b => b.where('o.reserved_at', '>', T).orWhere(w => w.whereNull('o.reserved_at').where('o.status', 'placed')));
  const m = new Map<string, number>();
  for (const r of (await q) as any[]) m.set(`${r.style_id}|${r.color}|${r.size}`, Number(r.q));
  return m;
}

/** Bulk upsert (initial load and snapshots). Postgres uses ON CONFLICT; Oracle falls back to row updates (MERGE later). */
export async function bulkSet(items: { styleId: string; color: string; size: string; available: number }[]) {
  const now = new Date();
  for (let i = 0; i < items.length; i += 1000) {
    const rows = items.slice(i, i + 1000).map(it => ({ style_id: it.styleId, color: it.color, size: it.size, available: it.available, updated_at: now }));
    if (config.dbClient === 'pg') await db('availability').insert(rows).onConflict(['style_id', 'color', 'size']).merge(['available', 'updated_at']);
    else for (const r of rows) { const n = await db('availability').where({ style_id: r.style_id, color: r.color, size: r.size }).update(r); if (!n) await db('availability').insert(r); }
  }
}

/** Re-read some styles from the DB into Redis (after bulk changes). */
async function reloadStyles(ids: string[]) {
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const rows = await db('availability').whereIn('style_id', chunk);
    const by: Record<string, Record<string, string>> = {};
    for (const r of rows) (by[r.style_id] ??= {})[`${r.color}|${r.size}`] = String(r.available);
    const p = redis.pipeline(); for (const [id, h] of Object.entries(by)) p.hset(key(id), h); await p.exec();
    await refreshTotals(chunk);
  }
}

export async function stockSyncAgeSeconds() {
  const cur = await db('sync_cursors').where({ name: 'stock' }).first();
  return cur ? Math.round((Date.now() - new Date(cur.updated_at).getTime()) / 1000) : null;
}

// Per-style totals power "in stock only" and "most available" across thousands of styles without reading every SKU.
const TOT = 'av:tot';
let totCache: { at: number; m: Record<string, number> } | null = null;

async function refreshTotals(styleIds: string[]) {
  for (let i = 0; i < styleIds.length; i += 500) {
    const chunk = styleIds.slice(i, i + 500);
    const p = redis.pipeline(); for (const id of chunk) p.hvals(key(id));
    const res = (await p.exec()) ?? [];
    const w = redis.pipeline();
    chunk.forEach((id, j) => w.hset(TOT, id, String(((res[j]?.[1] ?? []) as string[]).reduce((a, v) => a + shown(Number(v)), 0))));
    await w.exec();
  }
  totCache = null;
}

/** styleId -> total sellable pieces. Cached in-process for 3 s; rebuilt from the DB if Redis was flushed. */
export async function styleTotals(): Promise<Record<string, number>> {
  if (totCache && Date.now() - totCache.at < 3000) return totCache.m;
  let h = await redis.hgetall(TOT);
  if (!Object.keys(h).length) {
    await warmCache();
    h = await redis.hgetall(TOT);
  }
  const m = Object.fromEntries(Object.entries(h).map(([k, v]) => [k, Number(v)]));
  totCache = { at: Date.now(), m };
  return m;
}

/** Load the whole availability table into Redis (startup, or after a Redis restart). */
export async function warmCache() {
  const rows = await db('availability').select('style_id', 'color', 'size', 'available');
  const byStyle: Record<string, Record<string, string>> = {};
  for (const r of rows) (byStyle[r.style_id] ??= {})[`${r.color}|${r.size}`] = String(r.available);
  const ids = Object.keys(byStyle);
  for (let i = 0; i < ids.length; i += 500) {
    const p = redis.pipeline();
    for (const id of ids.slice(i, i + 500)) { p.del(key(id)); p.hset(key(id), byStyle[id]); p.hset(TOT, id, String(Object.values(byStyle[id]).reduce((a, v) => a + shown(Number(v)), 0))); }
    await p.exec();
  }
  totCache = null;
  return rows.length;
}
