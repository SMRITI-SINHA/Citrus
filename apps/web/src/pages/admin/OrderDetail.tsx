// One order as CITRUS sees it: retailer status and Ginesys state side by side, the event trail,
// the integration log, notifications sent, and, for an order stuck with a slow distributor,
// a decision CITRUS takes on the distributor's behalf (recorded as such).
import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import type { DistributorDecision, Order } from '@citrus/shared';
import { POLICY } from '@citrus/shared';
import { api, ApiError } from '../../lib/api';
import { setCached, useQuery } from '../../lib/query';
import { age, dstr, inr, num } from '../../lib/format';
import { soShown, upsertOrder } from '../../state/orders';
import { toast } from '../../state/toast';
import { Icon } from '../../components/Icon';
import { PLink } from '../../components/PLink';
import { Sheet } from '../../components/Sheet';
import { ErrorNote, StatusBadge } from '../../components/Bits';
import { GroupedLines } from '../../components/OrderLines';
import { ReasonChips } from '../../components/ReasonChips';
import { erpText } from './shared';

interface Detail {
  order: Order;
  integration: { topic: string; status: string; attempts: number; last_error?: string | null; created_at: string; done_at?: string | null; request_id?: string | null }[];
  notifications: { channel: string; template: string; status: string; created_at: string; to_phone: string }[];
}

const ACTOR: Record<string, string> = { retailer: 'Retailer', distributor: 'Distributor', admin: 'CITRUS', erp: 'Ginesys', system: 'System' };

