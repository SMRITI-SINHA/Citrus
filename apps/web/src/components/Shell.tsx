// One adaptive shell per role. Phone: app bar + bottom tab bar (+ mini cart). ≥768px: quiet side rail + wide canvas.
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import type { AdminOverview, Me } from '@citrus/shared';
import { useQuery } from '../lib/query';
import { useMyOrders, useQueue } from '../state/orders';
import { useT } from '../lib/i18n';
import { inr, num } from '../lib/format';
import { live$ } from '../lib/sse';
import { useCart } from '../state/cart';
import { useStyles } from '../state/catalogue';
import { session } from '../state/session';
import { contactOf } from './Contact';
import { Icon, type IconName } from './Icon';
import { PLink } from './PLink';

interface NavItem { to: string; icon: IconName; label: string; badge?: number; match: RegExp; /** false: rail only, not in the phone tab bar */ tab?: boolean }

function useOnline() {
  return useSyncExternalStore(f => { window.addEventListener('online', f); window.addEventListener('offline', f); return () => { window.removeEventListener('online', f); window.removeEventListener('offline', f); }; }, () => navigator.onLine);
}
export function useLive() {
  return useSyncExternalStore(f => live$.onStatus(f), () => live$.connected);
}

type Theme = 'system' | 'light' | 'dark';
export function useTheme(): [Theme, () => void] {
  const [th, setTh] = useState<Theme>(() => { try { const v = localStorage.getItem('ct.theme'); return v === 'light' || v === 'dark' ? v : 'system'; } catch { return 'system'; } });
  useEffect(() => {
    const r = document.documentElement;
    if (th === 'system') delete r.dataset.theme; else r.dataset.theme = th;
    try { if (th === 'system') localStorage.removeItem('ct.theme'); else localStorage.setItem('ct.theme', th); } catch { /* ignore */ }
    const dark = th === 'dark' || (th === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0B0D0D' : '#0F1B2D');
  }, [th]);
  return [th, () => setTh(v => (v === 'system' ? 'light' : v === 'light' ? 'dark' : 'system'))];
}

function LangButton() {
  const { t, toggle, lang } = useT();
  return <button type="button" className="langbtn" onClick={toggle} lang={lang === 'en' ? 'hi' : 'en'} aria-label={lang === 'en' ? 'हिंदी में देखें' : 'View in English'}>{t('language')}</button>;
}

function Brand({ small }: { small?: boolean }) {
  return <div className="brand"><span className="dot">.</span>CITRUS{small ? null : <small>Trade</small>}</div>;
}

function Frame({ nav, header, foot, children, after }: { nav: NavItem[]; header: ReactNode; foot: ReactNode; children: ReactNode; after?: ReactNode }) {
  const { pathname } = useLocation();
  const online = useOnline();
  const isCur = (n: NavItem) => n.match.test(pathname);
  return (
    <div className="shell">
      <nav className="rail" aria-label="Main">
        <Brand />
        {nav.map(n => (
          <PLink key={n.to} to={n.to} className="navlink" aria-current={isCur(n) ? 'page' : undefined}>
            <Icon name={n.icon} /><span>{n.label}</span>{n.badge ? <span className="badge">{num(n.badge)}</span> : null}
          </PLink>
        ))}
        <div className="foot">{foot}</div>
      </nav>
      <div className="main">
        <header className="appbar">{header}</header>
        {!online && <div className="netbar" role="status"><Icon name="wifiOff" />You are offline. Everything you change is kept on this phone and sent when you are back online.</div>}
        <main className="content" id="content" tabIndex={-1}>{children}</main>
      </div>
      <nav className="tabbar" aria-label="Main" style={{ gridTemplateColumns: `repeat(${nav.filter(n => n.tab !== false).length},1fr)` }}>
        {nav.filter(n => n.tab !== false).map(n => (
          <PLink key={n.to} to={n.to} aria-current={isCur(n) ? 'page' : undefined}>
            <Icon name={n.icon} /><span>{n.label}</span>{n.badge ? <span className="badge">{num(n.badge)}</span> : null}
          </PLink>
        ))}
      </nav>
      {after}
    </div>
  );
}

function RailFoot({ me, children }: { me: Me; children?: ReactNode }) {
  const [th, cycle] = useTheme();
  return (
    <>
      {children}
      <div className="row">
        <button type="button" className="linkbtn" onClick={cycle} aria-label={`Theme: ${th}. Change theme`}><Icon name={th === 'dark' ? 'moon' : 'sun'} size={14} /> {th === 'system' ? 'Auto' : th === 'dark' ? 'Dark' : 'Light'}</button>
        <span aria-hidden="true">·</span>
        <button type="button" className="linkbtn" onClick={() => session.signOut()}>Sign out</button>
      </div>
      <span className="xs" style={{ display: 'block', marginTop: 6 }}>{me.name}</span>
    </>
  );
}

export function RetailerShell({ me, children, after }: { me: Me; children: ReactNode; after?: ReactNode }) {
  const { t } = useT();
  const cartv = useCart();
  const { pathname } = useLocation();
  const { data: orders } = useMyOrders();
  const needAnswer = orders?.filter(o => o.status === 'modified').length ?? 0;
  const r = me.retailer;
  const c = contactOf(me);
  const nav: NavItem[] = [
    { to: '/home', icon: 'home', label: t('home'), match: /^\/home/ },
    { to: '/catalogue', icon: 'grid', label: t('catalogue'), match: /^\/(catalogue|product)/ },
    { to: '/cart', icon: 'cart', label: t('cart'), badge: cartv.pieces, match: /^\/cart/ },
    { to: '/orders', icon: 'box', label: t('orders'), badge: needAnswer, match: /^\/(orders|placed)/ },
    { to: '/rewards', icon: 'gift', label: t('rewards'), match: /^\/rewards/ },
  ];
  const header = (
    <>
      <Brand small />
      <div className="who"><b>{r?.store ?? me.name}</b><span>{r ? `${r.city} · ${r.code}` : 'Retailer'}</span></div>
      <div className="acts">
        <PLink to="/rewards" className="pill" aria-label={`${num(me.points ?? 0)} reward points`}><span className="z" /><span className="num">{num(me.points ?? 0)}</span><span className="hide-sm">{t('pts')}</span></PLink>
        <LangButton />
        <PLink to="/cart" className="iconbtn hide-sm" aria-label={`Cart, ${cartv.pieces} pieces`}><Icon name="cart" />{cartv.pieces ? <span className="badge">{num(cartv.pieces)}</span> : null}</PLink>
      </div>
    </>
  );
  const foot = (
    <RailFoot me={me}>
      {c.tel && <>
        <b>{c.name || 'CITRUS'}</b>{c.name ? 'Your CITRUS rep' : 'Sales support'}
        <div className="row"><a className="btn sec sm" href={c.tel}><Icon name="phone" size={14} />Call</a><a className="btn wa sm" href={c.wa()} target="_blank" rel="noopener noreferrer"><Icon name="wa" size={14} />WhatsApp</a></div>
      </>}
    </RailFoot>
  );
  const showMini = cartv.pieces > 0 && /^\/(home|catalogue|rewards|orders)/.test(pathname);
  return (
    <Frame nav={nav} header={header} foot={foot} after={<>{showMini && <MiniCart />}{after}</>}>
      {children}
      {showMini && <div className="mc-sp" aria-hidden="true" />}
    </Frame>
  );
}

function MiniCart() {
  const v = useCart();
  const { t } = useT();
  const styles = useStyles(v.lines.map(l => l.styleId));
  const value = v.lines.reduce((a, l) => a + l.qty * (styles[l.styleId]?.rate ?? 0), 0);
  const groups = new Set(v.lines.map(l => l.styleId + '|' + l.color)).size;
  return (
    <div className="minicart" role="region" aria-label="Cart">
      <div className="t" aria-live="polite"><b className="num">{num(v.pieces)} pcs · {inr(value)}</b><span>{groups} style{groups === 1 ? '' : 's'} · {t('savedAuto')}</span></div>
      <PLink to="/cart" className="btn">{t('viewCart')}</PLink>
    </div>
  );
}

export function DistributorShell({ me, children }: { me: Me; children: ReactNode }) {
  const { t } = useT();
  const { data: queue } = useQueue();
  const live = useLive();
  const d = me.distributor;
  const n = queue?.filter(o => o.status === 'review').length ?? 0;
  const nav: NavItem[] = [
    { to: '/queue', icon: 'inbox', label: t('approvals'), badge: n, match: /^\/queue/ },
    { to: '/history', icon: 'box', label: t('history'), match: /^\/history/ },
  ];
  const header = (
    <>
      <Brand small />
      <div className="who"><b>{d?.name ?? me.name}</b><span>Distributor{d?.state ? ` · ${d.state}` : ''} · {n} waiting</span></div>
      <div className="acts"><span className={`live-dot${live ? ' on' : ''}`} title={live ? 'Live' : 'Reconnecting'} aria-label={live ? 'Live updates on' : 'Reconnecting'} role="img" /><LangButton /></div>
    </>
  );
  return <Frame nav={nav} header={header} foot={<RailFoot me={me}><b>{d?.name}</b>{d?.city}</RailFoot>}>{children}</Frame>;
}

export function AdminShell({ me, children }: { me: Me; children: ReactNode }) {
  const { t } = useT();
  const live = useLive();
  const { data: ov } = useQuery<AdminOverview>('/api/admin/overview', { staleMs: 30_000 });
  const exc = ov?.live.exceptions.filter(e => e.severity !== 'info').length;
  const nav: NavItem[] = [
    { to: '/admin', icon: 'chart', label: t('overview'), match: /^\/admin\/?$/ },
    { to: '/admin/orders', icon: 'file', label: t('orders'), match: /^\/admin\/orders/ },
    { to: '/admin/exceptions', icon: 'alert', label: t('exceptions'), badge: exc, match: /^\/admin\/exceptions/ },
    { to: '/admin/distributors', icon: 'truck', label: t('distributors'), match: /^\/admin\/distributors/ },
    { to: '/admin/retailers', icon: 'users', label: t('retailers'), match: /^\/admin\/retailers/ },
    { to: '/admin/low-stock', icon: 'box', label: t('lowStock'), match: /^\/admin\/low-stock/, tab: false },
  ];
  const header = (
    <>
      <Brand small />
      <div className="who"><b>CITRUS control room</b><span>All regions · {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span></div>
      <div className="acts"><span className={`status ${live ? 's-ok' : 's-warn'} hide-sm`}>{live ? 'Live' : 'Reconnecting'}</span><LangButton /></div>
    </>
  );
  return <Frame nav={nav} header={header} foot={<RailFoot me={me}><b>CITRUS Trade</b>Admin</RailFoot>}>{children}</Frame>;
}
