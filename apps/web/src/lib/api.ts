// Typed API client. Access token lives in memory only; the refresh token is an httpOnly cookie
// the browser sends to POST /api/auth/refresh. Every request carries an x-request-id.
import type { Session } from '@citrus/shared';

export class ApiError extends Error {
  code: string;
  status: number;
  requestId?: string;
  body?: unknown;
  constructor(code: string, message: string, status: number, requestId?: string, body?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.requestId = requestId;
    this.body = body;
  }
  /** True when the request never reached the server (offline, DNS, proxy down). */
  get isNetwork() { return this.code === 'NETWORK'; }
}

export function uuid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

let accessToken: string | null = null;
let refreshing: Promise<Session | null> | null = null;
const sessionListeners = new Set<(s: Session | null) => void>();

export const auth = {
  get token() { return accessToken; },
  set(session: Session | null) {
    accessToken = session?.accessToken ?? null;
    sessionListeners.forEach(f => f(session));
  },
  onChange(f: (s: Session | null) => void) { sessionListeners.add(f); return () => { sessionListeners.delete(f); }; },
  /** Single-flight refresh: concurrent 401s share one refresh call. */
  refresh(): Promise<Session | null> {
    if (!refreshing) {
      refreshing = rawFetch<Session>('POST', '/api/auth/refresh', undefined, { auth: false })
        .then(s => { const b = s.status === 204 || !s.body ? null : s.body; auth.set(b); return b; })
        .catch(e => { if (e instanceof ApiError && !e.isNetwork) auth.set(null); if (e instanceof ApiError && e.isNetwork) throw e; return null; })
        .finally(() => { refreshing = null; });
    }
    return refreshing;
  },
};

interface Opts { auth?: boolean; signal?: AbortSignal; headers?: Record<string, string> }
export interface ApiResponse<T> { body: T; status: number; headers: Headers; requestId?: string }

async function rawFetch<T>(method: string, path: string, body?: unknown, opts: Opts = {}): Promise<ApiResponse<T>> {
  const requestId = uuid();
  const headers: Record<string, string> = { 'x-request-id': requestId, accept: 'application/json', ...opts.headers };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (opts.auth !== false && accessToken) headers.authorization = `Bearer ${accessToken}`;
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin', signal: opts.signal });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    throw new ApiError('NETWORK', 'No connection. Check your internet and try again.', 0, requestId);
  }
  const rid = res.headers.get('x-request-id') ?? requestId;
  const text = res.status === 204 ? '' : await res.text();
  let data: unknown = undefined;
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  if (!res.ok) {
    const d = (data && typeof data === 'object' ? data : {}) as { code?: string; message?: string };
    const fallback = res.status >= 500 ? 'Something went wrong on our side. Please try again.' : 'That did not work. Please try again.';
    throw new ApiError(d.code ?? `HTTP_${res.status}`, d.message ?? fallback, res.status, rid, data);
  }
  return { body: data as T, status: res.status, headers: res.headers, requestId: rid };
}

/** Request with automatic token refresh on 401 (once). */
export async function request<T>(method: string, path: string, body?: unknown, opts: Opts = {}): Promise<ApiResponse<T>> {
  try {
    return await rawFetch<T>(method, path, body, opts);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401 && opts.auth !== false) {
      const s = await auth.refresh();
      if (!s) throw e;
      return rawFetch<T>(method, path, body, opts);
    }
    throw e;
  }
}

export const api = {
  get: <T>(path: string, opts?: Opts) => request<T>('GET', path, undefined, opts).then(r => r.body),
  post: <T>(path: string, body?: unknown, opts?: Opts) => request<T>('POST', path, body ?? {}, opts).then(r => r.body),
  put: <T>(path: string, body?: unknown, opts?: Opts) => request<T>('PUT', path, body ?? {}, opts).then(r => r.body),
  del: <T>(path: string, opts?: Opts) => request<T>('DELETE', path, undefined, opts).then(r => r.body),
  raw: request,
};
