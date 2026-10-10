import { appBack } from '../../components/Shell';
import { useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import type { StyleCard } from '@citrus/shared';
import { useQuery } from '../../lib/query';
import type { CataloguePage } from '../../lib/types';
import { dmy, num } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { cart } from '../../state/cart';
import { colorTotal, seedStyles, sizesOf, spec, useStyle } from '../../state/catalogue';
import { draft, recentViews, useOverCount } from '../../state/ui';
import { useCart } from '../../state/cart';
import { toast } from '../../state/toast';
import { Garment, isBottom, isDark } from '../../components/Garment';
import { Icon } from '../../components/Icon';
import { PLink } from '../../components/PLink';
import { ColorPicker, productHref } from '../../components/ProductTile';
import { QtyGrid, useDraftSource } from '../../components/QtyGrid';
import { ErrorNote } from '../../components/Bits';
import { Badges, PcsChip, Price, PtsChip, SaveChip, savePer, tradeRate, ValueTxt } from '../../components/Price';

export default function Product() {
  const { id = '' } = useParams();
  const { data: style, error, refresh } = useStyle(id);
  const { t } = useT();
  if (error && !style) return <><BackLink /><ErrorNote error={error} onRetry={refresh} context={`Question about style ${id}`} /></>;
  if (!style) return <><BackLink /><ProductSkeleton /></>;
  return <ProductView style={style} />;
  function BackLink() { return <div><PLink to="/catalogue" className="linkbtn backlink"><Icon name="back" size={18} />{t('catalogue')}</PLink></div>; }
}

function ProductSkeleton() {
  return (
    <div className="pdp" aria-busy="true">
      <div className="skel" style={{ aspectRatio: '4/5', borderRadius: 22 }} />
      <div className="stack"><div className="skel line" style={{ width: '40%' }} /><div className="skel" style={{ height: 52, width: '80%' }} /><div className="skel card" style={{ height: 380 }} /></div>
    </div>
  );
}

function ProductView({ style }: { style: StyleCard }) {
  const { t } = useT();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const wanted = sp.get('color');
  const color = style.colors.some(c => c.name === wanted) ? wanted! : style.colors.find(c => colorTotal(style, c.name) > 0)?.name ?? style.colors[0]?.name ?? '';
  const src = useDraftSource(style, color);
  useEffect(() => { recentViews.add(style.id, color); }, [style.id, color]);
  const zs = sizesOf(style);
  const pcs = zs.reduce((a, z) => a + src.get(z), 0);
  const overN = useOverCount(`draft|${style.id}|${color}|`);
  const inCart = useCart().pieces;

  function add() {
    const before = cart.get();
    const lines = zs.map(z => ({ styleId: style.id, color, size: z, qty: src.get(z) })).filter(l => l.qty > 0);
    const prev = lines.map(l => ({ ...l, qty: before.qty(l.styleId, l.color, l.size) }));
    const r = cart.add(lines, { [style.id]: style });
    draft.clear(style.id, color);
    toast(r.added ? `${num(r.added)} pcs added${r.capped ? ` (${r.capped} size${r.capped > 1 ? 's' : ''} already at full stock in your cart)` : ''}. Tap Proceed to cart when you're done.` : 'Nothing added: your cart already has all the stock in these sizes.', { undo: () => cart.setMany(prev) });
  }

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <button type="button" className="linkbtn backlink" onClick={() => appBack(nav, '/catalogue')}><Icon name="back" size={18} />{t('catalogue')}</button>
      </div>
      <div className="pdp">
        <div className="gallery">
          <div className="hero">
            <Garment spec={spec(style, color)} />
          </div>
            <div className="facts show-lg">
            <div><span className="muted">Fit</span><b>{style.fit}</b></div><div><span className="muted">Fabric</span><b>{style.fabric}</b></div>
            <div><span className="muted">Pattern</span><b>{style.pattern}</b></div><div><span className="muted">Points</span><b>+{style.points} per piece</b></div>
            </div>
        </div>
        <div className="stack-lg" style={{ gap: 18 }}>
          <div>
            <div className="eyebrow">{style.category} · NOS · <span className="mono">{style.id}</span></div>
            <h1 style={{ fontSize: 'clamp(24px,2.6vw,32px)', marginTop: 6 }}>{style.name}</h1>
            <div className="row" style={{ gap: 6, marginTop: 8 }}><Badges style={style} /><PtsChip n={style.points} per /></div>
            <div style={{ marginTop: 8 }}><Price style={style} size="lg" perPiece /></div>
            {style.offer && <div className="dealnote"><b>{style.offer.label}</b> · {style.offer.pct}% off the trade rate{style.offer.ends ? ` until ${dmy(style.offer.ends)}` : ''}</div>}
          </div>
          {style.reason && <div className="why"><span><Icon name="spark" size={14} /> {style.reason}</span></div>}
          <div className="fgroup"><div className="eyebrow">Colour · {color}</div><ColorPicker style={style} value={color} onChange={c => setSp({ color: c }, { replace: true })} /></div>
          <div className="fgroup">
            <div className="eyebrow">Quantities · live stock per size</div>
            <QtyGrid key={color} style={style} color={color} src={src} />
            <div className="muted xs">Stock is live from the CITRUS warehouse. Adding to cart does not hold stock; we check again when you place the order.</div>
          </div>
          <div className="stickybuy">
            <div className="t vrow" aria-live="polite">{overN > 0 ? <span className="bad-ink small"><b>More than in stock.</b> Fix the red {overN === 1 ? 'size' : 'sizes'} to add.</span> : pcs ? <><PcsChip n={pcs} /><ValueTxt amt={pcs * tradeRate(style)} /><SaveChip amt={pcs * savePer(style)} /><PtsChip n={pcs * style.points} /></> : <span className="muted small">Type quantities above</span>}</div>
            {inCart > 0 && <PLink to="/cart" className="btn sec">{t('proceedCart')}</PLink>}
            <button type="button" className="btn" data-gadd disabled={!pcs || overN > 0} onClick={add}>{t('add')}</button>
          </div>
          <div className="facts hide-lg">
            <div><span className="muted">Fit</span><b>{style.fit}</b></div><div><span className="muted">Fabric</span><b>{style.fabric}</b></div>
            <div><span className="muted">Pattern</span><b>{style.pattern}</b></div><div><span className="muted">Points</span><b>+{style.points} per piece</b></div>
          </div>
        </div>
      </div>
      <Pairs style={style} color={color} />
    </>
  );
}

