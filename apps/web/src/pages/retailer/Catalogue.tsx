import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import type { StyleCard } from '@citrus/shared';
import { DISCOUNT_STEPS, PRICE_BANDS, SHELVES, shelfOf } from '@citrus/shared';
import { api } from '../../lib/api';
import { getCached, setCached, useQuery } from '../../lib/query';
import type { CataloguePage, Facet } from '../../lib/types';
import { useT } from '../../lib/i18n';
import { num } from '../../lib/format';
import { seedStyles } from '../../state/catalogue';
import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/Sheet';
import { Garment } from '../../components/Garment';
import { ProductTile } from '../../components/ProductTile';
import { VirtualGrid } from '../../components/VirtualGrid';
import { ErrorNote, TileSkeletons } from '../../components/Bits';
import { normaliseQuery, VoiceButton } from './voice';

const CATS = ['Shirts', 'Trousers', 'T-shirts'] as const;
const SORTS = [
  ['best', 'Best for your store', 'What you usually buy, then availability'],
  ['avail', 'Most available', 'Highest total stock first'],
  ['new', 'New first', 'Latest NOS additions'],
  ['offer', 'Best offers', 'Biggest scheme discount first'],
  ['price', 'Price: low to high', 'Lowest trade rate first'],
  ['points', 'Most points', 'Highest points per piece'],
] as const;
const FILTER_KEYS = ['fit', 'pattern', 'color', 'size', 'fabric', 'price'] as const;
const FLAG_KEYS = ['inStock', 'isNew', 'offer', 'discount'] as const;
type SectionKey = 'cat' | 'size' | 'price' | 'color' | 'offers' | 'fit' | 'pattern' | 'fabric' | 'avail';
const SECTIONS: [SectionKey, string][] = [['cat', 'Category'], ['size', 'Size in stock'], ['price', 'Price (trade rate)'], ['color', 'Colour'], ['offers', 'Offers'], ['fit', 'Fit'], ['pattern', 'Pattern'], ['fabric', 'Fabric'], ['avail', 'Availability']];

// Coming-soon list from GET /api/catalogue/upcoming. Colour names map to swatches here (the list has no hex).
interface Upcoming { name: string; kind: string; pattern: string; color: string; hex?: string; when: string }
const SWATCH: Record<string, string> = { Rust: '#9A4A2B', Bottle: '#244233', Grey: '#8C919A', Maroon: '#6C2432', Navy: '#1F2A44', Olive: '#5B6236', Khaki: '#B9A27A', Charcoal: '#3A3D42', Black: '#1B1C1E', White: '#F4F3EF', Stone: '#CFC6B4' };

