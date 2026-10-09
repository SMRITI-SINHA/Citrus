// Quick add from any tile (mode add), or "Split a total" for a cart line (mode edit, writes straight to the cart).
import { useNavigate } from 'react-router';
import { cart } from '../state/cart';
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

  function add() {
    const before = cart.get();
    const lines = zs.map(z => ({ styleId: style.id, color, size: z, qty: dsrc.get(z) })).filter(l => l.qty > 0);
    const prev = lines.map(l => ({ ...l, qty: before.qty(l.styleId, l.color, l.size) }));
    const r = cart.add(lines, { [style.id]: style });
    draft.clear(style.id, color);
    quickAdd.close();
    toast(`${num(r.added)} pcs added to cart${r.capped ? `. ${r.capped} size${r.capped > 1 ? 's' : ''} capped at stock` : ''}`, { undo: () => cart.setMany(prev) });
  }

  return (
    <>
      <div className="shead">
        <div className="qhead" style={{ display: 'grid', gridTemplateColumns: '84px minmax(0,1fr)', gap: 14, alignItems: 'center', minWidth: 0 }}>
          <div className="im" style={{ width: 84, height: 104, borderRadius: 14 }}><Garment spec={spec(style, color)} /></div>
          <div style={{ minWidth: 0 }}>
            <div className="eyebrow">{mode === 'edit' ? 'Edit sizes in cart' : 'Quick add'} · <span className="mono">{style.id}</span></div>
            <h3 style={{ fontSize: 20, marginTop: 2 }}>{style.name}</h3>
            <span className="muted num small">{inr(style.rate)}/pc · MRP {inr(style.mrp)} · +{style.points} pts/pc</span>
          </div>
        </div>
        <button type="button" className="close" onClick={quickAdd.close} aria-label="Close"><Icon name="x" size={18} /></button>
      </div>
      {mode === 'add' ? <ColorPicker style={style} value={color} onChange={quickAdd.setColor} /> : <div className="eyebrow">Colour · {color}</div>}
      <QtyGrid key={style.id + color + mode} style={style} color={color} src={src} showCopy={mode === 'add'} onCopied={() => { draft.clear(style.id, color); quickAdd.close(); }} />
      <div className="qfoot">
        <div className="t" aria-live="polite"><b className="num">{num(pcs)} pcs · {inr(pcs * style.rate)}</b><span className="muted">+{num(pcs * style.points)} points</span></div>
        <button type="button" className="btn sec" onClick={() => { quickAdd.close(); nav(productHref(style.id, color), { viewTransition: true }); }}>Details</button>
        {mode === 'edit'
          ? <button type="button" className="btn" data-gadd onClick={quickAdd.close}>Done</button>
          : <button type="button" className="btn" data-gadd disabled={!pcs} onClick={add}>{t('add')}</button>}
      </div>
    </>
  );
}
