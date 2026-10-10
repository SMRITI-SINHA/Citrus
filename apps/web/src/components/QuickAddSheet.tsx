// Quick add from any tile (mode add), or "Split a total" for a cart line (mode edit, writes straight to the cart).
import { useNavigate } from 'react-router';
import { cart, useCart } from '../state/cart';
import { sizesOf, spec, useStyle } from '../state/catalogue';
import { draft, quickAdd, useQuick } from '../state/ui';
import { toast } from '../state/toast';
import { inr, num } from '../lib/format';
import { useT } from '../lib/i18n';
import { Garment } from './Garment';
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import { QtyGrid, useCartSource, useDraftSource } from './QtyGrid';
import { ColorPicker, productHref } from './ProductTile';
import type { StyleCard } from '@citrus/shared';
import { PcsChip, PtsChip, SaveChip, savePer, tradeRate, ValueTxt } from './Price';
import { useOverCount } from '../state/ui';
import { PLink } from './PLink';

export function QuickAddSheet() {
  const q = useQuick();
  const { data: style } = useStyle(q?.styleId);
  if (!q) return null;
  return (
    <Sheet open onClose={quickAdd.close} label={q.mode === 'edit' ? `Edit sizes: ${style?.name ?? ''}` : `Quick add: ${style?.name ?? ''}`} initialFocus=".qin:not(:disabled)">
      {style ? <Body style={style} color={q.color} mode={q.mode} /> : <div className="skel card" style={{ height: 380 }} aria-busy="true" />}
    </Sheet>
  );
}

function Body({ style, color, mode }: { style: StyleCard; color: string; mode: 'add' | 'edit' }) {
  const { t } = useT();
  const nav = useNavigate();
  const dsrc = useDraftSource(style, color);
  const csrc = useCartSource(style, color);
  const src = mode === 'edit' ? csrc : dsrc;
  const zs = sizesOf(style);
  const pcs = zs.reduce((a, z) => a + src.get(z), 0);
  const overN = useOverCount(`${mode === 'edit' ? 'cart' : 'draft'}|${style.id}|${color}|`);
  const inCart = useCart().pieces;

  function add() {
    const before = cart.get();
    const lines = zs.map(z => ({ styleId: style.id, color, size: z, qty: dsrc.get(z) })).filter(l => l.qty > 0);
    const prev = lines.map(l => ({ ...l, qty: before.qty(l.styleId, l.color, l.size) }));
    const r = cart.add(lines, { [style.id]: style });
    draft.clear(style.id, color);
    quickAdd.close();
    toast(r.added ? `${num(r.added)} pcs added${r.capped ? ` (${r.capped} size${r.capped > 1 ? 's' : ''} already at full stock in your cart)` : ''}. Tap Proceed to cart when you're done.` : 'Nothing added: your cart already has all the stock in these sizes.', { undo: () => cart.setMany(prev) });
  }

  return (
    <>
      <div className="shead">
        <div className="qhead" style={{ display: 'grid', gridTemplateColumns: '84px minmax(0,1fr)', gap: 14, alignItems: 'center', minWidth: 0 }}>
          <div className="im" style={{ width: 84, height: 104, borderRadius: 14 }}><Garment spec={spec(style, color)} /></div>
          <div style={{ minWidth: 0 }}>
            <div className="eyebrow">{mode === 'edit' ? 'Edit sizes in cart' : 'Quick add'} · <span className="mono">{style.id}</span></div>
            <h3 style={{ fontSize: 20, marginTop: 2 }}>{style.name}</h3>
            <span className="vrow" style={{ marginTop: 6 }}><b className={`num${style.offer ? ' deal-ink' : ''}`}>{inr(tradeRate(style))}/pc</b>{style.offer && <span className="pr-off">{style.offer.pct}% off</span>}<span className="muted num small">MRP {inr(style.mrp)}</span><PtsChip n={style.points} per /></span>
          </div>
        </div>
        <button type="button" className="close" onClick={quickAdd.close} aria-label="Close"><Icon name="x" size={18} /></button>
      </div>
      {mode === 'add' ? <ColorPicker style={style} value={color} onChange={quickAdd.setColor} /> : <div className="eyebrow">Colour · {color}</div>}
      <QtyGrid key={style.id + color + mode} style={style} color={color} src={src} scope={mode === 'edit' ? 'cart' : 'draft'} showCopy={mode === 'add'} onCopied={() => { draft.clear(style.id, color); quickAdd.close(); }} />
      <div className="qfoot">
        <div className="t vrow" aria-live="polite">{overN > 0 ? <span className="bad-ink small"><b>More than in stock.</b> Fix the red {overN === 1 ? 'size' : 'sizes'} to add.</span> : pcs ? <><PcsChip n={pcs} /><ValueTxt amt={pcs * tradeRate(style)} /><SaveChip amt={pcs * savePer(style)} /><PtsChip n={pcs * style.points} /></> : <span className="muted small">Type quantities above</span>}</div>
        <div className="qacts">
          {mode === 'add' && <button type="button" className="btn sec" onClick={() => { quickAdd.close(); nav(productHref(style.id, color)); }}>Details</button>}
          {mode === 'add' && inCart > 0 && <PLink to="/cart" className="btn sec" onClick={quickAdd.close}>{t('proceedCart')}</PLink>}
          {mode === 'edit'
            ? <button type="button" className="btn" data-gadd disabled={overN > 0} onClick={quickAdd.close}>Done</button>
            : <button type="button" className="btn" data-gadd disabled={!pcs || overN > 0} onClick={add}>{t('add')}</button>}
        </div>
      </div>
    </>
  );
}
