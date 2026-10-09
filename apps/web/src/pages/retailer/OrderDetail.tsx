import { useState } from 'react';
import { useParams } from 'react-router';
import type { Order, OrderStatus } from '@citrus/shared';
import { GroupedLines } from '../../components/OrderLines';
import { POLICY, RETAILER_STEPS, retailerLabel } from '@citrus/shared';
import { api, ApiError } from '../../lib/api';
import { getCached, setCached, useQuery } from '../../lib/query';
import { dstr, inr, num } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { soShown, upsertOrder } from '../../state/orders';
import { toast } from '../../state/toast';
import { Icon } from '../../components/Icon';
import { PLink } from '../../components/PLink';
import { ErrorNote, StatusBadge } from '../../components/Bits';
import { ContactButtons } from '../../components/Contact';
import { ReorderSheet } from './ReorderSheet';
import type { ReorderRef } from './ReorderSheet';

const IDX = Object.fromEntries(RETAILER_STEPS.map((s, i) => [s.key, i])) as Record<string, number>;

function when(o: Order, k: OrderStatus): string | undefined {
  if (k === 'placed') return o.placedAt;
  // Status times come from the event trail (API event types: reserved, approved, changes_accepted, confirmed, ...).
  const types: Partial<Record<OrderStatus, string[]>> = { review: ['reserved'], approved: ['approved', 'changes_accepted'] };
  const want = types[k] ?? [k];
  return [...o.events].reverse().find(e => want.includes(e.type))?.at;
}

