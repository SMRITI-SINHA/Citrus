import { useEffect } from 'react';
import { createBrowserRouter, Navigate, Outlet, ScrollRestoration, useLocation, useMatches } from 'react-router';
import type { Role } from '@citrus/shared';
import { lazyPage, preloadRole, ROLE_HOME } from './routes';
import { session, useSession } from './state/session';
import { cart } from './state/cart';
import { Toaster } from './state/toast';
import { AdminShell, DistributorShell, RetailerShell } from './components/Shell';
import { QuickAddSheet } from './components/QuickAddSheet';
import { Consent } from './pages/auth/Consent';
import { Icon } from './components/Icon';
import { PLink } from './components/PLink';
import './state/orders';

function Boot() {
  return <div className="boot" aria-busy="true"><div className="brand"><span className="dot">.</span>CITRUS<small>Trade</small></div></div>;
}

function Root() {
  const s = useSession();
  useEffect(() => { session.bootstrap(); }, []);
  return (
    <>
      {s.status === 'loading' ? <Boot /> : <Outlet />}
      <Toaster />
      <ScrollRestoration />
    </>
  );
}

/** Signed-in area: picks the shell by role from /api/me and keeps each role on its own routes. */
function Authed() {
  const s = useSession();
  const loc = useLocation();
  const matches = useMatches();
  const role = s.status === 'authed' ? s.me.role : undefined;
  useEffect(() => {
    if (!role) return;
    preloadRole(role);
    if (role === 'retailer') cart.load().catch(() => {});
  }, [role]);

  if (s.status !== 'authed') return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  const me = s.me;
  if (me.consentRequired) return <Consent me={me} />;

  const allowed = matches.map(m => (m.handle as { roles?: Role[] } | undefined)?.roles).filter(Boolean).pop();
  if (allowed && !allowed.includes(me.role)) return <Navigate to={ROLE_HOME[me.role]} replace />;

  const page = <div className="page" key={loc.pathname}><Outlet /></div>;
  if (me.role === 'retailer') return <RetailerShell me={me} after={<QuickAddSheet />}>{page}</RetailerShell>;
  if (me.role === 'distributor') return <DistributorShell me={me}>{page}</DistributorShell>;
  return <AdminShell me={me}>{page}</AdminShell>;
}

function RoleIndex() {
  const s = useSession();
  return s.status === 'authed' ? <Navigate to={ROLE_HOME[s.me.role]} replace /> : null;
}

function NotFound() {
  return (
    <div className="card empty">
      <h3>This page is not here</h3>
      <p>The link may be old. Go back to where you were.</p>
      <div style={{ marginTop: 14 }}><PLink to="/" className="btn"><Icon name="home" size={16} />Go home</PLink></div>
    </div>
  );
}

function RouteError() {
  return (
    <div className="boot"><div className="card empty" style={{ maxWidth: 420 }}>
      <h3>Something went wrong</h3>
      <p>Reload to continue. Your cart is saved.</p>
      <div style={{ marginTop: 14 }}><button type="button" className="btn" onClick={() => location.reload()}>Reload</button></div>
    </div></div>
  );
}

const R = (roles: Role[]) => ({ roles });

export const router = createBrowserRouter([
  {
    element: <Root />,
    HydrateFallback: Boot,
    errorElement: <RouteError />,
    children: [
      { path: '/i/:token', lazy: lazyPage('activate') },
      { path: '/login', lazy: lazyPage('login') },
      {
        element: <Authed />,
        children: [
          { index: true, element: <RoleIndex /> },
          { path: 'home', lazy: lazyPage('home'), handle: R(['retailer']) },
          { path: 'catalogue', lazy: lazyPage('catalogue'), handle: R(['retailer']) },
          { path: 'product/:id', lazy: lazyPage('product'), handle: R(['retailer']) },
          { path: 'cart', lazy: lazyPage('cart'), handle: R(['retailer']) },
          { path: 'placed/:id', lazy: lazyPage('placed'), handle: R(['retailer']) },
          { path: 'orders', lazy: lazyPage('orders'), handle: R(['retailer']) },
          { path: 'orders/:id', lazy: lazyPage('order'), handle: R(['retailer']) },
          { path: 'rewards', lazy: lazyPage('rewards'), handle: R(['retailer']) },
          { path: 'queue', lazy: lazyPage('queue'), handle: R(['distributor']) },
          { path: 'queue/:id', lazy: lazyPage('queue'), handle: R(['distributor']) },
          { path: 'history', lazy: lazyPage('history'), handle: R(['distributor']) },
          { path: 'admin', lazy: lazyPage('overview'), handle: R(['admin']) },
          { path: 'admin/exceptions', lazy: lazyPage('exceptions'), handle: R(['admin']) },
          { path: 'admin/low-stock', lazy: lazyPage('lowstock'), handle: R(['admin']) },
          { path: 'admin/orders', lazy: lazyPage('aorders'), handle: R(['admin']) },
          { path: 'admin/orders/:id', lazy: lazyPage('aorder'), handle: R(['admin']) },
          { path: 'admin/distributors', lazy: lazyPage('distributors'), handle: R(['admin']) },
          { path: 'admin/retailers', lazy: lazyPage('retailers'), handle: R(['admin']) },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]);
