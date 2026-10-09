import type { StyleCard } from '@citrus/shared';
import { avail, colorTotal, LOW, sizesOf, spec, useStockVersion } from '../state/catalogue';
import { quickAdd } from '../state/ui';
import { inr, num } from '../lib/format';
import { Garment } from './Garment';
import { Icon } from './Icon';
import { PLink } from './PLink';

export function productHref(id: string, color?: string) {
  return `/product/${encodeURIComponent(id)}${color ? `?color=${encodeURIComponent(color)}` : ''}`;
}

export function ProductTile({ style, color, why }: { style: StyleCard; color?: string; why?: string }) {
  useStockVersion();
  const c = color ?? style.colors.find(x => colorTotal(style, x.name) > 0)?.name ?? style.colors[0]?.name ?? '';
  const zs = sizesOf(style);
  return (
    <div className="ptile">
      <div className="img">
        <PLink to={productHref(style.id, c)} aria-label={`${style.name}, ${c}`} data={`/api/styles/${style.id}`} style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
          <Garment spec={spec(style, c)} />
        </PLink>
        <div className="tags">{style.isNew ? <span className="tagx new">NEW</span> : <span />}<span className="tagx pts">+{style.points} pts</span></div>
        <button type="button" className="quick" onClick={() => quickAdd.open({ styleId: style.id, color: c, mode: 'add' })} aria-label={`Quick add ${style.name}, ${c}`}><Icon name="plus" size={18} /></button>
      </div>
      <PLink to={productHref(style.id, c)} tabIndex={-1} style={{ color: 'inherit', textDecoration: 'none' }} data={`/api/styles/${style.id}`}>
        <div className="nm">{style.name}</div>
        <div className="meta">{c} · {style.fit} fit · <span className="mono">{style.id}</span></div>
      </PLink>
      <div className="price num">{inr(style.rate)}<s>MRP {inr(style.mrp)}</s></div>
      <div className="sizestrip" aria-label="Stock per size">
        {zs.map(z => { const n = avail(style, c, z); return <span key={z} className={`sz${n === 0 ? ' out' : n <= LOW ? ' low' : ''}`}>{z}·{num(n)}</span>; })}
      </div>
      {why && <div className="why">{why}</div>}
    </div>
  );
}

export function ColorPicker({ style, value, onChange }: { style: StyleCard; value: string; onChange: (c: string) => void }) {
  useStockVersion();
  return (
    <div className="colors" role="radiogroup" aria-label="Colour">
      {style.colors.map(cc => (
        <button type="button" key={cc.name} role="radio" aria-checked={cc.name === value} aria-pressed={cc.name === value} onClick={() => onChange(cc.name)}>
          <span className="sw" style={{ background: cc.hex }} />{cc.name}<span className="muted num" style={{ fontWeight: 500 }}>{num(colorTotal(style, cc.name))}</span>
        </button>
      ))}
    </div>
  );
}
