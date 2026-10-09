// Route table with code-split pages. Each page chunk can be preloaded (hover, focus, touch, visible)
// so navigation never waits on the network for code.
import type { ComponentType } from 'react';
import type { Role } from '@citrus/shared';

type Loader = () => Promise<{ default: ComponentType }>;
const memo = (f: Loader): Loader => { let p: ReturnType<Loader> | undefined; return () => (p ??= f().catch(e => { p = undefined; throw e; })); };

export const pages = {
  activate: memo(() => import('./pages/auth/Activate')),
  login: memo(() => import('./pages/auth/Login')),
  home: memo(() => import('./pages/retailer/Home')),
  catalogue: memo(() => import('./pages/retailer/Catalogue')),
  product: memo(() => import('./pages/retailer/Product')),
  cart: memo(() => import('./pages/retailer/CartPage')),
  placed: memo(() => import('./pages/retailer/Placed')),
  orders: memo(() => import('./pages/retailer/Orders')),
  order: memo(() => import('./pages/retailer/OrderDetail')),
  rewards: memo(() => import('./pages/retailer/Rewards')),
  queue: memo(() => import('./pages/distributor/Queue')),
  history: memo(() => import('./pages/distributor/History')),
  overview: memo(() => import('./pages/admin/Overview')),
  exceptions: memo(() => import('./pages/admin/Exceptions')),
  lowstock: memo(() => import('./pages/admin/LowStock')),
  aorders: memo(() => import('./pages/admin/Orders')),
  aorder: memo(() => import('./pages/admin/OrderDetail')),
  distributors: memo(() => import('./pages/admin/Distributors')),
  retailers: memo(() => import('./pages/admin/Retailers')),
};
export type PageName = keyof typeof pages;

export const lazyPage = (name: PageName) => async () => ({ Component: (await pages[name]()).default });

const MATCH: [RegExp, PageName][] = [
  [/^\/home\/?$/, 'home'], [/^\/catalogue/, 'catalogue'], [/^\/product\//, 'product'], [/^\/cart/, 'cart'],
  [/^\/placed\//, 'placed'], [/^\/orders\/[^/]+/, 'order'], [/^\/orders\/?$/, 'orders'], [/^\/rewards/, 'rewards'],
  [/^\/queue/, 'queue'], [/^\/history/, 'history'], [/^\/admin\/exceptions/, 'exceptions'], [/^\/admin\/low-stock/, 'lowstock'],
  [/^\/admin\/orders\/[^/]+/, 'aorder'], [/^\/admin\/orders\/?$/, 'aorders'], [/^\/admin\/distributors/, 'distributors'], [/^\/admin\/retailers/, 'retailers'],
  [/^\/admin\/?$/, 'overview'], [/^\/login/, 'login'], [/^\/i\//, 'activate'],
];
export function pageFor(path: string): PageName | undefined {
  const p = path.split(/[?#]/)[0];
  return MATCH.find(([re]) => re.test(p))?.[1];
}
export function preloadPath(path: string) { const n = pageFor(path); if (n) pages[n]().catch(() => {}); }

export const ROLE_PAGES: Record<Role, PageName[]> = {
  retailer: ['home', 'catalogue', 'product', 'cart', 'orders', 'order', 'rewards', 'placed'],
  distributor: ['queue', 'history'],
  admin: ['overview', 'aorders', 'aorder', 'exceptions', 'distributors', 'retailers', 'lowstock'],
};
export const ROLE_HOME: Record<Role, string> = { retailer: '/home', distributor: '/queue', admin: '/admin' };

/** After sign-in, warm every page chunk of the role while the browser is idle. */
export function preloadRole(role: Role) {
  const run = () => ROLE_PAGES[role].forEach(n => pages[n]().catch(() => {}));
  const w = window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(run, { timeout: 2500 }); else setTimeout(run, 800);
}