/** "Want the trouser that goes with this?" Pairs from the other half of the wardrobe, with a colour that works. */
function Pairs({ style, color }: { style: StyleCard; color: string }) {
  const bottom = isBottom(style.kind);
  // Pairs come from the API (bought-together first, then a colour that works); the catalogue is only a fallback.
  const { data: api, error } = useQuery<StyleCard[]>(`/api/styles/${encodeURIComponent(style.id)}/pairs?color=${encodeURIComponent(color)}`, { staleMs: 300_000 });
  const { data: fb } = useQuery<CataloguePage>(error ? `/api/catalogue?category=${bottom ? 'Shirts' : 'Trousers'}&sort=best&inStock=1&limit=8` : null, { staleMs: 120_000 });
  const list = api ?? fb?.items;
  useEffect(() => { seedStyles(list); }, [list]);
  const dark = isDark(style.colors.find(c => c.name === color)?.hex ?? '#888');
  const pairs = (list ?? []).slice(0, 4).map(p => {
    const inStock = p.colors.filter(c => colorTotal(p, c.name) > 0);
    const pool = inStock.length ? inStock : p.colors;
    const pick = pool.find(c => c.name === p.pairColor) ?? pool.find(c => isDark(c.hex) !== dark) ?? pool[0];
    return { p, c: pick?.name ?? '', why: p.reason };
  });
  if (!pairs.length) return null;
  return (
    <section className="pairs">
      <div className="pairs-h"><b>Complete the look</b><span className="muted">{bottom ? `Shirts that go with ${color}, picked for your store` : `Trousers that go with ${color}, picked for your store`}</span></div>
      <div className="pairs-row">
        {pairs.map(({ p, c, why }) => (
          <PLink key={p.id} to={productHref(p.id, c)} className="pcard" data={`/api/styles/${p.id}`}>
            <span className="pimg"><Garment spec={spec(p, c)} /></span>
            <span className="bslot"><Badges style={p} /></span>
            <span className="pnm">{p.name}</span>
            <span className="pmeta"><span className="cpill"><i className="cdot" style={{ background: p.colors.find(x => x.name === c)?.hex }} />{c}</span></span>
            <Price style={p} />
            <span className="pwhy">{why ?? ''}</span>
          </PLink>
        ))}
      </div>
    </section>
  );
}
