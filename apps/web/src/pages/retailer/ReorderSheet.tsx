// Restock preview: for every style and size, what the store asked for last time next to what is in stock today.
// Quantities start at what can be sent and stay editable. Nothing is skipped silently and nothing is added
// until the retailer taps Add. Used by "Restock last order", the best-seller cards and Order history.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import type { Order } from '@citrus/shared';
import { api, ApiError } from '../../lib/api';
import { dmy, inr, num } from '../../lib/format';
import { avail, sizesOf, spec, useStyles } from '../../state/catalogue';
import { cart } from '../../state/cart';
import { toast } from '../../state/toast';
import { Sheet } from '../../components/Sheet';
import { Garment } from '../../components/Garment';
import { Icon } from '../../components/Icon';
import { ErrorNote } from '../../components/Bits';
import { tradeRate } from '../../components/Price';
import { SmartLoader } from '../../components/SmartLoader';

export type RestockItem = { styleId: string; color: string; want: Record<string, number> };
export type ReorderRef = { orderId: string; number?: string; placedAt?: string } | { items: RestockItem[]; title: string; eyebrow?: string; usual?: boolean };

export function ReorderSheet({ card, onClose }: { card: ReorderRef | null; onClose: () => void }) {
  const orderId = card && 'orderId' in card ? card.orderId : undefined;
  const [order, setOrder] = useState<Order | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const load = () => { if (!orderId) return; setOrder(null); setErr(null); api.get<Order>(`/api/orders/${encodeURIComponent(orderId)}`).then(setOrder, e => setErr(e)); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [orderId]);

  const items: RestockItem[] | null = useMemo(() => {
    if (!card) return null;
    if ('items' in card) return card.items;
    if (!order) return null;
    const m = new Map<string, RestockItem>();
    for (const l of order.lines) {
      const k = `${l.styleId}|${l.color}`;
      if (!m.has(k)) m.set(k, { styleId: l.styleId, color: l.color, want: {} });
      m.get(k)!.want[l.size] = (m.get(k)!.want[l.size] ?? 0) + l.qty;
    }
    return [...m.values()];
  }, [card, order]);

  const eyebrow = !card ? '' : 'items' in card ? card.eyebrow ?? 'Restock' : `Restock · ${card.number ?? ''}${card.placedAt ? ` · ${dmy(card.placedAt)}` : ''}`;
  const title = !card ? '' : 'items' in card ? card.title : 'Review sizes before adding';
  return (
    <Sheet open={!!card} onClose={onClose} label="Restock" eyebrow={eyebrow} title={title} wide>
      {err && <ErrorNote error={err} onRetry={load} context="Restock" />}
      {!items && !err && <SmartLoader context="reorder" delay={300} />}
      {items && <RestockBody key={eyebrow + title} items={items} onClose={onClose} usual={!!card && 'items' in card && !!card.usual} />}
    </Sheet>
  );
}

function RestockBody({ items, onClose, usual }: { items: RestockItem[]; onClose: () => void; usual: boolean }) {
  const styles = useStyles(items.map(i => i.styleId));
  const nav = useNavigate();
  const ready = items.every(i => styles[i.styleId]);
  const [qty, setQty] = useState<Record<string, number> | null>(null);
  // Start every size at what can be sent today: the usual quantity, or all that is left if stock is short.
  useEffect(() => {
    if (!ready || qty) return;
    const q: Record<string, number> = {};
    for (const i of items) for (const [z, w] of Object.entries(i.want)) q[`${i.styleId}|${i.color}|${z}`] = Math.min(w, avail(styles[i.styleId]!, i.color, z));
    setQty(q);
  }, [ready, qty, items, styles]);
  if (!ready || !qty) return <SmartLoader context="reorder" delay={300} />;

  let pcs = 0, value = 0, short = 0, over = 0;
  for (const i of items) {
    const s = styles[i.styleId]!;
    for (const z of sizesOf(s)) {
      const k = `${i.styleId}|${i.color}|${z}`, q = qty[k] ?? 0, a = avail(s, i.color, z), w = i.want[z] ?? 0;
      pcs += q; value += q * tradeRate(s);
      if (w > a) short++;
      if (q > a) over++;
    }
  }
  function add() {
    const lines = Object.entries(qty!).filter(([, q]) => q > 0).map(([k, q]) => { const [styleId, color, size] = k.split('|'); return { styleId, color, size, qty: q }; });
    const r = cart.add(lines, styles);
    onClose(); nav('/cart');
    toast(`${num(r.added)} pcs added to your cart. You can still change any size there.`);
  }
  return (
    <div className="stack rs" style={{ gap: 14 }}>
      <p className="muted small" style={{ margin: 0 }}>Each size starts at what we can send today. Change any number before adding.</p>
      <div className="rs-key"><span><i className="ok" />In stock</span><span><i className="low" />Less than you asked</span><span><i className="out" />Out of stock</span></div>
      {items.map(i => {
        const s = styles[i.styleId]!;
        const asked = Object.values(i.want).reduce((a, b) => a + b, 0);
        return (
          <div key={i.styleId + i.color} className="card rs-style">
            <div className="rs-h">
              <span className="im"><Garment spec={spec(s, i.color)} /></span>
              <span className="grow" style={{ minWidth: 0 }}><b>{s.name}</b><span className="muted small"><span className="mono">{s.id}</span> · {i.color} · {inr(tradeRate(s))}/pc</span><span className="muted xs">{usual ? `Your usual order: ${num(asked)} pcs` : `You ordered ${num(asked)} pcs last time`}</span></span>
            </div>
            <div className="rs-sizes">
              {sizesOf(s).filter(z => i.want[z] !== undefined || avail(s, i.color, z) > 0).map(z => {
                const k = `${i.styleId}|${i.color}|${z}`, a = avail(s, i.color, z), w = i.want[z] ?? 0, q = qty[k] ?? 0;
                const tone = a === 0 ? 'out' : w > a ? 'low' : 'ok';
                return (
                  <label key={z} className={`rs-z ${tone}${q > a ? ' over' : ''}`}>
                    <b>{z}</b>
                    <input className="qin" inputMode="numeric" value={q || ''} placeholder="0" disabled={a === 0} aria-label={`${s.name} ${i.color} size ${z}`}
                      onChange={e => setQty({ ...qty!, [k]: Math.max(0, Math.floor(Number(e.target.value.replace(/\D/g, '')) || 0)) })} />
                    <small>{a === 0 ? 'Out of stock' : q > a ? `Only ${num(a)} left` : w > a ? `${usual ? 'Usual' : 'Last time'} ${num(w)}, ${num(a)} left` : `${num(a)} in stock`}</small>
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
      {short > 0 && <div className="note warn"><Icon name="alert" size={18} /><div className="grow"><b>{short} size{short > 1 ? 's are' : ' is'} short today</b>They are set to what is in stock. Nothing else changes.</div></div>}
      <div className="rs-foot">
        <span><b className="num">{num(pcs)} pcs</b><span className="muted"> · {inr(value)}</span></span>
        <button type="button" className="btn" disabled={!pcs || over > 0} onClick={add} data-gadd><Icon name="cart" size={16} />{over ? 'Fix the red sizes' : `Add ${num(pcs)} pcs to cart`}</button>
      </div>
    </div>
  );
}
