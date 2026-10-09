// The cart is a working order: every size is a typed cell with live stock, edited in place and autosaved.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { Cart, CartLine, Order, StockConflict, StyleCard } from '@citrus/shared';
import { api, ApiError, uuid } from '../../lib/api';
import { setCached } from '../../lib/query';
import { inr, num } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { cart, useCart, type SaveStatus } from '../../state/cart';
import { applyStock, avail, LOW, sizesOf, spec, useStockVersion, useStyles } from '../../state/catalogue';
import { upsertOrder } from '../../state/orders';
import { useMe } from '../../state/session';
import { quickAdd } from '../../state/ui';
import { toast } from '../../state/toast';
import { Garment } from '../../components/Garment';
import { Icon } from '../../components/Icon';
import { PLink } from '../../components/PLink';
import { ContactButtons } from '../../components/Contact';
import { enterNext } from '../../components/QtyGrid';

type Conflict = StockConflict['lines'];
interface Group { styleId: string; color: string; lines: CartLine[] }

function groupLines(lines: CartLine[]): Group[] {
  const m = new Map<string, Group>();
  for (const l of lines) {
    const k = l.styleId + '|' + l.color;
    if (!m.has(k)) m.set(k, { styleId: l.styleId, color: l.color, lines: [] });
    m.get(k)!.lines.push(l);
  }
  return [...m.values()];
}

