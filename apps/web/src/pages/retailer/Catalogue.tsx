import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { StyleCard } from '@citrus/shared';
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
  ['points', 'Most points', 'Highest points per piece'],
] as const;
const FILTER_KEYS = ['fit', 'pattern', 'color'] as const;

// Coming-soon list from GET /api/catalogue/upcoming. Colour names map to swatches here (the list has no hex).
interface Upcoming { name: string; kind: string; pattern: string; color: string; hex?: string; when: string }
const SWATCH: Record<string, string> = { Rust: '#9A4A2B', Bottle: '#244233', Grey: '#8C919A', Maroon: '#6C2432', Navy: '#1F2A44', Olive: '#5B6236', Khaki: '#B9A27A', Charcoal: '#3A3D42', Black: '#1B1C1E', White: '#F4F3EF', Stone: '#CFC6B4' };

export default function Catalogue() {
  const { t } = useT();
  const [sp, setSp] = useSearchParams();
  const view = sp.get('view') === 'soon' ? 'soon' : 'now';
  const { data: soon, error: soonErr } = useQuery<Upcoming[]>(view === 'soon' ? '/api/catalogue/upcoming' : null, { staleMs: 600_000 });
  const q = sp.get('q') ?? '';
  const cat = sp.get('cat') ?? (q ? '' : 'Shirts');
  const sort = sp.get('sort') ?? 'best';
  const [text, setText] = useState(q);
  const [sheet, setSheet] = useState<'filters' | 'sort' | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (sp.get('focus')) { inputRef.current?.focus(); const n = new URLSearchParams(sp); n.delete('focus'); setSp(n, { replace: true }); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => { setText(q); }, [q]);
  // Debounce typing into the URL (and the request).
  useEffect(() => {
    if (text === q) return;
    const id = setTimeout(() => update({ q: text || null, cat: text ? null : cat || 'Shirts' }), 250);
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
    if (q) n.set('q', normaliseQuery(q)); else if (cat) n.set('category', cat);
    for (const k of FILTER_KEYS) if (sp.get(k)) n.set(k, sp.get(k)!);
    if (sp.get('inStock')) n.set('inStock', '1');
    if (sp.get('isNew')) n.set('isNew', '1');
    n.set('sort', sort);
    return n.toString();
  }, [q, cat, sort, sp]);
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

  const nf = FILTER_KEYS.reduce((a, k) => a + list(k).length, 0) + (sp.get('inStock') ? 1 : 0) + (sp.get('isNew') ? 1 : 0);
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
            <div className="chips">
              {CATS.map(c => <button type="button" key={c} className="chip" aria-pressed={!q && cat === c} onClick={() => { setText(''); update({ cat: c, q: null, fit: null, pattern: null, color: null }); }}>{c}</button>)}
              <button type="button" className="chip" aria-pressed={!!sp.get('isNew')} onClick={() => update({ isNew: sp.get('isNew') ? null : '1' })}>New</button>
              <button type="button" className="chip" onClick={() => setSheet('filters')}><Icon name="filter" size={16} />{t('filters')}{nf ? ` · ${nf}` : ''}</button>
              <button type="button" className="chip" onClick={() => setSheet('sort')}>{t('sort')}: {sortLabel}</button>
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
        <div className="stack" aria-busy={stale}>
          {error && !shown && <ErrorNote error={error} onRetry={refresh} context="Help finding a style in the CITRUS catalogue" />}
          {!shown && !error && <TileSkeletons n={8} />}
          {shown && (
            <>
              <div className="muted" style={{ fontSize: 13 }} aria-live="polite">{num(total)} style{total === 1 ? '' : 's'}{q ? ` for "${q}"` : ''} · NOS · live stock</div>
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
      )}

      <Sheet open={sheet === 'filters'} onClose={() => setSheet(null)} label="Filters" title={`${t('filters')}${!q && cat ? ` · ${cat}` : ''}`}>
        <FacetGroup label="Fit" k="fit" facets={shown?.facets?.fit} sel={list('fit')} onToggle={toggle} />
        <FacetGroup label="Pattern" k="pattern" facets={shown?.facets?.pattern} sel={list('pattern')} onToggle={toggle} />
        <FacetGroup label="Colour" k="color" facets={shown?.facets?.color} sel={list('color')} onToggle={toggle} hexes={hexes} />
        <div className="fgroup"><div className="eyebrow">Availability</div><div className="chips">
          <button type="button" className="chip" aria-pressed={!!sp.get('inStock')} onClick={() => update({ inStock: sp.get('inStock') ? null : '1' })}>Only styles with stock</button>
          <button type="button" className="chip" aria-pressed={!!sp.get('isNew')} onClick={() => update({ isNew: sp.get('isNew') ? null : '1' })}>New styles</button>
        </div></div>
        <div className="row">
          <button type="button" className="btn" style={{ flex: 1 }} onClick={() => setSheet(null)}>Show {num(total)} result{total === 1 ? '' : 's'}</button>
          <button type="button" className="btn sec" onClick={() => update({ fit: null, pattern: null, color: null, inStock: null, isNew: null })}>Clear all</button>
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

function FacetGroup({ label, k, facets, sel, onToggle, hexes }: { label: string; k: string; facets?: Facet[]; sel: string[]; onToggle: (k: string, v: string) => void; hexes?: Record<string, string> }) {
  const vals: Facet[] = [...(facets ?? [])];
  for (const s of sel) if (!vals.some(f => f.value === s)) vals.push({ value: s, n: 0 });
  if (!vals.length) return null;
  return (
    <div className="fgroup">
      <div className="eyebrow">{label}</div>
      <div className="chips">
        {vals.map(f => (
          <button type="button" key={f.value} className="chip" aria-pressed={sel.includes(f.value)} onClick={() => onToggle(k, f.value)} disabled={!f.n && !sel.includes(f.value)}>
            {hexes && <span className="sw" style={{ background: hexes[f.value] ?? 'var(--tile-2)' }} />}{f.value}<span className="muted num" style={{ fontWeight: 500 }}>{num(f.n)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const dedupe = (l: StyleCard[]) => { const seen = new Set<string>(); return l.filter(s => (seen.has(s.id) ? false : (seen.add(s.id), true))); };
const pickColor = (s: StyleCard, wanted: string[]) => s.colors.find(c => wanted.includes(c.name))?.name;