export default function AdminOrderDetail() {
  const { id = '' } = useParams();
  const key = `/api/admin/orders/${encodeURIComponent(id)}`;
  const { data, error, refresh } = useQuery<Detail>(key, { staleMs: 5_000 });
  const o = data?.order;
  const [retrying, setRetrying] = useState(false);

  async function retry() {
    if (!o) return;
    setRetrying(true);
    try { const n = await api.post<Order>(`/api/admin/orders/${encodeURIComponent(o.id)}/retry`); upsertOrder(n); refresh(); toast(`${n.number}: sent to Ginesys again`); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Retry failed', { ms: 6000 }); }
    finally { setRetrying(false); }
  }

  return (
    <>
      <PLink to="/admin/orders" className="backlink"><Icon name="back" size={16} />Orders</PLink>
      {error && !data && <ErrorNote error={error} onRetry={refresh} />}
      {!data && !error && <><div className="skel" style={{ height: 60 }} /><div className="agrid"><div className="skel card" style={{ height: 380 }} /><div className="skel card" style={{ height: 380 }} /></div></>}
      {o && (
        <>
          <div className="sec-h">
            <div><div className="eyebrow">Order <span className="mono">{o.number}</span>{soShown(o) && <> · SO <span className="mono">{soShown(o)}</span></>}</div>
              <h1 className="title" style={{ marginTop: 4 }}>{o.store}, {o.city}</h1>
              <div className="muted small">{num(o.totalQty)} pcs · {inr(o.totalValue)} · placed {dstr(o.placedAt)} ({age(o.placedAt)} ago)</div></div>
            <StatusBadge status={o.status} />
          </div>
          {o.status === 'review' && <ActForDistributor o={o} onDone={next => { setCached<Detail>(key, d => d && { ...d, order: next }); upsertOrder(next); refresh(); }} />}
          <div className="agrid">
            <div className="stack-lg" style={{ gap: 20, minWidth: 0 }}>
              <div className="card panel"><h3>Items</h3><GroupedLines lines={o.lines} />
                {(o.note || o.po) && <div className="muted small">{o.po && <>PO <span className="mono">{o.po}</span>. </>}{o.note && <>Note: “{o.note}”</>}</div>}
                {o.reason && <div className="note warn"><Icon name="alert" size={16} /><span>{o.status === 'modified' ? 'Change reason' : 'Reason'}: {o.changeReason ?? o.reason}</span></div>}
              </div>
              <div className="card panel"><h3>What happened</h3>
                <ol className="tl">{[...o.events].sort((a, b) => a.at.localeCompare(b.at)).map((e, i) => (
                  <li key={i}><time dateTime={e.at}>{dstr(e.at)}</time><div><span className="who">{ACTOR[e.actor] ?? e.actor} · {e.type.replace(/_/g, ' ')}</span><div>{e.message}</div></div></li>
                ))}</ol>
              </div>
            </div>
            <div className="stack-lg" style={{ gap: 20, minWidth: 0 }}>
              <div className="card panel"><h3>Ginesys</h3>
                <dl className="kv">
                  <dt>State</dt><dd>{erpText(o)}</dd>
                  {o.erp.reservationRef && <><dt>Reservation</dt><dd className="mono">{o.erp.reservationRef}</dd></>}
                  {o.erp.soNumber && <><dt>{soShown(o) ? 'Sales order' : 'Unauthorised SO'}</dt><dd className="mono">{o.erp.soNumber}</dd></>}
                  {o.erp.awb && <><dt>AWB</dt><dd className="mono">{o.erp.awb}</dd></>}
                  <dt>Attempts</dt><dd>{o.erp.attempts}</dd>
                  {o.erp.lastError && <><dt>Last error</dt><dd className="bad-ink">{o.erp.lastError}</dd></>}
                  <dt>Distributor</dt><dd>{o.distributorName}</dd>
                  {o.retailerCode && <><dt>Store code</dt><dd className="mono">{o.retailerCode}</dd></>}
                </dl>
                {(o.erp.state === 'failed' || o.erp.state === 'retrying') && <button type="button" className="btn sec sm" style={{ alignSelf: 'flex-start' }} onClick={retry} disabled={retrying}><Icon name="refresh" size={14} />{retrying ? 'Retrying…' : 'Retry now'}</button>}
              </div>
              <div className="card panel"><h3>Integration log</h3>
                {data.integration.length ? (
                  <div className="cq"><table className="tbl">
                    <thead><tr><th>Call</th><th>Result</th><th className="r p2">Tries</th><th className="p1">When</th></tr></thead>
                    <tbody>{data.integration.map((x, i) => (
                      <tr key={i}><td className="mono xs">{x.topic}{x.last_error && <div className="bad-ink">{x.last_error}</div>}</td>
                        <td><span className={`status ${x.status === 'done' ? 's-ok' : x.status === 'failed' ? 's-bad' : 's-warn'}`}>{x.status}</span></td>
                        <td className="r num p2">{x.attempts}</td><td className="nw muted xs p1">{dstr(x.created_at)}</td></tr>
                    ))}</tbody>
                  </table></div>
                ) : <span className="muted small">No Ginesys calls yet.</span>}
              </div>
              <div className="card panel"><h3>Messages sent</h3>
                {data.notifications.length ? data.notifications.map((n, i) => (
                  <div key={i} className="row" style={{ justifyContent: 'space-between', fontSize: 13 }}>
                    <span><Icon name={n.channel === 'whatsapp' ? 'wa' : 'phone'} size={14} /> {n.template.replace(/_/g, ' ')} <span className="muted">to {n.to_phone}</span></span>
                    <span className={`status ${n.status === 'failed' ? 's-bad' : n.status === 'sent' || n.status === 'delivered' ? 's-ok' : 's-info'}`}>{n.status}</span>
                  </div>
                )) : <span className="muted small">No messages for this order.</span>}
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}

/** CITRUS decides for a distributor who has not acted. Always confirmed in a sheet and recorded as CITRUS acting. */
function ActForDistributor({ o, onDone }: { o: Order; onDone: (o: Order) => void }) {
  const [sp] = useSearchParams();
  const ref = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<'view' | 'modify' | 'reject'>('view');
  const [reason, setReason] = useState<string | null>(null);
  const [qty, setQty] = useState<number[]>(() => o.lines.map(l => l.qty));
  const [confirm, setConfirm] = useState<DistributorDecision | null>(null);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const changes = o.lines.filter((l, i) => qty[i] !== l.qty).length;
  const overdue = (Date.now() - new Date(o.placedAt).getTime()) / 3_600_000 > POLICY.approvalSlaHours;
  useEffect(() => { if (sp.get('act')) ref.current?.scrollIntoView({ block: 'center' }); }, [sp]);

  async function send() {
    if (!confirm) return;
    setSending(true); setErr(null);
    try {
      const next = await api.post<Order>(`/api/admin/orders/${encodeURIComponent(o.id)}/decision`, confirm);
      setConfirm(null); setMode('view');
      onDone(next);
      toast(`${o.number}: ${confirm.action === 'approve' ? 'approved' : confirm.action === 'reject' ? 'rejected' : 'changes sent to the retailer'} for ${o.distributorName}`);
    } catch (e) {
      const er = e instanceof ApiError ? e : new ApiError('UNKNOWN', 'Could not send the decision.', 0);
      setErr(er);
      const fresh = (er.body as { order?: Order } | undefined)?.order;
      if (fresh) { onDone(fresh); setConfirm(null); }
    } finally { setSending(false); }
  }

  const verb = confirm?.action === 'approve' ? 'Approve' : confirm?.action === 'reject' ? 'Reject' : 'Send changes';
  return (
    <div ref={ref} className="card panel actfor">
      <div className="sec-h"><div><h3>Waiting for {o.distributorName}</h3>
        <div className="sub">{overdue ? `Over the ${POLICY.approvalSlaHours}-hour approval time. ` : ''}If the distributor cannot be reached, CITRUS can decide for them. It is recorded as CITRUS acting for the distributor.</div></div></div>
      {err && <div className="note bad" role="alert"><Icon name="alert" size={18} /><div className="grow"><b>Decision not sent</b>{err.message}</div></div>}
      {mode === 'view' && (
        <div className="row">
          <button type="button" className="btn ok" onClick={() => setConfirm({ action: 'approve' })}><Icon name="check" size={16} />Approve for distributor</button>
          <button type="button" className="btn sec" onClick={() => { setMode('modify'); setReason(null); }}><Icon name="edit" size={16} />Modify</button>
          <button type="button" className="btn bad" onClick={() => { setMode('reject'); setReason(null); }}><Icon name="x" size={16} />Reject</button>
        </div>
      )}
      {mode === 'modify' && (
        <>
          <div className="eyebrow">Reduce quantities · can only lower them</div>
          <div data-ascope>{o.lines.map((l, i) => (
            <div key={`${l.styleId}|${l.color}|${l.size}`} className="dqrow">
              <span style={{ minWidth: 0 }}><b>{l.name}</b><span className="muted"> · {l.color} · {l.size}</span>{qty[i] !== l.qty && <span className="was" style={{ display: 'block' }}>was {l.qty}</span>}</span>
              <input className="dqin" inputMode="numeric" pattern="[0-9]*" enterKeyHint="next" value={qty[i]} aria-label={`${l.name}, ${l.color}, size ${l.size}, ordered ${l.qty}`}
                onFocus={e => { const el = e.currentTarget; setTimeout(() => el.select(), 0); }}
                onChange={e => { const v = Math.min(l.qty, parseInt(e.target.value.replace(/\D/g, ''), 10) || 0); setQty(q => q.map((x, j) => (j === i ? v : x))); }}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); const all = [...document.querySelectorAll<HTMLInputElement>('[data-ascope] .dqin')]; all[all.indexOf(e.currentTarget) + 1]?.focus(); } }} />
            </div>
          ))}</div>
          <ReasonChips label="Reason for the change (required)" options={POLICY.modifyReasons} value={reason} onChange={setReason} />
          <div className="row">
            <button type="button" className="btn" disabled={!reason || !changes} onClick={() => setConfirm({ action: 'modify', reason: reason!, lines: o.lines.map((l, i) => ({ styleId: l.styleId, color: l.color, size: l.size, qty: qty[i] })) })}>Review changes{changes ? ` (${changes})` : ''}</button>
            <button type="button" className="btn sec" onClick={() => { setMode('view'); setQty(o.lines.map(l => l.qty)); }}>Cancel</button>
          </div>
        </>
      )}
      {mode === 'reject' && (
        <>
          <ReasonChips label="Reason for rejecting (required)" options={POLICY.rejectReasons} value={reason} onChange={setReason} />
          <div className="row">
            <button type="button" className="btn bad" disabled={!reason} onClick={() => setConfirm({ action: 'reject', reason: reason! })}>Review rejection</button>
            <button type="button" className="btn sec" onClick={() => setMode('view')}>Back</button>
          </div>
        </>
      )}
      <Sheet open={!!confirm} onClose={() => !sending && setConfirm(null)} label="Confirm decision" eyebrow={`${o.number} · ${o.store}`} title={`${verb} for ${o.distributorName}?`} initialFocus="[data-confirm]">
        <div className="note warn"><Icon name="alert" size={18} /><span>This is recorded as <b style={{ display: 'inline' }}>CITRUS acting for {o.distributorName}</b>. The distributor and the retailer both see it in the order history.</span></div>
        {confirm?.reason && <p className="small">Reason: <b>{confirm.reason}</b></p>}
        {confirm?.action === 'modify' && <p className="small">{changes} size{changes === 1 ? '' : 's'} reduced. The retailer must accept before the order goes to Ginesys.</p>}
        {confirm?.action === 'approve' && <p className="small">CITRUS creates the sales order in Ginesys right away.</p>}
        {confirm?.action === 'reject' && <p className="small">The held stock is released and the retailer is told the reason on WhatsApp.</p>}
        <div className="row">
          <button type="button" data-confirm className={`btn ${confirm?.action === 'reject' ? 'bad' : confirm?.action === 'approve' ? 'ok' : ''}`} disabled={sending} onClick={send}>{sending ? 'Sending…' : `${verb} as CITRUS`}</button>
          <button type="button" className="btn sec" disabled={sending} onClick={() => setConfirm(null)}>Cancel</button>
        </div>
      </Sheet>
    </div>
  );
}