export default function CartPage() {
  const v = useCart();
  const me = useMe();
  const { t } = useT();
  const nav = useNavigate();
  useStockVersion();
  // A card stays while its cells are being edited (clearing the last size must not make it vanish under the cursor).
  // It leaves only when removed with the x (Undo brings it back) or when its colour is moved.
  const order = useRef<string[]>([]);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const groups = useMemo(() => {
    const cur = groupLines(v.lines);
    for (const g of cur) { const k = g.styleId + '|' + g.color; if (!order.current.includes(k)) order.current.push(k); }
    return order.current.filter(k => !removed.has(k) || cur.some(g => g.styleId + '|' + g.color === k)).map(k => {
      const [styleId, color] = k.split('|');
      return cur.find(g => g.styleId === styleId && g.color === color) ?? { styleId, color, lines: [] };
    });
  }, [v.lines, removed]);
  const hide = (k: string, on: boolean) => setRemoved(s => { const n = new Set(s); if (on) n.add(k); else n.delete(k); return n; });
  const styles = useStyles(v.lines.map(l => l.styleId));
  const [phase, setPhase] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [changedElsewhere, setChangedElsewhere] = useState(false);
  const [placeErr, setPlaceErr] = useState<ApiError | null>(null);
  const attempt = useRef<{ key: string; version: number } | null>(null);
  const dist = me.retailer?.distributor;

  const pieces = v.pieces;
  const value = v.lines.reduce((a, l) => a + l.qty * (styles[l.styleId]?.rate ?? 0), 0);
  const points = v.lines.reduce((a, l) => a + l.qty * (styles[l.styleId]?.points ?? 0), 0);
  const open = conflict?.filter(c => v.qty(c.styleId, c.color, c.size) > c.available) ?? [];
  useEffect(() => { if (conflict && !open.length) { setConflict(null); toast('All fixed. Ready to place'); } }, [conflict, open.length]);
  const flagged = new Set(open.map(c => `${c.styleId}|${c.color}|${c.size}`));
  const blocked = !!phase || open.length > 0 || !pieces;

  async function place() {
    if (phase) return; // a double tap never makes two orders
    setPlaceErr(null); setChangedElsewhere(false);
    setPhase('Checking live stock…');
    const slow = setTimeout(() => setPhase('Placing order…'), 700);
    try {
      const c = await cart.flush();
      if (!attempt.current || attempt.current.version !== c.version) attempt.current = { key: uuid(), version: c.version };
      const order = await api.post<Order>('/api/orders', { idempotencyKey: attempt.current.key, cartVersion: c.version });
      attempt.current = null;
      setCached(`/api/orders/${order.id}`, order);
      upsertOrder(order);
      cart.load(true).catch(() => cart.replace({ lines: [], note: '', po: '', updatedAt: new Date().toISOString(), version: c.version + 1 }));
      nav(`/placed/${order.id}`, { viewTransition: true, replace: true });
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError('UNKNOWN', 'Could not place the order.', 0);
      const body = err.body as { code?: string; lines?: Conflict; cart?: Cart } | undefined;
      if (err.status === 409 && (body?.code === 'STOCK_CHANGED' || err.code === 'STOCK_CHANGED') && body?.lines) {
        applyStock(body.lines.map(l => ({ styleId: l.styleId, color: l.color, size: l.size, available: l.available })));
        setConflict(body.lines);
        attempt.current = null;
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else if (err.status === 409 && (body?.code === 'CART_CHANGED' || err.code === 'CART_CHANGED')) {
        if (body?.cart) cart.replace(body.cart); else cart.load(true).catch(() => {});
        attempt.current = null;
        setChangedElsewhere(true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        // Network or server error: keep the same idempotency key so a retry can never create a second order.
        setPlaceErr(err);
      }
    } finally {
      clearTimeout(slow);
      setPhase(null);
    }
  }

  function share() {
    const lines = groups.map(g => { const s = styles[g.styleId]; return `${s?.name ?? g.styleId} (${g.styleId}), ${g.color}: ${g.lines.map(l => `${l.size}×${l.qty}`).join(', ')}`; });
    const text = `CITRUS order draft, ${me.retailer?.store ?? ''}\n${lines.join('\n')}\nTotal ${num(pieces)} pcs · ${inr(value)}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  }

  if (!v.ready) return <><h1 className="title">{t('cart')}</h1><div className="stack" aria-busy="true">{[0, 1].map(i => <div key={i} className="skel card" style={{ height: 210 }} />)}</div></>;
  if (!pieces) {
    return (
      <>
        <h1 className="title">{t('cart')}</h1>
        <div className="card empty">
          <h3>{t('emptyCart')}</h3>
          <p>Reorder your usual from Home, or browse the catalogue.</p>
          <div className="row" style={{ marginTop: 14, justifyContent: 'center' }}>
            <PLink to="/home" className="btn">{t('buyAgain')}</PLink>
            <PLink to="/catalogue" className="btn sec">{t('browse')} {t('catalogue').toLowerCase()}</PLink>
          </div>
        </div>
        <ContactButtons context="I'd like to place an order" />
      </>
    );
  }

  const placeLabel = phase ?? t('place');
  return (
    <>
      <div className="sec-h">
        <h1 className="title">{t('cart')}</h1>
        <div className="stack" style={{ gap: 2, alignItems: 'flex-end' }}>
          <span className="muted num" aria-live="polite">{num(pieces)} pcs · {groups.length} style{groups.length === 1 ? '' : 's'}</span>
          <SaveState s={v.status} />
        </div>
      </div>
      <p className="muted" style={{ marginTop: -4, fontSize: 13 }}>Type any quantity right here. 0 removes a size. Changes save automatically.</p>

      {changedElsewhere && (
        <div className="note warn" role="alert"><Icon name="alert" size={18} /><div className="grow"><b>Your cart changed on another device</b>We've loaded the latest version. Check the quantities below, then place the order again.</div></div>
      )}
      {open.length > 0 && (
        <div className="note bad conflict" role="alert">
          <Icon name="alert" size={20} />
          <div className="grow">
            <b>Availability changed</b>
            <span>Another store's order took some of this stock a moment ago. Nothing was placed. Fix {open.length === 1 ? 'this size' : 'these sizes'} and place again.</span>
            <div className="lines">
              {open.map(c => {
                const s = styles[c.styleId];
                const have = v.qty(c.styleId, c.color, c.size);
                return (
                  <div key={`${c.styleId}|${c.color}|${c.size}`} className="cl">
                    <span><b style={{ display: 'inline' }}>{s?.name ?? c.styleId}</b>, {c.color}, size {c.size}: only <b style={{ display: 'inline' }}>{num(c.available)}</b> available now (you had {num(have)}).</span>
                    <div className="row">
                      {c.available > 0 && <button type="button" className="btn sm" onClick={() => cart.set(c.styleId, c.color, c.size, c.available)}>Update to {num(c.available)}</button>}
                      <button type="button" className="btn sec sm" onClick={() => cart.set(c.styleId, c.color, c.size, 0)}>Remove this size</button>
                    </div>
                  </div>
                );
              })}
            </div>
            {open.length > 1 && <button type="button" className="linkbtn" style={{ marginTop: 10 }} onClick={() => cart.setMany(open.map(c => ({ styleId: c.styleId, color: c.color, size: c.size, qty: c.available })))}>Update all to what's available</button>}
            <div style={{ marginTop: 10 }}><ContactButtons compact context="Stock changed while placing my CITRUS order" /></div>
          </div>
        </div>
      )}

      <div className="cartl">
        <div className="stack">
          {groups.map(g => <CartLineCard key={g.styleId + '|' + g.color} g={g} style={styles[g.styleId]} flagged={flagged} allGroups={groups} hide={hide} />)}
        </div>
        <aside className="card sum" aria-label={t('orderSummary')}>
          <h3>{t('orderSummary')}</h3>
          <div aria-live="polite" className="stack" style={{ gap: 11 }}>
            <div className="r"><span>Pieces</span><b className="num">{num(pieces)}</b></div>
            <div className="r"><span>Styles</span><b className="num">{groups.length}</b></div>
            <div className="r t"><span>Value</span><span className="num">{inr(value)}</span></div>
            <div className="r"><span className="muted">At your wholesale rate. GST as per invoice.</span></div>
            <div className="r"><span>Reward points on this order</span><b className="num" style={{ color: 'var(--citrus-ink)' }}>+{num(points)}</b></div>
          </div>
          <MetaFields distName={dist?.name ?? 'your distributor'} note={v.note} po={v.po} />
          <div className="note info" style={{ fontSize: 12.5 }}><Icon name="users" size={18} /><span>Goes to <b style={{ display: 'inline' }}>{dist?.name ?? 'your distributor'}</b>{dist?.city ? `, ${dist.city},` : ''} for review. Billing and credit stay as today.</span></div>
          {placeErr && (
            <div className="note bad" role="alert"><Icon name={placeErr.isNetwork ? 'wifiOff' : 'alert'} size={18} /><div className="grow">
              <b>{placeErr.isNetwork ? 'Not sent yet: no connection' : 'The order was not placed'}</b>{placeErr.message} Tap Place order again; it will never create two orders.
              <div style={{ marginTop: 8 }}><ContactButtons compact context="I could not place my CITRUS order" /></div>
            </div></div>
          )}
          <button type="button" className="btn block" onClick={place} disabled={blocked} aria-busy={!!phase}>{placeLabel}</button>
          <button type="button" className="btn sec block" onClick={share}><Icon name="wa" size={16} />{t('shareCart')}</button>
          <span className="muted xs" style={{ textAlign: 'center' }}>We check live stock once more before placing. Tapping twice never creates two orders.</span>
        </aside>
      </div>
      <ContactButtons context="Question about my CITRUS cart" />
      <div className="mc-sp" aria-hidden="true" />
      <div className="minicart cartbar">
        <div className="t" aria-live="polite"><b className="num">{inr(value)}</b><span>{num(pieces)} pcs · +{num(points)} pts</span></div>
        <button type="button" className="btn" onClick={place} disabled={blocked}>{placeLabel}</button>
      </div>
    </>
  );
}

function SaveState({ s }: { s: SaveStatus }) {
  const label = { saved: 'Saved', saving: 'Saving…', offline: 'Offline: saved on this phone', error: 'Some changes not saved' }[s];
  return <span className={`savestate ${s}`} role="status"><span className="d" />{label}</span>;
}

function MetaFields({ distName, note, po }: { distName: string; note: string; po: string }) {
  const { t } = useT();
  const [n, setN] = useState(note);
  const [p, setP] = useState(po);
  useEffect(() => { if (document.activeElement?.id !== 'cnote') setN(note); }, [note]);
  useEffect(() => { if (document.activeElement?.id !== 'cpo') setP(po); }, [po]);
  return (
    <>
      <label className="field" style={{ gap: 6 }}><span className="eyebrow">{t('note', { n: distName })}</span>
        <textarea id="cnote" rows={2} maxLength={200} placeholder="e.g. Deliver before Diwali sale" value={n} onChange={e => { setN(e.target.value); cart.setMeta({ note: e.target.value }); }} />
      </label>
      <label className="field" style={{ gap: 6 }}><span className="eyebrow">{t('po')}</span>
        <input id="cpo" className="poin" maxLength={30} autoComplete="off" placeholder="e.g. SBM/24-25/118" value={p} onChange={e => { setP(e.target.value); cart.setMeta({ po: e.target.value }); }} />
      </label>
    </>
  );
}

function CartLineCard({ g, style, flagged, allGroups, hide }: { g: Group; style?: StyleCard; flagged: Set<string>; allGroups: Group[]; hide: (k: string, on: boolean) => void }) {
  const gk = g.styleId + '|' + g.color;
  const v = useCart();
  const zs = style ? sizesOf(style) : g.lines.map(l => l.size);
  const q = g.lines.reduce((a, l) => a + l.qty, 0);

  function remove() {
    const prev = zs.map(z => ({ styleId: g.styleId, color: g.color, size: z, qty: v.qty(g.styleId, g.color, z) })).filter(l => l.qty > 0);
    cart.setMany(prev.map(l => ({ ...l, qty: 0 })));
    hide(gk, true);
    toast(`Removed ${style?.name ?? g.styleId}, ${g.color}`, { undo: () => { hide(gk, false); cart.setMany(prev); } });
  }
  function moveTo(to: string) {
    if (!style || to === g.color) return;
    const prev: CartLine[] = [];
    const next: CartLine[] = [];
    let cut = 0;
    for (const z of zs) {
      const from = v.qty(g.styleId, g.color, z), ex = v.qty(g.styleId, to, z);
      if (!from) continue;
      prev.push({ styleId: g.styleId, color: g.color, size: z, qty: from }, { styleId: g.styleId, color: to, size: z, qty: ex });
      const want = from + ex, got = Math.min(want, avail(style, to, z));
      if (got < want) cut++;
      next.push({ styleId: g.styleId, color: g.color, size: z, qty: 0 }, { styleId: g.styleId, color: to, size: z, qty: got });
    }
    cart.setMany(next);
    hide(gk, true);
    toast(`Changed to ${to}${cut ? `. ${cut} size${cut > 1 ? 's' : ''} reduced to stock` : ''}`, { undo: () => { hide(gk, false); cart.setMany(prev); } });
  }
  const nextColor = style?.colors.find(c => !allGroups.some(x => x.styleId === g.styleId && x.color === c.name))?.name;

  return (
    <div className="card cline" data-line>
      <div className="im"><Garment spec={spec(style, g.color)} /></div>
      <div style={{ minWidth: 0 }}>
        <div className="head">
          <b>{style?.name ?? g.styleId}</b>
          <button type="button" className="rm" onClick={remove} aria-label={`Remove ${style?.name ?? g.styleId}, ${g.color}`}><Icon name="x" size={18} /></button>
        </div>
        <div className="muted" style={{ fontSize: 12.5 }}><span className="mono">{g.styleId}</span>{style && <> · {inr(style.rate)}/pc · +{style.points} pts/pc</>}</div>
        {style && (
          <div className="cedit">
          <label className="csel"><span className="sw" style={{ background: style.colors.find(c => c.name === g.color)?.hex }} />
            <span className="muted">Colour</span>
            <select value={g.color} onChange={e => moveTo(e.target.value)} aria-label={`Colour for ${style.name}`}>
              {style.colors.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
            <Icon name="down" size={14} />
          </label>
          {nextColor && <button type="button" className="csel" onClick={() => quickAdd.open({ styleId: g.styleId, color: nextColor, mode: 'add' })}><Icon name="plus" size={14} />Add a colour</button>}
          </div>
        )}
      </div>
      <div className="chint">Type any quantity in any size. Clear a size to drop it.</div>
      <div className="cgrid" style={{ ['--n' as string]: zs.length }} data-cscope>
        {zs.map(z => {
          const lq = v.qty(g.styleId, g.color, z);
          const n = style ? avail(style, g.color, z) : undefined;
          const k = `${g.styleId}|${g.color}|${z}`;
          const note = v.notes[k];
          const bad = flagged.has(k);
          const out = n === 0 && !lq;
          return (
            <label key={z} className={`cc${bad ? ' flag' : note ? ' capped' : ''}${out ? ' out' : ''}`}>
              <span className="z">{z}</span>
              <input className="cin" inputMode="numeric" pattern="[0-9]*" enterKeyHint="next" autoComplete="off" placeholder="Type" value={lq || ''} disabled={out}
                aria-label={`${style?.name ?? g.styleId}, ${g.color}, size ${z}${n !== undefined ? `, ${n} available` : ''}`}
                onFocus={e => { const el = e.currentTarget; setTimeout(() => { try { el.select(); } catch { /* ignore */ } }, 0); }}
                onChange={e => cart.set(g.styleId, g.color, z, parseInt(e.target.value.replace(/\D/g, '').slice(0, 4), 10) || 0, style)}
                onKeyDown={e => enterNext(e, '.cartl', '.cin', '.sum .btn.block')} />
              <span className="av">{n === undefined ? '…' : n === 0 ? 'Out' : n <= LOW ? `${n} left` : `${num(n)} avail`}</span>
              {note && <span className="rn" role="status">{note}</span>}
            </label>
          );
        })}
      </div>
      <div className="cfoot">
        <span className="num"><b>{num(q)} pcs{style ? ` · ${inr(q * style.rate)}` : ''}</b> <span className="muted">· {q ? (style ? `+${num(q * style.points)} pts` : '') : 'will be removed'}</span></span>
        <span className="acts">
          <button type="button" className="linkbtn" onClick={() => quickAdd.open({ styleId: g.styleId, color: g.color, mode: 'edit' })}>Quick fill</button>
        </span>
      </div>
    </div>
  );
}