export default function Catalogue() {
  const { t } = useT();
  const [sp, setSp] = useSearchParams();
  const view = sp.get('view') === 'soon' ? 'soon' : 'now';
  const { data: soon, error: soonErr } = useQuery<Upcoming[]>(view === 'soon' ? '/api/catalogue/upcoming' : null, { staleMs: 600_000 });
  const q = sp.get('q') ?? '';
  const shelf = q ? undefined : shelfOf(sp.get('shelf'));
  const cat = shelf?.category ?? sp.get('cat') ?? (q ? '' : 'Shirts');
  const sort = sp.get('sort') ?? 'best';
  const [text, setText] = useState(q);
  const [sheet, setSheet] = useState<'filters' | 'sort' | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (sp.get('focus')) { inputRef.current?.focus(); const n = new URLSearchParams(sp); n.delete('focus'); setSp(n, { replace: true }); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => { setText(q); }, [q]);
  // Debounce typing into the URL (and the request).
  useEffect(() => {
    if (text === q) return;
    const id = setTimeout(() => update({ q: text || null, shelf: text ? null : sp.get('shelf'), cat: text ? null : cat || 'Shirts' }), 250);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  function update(patch: Record<string, string | null>) {
    const n = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) if (v === null || v === '') n.delete(k); else n.set(k, v);
    setSp(n, { replace: true });
  }
  const list = (k: string) => (sp.get(k) ?? '').split(',').filter(Boolean);
  function toggle(k: string, v: string) { const cur = list(k); update({ [k]: (cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v]).join(',') || null }); }

  const apiQs = useMemo(() => {
    const n = new URLSearchParams();
    if (q) n.set('q', normaliseQuery(q)); else if (shelf) n.set('shelf', shelf.key); else if (cat) n.set('category', cat);
    for (const k of FILTER_KEYS) if (sp.get(k)) n.set(k, sp.get(k)!);
    for (const k of FLAG_KEYS) if (sp.get(k)) n.set(k, sp.get(k)!);
    n.set('sort', sort);
    return n.toString();
  }, [q, cat, shelf, sort, sp]);
  const key = `/api/catalogue?${apiQs}`;
  const { data, error, refresh } = useQuery<CataloguePage>(view === 'now' ? key : null, { staleMs: 60_000 });
  // Keep showing the previous results while the next set loads (no flash of skeletons).
  const last = useRef<CataloguePage | undefined>(undefined);
  if (data) last.current = data;
  const shown = data ?? last.current;
  const stale = !data && !!last.current;
  useEffect(() => { seedStyles(data?.items); }, [data]);

  const [loadingMore, setLoadingMore] = useState(false);
  async function more() {
    const cur = getCached<CataloguePage>(key);
    if (!cur?.nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const pg = await api.get<CataloguePage>(`${key}&cursor=${encodeURIComponent(cur.nextCursor)}`);
      seedStyles(pg.items);
      setCached<CataloguePage>(key, p => p && ({ ...p, items: dedupe([...p.items, ...pg.items]), nextCursor: pg.nextCursor, total: pg.total ?? p.total, facets: p.facets ?? pg.facets }));
    } catch { /* the sentinel retries when it comes into view again */ } finally { setLoadingMore(false); }
  }
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current; if (!el) return;
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) more(); }, { rootMargin: '900px' });
    io.observe(el);
    return () => io.disconnect();
  });

  const nf = Number(!!shelf) + FILTER_KEYS.reduce((a, k) => a + list(k).length, 0) + FLAG_KEYS.filter(k => sp.get(k)).length;
  const clearAll = () => update(Object.fromEntries([...FILTER_KEYS, ...FLAG_KEYS, 'shelf'].map(k => [k, null])));
  const applied: { label: string; off: () => void }[] = [
    ...(shelf ? [{ label: shelf.label, off: () => update({ shelf: null }) }] : []),
    ...FILTER_KEYS.flatMap(k => list(k).map(v => ({ label: k === 'price' ? PRICE_BANDS.find(b => b.key === v)?.label ?? v : k === 'size' ? `Size ${v}` : v, off: () => toggle(k, v) }))),
    ...(sp.get('offer') ? [{ label: 'On offer', off: () => update({ offer: null }) }] : []),
    ...(sp.get('discount') ? [{ label: `${sp.get('discount')}% off or more`, off: () => update({ discount: null }) }] : []),
    ...(sp.get('inStock') ? [{ label: 'In stock', off: () => update({ inStock: null }) }] : []),
    ...(sp.get('isNew') ? [{ label: 'New', off: () => update({ isNew: null }) }] : []),
  ];
  const sortLabel = SORTS.find(s => s[0] === sort)?.[1] ?? 'Best for your store';
  const total = shown?.total ?? shown?.items.length ?? 0;
  const hexes = useMemo(() => { const m: Record<string, string> = {}; for (const s of shown?.items ?? []) for (const c of s.colors) m[c.name] = c.hex; return m; }, [shown]);

  return (
    <>
      <div className="stack">
        <div className="sec-h" style={{ flexWrap: 'wrap' }}>
          <h1 className="title">{t('catalogue')}</h1>
          <div className="chips" role="tablist" aria-label="Collection">
            <button type="button" className="chip" role="tab" aria-selected={view === 'now'} aria-pressed={view === 'now'} onClick={() => update({ view: null })}>{t('availableNow')}</button>
            <button type="button" className="chip" role="tab" aria-selected={view === 'soon'} aria-pressed={view === 'soon'} onClick={() => update({ view: 'soon' })}><Icon name="lock" size={14} />{t('comingSoon')}</button>
          </div>
        </div>
        {view === 'now' && (
          <>
            <div className="searchrow">
              <label className="search"><Icon name="search" /><span className="sr">{t('search')}</span>
                <input ref={inputRef} type="search" placeholder={t('search')} value={text} onChange={e => setText(e.target.value)} autoComplete="off" enterKeyHint="search" />
                {text && <button type="button" onClick={() => setText('')} aria-label="Clear search" style={{ width: 32, height: 32, display: 'grid', placeItems: 'center' }}><Icon name="x" size={16} /></button>}
              </label>
              <VoiceButton onResult={v => setText(v)} />
            </div>
            <div className="chips catchips">
              {CATS.map(c => <button type="button" key={c} className="chip" aria-pressed={!q && !shelf && cat === c} onClick={() => { setText(''); update({ cat: c, shelf: null, q: null, fit: null, pattern: null, color: null }); }}>{c}</button>)}
              <span className="chipsep" aria-hidden="true" />
              {SHELVES.map(x => <button type="button" key={x.key} className="chip" aria-pressed={shelf?.key === x.key} onClick={() => { setText(''); update({ shelf: shelf?.key === x.key ? null : x.key, cat: x.category, q: null, fit: null, pattern: null, color: null, size: null, fabric: null }); }}>{x.label}</button>)}
              <button type="button" className="chip" aria-pressed={!!sp.get('isNew')} onClick={() => update({ isNew: sp.get('isNew') ? null : '1' })}>New</button>
              <button type="button" className="chip" aria-pressed={!!sp.get('offer')} onClick={() => update({ offer: sp.get('offer') ? null : '1' })}><span className="dealdot" />Offers</button>
            </div>
          </>
        )}
      </div>

      {view === 'soon' ? (
        <div className="stack">
          <div className="note info"><Icon name="lock" size={18} /><div className="grow"><b>Preview only.</b>Seasonal Ready Stock and Forward Stock open for ordering after the NOS launch. Your CITRUS rep will tell you when.</div></div>
          <div className="grid">
            {soon?.map(p => (
              <div key={p.name} className="ptile">
                <div className="img"><Garment spec={{ kind: p.kind, pattern: p.pattern, fit: 'Regular', hex: p.hex ?? SWATCH[p.color] ?? '#8C919A', name: p.name, color: p.color }} /><div className="lock"><span><Icon name="lock" size={14} /> Coming soon</span></div></div>
                <div><div className="nm">{p.name}</div><div className="meta">{p.color} · {p.when}</div></div>
              </div>
            ))}
          </div>
          {!soon && !soonErr && <TileSkeletons n={4} />}
          {soonErr && !soon && <ErrorNote error={soonErr} />}
        </div>
      ) : (
        <div className="catlay">
        <aside className="fside" aria-label="Filters">
          <div className="fside-h"><b>FILTERS</b>{nf > 0 && <button type="button" className="linkbtn" onClick={clearAll}>Clear all</button>}</div>
          <FilterBody mode="side" sp={sp} q={q} cat={cat} facets={shown?.facets} hexes={hexes} list={list} toggle={toggle} update={update} setText={setText} />
        </aside>
        <div className="stack" aria-busy={stale}>
          <div className="catbar">
            <div className="muted" style={{ fontSize: 13 }} aria-live="polite"><b style={{ color: 'var(--ink)' }}>{shelf ? shelf.label : !q && cat ? cat : 'Results'}</b> · {num(total)} style{total === 1 ? '' : 's'}{q ? ` for "${q}"` : ''}</div>
            <label className="sortsel hide-sm"><span className="muted">Sort by:</span>
              <select value={sort} onChange={e => update({ sort: e.target.value === 'best' ? null : e.target.value })}>{SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              <Icon name="down" size={14} />
            </label>
          </div>
          {applied.length > 0 && (
            <div className="applied">
              {applied.map(a => <button type="button" key={a.label} className="achip" onClick={a.off}>{a.label}<Icon name="x" size={12} /></button>)}
              <button type="button" className="linkbtn" onClick={clearAll}>Clear all</button>
            </div>
          )}
          {error && !shown && <ErrorNote error={error} onRetry={refresh} context="Help finding a style in the CITRUS catalogue" />}
          {!shown && !error && <TileSkeletons n={8} />}
          {shown && (
            <>
              {shown.items.length === 0 ? (
                <div className="empty card"><b>No styles match.</b><br />Try removing a filter or searching a broader word like "shirt".</div>
              ) : (
                <div style={{ opacity: stale ? 0.55 : 1, transition: 'opacity .15s' }}>
                  <VirtualGrid items={shown.items} keyOf={(s: StyleCard) => s.id} render={s => <ProductTile style={s} color={pickColor(s, list('color'))} />} />
                </div>
              )}
              <div ref={sentinel} aria-hidden="true" style={{ height: 1 }} />
              {shown.nextCursor && <div className="row" style={{ justifyContent: 'center' }}><button type="button" className="btn sec" onClick={more} disabled={loadingMore}>{loadingMore ? 'Loading more…' : `Show more (${num(total - shown.items.length)} left)`}</button></div>}
            </>
          )}
        </div>
        </div>
      )}

      {view === 'now' && (
        <div className="sfbar" role="group" aria-label="Sort and filter">
          <button type="button" onClick={() => setSheet('sort')}><Icon name="down" size={16} /><span><b>Sort</b><small>{sortLabel}</small></span></button>
          <button type="button" onClick={() => setSheet('filters')}><Icon name="filter" size={16} /><span><b>Filter{nf ? ` (${nf})` : ''}</b><small>{nf ? 'Applied' : shelf ? shelf.label : 'Category, size, colour…'}</small></span></button>
        </div>
      )}

      <Sheet open={sheet === 'filters'} onClose={() => setSheet(null)} label="Filters" title="Filters">
        <FilterBody mode="tabs" sp={sp} q={q} cat={cat} facets={shown?.facets} hexes={hexes} list={list} toggle={toggle} update={update} setText={setText} />
        <div className="row fsheet-foot">
          <button type="button" className="btn sec" onClick={clearAll} disabled={!nf}>Clear all</button>
          <button type="button" className="btn" style={{ flex: 1 }} onClick={() => setSheet(null)}>Show {num(total)} style{total === 1 ? '' : 's'}</button>
        </div>
      </Sheet>

      <Sheet open={sheet === 'sort'} onClose={() => setSheet(null)} label="Sort" title="Sort by" initialFocus='[aria-checked="true"]'>
        <div className="stack" role="radiogroup" aria-label="Sort by" style={{ gap: 8 }}>
          {SORTS.map(([k, l, d]) => (
            <button type="button" key={k} role="radio" aria-checked={sort === k} className="card sortopt" onClick={() => { update({ sort: k === 'best' ? null : k }); setSheet(null); }}>
              <b>{l}</b><span className="muted" style={{ fontSize: 13 }}>{d}</span>
            </button>
          ))}
        </div>
      </Sheet>
    </>
  );
}