export default function OrderDetail() {
  const { id = '' } = useParams();
  const { t } = useT();
  const key = `/api/orders/${encodeURIComponent(id)}`;
  const { data: o, error, refresh } = useQuery<Order>(key, { staleMs: 5_000 });
  const [deciding, setDeciding] = useState<null | 'accept' | 'decline'>(null);
  const [decErr, setDecErr] = useState<ApiError | null>(null);
  const [reorder, setReorder] = useState<ReorderRef | null>(null);

  const back = <div><PLink to="/orders" className="linkbtn backlink"><Icon name="back" size={18} />{t('orders')}</PLink></div>;
  if (error && !o) return <>{back}<ErrorNote error={error} onRetry={refresh} /></>;
  if (!o) return <>{back}<div className="skel card" style={{ height: 120 }} /><div className="ordergrid"><div className="skel card" style={{ height: 380 }} /><div className="skel card" style={{ height: 380 }} /></div></>;

  async function decide(action: 'accept' | 'decline') {
    if (!o || deciding) return;
    const prev = getCached<Order>(key)!;
    setDeciding(action); setDecErr(null);
    // Optimistic: show the outcome immediately, reconcile with the server's order.
    setCached<Order>(key, { ...prev, status: action === 'accept' ? 'approved' : 'cancelled' });
    try {
      const next = await api.post<Order>(`/api/orders/${encodeURIComponent(o.id)}/changes`, { action });
      upsertOrder(next);
      toast(action === 'accept' ? 'Changes accepted. Order approved' : `${o.number} cancelled. Held stock released`);
    } catch (e) {
      const fresh = e instanceof ApiError ? (e.body as { order?: Order } | undefined)?.order : undefined;
      if (fresh) upsertOrder(fresh); else setCached(key, prev);
      setDecErr(e instanceof ApiError ? e : new ApiError('UNKNOWN', 'Could not send your answer.', 0));
    } finally { setDeciding(null); }
  }

  const ended = o.status === 'rejected' || o.status === 'cancelled';
  const cur = o.status === 'modified' ? IDX.review : IDX[o.status] ?? 0;
  const rateOf = (c: { styleId: string; color: string; size: string }) => o.lines.find(l => l.styleId === c.styleId)?.rate ?? 0;
  const nameOf = (sid: string) => o.lines.find(l => l.styleId === sid)?.name ?? sid;
  const dq = o.changes?.reduce((a, c) => a + c.to - c.from, 0) ?? 0;
  const dv = o.changes?.reduce((a, c) => a + (c.to - c.from) * rateOf(c), 0) ?? 0;
  const inWindow = Date.now() - Date.parse(o.placedAt) < POLICY.reorderWindowDays * 864e5;

  const extra = (k: OrderStatus): string => {
    if (k === 'placed' && o.status === 'placed') return 'Holding your stock';
    if (k === 'review') return o.distributorName;
    if (k === 'approved' && o.status === 'approved') return 'Creating your CITRUS order';
    if (k === 'confirmed' && soShown(o)) return `CITRUS order ${soShown(o)}`;
    if (k === 'dispatched' && o.erp.awb) return `Courier AWB ${o.erp.awb}`;
    return '';
  };

  return (
    <>
      {back}
      <div className="sec-h">
        <div style={{ minWidth: 0 }}>
          <h1 className="title">Order <span className="mono" style={{ fontSize: '.85em' }}>{o.number}</span></h1>
          <div className="sub">{num(o.totalQty)} pcs · {inr(o.totalValue)} · placed {dstr(o.placedAt)}</div>
        </div>
        <StatusBadge status={o.status} />
      </div>

      {o.status === 'modified' && o.changes && (
        <div className="card modcard" role="alert">
          <div className="eyebrow" style={{ color: 'var(--warn)' }}><Icon name="edit" size={14} /> Changes suggested by {o.distributorName}</div>
          {o.changeReason && <div className="muted" style={{ fontSize: 13 }}>Reason: {o.changeReason}</div>}
          <div>
            {o.changes.map(c => (
              <div key={`${c.styleId}|${c.color}|${c.size}`} className="diff">
                <span><b>{nameOf(c.styleId)}</b><span className="muted"> · {c.color} · {c.size}</span></span>
                <span className="num"><s>{c.from}</s> → <b>{c.to}</b><span className="imp">{c.to - c.from > 0 ? '+' : ''}{c.to - c.from} pcs{c.to === 0 ? ' (removed)' : ''}</span></span>
              </div>
            ))}
          </div>
          <div className="diff tot"><span>Net change</span><b className="num">{dq} pcs · {dv < 0 ? '−' : '+'}{inr(Math.abs(dv))}</b></div>
          {decErr && <div className="note bad" role="alert"><Icon name="alert" size={18} /><div className="grow"><b>Your answer was not sent</b>{decErr.message}<div style={{ marginTop: 8 }}><ContactButtons compact context={`About the changes to ${o.number}`} /></div></div></div>}
          <div className="row">
            <button type="button" className="btn" disabled={!!deciding} onClick={() => decide('accept')}>{t('accept')}</button>
            <button type="button" className="btn sec" disabled={!!deciding} onClick={() => decide('decline')}>{t('cancelOrder')}</button>
          </div>
          <span className="muted xs">Nothing goes ahead until you accept. If you haven't decided, we'll remind you. The order is never cancelled without your OK.</span>
          <ContactButtons compact context={`About the changes ${o.distributorName} suggested to ${o.number}`} />
        </div>
      )}

      <div className="ordergrid">
        <div className="card" style={{ padding: 18 }}>
          <div className="tl">
            {ended ? (
              <>
                {RETAILER_STEPS.slice(0, 2).map(s => (
                  <div key={s.key} className="st done"><span className="dot"><Icon name="check" size={16} /></span><div><div className="lbl">{s.label}</div><div className="when">{when(o, s.key) ? dstr(when(o, s.key)!) : ''}</div></div></div>
                ))}
                <div className="st bad"><span className="dot"><Icon name="x" size={16} /></span><div><div className="lbl">{o.status === 'cancelled' ? 'Cancelled' : `Not approved by ${o.distributorName}`}</div><div className="when">{dstr(o.updatedAt)}{o.reason ? ` · ${o.reason}` : ''}</div></div></div>
              </>
            ) : RETAILER_STEPS.map((s, i) => {
              const isDone = i < cur || o.status === 'delivered' || (i === cur && i === 0 && o.status !== 'placed');
              const isNow = !isDone && i === cur;
              const w = when(o, s.key);
              const ex = extra(s.key);
              const label = s.key === 'review' && o.status === 'modified' ? `${retailerLabel('modified')}` : s.label;
              return (
                <div key={s.key} className={`st${isDone ? ' done' : isNow ? ' now' : ''}`}>
                  <span className="dot">{isDone && <Icon name="check" size={16} />}</span>
                  <div><div className="lbl">{label}</div><div className="when">{w ? dstr(w) : isNow ? 'In progress' : ''}{ex ? `${w || isNow ? ' · ' : ''}${ex}` : ''}</div></div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="stack" style={{ gap: 14 }}>
          <div className="eyebrow">Updates · also sent on WhatsApp</div>
          <div className="wa">
            {[...o.events].slice(-4).map((e, i) => <div key={i} className="bub"><Icon name="wa" size={14} /> {e.message}<div className="muted xs" style={{ marginTop: 4 }}>{dstr(e.at)}</div></div>)}
            {!o.events.length && <div className="bub">Order {o.number} received. {num(o.totalQty)} pcs sent to {o.distributorName} for review.</div>}
          </div>
          {(o.note || o.po) && <div className="muted small">{o.po && <>Your PO: <span className="mono">{o.po}</span><br /></>}{o.note && <>Your note: “{o.note}”</>}</div>}
          <div className="eyebrow">Items</div>
          <div className="card" style={{ padding: '4px 16px' }}><GroupedLines lines={o.lines} /></div>
          <div className="row no-print">
            {inWindow && <button type="button" className="btn sec" onClick={() => setReorder({ orderId: o.id, number: o.number, placedAt: o.placedAt })}>{t('reorder')}</button>}
            <button type="button" className="btn sec" onClick={() => window.print()}><Icon name="file" size={16} />Download PDF</button>
          </div>
          <div className="no-print"><ContactButtons context={`About my order ${o.number}`} /></div>
        </div>
      </div>
      <ReorderSheet card={reorder} onClose={() => setReorder(null)} />
    </>
  );
}
