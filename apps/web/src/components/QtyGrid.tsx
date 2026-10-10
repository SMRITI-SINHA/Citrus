// Quantity entry, built so buyers never tap + fifty times:
// typed input per size (numeric keypad, select on focus, Enter moves to the next size, capped at live stock),
// a total split by the store's size ratio, set chips, "Same as last time", Clear, and "Add these sizes in all colours".
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { Category, HomeResponse } from '@citrus/shared';
import { api } from '../lib/api';
import { setCached, useQuery } from '../lib/query';
import type { StyleCard } from '@citrus/shared';
import { useMyOrders } from '../state/orders';
import { splitByRatio } from '@citrus/shared';
import { avail, lastOrderFor, LOW, ratioOf, sizesOf, useStockVersion } from '../state/catalogue';
import { cart, useCart } from '../state/cart';
import { draft, overStock, useDraft, useOverCount } from '../state/ui';
import { toast } from '../state/toast';
import { dmy, inr, num } from '../lib/format';
import { useT, t as tx } from '../lib/i18n';
import { Icon } from './Icon';
import { PcsChip, PtsChip, SaveChip, savePer, tradeRate, ValueTxt } from './Price';

export interface QtySource { get: (size: string) => number; set: (size: string, q: number) => number; setAll: (m: Record<string, number>) => void; note: (size: string) => string | undefined }

export function useDraftSource(style: StyleCard, color: string): QtySource {
  const d = useDraft(style.id, color);
  const [notes, setNotes] = useState<Record<string, string>>({});
  return {
    get: z => d[z] ?? 0,
    set: (z, q) => {
      const n = avail(style, color, z), want = Math.max(0, Math.floor(q || 0)), got = Math.min(n, want);
      draft.set(style.id, color, { ...draft.get(style.id, color), [z]: got });
      setNotes(p => ({ ...p, [z]: want > n ? (n === 0 ? 'Out of stock' : `Only ${n} available, set to ${n}`) : '' }));
      return got;
    },
    setAll: m => { draft.set(style.id, color, { ...m }); setNotes({}); },
    note: z => notes[z] || undefined,
  };
}

export function useCartSource(style: StyleCard, color: string): QtySource {
  const v = useCart();
  return {
    get: z => v.qty(style.id, color, z),
    set: (z, q) => cart.set(style.id, color, z, q, style),
    setAll: m => cart.setMany(Object.entries(m).map(([size, qty]) => ({ styleId: style.id, color, size, qty }))),
    note: z => v.notes[`${style.id}|${color}|${z}`],
  };
}

/** Focus the next size input inside the same scope; at the end, focus the primary action. */
export function enterNext(e: KeyboardEvent<HTMLInputElement>, scopeSel: string, inputSel: string, endSel = '[data-gadd]') {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const el = e.currentTarget;
  const scope = el.closest(scopeSel) ?? document;
  const all = [...scope.querySelectorAll<HTMLInputElement>(inputSel)].filter(x => !x.disabled);
  const nx = all[all.indexOf(el) + 1];
  if (nx) nx.focus();
  else {
    const root = el.closest('.sheet') ?? document;
    const end = root.querySelector<HTMLElement>(endSel);
    if (end && !(end as HTMLButtonElement).disabled) end.focus(); else el.blur();
  }
}

