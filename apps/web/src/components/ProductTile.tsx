import type { StyleCard } from '@citrus/shared';
import { avail, colorTotal, LOW, sizesOf, spec, useStockVersion } from '../state/catalogue';
import { quickAdd } from '../state/ui';
import { num } from '../lib/format';
import { Garment } from './Garment';
import { Icon } from './Icon';
import { PLink } from './PLink';
import { Badges, Price, PtsChip } from './Price';

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
          <Garment spec={spec(style, c)} swatch={false} />
        </PLink>
      </div>
      <Badges style={style} />
      <PLink to={productHref(style.id, c)} tabIndex={-1} style={{ color: 'inherit', textDecoration: 'none' }} data={`/api/styles/${style.id}`}>
        <div className="nm">{style.name}</div>
        <div className="cline-t">
          <span className="cpill"><i className="cdot" style={{ background: style.colors.find(x => x.name === c)?.hex }} />{c}</span>
          {style.colors.length > 1 && <span className="cmore">+{style.colors.length - 1} colour{style.colors.length > 2 ? 's' : ''}</span>}
        </div>
        <div className="meta">{style.fit} fit · {style.fabric}</div>
      </PLink>
      <Price style={style} />
      <div className="tfoot"><PtsChip n={style.points} per /></div>
      <div className="sizestrip" aria-label="Stock per size">
        {zs.map(z => { const n = avail(style, c, z); return <span key={z} className={`sz${n === 0 ? ' out' : n <= LOW ? ' low' : ''}`}>{z}·{num(n)}</span>; })}
      </div>
      {why && <div className="why"><span>{why}</span></div>}
      <button type="button" className="addbtn" onClick={() => quickAdd.open({ styleId: style.id, color: c, mode: 'add' })} aria-label={`Add ${style.name}, ${c}`}><Icon name="plus" size={16} />Add to order</button>
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
