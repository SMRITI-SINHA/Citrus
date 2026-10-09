// Live updates fan out through Redis pub/sub so any API instance can push SSE to any connected user.
import type { LiveEvent } from '@citrus/shared';
import { redis, sub } from './redis.ts';

export interface Audience { retailerId?: string; distributorId?: string; admins?: boolean; all?: boolean }
type Listener = (aud: Audience, ev: LiveEvent) => void;
const listeners = new Set<Listener>();
const CH = 'ct:events';
let subscribed = false;

export async function publish(aud: Audience, ev: LiveEvent) { await redis.publish(CH, JSON.stringify({ aud, ev })); }
export function onEvent(fn: Listener) {
  if (!subscribed) {
    subscribed = true;
    sub.subscribe(CH);
    sub.on('message', (_c, msg) => { const { aud, ev } = JSON.parse(msg); for (const l of listeners) l(aud, ev); });
  }
  listeners.add(fn); return () => listeners.delete(fn);
}
