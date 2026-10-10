// Prices the way Indian shoppers read them (Myntra, AJIO, Udaan): the price you pay in bold, the old price struck through,
// and the saving in green. A CITRUS scheme shows as a green trade rate; without one, the rate is plain and the margin is green.
import type { StyleCard } from '@citrus/shared';
import { inr, num } from '../lib/format';
import { Icon } from './Icon';

/** The trade rate a retailer pays today: the scheme rate when a scheme is running, otherwise the price-list rate. */
export const tradeRate = (s: Pick<StyleCard, 'rate' | 'offer'> | undefined) => (s ? s.offer?.rate ?? s.rate : 0);
export const marginPct = (s: Pick<StyleCard, 'rate' | 'offer' | 'mrp'>) => (s.mrp ? Math.round((1 - tradeRate(s) / s.mrp) * 100) : 0);

export function Price({ style, size = 'sm', perPiece }: { style: StyleCard; size?: 'sm' | 'lg'; perPiece?: boolean }) {
  const o = style.offer, m = marginPct(style);
  return (
    <div className={`pr pr-${size}`}>
      <div className="pr-main num">
        <b className={o ? 'deal' : ''}>{inr(tradeRate(style))}</b>
        {perPiece && <span className="muted pr-unit">/pc</span>}
        {o && <s className="muted">{inr(style.rate)}</s>}
        {o && <span className="pr-off">{o.pct}% off</span>}
      </div>
      <div className="pr-sub num"><span className="muted">MRP {inr(style.mrp)}</span>{m > 0 && <span className="pr-margin">{m}% margin</span>}</div>
    </div>
  );
}

/** Scheme and NEW labels, shown under the photo (never on it, so the garment stays fully visible). */
export function Badges({ style }: { style: StyleCard }) {
  if (!style.offer && !style.isNew) return null;
  return (
    <div className="badges">
      {style.offer && <span className="bdg deal">{style.offer.pct}% OFF</span>}
      {style.isNew && <span className="bdg new">NEW</span>}
    </div>
  );
}

/** Reward points, always in the citrus colour with a gift icon, so they never read like a price or a piece count. */
export function PtsChip({ n, per, big }: { n: number; per?: boolean; big?: boolean }) {
  return <span className={`vchip pts${big ? ' big' : ''}`}><Icon name="gift" size={big ? 15 : 13} /><b className="num">+{num(n)}</b> pts{per ? '/pc' : ''}</span>;
}
/** Pieces, in navy with a box icon. */
export function PcsChip({ n, big }: { n: number; big?: boolean }) {
  return <span className={`vchip pcs${big ? ' big' : ''}`}><Icon name="box" size={big ? 15 : 13} /><b className="num">{num(n)}</b> pcs</span>;
}
/** Money saved on schemes, in green. */
export function SaveChip({ amt, big }: { amt: number; big?: boolean }) {
  if (amt <= 0) return null;
  return <span className={`vchip save${big ? ' big' : ''}`}>You save <b className="num">{inr(amt)}</b></span>;
}
/** Value: the one number in bold ink. */
export function ValueTxt({ amt, big }: { amt: number; big?: boolean }) {
  return <b className={`vval num${big ? ' big' : ''}`}>{inr(amt)}</b>;
}
/** Scheme saving per piece against the price-list rate. */
export const savePer = (s: Pick<StyleCard, 'rate' | 'offer'> | undefined) => (s?.offer ? s.rate - s.offer.rate : 0);
