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
import { groupOrderLines } from '../../components/OrderLines';
import { ReasonChips } from '../../components/ReasonChips';
import { ErpTag, erpText, PageHeader, Panel } from './shared';

interface Detail {
  order: Order;
  integration: { topic: string; status: string; attempts: number; last_error?: string | null; created_at: string; done_at?: string | null; request_id?: string | null }[];
  notifications: { channel: string; template: string; status: string; created_at: string; to_phone: string }[];
}

const ACTOR: Record<string, string> = { retailer: 'Retailer', distributor: 'Distributor', admin: 'CITRUS', erp: 'Ginesys', system: 'System' };

const SZ = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL'];
const szKey = (z: string) => { const i = SZ.indexOf(z); return i >= 0 ? i : 100 + (parseFloat(z) || 0); };

/** Line items as a size matrix: one row per style and colour, one column per size, totals on the right. */
function SizeMatrix({ lines }: { lines: Order['lines'] }) {
  const sizes = [...new Set(lines.map(l => l.size))].sort((a, b) => szKey(a) - szKey(b));
  const groups = groupOrderLines(lines);
  const colTotal = (z: string) => lines.filter(l => l.size === z).reduce((a, l) => a + l.qty, 0);
  const pcs = lines.reduce((a, l) => a + l.qty, 0), val = lines.reduce((a, l) => a + l.qty * l.rate, 0);
  return (
    <div className="ap-tw">
      <table className="ap-t ap-mx">
        <thead><tr><th className="c-sty">Style</th>{sizes.map(z => <th key={z} className="c-sz r">{z}</th>)}<th className="c-pc r">Pcs</th><th className="c-am r">Amount</th></tr></thead>
        <tbody>{groups.map(g => {
          const by = new Map(g.ls.map(l => [l.size, l]));
          const q = g.ls.reduce((a, l) => a + l.qty, 0), v = g.ls.reduce((a, l) => a + l.qty * l.rate, 0);
          return (
            <tr key={g.styleId + g.color}>
              <td className="c-sty"><b>{g.name}</b><span>{g.color} · <span className="ap-id">{g.styleId}</span> · {inr(g.ls[0]?.rate ?? 0)}/pc</span></td>
              {sizes.map(z => { const l = by.get(z); const was = l?.origQty !== undefined && l.origQty !== l.qty ? l.origQty : undefined; return (
                <td key={z} className={`c-sz r num${l?.qty ? '' : ' nil'}`} data-sz={z}>{l ? <>{was !== undefined && <s>{was}</s>}{l.qty}</> : '·'}</td>
              ); })}
              <td className="c-pc r num"><b>{num(q)}</b></td>
              <td className="c-am r num">{inr(v)}</td>
            </tr>
          );
        })}</tbody>
        <tfoot><tr><td className="c-sty">Total</td>{sizes.map(z => <td key={z} className="c-sz r num">{num(colTotal(z))}</td>)}<td className="c-pc r num"><b>{num(pcs)}</b></td><td className="c-am r num"><b>{inr(val)}</b></td></tr></tfoot>
      </table>
    </div>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const tone = (s: string) => (s === 'done' || s === 'sent' || s === 'delivered' ? 'ok' : s === 'failed' ? 'bad' : s === 'retrying' || s === 'pending' ? 'warn' : 'idle');

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
  const canRetry = o && (o.erp.state === 'failed' || o.erp.state === 'retrying');

  return (
    <>
      {error && !data && <ErrorNote error={error} onRetry={refresh} />}
      {!data && !error && <><div className="ap-sk" style={{ height: 56, width: 360 }} /><div className="ap-detail"><div className="ap-card ap-skel" style={{ height: 380 }} /><div className="ap-card ap-skel" style={{ height: 380 }} /></div></>}
      {o && (
        <>
          <PageHeader
            eyebrow={<PLink to="/admin/orders" className="ap-back"><Icon name="back" size={14} />Orders</PLink>}
            title={<span className="ap-id lg">{o.number}</span>}
            meta={<span className="ap-ph-pills"><StatusBadge status={o.status} /><ErpTag o={o} /></span>}
            sub={<>{dstr(o.placedAt)} · {age(o.placedAt)} ago · <b>{o.store}</b>, {o.city} · <span className="num">{num(o.totalQty)} pcs · {inr(o.totalValue)}</span></>}
            actions={canRetry ? <button type="button" className="ap-btn pri" onClick={retry} disabled={retrying}><Icon name="refresh" size={14} />{retrying ? 'Retrying…' : 'Retry Ginesys sync'}</button> : undefined} />
          {o.status === 'review' && <ActForDistributor o={o} onDone={next => { setCached<Detail>(key, d => d && { ...d, order: next }); upsertOrder(next); refresh(); }} />}
          <div className="ap-detail">
            <div className="ap-col">
              <Panel title="Items" flush sub={`${num(o.totalQty)} pieces in ${groupOrderLines(o.lines).length} style${groupOrderLines(o.lines).length === 1 ? '' : 's'}`}>
                <SizeMatrix lines={o.lines} />
                {(o.note || o.po || o.reason) && (
                  <div className="ap-notes">
                    {o.po && <div><span>PO</span><span className="ap-id">{o.po}</span></div>}
                    {o.note && <div><span>Note</span>“{o.note}”</div>}
                    {o.reason && <div className="warn"><span>{o.status === 'modified' ? 'Change reason' : 'Reason'}</span>{o.changeReason ?? o.reason}</div>}
                  </div>
                )}
              </Panel>
              <Panel title="Activity">
                <ol className="ap-tl">{[...o.events].sort((a, b) => b.at.localeCompare(a.at)).map((e, i) => (
                  <li key={i} className={`a-${e.actor}`}>
                    <span className="dot" aria-hidden="true" />
                    <div className="m"><div className="h"><b>{ACTOR[e.actor] ?? e.actor}</b><span>{e.type.replace(/_/g, ' ')}</span></div><p>{e.message}</p></div>
                    <time dateTime={e.at}>{dstr(e.at)}</time>
                  </li>
                ))}</ol>
              </Panel>
            </div>
            <aside className="ap-col">
              <Panel title="Status">
                <dl className="ap-kv">
                  <dt>Retailer sees</dt><dd><StatusBadge status={o.status} /></dd>
                  <dt>Placed</dt><dd>{dstr(o.placedAt)}</dd>
                  <dt>Updated</dt><dd>{dstr(o.updatedAt)}</dd>
                  {o.collection && <><dt>Collection</dt><dd>{o.collection}</dd></>}
                  <dt>Points</dt><dd className="num">{num(o.totalPoints)}</dd>
                </dl>
              </Panel>
              <Panel title="Retailer">
                <div className="ap-ent"><span className="ap-av">{o.store.split(/\s+/).slice(0, 2).map(w => w[0]).join('')}</span><span><b>{o.store}</b><span>{o.city}{o.owner ? ` · ${o.owner}` : ''}</span></span></div>
                {o.retailerCode && <dl className="ap-kv"><dt>Store code</dt><dd className="ap-id">{o.retailerCode}</dd></dl>}
              </Panel>
              <Panel title="Distributor">
                <div className="ap-ent"><span className="ap-av"><Icon name="truck" size={14} /></span><span><b>{o.distributorName}</b><span>Approval target {POLICY.approvalSlaHours} h</span></span></div>
              </Panel>
              <Panel title="Ginesys sync" action={<ErpTag o={o} />}>
                <dl className="ap-kv">
                  <dt>State</dt><dd>{erpText(o)}</dd>
                  {o.erp.reservationRef && <><dt>Reservation</dt><dd className="ap-id">{o.erp.reservationRef}</dd></>}
                  {o.erp.soNumber && <><dt>{soShown(o) ? 'Sales order' : 'Unauth. SO'}</dt><dd className="ap-id">{o.erp.soNumber}</dd></>}
                  {o.erp.awb && <><dt>AWB</dt><dd className="ap-id">{o.erp.awb}</dd></>}
                  <dt>Attempts</dt><dd className="num">{o.erp.attempts}</dd>
                  {o.erp.lastError && <><dt>Last error</dt><dd className="bad-ink">{o.erp.lastError}</dd></>}
                </dl>
                {data.integration.length > 0 && (
                  <ul className="ap-log">{data.integration.map((x, i) => (
                    <li key={i}>
                      <span className={`ap-erp t-${tone(x.status)}`}><i /></span>
                      <span className="m"><b>{x.topic}</b><span>{dstr(x.created_at)} · {x.attempts} attempt{x.attempts === 1 ? '' : 's'}{x.request_id ? <> · <span className="ap-id">{x.request_id}</span></> : null}</span>{x.last_error && <span className="bad-ink">{x.last_error}</span>}</span>
                      <span className={`ap-pill t-${tone(x.status)}`}>{cap(x.status)}</span>
                    </li>
                  ))}</ul>
                )}
                {!data.integration.length && <span className="muted small">No Ginesys calls yet.</span>}
                {canRetry && <button type="button" className="ap-btn" onClick={retry} disabled={retrying}><Icon name="refresh" size={14} />{retrying ? 'Retrying…' : 'Retry now'}</button>}
              </Panel>
              <Panel title="Notifications" count={data.notifications.length}>
                {data.notifications.length ? (
                  <ul className="ap-log">{data.notifications.map((n, i) => (
                    <li key={i}>
                      <span className="ap-nic"><Icon name={/whatsapp/i.test(n.channel) ? 'wa' : 'phone'} size={14} /></span>
                      <span className="m"><b>{cap(n.template.replace(/_/g, ' '))}</b><span>{n.channel} · {n.to_phone} · {dstr(n.created_at)}</span></span>
                      <span className={`ap-pill t-${tone(n.status)}`}>{cap(n.status)}</span>
                    </li>
                  ))}</ul>
                ) : <span className="muted small">No messages for this order.</span>}
              </Panel>
            </aside>
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
    <div ref={ref} className="ap-callout actfor">
      <div className="ap-callout-h"><span className="ap-callout-ic"><Icon name="inbox" size={16} /></span><div><h3>Waiting for {o.distributorName}{overdue && <span className="ap-pill t-bad">Overdue</span>}</h3>
        <div className="sub">{overdue ? `Over the ${POLICY.approvalSlaHours}-hour approval time. ` : ''}If the distributor cannot be reached, CITRUS can decide for them. It is recorded as CITRUS acting for the distributor.</div></div></div>
      {err && <div className="note bad" role="alert"><Icon name="alert" size={18} /><div className="grow"><b>Decision not sent</b>{err.message}</div></div>}
      {mode === 'view' && (
        <div className="row">
          <button type="button" className="ap-btn pri" onClick={() => setConfirm({ action: 'approve' })}><Icon name="check" size={16} />Approve for distributor</button>
          <button type="button" className="ap-btn" onClick={() => { setMode('modify'); setReason(null); }}><Icon name="edit" size={16} />Modify</button>
          <button type="button" className="ap-btn danger" onClick={() => { setMode('reject'); setReason(null); }}><Icon name="x" size={16} />Reject</button>
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
