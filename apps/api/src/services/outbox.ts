// Transactional outbox. Every ERP call and every message is written in the same DB transaction as the state change
// that causes it, then executed: immediately in-process for low latency (runNow), and by the worker as the safety net
// (crash, timeout, Ginesys down). Rows are claimed with a lease so several API instances can run workers safely.
import type { Knex } from 'knex';
import { POLICY } from '@citrus/shared';
import { db } from '../db/knex.ts';
import { config } from '../config.ts';
import { uid } from '../lib/ids.ts';
import { ErpError } from '../adapters/ginesys.ts';
import { raiseException } from './exceptions.ts';
import { log } from '../lib/log.ts';

export type Outcome = { ok: true; data?: any } | { retry: string } | { fail: string; data?: any };
export interface Row { id: string; topic: string; payload: string; attempts: number; ref: string | null; request_id: string | null }
type Handler = (payload: any, row: Row, ctx: RunCtx) => Promise<Outcome>;
export interface RunCtx { interactive: boolean }
const handlers: Record<string, { run: Handler; giveUp?: (payload: any, row: Row, err: string) => Promise<void> }> = {};

export function register(topic: string, run: Handler, giveUp?: (payload: any, row: Row, err: string) => Promise<void>) { handlers[topic] = { run, giveUp }; }

/** Write an outbox row inside the caller's transaction. delaySeconds > 0 means "the caller will try it now; worker only if that fails". */
export async function enqueue(trx: Knex | Knex.Transaction, topic: string, payload: unknown, ref?: string, delaySeconds = 0, requestId?: string) {
  const id = uid();
  await trx('outbox').insert({
    id, topic, payload: JSON.stringify(payload), status: 'pending', attempts: 0, ref: ref ?? null, request_id: requestId ?? null,
    next_at: new Date(Date.now() + delaySeconds * 1000), created_at: new Date(),
  });
  return id;
}

const LEASE_S = 60;
async function claimById(id: string): Promise<Row | undefined> {
  const n = await db('outbox').where({ id, status: 'pending' }).update({ status: 'running', next_at: new Date(Date.now() + LEASE_S * 1000) });
  return n ? db('outbox').where({ id }).first() : undefined;
}

/** Claim due rows. FOR UPDATE SKIP LOCKED lets several workers share the queue without double-processing. */
async function claimDue(max = 25): Promise<Row[]> {
  return db.transaction(async trx => {
    let q = trx('outbox').whereIn('status', ['pending', 'running']).where('next_at', '<=', new Date()).forUpdate().skipLocked();
    // Oracle cannot combine FOR UPDATE with ROWNUM/FETCH FIRST; there the batch is bounded by next_at instead.
    if (config.dbClient === 'pg') q = q.orderBy('next_at').limit(max);
    const rows: Row[] = await q.select('*');
    if (rows.length) await trx('outbox').whereIn('id', rows.map(r => r.id)).update({ status: 'running', next_at: new Date(Date.now() + LEASE_S * 1000) });
    return rows;
  });
}

async function execute(row: Row, ctx: RunCtx = { interactive: false }): Promise<Outcome> {
  const h = handlers[row.topic];
  let out: Outcome;
  const started = Date.now();
  try {
    if (!h) throw new Error(`No handler for ${row.topic}`);
    out = await h.run(JSON.parse(row.payload), row, ctx);
  } catch (e: any) {
    out = e instanceof ErpError && e.kind === 'unavailable' ? { retry: e.message } : { fail: String(e?.message ?? e).slice(0, 290) };
  }
  log.info({ outbox: row.id, topic: row.topic, ref: row.ref, requestId: row.request_id, ms: Date.now() - started, outcome: 'ok' in out ? 'ok' : 'retry' in out ? 'retry' : 'fail' }, 'outbox');
  if ('ok' in out) {
    await db('outbox').where({ id: row.id }).update({ status: 'done', done_at: new Date(), last_error: null });
  } else if ('retry' in out) {
    const attempts = row.attempts + 1;
    const backoff = POLICY.outboxBackoffSeconds;
    if (attempts > backoff.length) {
      await db('outbox').where({ id: row.id }).update({ status: 'failed', attempts, last_error: out.retry.slice(0, 290) });
      await h?.giveUp?.(JSON.parse(row.payload), row, out.retry);
    } else {
      await db('outbox').where({ id: row.id }).update({ status: 'pending', attempts, last_error: out.retry.slice(0, 290), next_at: new Date(Date.now() + backoff[attempts - 1] * 1000) });
    }
  } else {
    await db('outbox').where({ id: row.id }).update({ status: 'failed', attempts: row.attempts + 1, last_error: out.fail.slice(0, 290) });
    await h?.giveUp?.(JSON.parse(row.payload), row, out.fail);
  }
  return out;
}

/**
 * Run one row now and wait up to waitMs for its outcome. If it takes longer, the caller gets undefined and
 * ctx.interactive flips to false, so the handler knows nobody is waiting and must notify instead.
 */
export async function runNow(id: string, waitMs = 3000): Promise<Outcome | undefined> {
  const row = await claimById(id);
  if (!row) return undefined;
  const ctx: RunCtx = { interactive: true };
  const p = execute(row, ctx);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<undefined>(r => { timer = setTimeout(() => { ctx.interactive = false; r(undefined); }, waitMs); });
  const res = await Promise.race([p, timeout]);
  clearTimeout(timer);
  return res;
}

let running = false, again = false;
/** One worker pass. Safe to call often ("poke" after a commit); overlapping calls coalesce. */
export async function tick() {
  if (running) { again = true; return; }
  running = true;
  try {
    do {
      again = false;
      const rows = await claimDue();
      await Promise.all(rows.map(r => execute(r)));
      if (rows.length === 25) again = true;
    } while (again);
  } catch (e) { log.error({ err: e }, 'outbox tick failed'); } finally { running = false; }
}
export const poke = () => { setImmediate(() => tick().catch(() => {})); };

/** Admin "Retry now": re-queue failed rows for an order. */
export async function retryFor(ref: string) {
  const n = await db('outbox').where({ ref, status: 'failed' }).update({ status: 'pending', attempts: 0, next_at: new Date(), last_error: null });
  poke();
  return n;
}

export async function queueHealth() {
  const rows = await db('outbox').select('status').count({ n: '*' }).groupBy('status');
  const m: Record<string, number> = {}; for (const r of rows as any[]) m[r.status] = Number(r.n);
  const oldest = await db('outbox').where({ status: 'pending' }).where('next_at', '<=', new Date()).min({ t: 'created_at' }).first();
  return { pending: m.pending ?? 0, running: m.running ?? 0, failed: m.failed ?? 0, oldestDueSeconds: oldest?.t ? Math.round((Date.now() - new Date(oldest.t).getTime()) / 1000) : 0 };
}

export { raiseException };
