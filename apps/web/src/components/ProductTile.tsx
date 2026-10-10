import type { StyleCard } from '@citrus/shared';
import { avail, colorTotal, LOW, sizesOf, spec, useStockVersion } from '../state/catalogue';
import { quickAdd } from '../state/ui';
import { num } from '../lib/format';
import { useState } from 'react';
import { TileReel } from './TileReel';
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
          <TileReel spec={spec(style, c)} />
        </PLink>
      </div>
      <Badges style={style} />
      <PLink to={productHref(style.id, c)} tabIndex={-1} style={{ color: 'inherit', textDecoration: 'none' }} data={`/api/styles/${style.id}`}>
        <div className="nm">{style.name}</div>
      </PLink>
      <ColourRow style={style} current={c} />
      <div className="meta">{style.fit} fit · {style.fabric}</div>
      <Price style={style} />
      <div className="tfoot"><PtsChip n={style.points} per /></div>
      <div className="sizestrip" aria-label="Stock per size">
        {zs.map(z => { const n = avail(style, c, z); return <span key={z} className={`sz${n === 0 ? ' out' : n <= LOW ? ' low' : ''}`}>{z}·{num(n)}</span>; })}
      </div>
      {why && <div className="why"><span>{why}</span></div>}
      <button type="button" className="addbtn" onClick={() => quickAdd.open({ styleId: style.id, color: c, mode: 'add' })} aria-label={`Add ${style.name}, ${c}`}><Icon name="cart" size={16} />Add to cart</button>
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

const MAX_SW = 5;

/** The selected colour as a named pill. Other colours show as circles below it on laptops; on phones they
 *  collapse into a small stack of dots with a count beside the pill (Amazon style) that opens into circles on tap. */
function ColourRow({ style, current }: { style: StyleCard; current: string }) {
  const [open, setOpen] = useState(false);
  const others = style.colors.filter(x => x.name !== current);
  const hex = style.colors.find(x => x.name === current)?.hex;
  return (
    <div className={`colrow${open ? ' open' : ''}`}>
      <div className="cline-t">
        <PLink to={productHref(style.id, current)} tabIndex={-1} className="cpill" data={`/api/styles/${style.id}`}><i className="cdot" style={{ background: hex }} />{current}</PLink>
        {others.length > 0 && (
          <button type="button" className="cstack" aria-expanded={open} aria-label={`${others.length} more colour${others.length > 1 ? 's' : ''}`} onClick={() => setOpen(o => !o)}>
            <span className="dots">{others.slice(0, 2).map(x => <i key={x.name} style={{ background: x.hex }} />)}</span>
            <b>+{others.length}</b>
          </button>
        )}
      </div>
      {others.length > 0 && (
        <div className="oswatch" aria-label="Other colours">
          {others.slice(0, MAX_SW).map(x => (
            <PLink key={x.name} to={productHref(style.id, x.name)} className="osw" title={x.name} aria-label={`${style.name} in ${x.name}`} data={`/api/styles/${style.id}`}>
              <i style={{ background: x.hex }} />
            </PLink>
          ))}
          {others.length > MAX_SW && <PLink to={productHref(style.id, current)} className="osw-more" aria-label={`${others.length - MAX_SW} more colours`}>+{others.length - MAX_SW}</PLink>}
        </div>
      )}
    </div>
  );
}
