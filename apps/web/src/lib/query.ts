// Tiny in-memory stale-while-revalidate cache for GET requests.
// Cached data renders instantly (back/forward, revisits); a background revalidation keeps it fresh.
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { api, ApiError } from './api';

interface Entry<T = unknown> { data?: T; error?: ApiError; at: number; inflight?: Promise<T>; }
const cache = new Map<string, Entry>();
const subs = new Map<string, Set<() => void>>();
const EMPTY: Entry = { at: 0 };

function emit(key: string) { subs.get(key)?.forEach(f => f()); }
function subscribe(key: string, f: () => void) {
  let s = subs.get(key); if (!s) subs.set(key, (s = new Set()));
  s.add(f);
  return () => { s!.delete(f); };
}

export function getCached<T>(key: string): T | undefined { return cache.get(key)?.data as T | undefined; }

export function setCached<T>(key: string, updater: T | ((prev: T | undefined) => T | undefined)) {
  const prev = cache.get(key);
  const data = typeof updater === 'function' ? (updater as (p: T | undefined) => T | undefined)(prev?.data as T | undefined) : updater;
  if (data === undefined) return;
  cache.set(key, { ...prev, data, error: undefined, at: Date.now() });
  emit(key);
}

/** Update every cached entry whose key starts with prefix. */
export function updateWhere<T>(prefix: string, fn: (prev: T) => T) {
  for (const [k, e] of cache) if (k.startsWith(prefix) && e.data !== undefined) { cache.set(k, { ...e, data: fn(e.data as T) }); emit(k); }
}

export function invalidate(prefix: string) {
  for (const k of cache.keys()) if (k.startsWith(prefix)) { const e = cache.get(k)!; cache.set(k, { ...e, at: 0 }); revalidate(k).catch(() => {}); }
}

export function clearCache() { cache.clear(); subs.forEach((s) => s.forEach(f => f())); }

/** Fetch (or join an in-flight fetch) and store. Keeps previous data on error. */
export function revalidate<T>(key: string, fetcher: () => Promise<T> = () => api.get<T>(key)): Promise<T> {
  const prev = cache.get(key) ?? { at: 0 };
  if (prev.inflight) return prev.inflight as Promise<T>;
  const p = fetcher().then(
    data => { cache.set(key, { data, at: Date.now() }); emit(key); return data; },
    (error: unknown) => {
      const e = error instanceof ApiError ? error : new ApiError('UNKNOWN', String(error), 0);
      cache.set(key, { ...cache.get(key), error: e, at: Date.now(), inflight: undefined }); emit(key); throw e;
    },
  );
  cache.set(key, { ...prev, inflight: p });
  return p;
}

/** Warm the cache ahead of navigation (hover / visible). No-op if fresh. */
export function prefetch(key: string, maxAgeMs = 30_000) {
  const e = cache.get(key);
  if (e?.inflight || (e?.data !== undefined && Date.now() - e.at < maxAgeMs)) return;
  revalidate(key).catch(() => {});
}

export interface QueryResult<T> { data: T | undefined; error: ApiError | undefined; loading: boolean; refresh: () => Promise<T | undefined> }

/** Subscribe to a cached GET. `key` null skips. Revalidates on mount when older than `staleMs`. */
export function useQuery<T>(key: string | null, opts: { staleMs?: number; fetcher?: () => Promise<T> } = {}): QueryResult<T> {
  const k = key ?? '';
  const entry = useSyncExternalStore(
    useCallback(f => (key ? subscribe(key, f) : () => {}), [key]),
    () => (key ? cache.get(key) ?? EMPTY : EMPTY),
  ) as Entry<T>;
  const staleMs = opts.staleMs ?? 0;
  useEffect(() => {
    if (!key) return;
    const e = cache.get(key);
    if (!e || e.data === undefined || Date.now() - e.at >= staleMs) revalidate<T>(key, opts.fetcher).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const refresh = useCallback(() => (k ? revalidate<T>(k, opts.fetcher).catch(() => undefined) : Promise.resolve(undefined)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [k]);
  return { data: entry.data, error: entry.data === undefined ? entry.error : undefined, loading: !!key && entry.data === undefined && !entry.error, refresh };
}

interface PageLike<T> { items: T[]; nextCursor?: string }
/** Cursor-paginated list on top of useQuery: the first page is cached under `key`, "more" appends into the same entry. */
export function usePaged<T>(key: string | null, staleMs = 15_000) {
  const q = useQuery<PageLike<T>>(key, { staleMs });
  const busy = useSyncExternalStore(f => moreSubs.add(f) && (() => { moreSubs.delete(f); }), () => (key ? moreBusy.has(key) : false));
  const more = useCallback(async () => {
    const pg = key ? getCached<PageLike<T>>(key) : undefined;
    if (!key || !pg?.nextCursor || moreBusy.has(key)) return;
    moreBusy.add(key); moreSubs.forEach(f => f());
    try {
      const nx = await api.get<PageLike<T>>(`${key}${key.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(pg.nextCursor)}`);
      setCached<PageLike<T>>(key, p => ({ ...p, items: [...(p?.items ?? []), ...nx.items], nextCursor: nx.nextCursor }));
    } finally { moreBusy.delete(key); moreSubs.forEach(f => f()); }
  }, [key]);
  return { items: q.data?.items, next: q.data?.nextCursor, more, busy, error: q.error, refresh: q.refresh, data: q.data };
}
const moreBusy = new Set<string>();
const moreSubs = new Set<() => void>();