type Facets = CataloguePage['facets'] | undefined;
function FilterBody({ mode, sp, q, cat, facets, hexes, list, toggle, update, setText }: {
  mode: 'side' | 'tabs'; sp: URLSearchParams; q: string; cat: string; facets: Facets; hexes: Record<string, string>;
  list: (k: string) => string[]; toggle: (k: string, v: string) => void; update: (p: Record<string, string | null>) => void; setText: (v: string) => void;
}) {
  const [tab, setTab] = useState<SectionKey>('cat');
  const count = (k: SectionKey) => k === 'cat' ? Number(!!sp.get('shelf')) : k === 'offers' ? Number(!!sp.get('offer')) + Number(!!sp.get('discount')) : k === 'avail' ? Number(!!sp.get('inStock')) + Number(!!sp.get('isNew')) : list(k).length;
  const body = (k: SectionKey) => {
    switch (k) {
      case 'cat': {
        const sh = q ? undefined : shelfOf(sp.get('shelf'));
        const go = (c: string, key: string | null) => { setText(''); update({ cat: c, shelf: key, q: null, fit: null, pattern: null, color: null, size: null, fabric: null }); };
        return <div className="fopts">{CATS.map(c => (
          <div key={c} className="fgroup">
            <Opt radio on={!q && !sh && cat === c} onClick={() => go(c, null)}>All {c.toLowerCase()}</Opt>
            {SHELVES.filter(x => x.category === c).map(x => <Opt key={x.key} radio on={sh?.key === x.key} onClick={() => go(c, x.key)}><span className="fsub">{x.label}</span></Opt>)}
          </div>
        ))}</div>;
      }
      case 'size': return <div className="fsizes">{(facets?.size ?? []).map(f => <button type="button" key={f.value} className="fsize" aria-pressed={list('size').includes(f.value)} onClick={() => toggle('size', f.value)}><b>{f.value}</b><small>{num(f.n)}</small></button>)}{!facets?.size?.length && <span className="muted xs">Pick a category to see sizes.</span>}</div>;
      case 'price': return <div className="fopts">{PRICE_BANDS.map(b => { const n = facets?.price?.find(f => f.value === b.key)?.n ?? 0; return <Opt key={b.key} on={list('price').includes(b.key)} n={n} disabled={!n && !list('price').includes(b.key)} onClick={() => toggle('price', b.key)}>{b.label}</Opt>; })}</div>;
      case 'color': return <Many k="color" facets={facets?.color} sel={list('color')} toggle={toggle} hexes={hexes} />;
      case 'offers': return (
        <div className="fopts">
          <Opt on={!!sp.get('offer')} n={facets?.offer?.[0]?.n} onClick={() => update({ offer: sp.get('offer') ? null : '1' })}><span className="deal-ink" style={{ fontWeight: 600 }}>On offer now</span></Opt>
          {DISCOUNT_STEPS.map(d => { const n = facets?.discount?.find(f => f.value === String(d))?.n ?? 0; return <Opt key={d} radio on={sp.get('discount') === String(d)} n={n} disabled={!n && sp.get('discount') !== String(d)} onClick={() => update({ discount: sp.get('discount') === String(d) ? null : String(d) })}>{d}% off and above</Opt>; })}
        </div>
      );
      case 'fit': return <Many k="fit" facets={facets?.fit} sel={list('fit')} toggle={toggle} />;
      case 'pattern': return <Many k="pattern" facets={facets?.pattern} sel={list('pattern')} toggle={toggle} />;
      case 'fabric': return <Many k="fabric" facets={facets?.fabric} sel={list('fabric')} toggle={toggle} />;
      case 'avail': return (
        <div className="fopts">
          <Opt on={!!sp.get('inStock')} onClick={() => update({ inStock: sp.get('inStock') ? null : '1' })}>Ready stock only (NOS in stock now)</Opt>
          <Opt on={!!sp.get('isNew')} onClick={() => update({ isNew: sp.get('isNew') ? null : '1' })}>New arrivals</Opt>
        </div>
      );
    }
  };
  if (mode === 'side') return <>{SECTIONS.map(([k, l]) => <section key={k} className="fsec"><h4>{l}</h4>{body(k)}</section>)}</>;
  return (
    <div className="ftabs">
      <div className="ftabs-l" role="tablist" aria-label="Filter by">
        {SECTIONS.map(([k, l]) => <button type="button" key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}{count(k) > 0 && <span className="fcount">{count(k)}</span>}</button>)}
      </div>
      <div className="ftabs-r" role="tabpanel">{body(tab)}</div>
    </div>
  );
}

