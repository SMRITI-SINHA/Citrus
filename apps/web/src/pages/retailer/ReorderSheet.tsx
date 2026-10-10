// Reorder preview: checked against live stock, nothing is added until the retailer confirms.
import { useEffect, useState } from 'react';
import { SmartLoader } from '../../components/SmartLoader';
import { useNavigate } from 'react-router';
import type { Cart } from '@citrus/shared';
import { api, ApiError } from '../../lib/api';
import { dmy, inr, num } from '../../lib/format';
import type { ReorderPreview } from '../../lib/types';
import { skipText } from '../../lib/types';
import { cart } from '../../state/cart';
import { spec, useStyles } from '../../state/catalogue';
import { toast } from '../../state/toast';
import { Sheet } from '../../components/Sheet';
import { Garment } from '../../components/Garment';
import { Icon } from '../../components/Icon';
import { ErrorNote } from '../../components/Bits';

export type ReorderRef = { orderId: string; number?: string; placedAt?: string };

export function ReorderSheet({ card, onClose }: { card: ReorderRef | null; onClose: () => void }) {
  const [pv, setPv] = useState<ReorderPreview | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [adding, setAdding] = useState(false);
  const nav = useNavigate();
  const id = card?.orderId;

  const load = () => {
    if (!id) return;
    setPv(null); setErr(null);
    api.post<ReorderPreview>(`/api/cart/reorder/${encodeURIComponent(id)}/preview`).then(setPv, e => setErr(e));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [id]);

  const styles = useStyles(pv?.lines.map(l => l.styleId) ?? []);
  const groups = new Map<string, { styleId: string; color: string; ls: { size: string; qty: number }[] }>();
  for (const l of pv?.lines ?? []) {
    const k = l.styleId + '|' + l.color;
    if (!groups.has(k)) groups.set(k, { styleId: l.styleId, color: l.color, ls: [] });
    groups.get(k)!.ls.push({ size: l.size, qty: l.qty });
  }
  const ok = pv?.lines.reduce((a, l) => a + l.qty, 0) ?? 0;

  async function confirm() {
    if (!id) return;
    setAdding(true);
    try {
      await cart.flush().catch(() => {});
      const c = await api.post<Cart>(`/api/cart/reorder/${encodeURIComponent(id)}`);
      cart.replace(c);
      onClose();
      nav('/cart');
      toast(`${num(ok)} pcs from ${card?.number ?? id} added. Edit any size below`);
    } catch (e) {
      setErr(e instanceof ApiError ? e : new ApiError('UNKNOWN', String(e), 0));
    } finally { setAdding(false); }
  }

  return (
    <Sheet open={!!card} onClose={onClose} label="Reorder" eyebrow={`Reorder · ${card?.number ?? id ?? ''}${card?.placedAt ? ` · ${dmy(card.placedAt)}` : ''}`} title={pv ? `${num(ok)} pcs ready to add` : err ? 'Reorder' : 'Checking live stock…'}>
      <p className="muted small" style={{ marginTop: -10 }}>Checked against live stock just now. Nothing is added until you confirm.</p>
      {err && <ErrorNote error={err} onRetry={load} context={`Reorder ${card?.number ?? ''}`} />}
      {!pv && !err && <SmartLoader context="reorder" delay={300} />}
      {pv && (
        <>
          <div className="card" style={{ padding: '4px 14px' }}>
            {[...groups.values()].map(g => {
              const s = styles[g.styleId];
              return (
                <div key={g.styleId + g.color} className="rrow">
                  <span className="im"><Garment spec={spec(s, g.color)} /></span>
                  <span style={{ minWidth: 0 }}><b>{s?.name ?? g.styleId}</b><span className="muted">{g.color} · {g.ls.map(l => `${l.size} ${l.qty}`).join(' · ')}</span></span>
                  <b className="num">{num(g.ls.reduce((a, l) => a + l.qty, 0))}</b>
                </div>
              );
            })}
            {!groups.size && <div className="empty" style={{ padding: 20 }}>Nothing from this order is in stock right now.</div>}
          </div>
          {pv.skipped.length > 0 && <div className="note warn"><Icon name="alert" size={18} /><div className="grow"><b>{pv.skipped.length} size{pv.skipped.length > 1 ? 's' : ''} out of stock, will be skipped</b>{pv.skipped.map((x, i) => <div key={i}>{skipText(x)}</div>)}</div></div>}
          {pv.reduced.length > 0 && <div className="note info"><Icon name="alert" size={18} /><div className="grow"><b>{pv.reduced.length} size{pv.reduced.length > 1 ? 's' : ''} reduced to live stock</b>{pv.reduced.map((x, i) => <div key={i}>{skipText(x)}</div>)}</div></div>}
          {ok > 0 && <div className="row" style={{ justifyContent: 'space-between' }}><span className="muted">Value at today's rate</span><b className="num">{inr(pv.totalValue)}</b></div>}
          <div className="row">
            <button type="button" className="btn" disabled={!ok || adding} onClick={confirm} data-gadd>{adding ? 'Adding…' : `Add ${num(ok)} pcs to cart`}</button>
            <button type="button" className="btn sec" onClick={onClose}>Cancel</button>
          </div>
        </>
      )}
    </Sheet>
  );
}
