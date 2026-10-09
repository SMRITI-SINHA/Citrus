// Prices the way Indian shoppers read them (Myntra, AJIO, Udaan): the price you pay in bold, the old price struck through,
// and the saving in green. A CITRUS scheme shows as a green trade rate; without one, the rate is plain and the margin is green.
import type { StyleCard } from '@citrus/shared';
import { inr } from '../lib/format';

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

/** The scheme ribbon used on photos and deal cards. */
export function OfferTag({ style }: { style: StyleCard }) {
  if (!style.offer) return null;
  return <span className="tagx deal">{style.offer.pct}% OFF</span>;
}