function Opt({ on, n, radio, disabled, onClick, children }: { on: boolean; n?: number; radio?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={`fopt${radio ? ' radio' : ''}`} role={radio ? 'radio' : 'checkbox'} aria-checked={on} disabled={disabled} onClick={onClick}>
      <span className="fbox" aria-hidden="true">{on && <Icon name="check" size={12} />}</span>
      <span className="fl">{children}</span>{n !== undefined && <span className="fn num">({num(n)})</span>}
    </button>
  );
}

function Many({ k, facets, sel, toggle, hexes }: { k: string; facets?: Facet[]; sel: string[]; toggle: (k: string, v: string) => void; hexes?: Record<string, string> }) {
  const [all, setAll] = useState(false);
  const vals: Facet[] = [...(facets ?? [])];
  for (const s of sel) if (!vals.some(f => f.value === s)) vals.push({ value: s, n: 0 });
  if (!vals.length) return <span className="muted xs">Nothing to filter here.</span>;
  const shown = all ? vals : vals.slice(0, 7);
  return (
    <div className="fopts">
      {shown.map(f => <Opt key={f.value} on={sel.includes(f.value)} n={f.n} disabled={!f.n && !sel.includes(f.value)} onClick={() => toggle(k, f.value)}>{hexes && <span className="sw" style={{ background: hexes[f.value] ?? 'var(--tile-2)' }} />}{f.value}</Opt>)}
      {vals.length > 7 && <button type="button" className="linkbtn fmore" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `+ ${vals.length - 7} more`}</button>}
    </div>
  );
}

const dedupe = (l: StyleCard[]) => { const seen = new Set<string>(); return l.filter(s => (seen.has(s.id) ? false : (seen.add(s.id), true))); };
const pickColor = (s: StyleCard, wanted: string[]) => s.colors.find(c => wanted.includes(c.name))?.name;
