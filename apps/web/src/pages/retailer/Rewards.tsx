import { useEffect } from 'react';
import { useQuery } from '../../lib/query';
import type { CataloguePage } from '../../lib/types';
import { fmtPhone, num } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { session, useMe } from '../../state/session';
import { seedStyles } from '../../state/catalogue';
import { Icon } from '../../components/Icon';
import { ProductTile } from '../../components/ProductTile';
import { SecHead, TileSkeletons } from '../../components/Bits';
import { HelpCard } from '../../components/Contact';
import { useTheme } from '../../components/Shell';
import { nextTier } from '../../lib/rewards';
import { REWARD_CREDITS, RewardCards } from '../../components/RewardCards';

export default function Rewards() {
  const me = useMe();
  const { t, toggle, lang } = useT();
  const [theme, cycleTheme] = useTheme();
  const points = me.points ?? 0;
  const tier = nextTier(points);
  const { data } = useQuery<CataloguePage>('/api/catalogue?sort=points&inStock=1&limit=8', { staleMs: 120_000 });
  useEffect(() => { seedStyles(data?.items); }, [data]);
  const r = me.retailer;

  return (
    <>
      <h1 className="title">{t('rewards')}</h1>
      <section className="rw">
        <div className="eyebrow">{t('progress')}</div>
        <div className="big num" style={{ fontSize: 48 }} aria-live="polite">{num(points)} <em style={{ fontSize: '.4em' }}>pts</em></div>
        <div className="bar" role="progressbar" aria-valuenow={tier.pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progress to next reward"><i style={{ width: `${tier.pct}%` }} /></div>
        <div><b>{t('away', { n: num(tier.away), r: tier.next.name })}</b></div>
      </section>
      <section className="stack" style={{ gap: 12 }}>
        <SecHead title="Rewards this month" sub="Order CITRUS styles, collect points, claim the prize" />
        <RewardCards points={points} />
        <p className="muted" style={{ fontSize: 11.5, margin: 0 }}>{REWARD_CREDITS}</p>
      </section>
      <div className="note info"><Icon name="spark" size={18} /><div className="grow"><b>How points work</b>Every piece earns points; new and priority styles earn more. You see the points on every product before you order. Rewards and point values are set by CITRUS each month.</div></div>
      <section>
        <SecHead title="Earn faster" sub="Styles with the most points per piece, in stock now" />
        <div style={{ marginTop: 12 }}>{data ? <div className="hscroll">{data.items.map(s => <ProductTile key={s.id} style={s} />)}</div> : <TileSkeletons n={4} scroll />}</div>
      </section>

      <section className="stack">
        <SecHead title={t('account')} />
        <div className="card" style={{ padding: '4px 16px' }}>
          <div className="facts" style={{ borderTop: 0 }}>
            <div><span className="muted">Store</span><b>{r?.store ?? me.name}</b></div>
            <div><span className="muted">Customer code</span><b className="mono">{r?.code ?? '-'}</b></div>
            <div><span className="muted">Your mobile</span><b className="num">+91 {fmtPhone(me.phone)}</b></div>
            <div><span className="muted">Distributor</span><b>{r?.distributor.name ?? '-'}</b></div>
            {r?.gstin && <div><span className="muted">GSTIN</span><b className="mono">{r.gstin}</b></div>}
            <div><span className="muted">City</span><b>{r ? `${r.city}, ${r.state}` : '-'}</b></div>
          </div>
        </div>
        <div className="row">
          <button type="button" className="btn sec" onClick={toggle}>{lang === 'en' ? 'हिंदी में देखें' : 'View in English'}</button>
          <button type="button" className="btn sec" onClick={cycleTheme}><Icon name={theme === 'dark' ? 'moon' : 'sun'} size={16} />{t('theme')}: {theme === 'system' ? 'Auto' : theme === 'dark' ? 'Dark' : 'Light'}</button>
          <button type="button" className="btn sec" onClick={() => session.signOut()}><Icon name="logout" size={16} />{t('signOut')}</button>
        </div>
        <HelpCard context="Question about CITRUS rewards" />
      </section>
    </>
  );
}
