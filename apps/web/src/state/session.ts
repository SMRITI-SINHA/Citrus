import { useSyncExternalStore } from 'react';
import type { Me, Session } from '@citrus/shared';
import { api, auth, ApiError } from '../lib/api';
import { clearCache, setCached } from '../lib/query';
import { live$ } from '../lib/sse';

export type SessionState =
  | { status: 'loading' }
  | { status: 'anon'; offline?: boolean }
  | { status: 'authed'; me: Me };

const HINT = 'ct.signedIn';
let state: SessionState = { status: 'loading' };
const subs = new Set<() => void>();
function set(s: SessionState) { state = s; subs.forEach(f => f()); }

auth.onChange((s: Session | null) => {
  if (s) {
    try { localStorage.setItem(HINT, '1'); } catch { /* ignore */ }
    set({ status: 'authed', me: s.me });
    setCached('/api/me', s.me);
    live$.start(); live$.restart();
    scheduleRefresh(s.expiresIn);
  } else {
    try { localStorage.removeItem(HINT); } catch { /* ignore */ }
  }
  if (!s && state.status !== 'loading') {
    live$.stop();
    set({ status: 'anon' });
  }
});

let refreshTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleRefresh(expiresIn: number) {
  clearTimeout(refreshTimer);
  // Refresh a minute before expiry so a request rarely hits a 401.
  const ms = Math.max(30, (expiresIn || 900) - 60) * 1000;
  refreshTimer = setTimeout(() => { auth.refresh().catch(() => {}); }, ms);
}

export const session = {
  get: () => state,
  async bootstrap() {
    // Only try the refresh cookie if this browser has signed in before (avoids a 401 on a first visit).
    let hint: string | null = '1';
    try { hint = localStorage.getItem(HINT); } catch { /* storage blocked: just try */ }
    if (hint !== '1') { set({ status: 'anon' }); return; }
    try {
      const s = await auth.refresh();
      if (!s) set({ status: 'anon' });
    } catch (e) {
      set({ status: 'anon', offline: e instanceof ApiError && e.isNetwork });
    }
  },
  /** Called after OTP verify. */
  signedIn(s: Session) { auth.set(s); },
  updateMe(patch: Partial<Me>) {
    if (state.status !== 'authed') return;
    const me = { ...state.me, ...patch };
    set({ status: 'authed', me });
    setCached('/api/me', me);
  },
  async reloadMe() {
    const me = await api.get<Me>('/api/me');
    if (state.status === 'authed') set({ status: 'authed', me });
    return me;
  },
  async signOut() {
    try { await api.post('/api/auth/logout'); } catch { /* signing out locally anyway */ }
    clearTimeout(refreshTimer);
    try { localStorage.removeItem('ct.cart.pending'); } catch { /* ignore */ }
    clearCache();
    auth.set(null);
    set({ status: 'anon' });
  },
};

export function useSession(): SessionState {
  return useSyncExternalStore(f => { subs.add(f); return () => { subs.delete(f); }; }, () => state);
}
export function useMe(): Me {
  const s = useSession();
  if (s.status !== 'authed') throw new Error('useMe outside an authenticated shell');
  return s.me;
}

// Live points
live$.on(e => { if (e.type === 'points.updated') session.updateMe({ points: e.points }); });
