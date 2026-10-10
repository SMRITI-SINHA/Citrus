import { useDeferredValue, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { POLICY } from '@citrus/shared';
import { useQuery } from '../../lib/query';
import { nextTier } from '../../lib/rewards';
import { useT } from '../../lib/i18n';
import { num } from '../../lib/format';
import type { HomeData } from '../../lib/types';
import { useMe } from '../../state/session';
import { seedStyles, spec } from '../../state/catalogue';
import { isOpen, nextStep, useMyOrders } from '../../state/orders';
import type { Order } from '@citrus/shared';
import { useRef } from 'react';
import { Garment, linePhoto, photoUrl } from '../../components/Garment';
import { RewardCards, RewardPic } from '../../components/RewardCards';
import { REWARD_TIERS } from '@citrus/shared';
import type { CataloguePage } from '../../lib/types';
import { Icon } from '../../components/Icon';
import { PLink } from '../../components/PLink';
import { ProductTile, productHref } from '../../components/ProductTile';
import { ErrorNote, SecHead, StatusBadge, TileSkeletons } from '../../components/Bits';
import { ReorderSheet, type ReorderRef } from './ReorderSheet';
import { Marquee } from '../../components/Marquee';
import type { StyleCard } from '@citrus/shared';
import { avail, sizesOf } from '../../state/catalogue';
import { tradeRate } from '../../components/Price';
import { inr } from '../../lib/format';
import { Rail } from '../../components/Rail';
import { VoiceButton } from './voice';


export default function Home() {
  const me = useMe();
  const { t } = useT();
  const nav = useNavigate();
  const { data, error, refresh } = useQuery<HomeData>('/api/home', { staleMs: 30_000 });
  const { data: orders } = useMyOrders();
  const { data: deals } = useQuery<CataloguePage>('/api/catalogue?offer=1&inStock=1&sort=offer&limit=10', { staleMs: 120_000 });
  useEffect(() => { seedStyles(deals?.items); }, [deals]);
  const best = deals?.items.reduce((a, s) => Math.max(a, s.offer?.pct ?? 0), 0) ?? 0;
  const [reorder, setReorder] = useState<ReorderRef | null>(null);
  useEffect(() => { if (data) { seedStyles(data.recommended); seedStyles(data.newStyles); } }, [data]);

  const points = me.points ?? data?.points ?? 0;
  const tier = nextTier(points);
  const actives = (orders ?? []).filter(o => isOpen(o.status)).sort((a, b) => (a.status === 'modified' ? -1 : b.status === 'modified' ? 1 : b.placedAt.localeCompare(a.placedAt)));
  const firstName = me.name.split(' ')[0];
  const buyAgain = (data?.buyAgain ?? []).filter(p => !p.placedAt || Date.now() - Date.parse(p.placedAt) < POLICY.reorderWindowDays * 864e5);
  const lastOrder = buyAgain[0];

  return (
    <>
      <div className="stack" style={{ gap: 14 }}>
        <section className="hero-b hero-c fade">
          <div className="copy">
            <div className="hero-hi"><span className="hi">{t('hello')}, <b>{firstName}</b></span><span className="nospill"><Icon name="spark" size={14} />NOS essentials</span></div>
            <h1>Pause. Breathe. <em>Restock.</em></h1>
            <div className="searchrow hero-search">
              <HomeSearch />
              <VoiceButton onResult={q => nav(`/catalogue?q=${encodeURIComponent(q)}`)} />
            </div>
            <div className="acts">
              {lastOrder ? <button type="button" className="btn citrus" onClick={() => setReorder({ orderId: lastOrder.orderId, number: lastOrder.number, placedAt: lastOrder.placedAt })}>Restock from last order</button>
                : <PLink to="/catalogue" className="btn citrus">{t('browse')}</PLink>}
              {lastOrder && <PLink to="/catalogue" className="btn light">{t('browse')}</PLink>}
            </div>
          </div>
          <img className="hero-model" src={photoUrl('look/home-about-1.webp')} alt="" aria-hidden="true" decoding="async" />
          <HeroRewards points={points} />
        </section>
      </div>

      <Shelves />

      {error && !data && <ErrorNote error={error} onRetry={refresh} />}

      <BestSellers onRestock={setReorder} lastOrder={lastOrder ? { orderId: lastOrder.orderId, number: lastOrder.number, placedAt: lastOrder.placedAt } : undefined} />

      {actives.length > 0 && <ActiveOrders orders={actives} />}

      <GoesWith />

      {deals && deals.items.length > 0 && (
        <section className="stack" style={{ gap: 12 }}>
          <PLink to="/catalogue?offer=1&sort=offer" className="dealban">
            <span className="dealban-copy">
              <span className="eyebrow">Scheme offers · till 31 Oct</span>
              <b>Up to {best}% off the trade rate</b>
              <span>On {num(deals.total ?? deals.items.length)} styles this month. The green price is what you pay.</span>
              <span className="btn light sm">See all offers <Icon name="fwd" size={14} /></span>
            </span>
            <span className="dealban-art" aria-hidden="true"><img src={linePhoto('casual')} alt="" loading="lazy" /></span>
          </PLink>
          <Rail label="Scheme offers">{deals.items.map(s => <ProductTile key={s.id} style={s} />)}</Rail>
        </section>
      )}

      <section>
        <SecHead title={t('recommended')} sub={t('recSub')} action={<PLink to="/catalogue" className="linkbtn" preloadVisible>{t('seeAll')}</PLink>} />
        <div style={{ marginTop: 12 }}>
          {!data ? <TileSkeletons n={4} scroll /> : <Rail label={t('recommended')}>{data.recommended.map(s => <ProductTile key={s.id} style={s} why={s.reason} />)}</Rail>}
        </div>
      </section>


      {data && data.newStyles.length > 0 && (
        <section>
          <SecHead title={t('newp')} sub={t('newSub')} />
          <div style={{ marginTop: 12 }}><Rail label={t('newp')}>{data.newStyles.map(s => <ProductTile key={s.id} style={s} />)}</Rail></div>
        </section>
      )}

      <section className="rw">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div><div className="eyebrow">{t('progress')}</div><div className="big num">{num(points)} <em style={{ fontSize: '.5em' }}>pts</em></div></div>
          <PLink to="/rewards" className="btn citrus">{t('seeRewards')}</PLink>
        </div>
        <div className="bar" role="progressbar" aria-valuenow={tier.pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progress to next reward"><i style={{ width: `${tier.pct}%` }} /></div>
        <div style={{ fontSize: 14 }}><b>{t('away', { n: num(tier.away), r: tier.next.name })}</b>{tier.prev ? ` · Unlocked: ${tier.prev.name}` : ''}</div>
        <RewardCards points={points} compact />
      </section>

      <ReorderSheet card={reorder} onClose={() => setReorder(null)} />
    </>
  );
}

// Every open order in one strip. It slides to the next order on its own, pauses while the store owner is
// reading or touching it, and has arrows and a View all link. The colour of each tag matches the order's stage.
function ActiveOrders({ orders }: { orders: Order[] }) {
  const [i, setI] = useState(0);
  const [hold, setHold] = useState(false);
  const n = orders.length, cur = Math.min(i, n - 1);
  const reduce = useRef(typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches).current;
  useEffect(() => {
    if (n < 2 || hold || reduce) return;
    const t = setTimeout(() => setI(x => (x + 1) % n), 2800);
    return () => clearTimeout(t);
  }, [cur, n, hold, reduce]);
  const go = (d: number) => setI(x => (x + d + n) % n);
  return (
    <section className="oslider slim" aria-roledescription="carousel" aria-label="Orders on the way"
      onPointerEnter={() => setHold(true)} onPointerLeave={() => setHold(false)} onFocus={() => setHold(true)} onBlur={() => setHold(false)} onTouchStart={() => setHold(true)}>
      <span className="os-label"><Icon name="box" size={16} /><b>{n === 1 ? '1 order' : `${n} orders`}</b><span className="muted"> on the way</span></span>
      <div className="os-view">
        <div className="os-track" style={{ transform: `translateX(-${cur * 100}%)` }}>
          {orders.map((o, k) => {
            const step = nextStep(o);
            return (
              <PLink key={o.id} to={`/orders/${o.id}`} className={`os-card st-${o.status}`} data={`/api/orders/${o.id}`} aria-hidden={k !== cur} tabIndex={k === cur ? 0 : -1} aria-label={`Order ${o.number}, ${step.text}`}>
                <StatusBadge status={o.status} />
                <span className="os-main"><b className="mono">{o.number}</b><span className="os-step"> · {step.text}</span></span>
                <span className="os-cta">{step.cta}<Icon name="fwd" size={14} /></span>
              </PLink>
            );
          })}
        </div>
      </div>
      {n > 1 && <span className="os-nav"><button type="button" className="os-arr" onClick={() => go(-1)} aria-label="Previous order"><Icon name="back" size={14} /></button><span className="num muted small">{cur + 1}/{n}</span><button type="button" className="os-arr" onClick={() => go(1)} aria-label="Next order"><Icon name="fwd" size={14} /></button></span>}
      <PLink to="/orders" className="linkbtn os-all">View all</PLink>
    </section>
  );
}

interface ShelfTile { key: string; label: string; n: number; full: number; cover?: import('../../lib/types').CataloguePage['items'][number] }
// One clear CITRUS photo per shelf, so every circle shows a different garment.
const SHELF_PHOTO: Record<string, string> = { 'formal-shirts': 'g/ampm-shirt.webp', 'casual-shirts': 'g/casual-shirt.webp', chinos: 'g/cotton-trouser.webp', 'formal-trousers': 'g/formalpant-trouser.webp', polos: 'g/shorts-polo.webp', tees: 'g/cargo-tee.webp' };
// The shelves a store restocks by. One tap opens that shelf, in-stock styles first.
// The prizes the store is playing for, drifting along the bottom of the hero so they are seen before anything else.
function HeroRewards({ points }: { points: number }) {
  const items = REWARD_TIERS; void points;
  return (
    <PLink to="/rewards" className="hrw" aria-label="See rewards you can win">
      <span className="hrw-lab"><Icon name="gift" size={14} />Win with every order</span>
      <span className="hrw-win" aria-hidden="true">
        <span className="hrw-run">
          {[0, 1].map(c => items.map((r, i) => (
            <span key={`${c}-${r.at}`} className="hrw-it" style={{ ['--d' as string]: `${i * 1.1}s` }}>
              <RewardPic at={r.at} name={r.name} />
              <span className="hrw-tx"><b>{r.name}</b><span className="hrw-pts num">{num(r.at)} pts</span></span>
            </span>
          )))}
        </span>
      </span>
    </PLink>
  );
}

function Shelves() {
  const { data } = useQuery<ShelfTile[]>('/api/shelves', { staleMs: 120_000 });
  if (!data) return null;
  return (
    <section className="home-shelves">
      <SecHead title="Shop by shelf" sub="Tap a shelf to see every style in stock" action={<PLink to="/catalogue" className="linkbtn" preloadVisible>See all</PLink>} />
      <div style={{ marginTop: 12 }}>
        <Marquee label="Shelves">
          {data.map(x => (
            <PLink key={x.key} to={`/catalogue?shelf=${x.key}&sort=avail`} className="shelf">
              <span className="sc">{SHELF_PHOTO[x.key] ? <span className="ph"><img src={photoUrl(SHELF_PHOTO[x.key])} alt="" loading="lazy" decoding="async" draggable={false} /></span> : x.cover && <Garment swatch={false} spec={spec(x.cover, x.cover.colors[0]?.name ?? '')} />}</span>
              <b>{x.label}</b><small>{num(x.full)} styles · all sizes</small>
            </PLink>
          ))}
        </Marquee>
      </div>
    </section>
  );
}

// Type first, see matches as you type, then go to the catalogue only when you ask for it.
function HomeSearch() {
  const { t } = useT();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const term = useDeferredValue(q.trim());
  const { data } = useQuery<CataloguePage>(term.length >= 2 ? `/api/catalogue?q=${encodeURIComponent(term)}&limit=5` : null, { staleMs: 60_000 });
  useEffect(() => { seedStyles(data?.items); }, [data]);
  const go = () => { const v = q.trim(); nav(v ? `/catalogue?q=${encodeURIComponent(v)}` : '/catalogue'); };
  const show = open && term.length >= 2 && !!data;
  return (
    <form className="hsearch" role="search" onSubmit={e => { e.preventDefault(); go(); }} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }}>
      <label className="search">
        <Icon name="search" />
        <input value={q} onChange={e => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder={t('search')} aria-label={t('search')} enterKeyHint="search" autoComplete="off" />
        {q && <button type="button" className="hs-clear" onClick={() => { setQ(''); setOpen(false); }} aria-label="Clear search"><Icon name="x" size={16} /></button>}
        <button type="submit" className="btn citrus sm hs-go">Search</button>
      </label>
      {show && (
        <div className="hs-pop" role="listbox" aria-label="Matching styles">
          {data.items.length ? data.items.map(s => (
            <PLink key={s.id} to={productHref(s.id)} className="hs-item" data={`/api/styles/${s.id}`}>
              <span className="hs-img"><Garment swatch={false} spec={spec(s, s.colors[0]?.name ?? '')} /></span>
              <span className="grow"><b>{s.name}</b><span className="muted small"> · <span className="mono">{s.id}</span> · {s.colors.length} colour{s.colors.length === 1 ? '' : 's'}</span></span>
            </PLink>
          )) : <div className="hs-none muted">No styles match "{term}". Try a colour, fit or code.</div>}
          {data.items.length > 0 && <button type="submit" className="hs-all">See all {num(data.total ?? data.items.length)} results for "{term}" <Icon name="fwd" size={14} /></button>}
        </div>
      )}
    </form>
  );
}

interface BestSeller { style: StyleCard; color: string; orders: number; pcs: number; lastAt: string; usual: Record<string, number> }

// Styles this store orders again and again, most-ordered first. One tap opens the size preview with its usual
// quantities next to today's stock. Whole past orders stay in Order history; this row is about styles.
function BestSellers({ onRestock, lastOrder }: { onRestock: (r: ReorderRef) => void; lastOrder?: ReorderRef }) {
  const { data } = useQuery<BestSeller[]>('/api/bestsellers', { staleMs: 60_000 });
  useEffect(() => { seedStyles(data?.map(b => b.style)); }, [data]);
  return (
    <section>
      <SecHead title="Restock your best-sellers" sub="Styles you order most, with your usual sizes" action={lastOrder ? <button type="button" className="linkbtn" onClick={() => onRestock(lastOrder)}>Restock last order</button> : undefined} />
      <div style={{ marginTop: 12 }}>
        {!data ? <TileSkeletons n={4} scroll /> : data.length ? (
          <Rail label="Your best-sellers" style={{ gridAutoColumns: 'minmax(300px,340px)' }}>{data.map(b => <BestCard key={b.style.id + b.color} b={b} onRestock={() => onRestock({ items: [{ styleId: b.style.id, color: b.color, want: b.usual }], title: `Restock ${b.style.name}`, eyebrow: `${b.color} · your usual sizes`, usual: true })} />)}</Rail>
        ) : <div className="card empty" style={{ padding: 24 }}><b>Styles you order more than once will show here.</b></div>}
      </div>
    </section>
  );
}

function BestCard({ b, onRestock }: { b: BestSeller; onRestock: () => void }) {
  const s = b.style;
  const sizes = sizesOf(s).filter(z => b.usual[z]);
  const short = sizes.filter(z => avail(s, b.color, z) < b.usual[z]).length;
  return (
    <div className="card best">
      <PLink to={productHref(s.id, b.color)} className="best-top" data={`/api/styles/${s.id}`}>
        <span className="best-im"><Garment swatch={false} spec={spec(s, b.color)} /></span>
        <span className="best-id">
          <span className="best-rank"><Icon name="refresh" size={12} />Ordered {b.orders} times</span>
          <b>{s.name}</b>
          <span className="muted small"><span className="mono">{s.id}</span> · {b.color}</span>
          <span className="small"><b className="num">{inr(tradeRate(s))}</b><span className="muted">/pc</span></span>
        </span>
      </PLink>
      <div className="best-sz" aria-label="Your usual sizes and today's stock">
        {sizes.map(z => { const a = avail(s, b.color, z), u = b.usual[z]; return <span key={z} className={a === 0 ? 'out' : a < u ? 'low' : 'ok'}><b>{z}</b><small>{a === 0 ? 'out' : a < u ? `${a} left` : `${u} usual`}</small></span>; })}
      </div>
      <span className={`best-note ${short ? 'low' : 'ok'}`}><Icon name={short ? 'alert' : 'check'} size={14} />{short ? `${short} size${short > 1 ? 's' : ''} short today, adjust when you restock` : 'All your usual sizes are in stock'}</span>
      <button type="button" className="btn sec" onClick={onRestock}>Choose sizes and restock</button>
    </div>
  );
}

// Styles that go with what this store already sells, and none it already orders.
function GoesWith() {
  const { data } = useQuery<(StyleCard & { pairColor?: string })[]>('/api/store-pairs', { staleMs: 120_000 });
  useEffect(() => { seedStyles(data); }, [data]);
  if (!data?.length) return null;
  return (
    <section>
      <SecHead title="Goes with what you stock" sub="New to your store, picked to pair with styles you order often" />
      <div style={{ marginTop: 12 }}><Rail label="Goes with what you stock">{data.map(s => <ProductTile key={s.id} style={s} color={s.pairColor} why={s.reason} />)}</Rail></div>
    </section>
  );
}
