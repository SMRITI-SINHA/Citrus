import { useDeferredValue, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { POLICY } from '@citrus/shared';
import { useQuery } from '../../lib/query';
import { nextTier } from '../../lib/rewards';
import { useT } from '../../lib/i18n';
import { dmy, num } from '../../lib/format';
import type { HomeData, PastOrderCard } from '../../lib/types';
import { lookPart, pastId } from '../../lib/types';
import { useMe } from '../../state/session';
import { seedStyles, spec } from '../../state/catalogue';
import { isOpen, useMyOrders } from '../../state/orders';
import { BrandArt, Garment, linePhoto } from '../../components/Garment';
import { RewardCards } from '../../components/RewardCards';
import type { CataloguePage } from '../../lib/types';
import { Icon } from '../../components/Icon';
import { PLink } from '../../components/PLink';
import { ProductTile, productHref } from '../../components/ProductTile';
import { CardSkeletons, ErrorNote, SecHead, StatusBadge, TileSkeletons } from '../../components/Bits';
import { ReorderSheet } from './ReorderSheet';
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
  const [reorder, setReorder] = useState<PastOrderCard | null>(null);
  useEffect(() => { if (data) { seedStyles(data.recommended); seedStyles(data.newStyles); } }, [data]);

  const points = me.points ?? data?.points ?? 0;
  const tier = nextTier(points);
  const active = orders?.filter(o => isOpen(o.status)).sort((a, b) => (a.status === 'modified' ? -1 : b.status === 'modified' ? 1 : b.placedAt.localeCompare(a.placedAt)))[0];
  const firstName = me.name.split(' ')[0];
  const buyAgain = (data?.buyAgain ?? []).filter(p => !p.placedAt || Date.now() - Date.parse(p.placedAt) < POLICY.reorderWindowDays * 864e5);
  const lastOrder = buyAgain[0];

  return (
    <>
      <div className="stack" style={{ gap: 14 }}>
        <section className="hero-b fade">
          <div className="copy">
            <div className="hero-hi"><span className="hi">{t('hello')}, <b>{firstName}</b></span><span className="nospill"><Icon name="spark" size={14} />NOS essentials</span></div>
            <h1>Pause. Breathe.<br /><em>Restock.</em></h1>
            <p>Your best-sellers are in stock today. Reorder your usual in one tap, or type exactly what you want in each size.</p>
            <div className="acts">
              {lastOrder ? <button type="button" className="btn citrus" onClick={() => setReorder(lastOrder)}>{t('reorderLast')}</button>
                : <PLink to="/catalogue" className="btn citrus">{t('browse')}</PLink>}
              {lastOrder && <PLink to="/catalogue" className="btn light">{t('browse')}</PLink>}
            </div>
          </div>
          <div className="art" aria-hidden="true">
            <BrandArt />
          </div>
        </section>
        {active && (
          <PLink to={`/orders/${active.id}`} className="card ostrip" style={{ color: 'inherit', textDecoration: 'none' }} data={`/api/orders/${active.id}`}>
            <StatusBadge status={active.status} />
            <span style={{ flex: 1, minWidth: 0 }}><b className="mono">{active.number}</b> · {num(active.totalQty)} pcs{active.status === 'modified' ? <> · <b>Your answer needed</b></> : ` · with ${active.distributorName}`}</span>
            <Icon name="fwd" size={16} />
          </PLink>
        )}
        <div className="searchrow">
          <HomeSearch />
          <VoiceButton onResult={q => nav(`/catalogue?q=${encodeURIComponent(q)}`)} />
        </div>
      </div>

      {error && !data && <ErrorNote error={error} onRetry={refresh} />}

      <section>
        <SecHead title={t('buyAgain')} sub={t('buyAgainSub')} />
        <div style={{ marginTop: 12 }}>
          {!data ? (error ? null : <CardSkeletons n={1} h={200} />) : buyAgain.length ? (
            <Rail label="Buy again" style={{ gridAutoColumns: 'minmax(260px,80%)' }}>
              {buyAgain.slice(0, 3).map(p => <BuyAgainCard key={pastId(p)} p={p} onReorder={() => setReorder(p)} />)}
            </Rail>
          ) : <div className="card empty" style={{ padding: 24 }}><b>Your past orders will show here.</b><br />Start with the catalogue; next time it's one tap.</div>}
        </div>
      </section>

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

      {data && (data.looks?.length ?? 0) > 0 && (
        <section>
          <SecHead title={t('look')} sub={t('lookSub')} />
          <div style={{ marginTop: 12 }}><Rail label={t('look')}>
            {data.looks!.map((l, i) => {
              const top = lookPart(l.top), bot = lookPart(l.bottom);
              if (!top.style || !bot.style) return null;
              return (
                <PLink key={i} to={productHref(bot.style.id, bot.color)} className="lookcard" data={`/api/styles/${bot.style.id}`}>
                  <span className="lookimgs"><span className="pimg"><Garment spec={spec(top.style, top.color)} /></span><span className="plus" aria-hidden="true">+</span><span className="pimg"><Garment spec={spec(bot.style, bot.color)} /></span></span>
                  <span className="lookcap"><b>{top.style.name}</b><span className="muted">{top.color}</span></span>
                  <span className="lookcap"><b>{bot.style.name}</b><span className="muted">{bot.color}</span></span>
                  <span className="pwhy">{l.reason ?? ''}</span>
                </PLink>
              );
            })}
          </Rail></div>
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

function BuyAgainCard({ p, onReorder }: { p: PastOrderCard; onReorder: () => void }) {
  const { t } = useT();
  const styles = p.styles ?? [];
  const outStyles = p.totalStyles !== undefined && p.inStockStyles !== undefined ? p.totalStyles - p.inStockStyles : 0;
  return (
    <div className="card ro">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <b className="mono">{p.number ?? pastId(p)}</b>
        <span className="muted small">{p.placedAt ? dmy(p.placedAt) : ''}</span>
      </div>
      <div className="thumbs">{styles.slice(0, 5).map((s, i) => <div key={i}><Garment swatch={false} spec={{ kind: s.kind ?? 'shirt', pattern: 'Solid', fit: 'Regular', hex: s.hex ?? '#8C919A', name: s.name, color: s.color, styleId: s.styleId }} /></div>)}</div>
      <div style={{ fontSize: 13 }}>{p.totalStyles ?? styles.length} style{(p.totalStyles ?? styles.length) === 1 ? '' : 's'}{p.totalQty ? ` · ${num(p.totalQty)} pcs last time` : ''}</div>
      <StockLine p={p} outStyles={outStyles} />
      <button type="button" className="btn sec" onClick={onReorder} disabled={p.inStockQty === 0}>{p.inStockQty === 0 ? 'Not in stock right now' : t('reorder')}</button>
    </div>
  );
}

// What can actually be sent again today, so a reorder never surprises the store.
function StockLine({ p, outStyles }: { p: PastOrderCard; outStyles: number }) {
  const got = p.inStockQty, all = p.totalQty;
  const box = (tone: string, icon: 'alert' | 'check', head: string, sub: string) => (
    <div className={`note ${tone} stockline`}><Icon name={icon} size={16} /><span><b>{head}</b><small>{sub}</small></span></div>
  );
  if (got === 0) return box('bad', 'alert', 'Not in stock', 'None of these styles can be sent now');
  if (got !== undefined && got < all) return box('warn', 'alert', `${num(got)} of ${num(all)} pcs in stock`, outStyles > 0 ? `${outStyles} style${outStyles > 1 ? 's' : ''} sold out, some sizes skipped` : 'Some sizes will be skipped');
  return box('ok', 'check', `All ${num(all)} pcs in stock`, 'Same sizes and colours as last time');
}
