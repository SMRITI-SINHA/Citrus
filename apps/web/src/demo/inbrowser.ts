// Hosted demo only (VITE_DEMO=1): runs the dev mock API (dev/mock-api.ts) inside the page, so the demo link needs no server.
// /api/* fetches and the /api/events stream are answered by the same handler `npm run mock` serves. Sample data, reset on reload.
import { handle, type MockReq, type MockRes } from '../../dev/mock-api.ts';

const jar = new Map<string, string>();
function keepCookies(h: Record<string, string>) {
  const c = h['set-cookie']; if (!c) return;
  const [pair, ...attrs] = c.split(';'); const [k, v] = pair.split('=');
  if (attrs.some(a => /max-age=0/i.test(a.trim())) || !v) jar.delete(k.trim()); else jar.set(k.trim(), v.trim());
}
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

function makeReq(url: string, method: string, headers: Record<string, string>, body?: string): MockReq & { close(): void } {
  const closers: (() => void)[] = [];
  return {
    url, method, headers: { ...headers, cookie: cookieHeader() },
    on(ev, f) {
      if (ev === 'data' && body) queueMicrotask(() => f(body));
      else if (ev === 'end') queueMicrotask(() => queueMicrotask(() => f()));
      else if (ev === 'close') closers.push(f);
    },
    close() { closers.forEach(f => f()); },
  };
}

const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const u = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
  if (!u.pathname.startsWith('/api/') && !/\/api\//.test(u.pathname)) return realFetch(input, init);
  const path = u.pathname.slice(u.pathname.indexOf('/api/')) + u.search;
  const headers: Record<string, string> = {};
  new Headers(init.headers).forEach((v, k) => { headers[k] = v; });
  return new Promise<Response>(resolve => {
    let status = 200, hs: Record<string, string> = {};
    const res: MockRes = {
      writeHead(s, h) { status = s; hs = h; keepCookies(h); },
      write() { /* only the event stream writes */ },
      end(b) { const { 'set-cookie': _drop, ...rest } = hs; resolve(new Response(status === 204 || !b ? null : b, { status, headers: rest })); },
    };
    handle(makeReq(path, (init.method ?? 'GET').toUpperCase(), headers, typeof init.body === 'string' ? init.body : undefined), res);
  });
};

/** EventSource stand-in for /api/events: the mock pushes "data: {...}" chunks straight into the page. */
class DemoEventSource extends EventTarget {
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  readyState = 0;
  private req: ReturnType<typeof makeReq>;
  constructor(public url: string) {
    super();
    const u = new URL(url, location.href);
    this.req = makeReq(u.pathname.slice(u.pathname.indexOf('/api/')) + u.search, 'GET', {});
    const self = this;
    handle(this.req, {
      writeHead(s) { if (s === 200) { self.readyState = 1; setTimeout(() => self.onopen?.(new Event('open'))); } },
      write(chunk) {
        for (const line of chunk.split('\n')) if (line.startsWith('data: ')) {
          const m = new MessageEvent('message', { data: line.slice(6) });
          self.onmessage?.(m); self.dispatchEvent(m);
        }
      },
      end() { self.readyState = 2; setTimeout(() => self.onerror?.(new Event('error'))); },
    });
  }
  close() { this.readyState = 2; this.req.close(); }
}
const RealES = window.EventSource;
window.EventSource = function (url: string | URL, init?: EventSourceInit) {
  return /\/api\/events/.test(String(url)) ? new DemoEventSource(String(url)) : new RealES(url, init);
} as unknown as typeof EventSource;