export function QtyGrid({ style, color, src, showCopy = true, onCopied, scope = 'draft' }: { style: StyleCard; color: string; src: QtySource; showCopy?: boolean; onCopied?: () => void; scope?: 'draft' | 'cart' }) {
  useStockVersion();
  useQuery<HomeResponse>('/api/home', { staleMs: 300_000 }); // the store's size mix lives on /api/home
  const { t } = useT();
  const uid = useId();
  const zs = sizesOf(style), ratio = ratioOf(style), setSize = ratio.reduce((a, b) => a + b, 0);
  const caps = zs.map(z => avail(style, color, z));
  const max = Math.max(1, ...caps);
  const { data: orders } = useMyOrders();
  const last = lastOrderFor(orders, style.id, color);
  const lastTotal = last ? Object.values(last.q).reduce((a, b) => a + b, 0) : 0;
  const [total, setTotal] = useState('');
  const totRef = useRef<HTMLInputElement>(null);
  const pcs = zs.reduce((a, z) => a + src.get(z), 0);
  const overN = useOverCount(`${scope}|${style.id}|${color}|`);

  const want = parseInt(total, 10) || 0;
  const preview = want > 0 ? (() => { const out = splitByRatio(want, ratio, caps); return { n: want, out, got: out.reduce((a, b) => a + b, 0) }; })() : null;

  function split(n: number, label?: string) {
    const out = splitByRatio(n, ratio, caps);
    src.setAll(Object.fromEntries(zs.map((z, i) => [z, out[i]])));
    const got = out.reduce((a, b) => a + b, 0);
    toast(got < n ? `Only ${num(got)} pcs in stock across sizes. Set ${num(got)} of ${num(n)}` : `${label ?? `${num(n)} pcs`} split ${zs.map((z, i) => `${z} ${out[i]}`).join(' · ')}`);
  }
  function doSplit() {
    const n = parseInt(total.replace(/\D/g, ''), 10) || 0;
    if (!n) { toast('Type how many pieces you want in total'); totRef.current?.focus(); return; }
    split(n);
  }
  function sameAsLast() {
    if (!last) return;
    let cut = 0;
    const m: Record<string, number> = {};
    zs.forEach((z, i) => { const want = last.q[z] ?? 0; m[z] = Math.min(want, caps[i]); if (m[z] < want) cut++; });
    src.setAll(m);
    toast(`Filled from ${last.number} (${dmy(last.placedAt)})${cut ? `. ${cut} size${cut > 1 ? 's' : ''} capped at stock` : ''}`);
  }
  function copyAllColours() {
    const lines = style.colors.flatMap(c => zs.map(z => ({ styleId: style.id, color: c.name, size: z, qty: src.get(z) }))).filter(l => l.qty > 0);
    const before = cart.get();
    const prev = lines.map(l => ({ ...l, qty: before.qty(l.styleId, l.color, l.size) }));
    const r = cart.add(lines, { [style.id]: style });
    toast(`${num(r.added)} pcs added across ${style.colors.length} colours${r.capped ? `. ${r.capped} size${r.capped > 1 ? 's' : ''} capped at stock` : ''}`, { undo: () => cart.setMany(prev) });
    onCopied?.();
  }

  return (
    <div className="qgrid">
      <div className="qhint" id={`${uid}-hint`}><Icon name="edit" size={16} /><span><b>{tx('howMany')}</b> {tx('howManySub')}</span></div>
      <div className="sgrid" data-qscope>
        {zs.map((z, i) => <SizeRow key={z} z={z} n={caps[i]} max={max} q={src.get(z)} note={src.note(z)} last={last?.q[z]} hasLast={!!last} src={src} okey={`${scope}|${style.id}|${color}|${z}`} />)}
      </div>
      <div className="qsum" aria-live="polite">
        {overN > 0
          ? <span className="bad-ink"><b>{overN === 1 ? '1 size is' : `${overN} sizes are`} more than the stock.</b> Change the red {overN === 1 ? 'box' : 'boxes'} to add to cart.</span>
          : pcs > 0
          ? <span className="qsum-row"><PcsChip n={pcs} /><span className="muted num">× {inr(tradeRate(style))}</span><ValueTxt amt={pcs * tradeRate(style)} /><SaveChip amt={pcs * savePer(style)} /><PtsChip n={pcs * style.points} /></span>
          : <span className="muted">Nothing typed yet. Tap any box above and type a number.</span>}
      </div>
      <details className="qfill">
        <summary><Icon name="spark" size={14} /><span>Fill sizes for me <span className="muted qf-sub">optional</span></span></summary>
        <div className="qfill-b">
          {(last || pcs > 0) && (
            <div className="chips" role="group" aria-label="Quick fills">
              {last && <button type="button" className="chip" onClick={sameAsLast}><Icon name="back" size={14} />{t('sameAsLast')} · {num(lastTotal)} pcs</button>}
              {pcs > 0 && <button type="button" className="chip" onClick={() => { src.setAll(Object.fromEntries(zs.map(z => [z, 0]))); setTotal(''); }}>{t('clear')} all sizes</button>}
            </div>
          )}
          <SizeMix style={style} />
          <div className="totbox">
            <label htmlFor={`${uid}-tot`}>{tx('howManyTotal')}</label>
            <div className="totrow">
              <input ref={totRef} id={`${uid}-tot`} className="totin" inputMode="numeric" pattern="[0-9]*" enterKeyHint="done" placeholder="Type, e.g. 50" autoComplete="off"
                value={total} onChange={e => setTotal(e.target.value.replace(/\D/g, '').slice(0, 5))} onFocus={e => e.currentTarget.select()}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); doSplit(); } }} />
              <button type="button" className="btn" onClick={doSplit}>Fill the sizes</button>
            </div>
            {preview && (
              <div className="qprev" role="status">
                <span><b>{num(preview.n)} pieces</b> will be filled like this:</span>
                <span className="qprev-row">{zs.map((z, i) => <span key={z} className={preview.out[i] ? '' : 'zero'}><i>{z}</i><b>{preview.out[i]}</b></span>)}</span>
                {zs.some((_z, i) => ratio[i] > 0 && caps[i] === 0) && preview.got === preview.n && <span className="muted xs">{zs.filter((_z, i) => ratio[i] > 0 && caps[i] === 0).join(', ')} is out of stock, so its share went to the other sizes. Change any box after if you prefer.</span>}
                {preview.got < preview.n && <span className="warn-ink xs">Only {num(preview.got)} of {num(preview.n)} are in stock in these sizes. Out-of-stock sizes are left empty, not moved to other sizes.</span>}
              </div>
            )}
            <div className="chips" role="group" aria-label="Sets">
              {[1, 2, 3].map(m => <button type="button" key={m} className="chip" onClick={() => { setTotal(String(setSize * m)); split(setSize * m, `${setSize * m} pcs`); }}>{setSize * m} pcs</button>)}
            </div>
            <span className="muted xs">We fill each size using your size mix above, never more than is in stock. You can change any size after.</span>
          </div>
        </div>
      </details>
      {showCopy && style.colors.length > 1 && (
        <button type="button" className="linkbtn" style={{ alignSelf: 'flex-start' }} disabled={!pcs} onClick={copyAllColours}>
          Add these sizes in all {style.colors.length} colours
        </button>
      )}
    </div>
  );
}

