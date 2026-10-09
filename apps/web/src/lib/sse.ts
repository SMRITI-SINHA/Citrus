// Live updates over Server-Sent Events: GET /api/events?token=<accessToken>.
// Reconnects with backoff and a fresh token; listeners receive typed LiveEvents.
import type { LiveEvent } from '@citrus/shared';
import { auth } from './api';

type Listener = (e: LiveEvent) => void;
const listeners = new Set<Listener>();
let es: EventSource | null = null;
let retry = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let wanted = false;
let statusListeners = new Set<(live: boolean) => void>();
let live = false;

function setLive(v: boolean) { if (live !== v) { live = v; statusListeners.forEach(f => f(v)); } }

function dispatch(raw: string, fallbackType?: string) {
  try {
    const data = JSON.parse(raw);
    const ev = (data && typeof data === 'object' && 'type' in data ? data : { type: fallbackType, ...data }) as LiveEvent;
    if (!ev.type) return;
    listeners.forEach(f => { try { f(ev); } catch (err) { console.warn('live listener failed', err); } });
  } catch { /* heartbeat or comment */ }
}

function open() {
  clearTimeout(timer);
  if (!wanted || !auth.token) return;
  es?.close();
  es = new EventSource(`/api/events?token=${encodeURIComponent(auth.token)}`);
  es.onopen = () => { retry = 0; setLive(true); };
  es.onmessage = m => dispatch(m.data);
  for (const t of ['order.updated', 'stock.updated', 'points.updated', 'admin.updated', 'cart.updated'] as const) es.addEventListener(t, m => dispatch((m as MessageEvent).data, t));
  es.onerror = () => {
    setLive(false);
    es?.close(); es = null;
    if (!wanted) return;
    const delay = Math.min(30_000, 1000 * 2 ** retry++);
    // The token may have expired: refresh before reconnecting.
    timer = setTimeout(() => { auth.refresh().catch(() => null).finally(open); }, delay);
  };
}

export const live$ = {
  start() { wanted = true; if (!es) open(); },
  stop() { wanted = false; clearTimeout(timer); es?.close(); es = null; setLive(false); },
  /** Reconnect with the latest token (after a refresh). */
  restart() { if (wanted) open(); },
  on(f: Listener) { listeners.add(f); return () => { listeners.delete(f); }; },
  onStatus(f: (live: boolean) => void) { statusListeners.add(f); return () => { statusListeners.delete(f); }; },
  get connected() { return live; },
};

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => live$.restart());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !es) live$.restart(); });
}
