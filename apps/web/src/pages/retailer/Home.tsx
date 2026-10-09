import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { POLICY, REWARD_TIERS } from '@citrus/shared';
import { useQuery } from '../../lib/query';
import { nextTier } from '../../lib/rewards';
import { useT } from '../../lib/i18n';
import { dmy, num } from '../../lib/format';
import type { HomeData, PastOrderCard } from '../../lib/types';
import { lookPart, pastId } from '../../lib/types';
import { useMe } from '../../state/session';
import { seedStyles, spec } from '../../state/catalogue';
import { isOpen, useMyOrders } from '../../state/orders';
import { BrandArt, Garment, Outfit } from '../../components/Garment';
import { Icon } from '../../components/Icon';
import { PLink } from '../../components/PLink';
import { ProductTile, productHref } from '../../components/ProductTile';
import { CardSkeletons, ErrorNote, SecHead, StatusBadge, TileSkeletons } from '../../components/Bits';
import { HelpCard } from '../../components/Contact';
import { ReorderSheet } from './ReorderSheet';
import { VoiceButton } from './voice';


export default function Home() {
  const me = useMe();
  const { t } = useT();
  const nav = useNavigate();
  const { data, error, refresh } = useQuery<HomeData>('/api/home', { staleMs: 30_000 });
  const { data: orders } = useMyOrders();
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
            <div className="eyebrow">{t('hello')}, {firstName} · NOS essentials</div>
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
          <PLink to="/catalogue?focus=1" className="search" style={{ color: 'var(--muted)', textDecoration: 'none' }} aria-label={t('search')}>
            <Icon name="search" /><span style={{ flex: 1 }}>{t('search')}</span>
          </PLink>
          <VoiceButton onResult={q => nav(`/catalogue?q=${encodeURIComponent(q)}`, { viewTransition: true })} />
        </div>
      </div>

      {error && !data && <ErrorNote error={error} onRetry={refresh} />}

      <section>
        <SecHead title={t('buyAgain')} sub={t('buyAgainSub')} />
        <div style={{ marginTop: 12 }}>
          {!data ? (error ? null : <CardSkeletons n={1} h={200} />) : buyAgain.length ? (
            <div className="hscroll" style={{ gridAutoColumns: 'minmax(260px,80%)' }}>
              {buyAgain.slice(0, 3).map(p => <BuyAgainCard key={pastId(p)} p={p} onReorder={() => setReorder(p)} />)}
            </div>
          ) : <div className="card empty" style={{ padding: 24 }}><b>Your past orders will show here.</b><br />Start with the catalogue; next time it's one tap.</div>}
        </div>
      </section>

      <section>
        <SecHead title={t('recommended')} sub={t('recSub')} action={<PLink to="/catalogue" className="linkbtn" preloadVisible>{t('seeAll')}</PLink>} />
        <div style={{ marginTop: 12 }}>
          {!data ? <TileSkeletons n={4} scroll /> : <div className="hscroll">{data.recommended.map(s => <ProductTile key={s.id} style={s} why={s.reason} />)}</div>}
        </div>
      </section>

      <HelpCard context="Hi, I need help with my CITRUS order" />

      {data && data.newStyles.length > 0 && (
        <section>
          <SecHead title={t('newp')} sub={t('newSub')} />
          <div className="hscroll" style={{ marginTop: 12 }}>{data.newStyles.map(s => <ProductTile key={s.id} style={s} />)}</div>
        </section>
      )}

      {data && (data.looks?.length ?? 0) > 0 && (
        <section>
          <SecHead title={t('look')} sub={t('lookSub')} />
          <div className="hscroll" style={{ marginTop: 12 }}>
            {data.looks!.map((l, i) => {
              const top = lookPart(l.top), bot = lookPart(l.bottom);
              if (!top.style || !bot.style) return null;
              return (
                <PLink key={i} to={productHref(bot.style.id, bot.color)} className="ptile" data={`/api/styles/${bot.style.id}`}>
                  <div className="img" style={{ aspectRatio: '3/4' }}><Outfit top={spec(top.style, top.color)} bottom={spec(bot.style, bot.color)} /></div>
                  <div><div className="nm">{bot.style.name}, {bot.color}</div><div className="meta">Goes with {top.style.name}, {top.color}</div>{l.reason && <div className="why">{l.reason}</div>}</div>
                </PLink>
              );
            })}
          </div>
        </section>
      )}

      <section className="rw">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div><div className="eyebrow">{t('progress')}</div><div className="big num">{num(points)} <em style={{ fontSize: '.5em' }}>pts</em></div></div>
          <PLink to="/rewards" className="btn citrus">{t('seeRewards')}</PLink>
        </div>
        <div className="bar" role="progressbar" aria-valuenow={tier.pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progress to next reward"><i style={{ width: `${tier.pct}%` }} /></div>
        <div style={{ fontSize: 14 }}><b>{t('away', { n: num(tier.away), r: tier.next.name })}</b>{tier.prev ? ` · Unlocked: ${tier.prev.name}` : ''}</div>
        <div className="ticker" aria-hidden="true"><span>This month: {REWARD_TIERS.map(r => `${num(r.at)} pts = ${r.name}`).join('   ·   ')}   ·   New styles earn up to 40 pts per piece</span></div>
      </section>

      <ReorderSheet card={reorder} onClose={() => setReorder(null)} />
    </>
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
      {outStyles > 0 ? <div className="note warn" style={{ padding: '7px 10px', fontSize: 12.5 }}><Icon name="alert" size={16} /><span>{outStyles} style{outStyles > 1 ? 's' : ''} out of stock, will be skipped</span></div>
        : <div className="note ok" style={{ padding: '7px 10px', fontSize: 12.5 }}><Icon name="check" size={16} /><span>Everything in stock</span></div>}
      <button type="button" className="btn sec" onClick={onReorder}>{t('reorder')}</button>
    </div>
  );
}