/** "Your size mix": what Fill sizes uses, where it comes from, and a plain editor. One mix per category (shirts, trousers, T-shirts). */
export function SizeMix({ style }: { style: StyleCard }) {
  const { data: home } = useQuery<HomeResponse>('/api/home', { staleMs: 300_000 });
  const cat = style.category as Category;
  const zs = sizesOf(style), mix = ratioOf(style);
  const info = home?.ratioInfo?.[cat];
  const [edit, setEdit] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const noun = cat.toLowerCase();
  const sum = mix.reduce((a, b) => a + b, 0);
  const from = info?.source === 'saved' ? `You set this ${noun} mix. Tap Change to edit it.`
    : `How your store usually buys ${noun}, from your past orders.`;

  async function save(ratio: number[] | null) {
    setBusy(true);
    try {
      const r = await api.put<{ ratios: HomeResponse['ratios']; ratioInfo: HomeResponse['ratioInfo'] }>('/api/me/size-mix', { category: cat, ratio });
      setCached<HomeResponse>('/api/home', prev => (prev ? { ...prev, ratios: r.ratios, ratioInfo: r.ratioInfo } : prev));
      setEdit(null);
      toast(ratio ? `Saved. ${style.category} will fill as ${zs.map((z, i) => `${z} ${ratio[i]}`).join(', ')}` : `Back to the mix from your orders`);
    } catch (e: any) { toast(e?.message ?? 'Could not save. Try again.'); }
    finally { setBusy(false); }
  }

  if (edit) {
    const vals = edit.map(v => parseInt(v, 10) || 0), n = vals.reduce((a, b) => a + b, 0);
    return (
      <div className="mix editing">
        <b>Change your {noun} size mix</b>
        <span className="muted xs">Type how many of each size you want in a typical order of {noun}. Example: S 1, M 3, L 3, XL 2, XXL 1.</span>
        <div className="mixedit" style={{ gridTemplateColumns: `repeat(${zs.length}, minmax(0, 1fr))` }}>
          {zs.map((z, i) => (
            <label key={z}><span>{z}</span>
              <input className="mixin" inputMode="numeric" pattern="[0-9]*" placeholder="Type" autoComplete="off" value={edit[i]}
                aria-label={`${z} in your ${noun} size mix`} onFocus={e => e.currentTarget.select()}
                onChange={e => setEdit(edit.map((v, j) => (j === i ? e.target.value.replace(/\D/g, '').slice(0, 2) : v)))} />
            </label>
          ))}
        </div>
        <span className="muted xs">{n ? `Out of every ${n} pieces: ${zs.map((z, i) => `${vals[i]} ${z}`).join(', ')}.` : 'Type a number in at least one size.'}</span>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn" disabled={!n || busy} onClick={() => save(vals)}>Save my mix</button>
          <button type="button" className="btn sec" disabled={busy} onClick={() => setEdit(null)}>Cancel</button>
          {info?.source === 'saved' && <button type="button" className="linkbtn" disabled={busy} onClick={() => save(null)}>Use my orders instead</button>}
        </div>
      </div>
    );
  }
  return (
    <div className="mix">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <b>Your {noun} size mix</b>
        <button type="button" className="linkbtn" onClick={() => setEdit(mix.map(String))}>Change</button>
      </div>
      <div className="mixbar" aria-label={`For every ${sum} pieces: ${zs.map((z, i) => `${mix[i]} ${z}`).join(', ')}`}>
        {zs.map((z, i) => <span key={z} style={{ flexGrow: Math.max(mix[i], 0.4) }} className={mix[i] ? '' : 'zero'}><b>{mix[i]}</b><i>{z}</i></span>)}
      </div>
      <span className="muted xs">{from}</span>
    </div>
  );
}

/** Typed-quantity state for one size. A number above stock is kept as typed (never lowered silently) and flagged red. */
export function useStockEntry(okey: string, q: number, n: number, set: (v: number) => void) {
  const [typed, setTyped] = useState<number | null>(null);
  useEffect(() => () => overStock.set(okey, null), [okey]);
  useEffect(() => { setTyped(null); overStock.set(okey, null); }, [q, okey]); // changed from outside (fill, clear, undo)
  const over = typed !== null && typed > n ? typed : null;
  useEffect(() => { if (typed !== null && typed <= n) { overStock.set(okey, null); set(typed); } }, [n]); // eslint-disable-line react-hooks/exhaustive-deps
  return {
    value: over !== null ? String(over) : q ? String(q) : '',
    over,
    onText(text: string) {
      const v = parseInt(text.replace(/\D/g, '').slice(0, 4), 10) || 0;
      if (v > n) { setTyped(v); overStock.set(okey, v); }
      else { setTyped(null); overStock.set(okey, null); set(v); }
    },
    useMax() { setTyped(null); overStock.set(okey, null); set(n); },
  };
}

function SizeRow({ z, n, max, q, note, last, hasLast, src, okey }: { z: string; n: number; max: number; q: number; note?: string; last?: number; hasLast: boolean; src: QtySource; okey: string }) {
  const { t } = useT();
  const e = useStockEntry(okey, q, n, v => src.set(z, v));
  return (
    <div className={`srow${n === 0 && !q ? ' out' : ''}${e.over !== null ? ' over' : ''}`}>
      <span className="s" aria-hidden="true">{z}</span>
      <span className="a">
        {n === 0 ? <span className="bad-ink" style={{ fontWeight: 600 }}>{t('out')}</span>
          : n <= LOW ? <b className="warn-ink">{t('only', { n })}</b>
            : <><b>{num(n)}</b> {t('avail')}</>}
        {hasLast && <span className="lastq">{t('lastOrder', { n: last ?? 0 })}</span>}
        <span className="meter" aria-hidden="true"><i style={{ width: `${Math.round((n / max) * 100)}%` }} /></span>
        {e.over !== null
          ? <span className="overmsg" role="alert">Only {num(n)} in stock. You typed {num(e.over)}. {n > 0 && <button type="button" className="linkbtn" onClick={e.useMax}>Use {num(n)}</button>}</span>
          : <span className="rn" role="status">{note}</span>}
      </span>
      <div className="step">
        <button type="button" onClick={() => src.set(z, q - 1)} disabled={q <= 0 || e.over !== null} aria-label={`One less ${z}`} tabIndex={-1}>−</button>
        <input className={`qin${e.over !== null ? ' over' : ''}`} inputMode="numeric" pattern="[0-9]*" enterKeyHint="next" autoComplete="off" placeholder="Type"
          value={e.value} disabled={n === 0 && !q && e.over === null} aria-invalid={e.over !== null} aria-label={`Quantity for size ${z}, ${n} available`}
          onFocus={ev => { const el = ev.currentTarget; setTimeout(() => { try { el.select(); } catch { /* ignore */ } }, 0); }}
          onChange={ev => e.onText(ev.target.value)}
          onKeyDown={ev => enterNext(ev, '[data-qscope]', '.qin')} />
        <button type="button" onClick={() => src.set(z, q + 1)} disabled={q >= n || e.over !== null} aria-label={`One more ${z}`} tabIndex={-1}>+</button>
      </div>
    </div>
  );
}
