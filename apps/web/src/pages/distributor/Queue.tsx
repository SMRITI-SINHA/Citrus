// Distributor approvals: cards decidable without opening, an order panel with credit from Ginesys,
// Approve / Modify (reduce only, reason required) / Reject (reason required), and auto-advance.
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { DistributorDecision, Order } from '@citrus/shared';
import { POLICY } from '@citrus/shared';
import { api, ApiError } from '../../lib/api';
import { getCached, setCached, useQuery } from '../../lib/query';
import { age, dstr, inr, minutesSince, num } from '../../lib/format';
import { useT } from '../../lib/i18n';
import type { Page, RetailerProfile } from '../../lib/types';
import { maskPhone } from '../../lib/format';
import { upsertOrder, useQueue } from '../../state/orders';
import { toast } from '../../state/toast';
import { Icon } from '../../components/Icon';
import { PLink } from '../../components/PLink';
import { CardSkeletons, ErrorNote } from '../../components/Bits';
import { GroupedLines, groupOrderLines } from '../../components/OrderLines';
import { ReasonChips } from '../../components/ReasonChips';

const FLIGHT: Record<string, string> = { placed: 'Reserving stock', modified: 'Waiting for retailer', approved: 'Creating sales order' };

function useMinuteTick() {
  const [, set] = useState(0);
  useEffect(() => { const id = setInterval(() => set(x => x + 1), 30_000); return () => clearInterval(id); }, []);
}

function waitTone(placedAt: string) {
  const m = minutesSince(placedAt);
  return m > POLICY.approvalSlaHours * 60 ? 's-bad' : m > 120 ? 's-warn' : 's-info';
}

export default function Queue() {
  useMinuteTick();
  const { t } = useT();
  const { id } = useParams();
  const nav = useNavigate();
  const { data: all, error, refresh } = useQueue();
  // The queue endpoint also returns orders in flight (reserving, waiting for the retailer, creating the SO).
  const queue = all?.filter(o => o.status === 'review');
  const inFlight = all?.filter(o => o.status !== 'review') ?? [];
  const sel = all?.find(o => o.id === id) ?? (id ? undefined : queue?.[0]);
  const selFromCache = id && !sel ? getCached<Order>(`/api/orders/${id}`) : undefined;
  const shown = sel ?? selFromCache;

  function advance(after: string) {
    const rest = (queue ?? []).filter(o => o.id !== after);
    const wide = window.innerWidth >= 1000;
    if (rest.length && wide) nav(`/queue/${rest[0].id}`, { replace: true, viewTransition: true });
    else nav('/queue', { replace: true, viewTransition: true });
  }

  return (
    <>
      <h1 className="title">Orders waiting for you</h1>
      {error && !queue && <ErrorNote error={error} onRetry={refresh} />}
      {!queue && !error && <div className="split"><CardSkeletons n={3} h={110} /><div className="skel card hide-split-sm" style={{ height: 420 }} /></div>}
      {queue && all && (all.length === 0 && !shown ? (
        <div className="card empty"><h3>All caught up.</h3><p>New retailer orders appear here and on WhatsApp.</p></div>
      ) : (
        <div className="split">
          <div className={`stack${id ? ' hide-split-sm' : ''}`} style={{ gap: 10 }}>
            {queue.map(o => (
              <PLink key={o.id} to={`/queue/${o.id}`} className="card qitem" aria-current={shown?.id === o.id ? 'true' : undefined} style={{ color: 'inherit', textDecoration: 'none' }}>
                <div className="top"><b>{o.store}</b><span className={`status ${waitTone(o.placedAt)} waits`}>{minutesSince(o.placedAt) < 1 ? 'Just now' : t('waiting', { n: age(o.placedAt) })}</span></div>
                <span className="muted" style={{ fontSize: 13 }}><span className="mono">{o.number}</span> · {o.city} · {num(o.totalQty)} pcs · {groupOrderLines(o.lines).length} style{groupOrderLines(o.lines).length === 1 ? '' : 's'} · {inr(o.totalValue)}</span>
                {o.note && <span style={{ fontSize: 12.5 }}>“{o.note}”</span>}
              </PLink>
            ))}
            {queue.length === 0 && <div className="card empty" style={{ padding: 20 }}><b>All caught up.</b><br />New retailer orders appear here and on WhatsApp.</div>}
            <div className="note info" style={{ fontSize: 12.5 }}><Icon name="alert" size={16} /><span>Orders waiting more than {POLICY.approvalSlaHours} hours are flagged to CITRUS.</span></div>
            {inFlight.length > 0 && (
              <>
                <div className="eyebrow" style={{ marginTop: 8 }}>In progress</div>
                {inFlight.map(o => (
                  <PLink key={o.id} to={`/queue/${o.id}`} className="card qitem" aria-current={shown?.id === o.id ? 'true' : undefined} style={{ color: 'inherit', textDecoration: 'none' }}>
                    <div className="top"><b>{o.store}</b><span className={`status ${o.status === 'modified' ? 's-warn' : 's-info'}`}>{FLIGHT[o.status] ?? o.status}</span></div>
                    <span className="muted" style={{ fontSize: 13 }}><span className="mono">{o.number}</span> · {num(o.totalQty)} pcs · {inr(o.totalValue)}</span>
                  </PLink>
                ))}
              </>
            )}
          </div>
          <div className={id ? '' : 'hide-split-sm'}>
            {id && <div className="only-sm"><PLink to="/queue" className="linkbtn backlink"><Icon name="back" size={18} />{t('approvals')}</PLink></div>}
            {shown ? <OrderPanel key={shown.id} o={shown} onDone={advance} /> : id ? <div className="card empty"><h3>Already decided</h3><p>This order is no longer waiting. See History.</p></div> : null}
          </div>
        </div>
      ))}
    </>
  );
}

function OrderPanel({ o, onDone }: { o: Order; onDone: (id: string) => void }) {
  const { t } = useT();
  const [mode, setMode] = useState<'view' | 'modify' | 'reject'>('view');
  const [reason, setReason] = useState<string | null>(null);
  const [qty, setQty] = useState<number[]>(() => o.lines.map(l => l.qty));
  const [err, setErr] = useState<ApiError | null>(null);
  const [sending, setSending] = useState(false);
  const rid = encodeURIComponent(o.retailerId);
  const { data: profile, error: creditErr } = useQuery<RetailerProfile>(`/api/distributor/retailers/${rid}`, { staleMs: 120_000 });
  const credit = profile?.credit;
  const decided = o.status !== 'review';
  const changes = o.lines.map((l, i) => ({ l, to: qty[i] })).filter(x => x.to !== x.l.qty);

  async function send(d: DistributorDecision, msg: string) {
    if (sending) return;
    setErr(null); setSending(true);
    // Optimistic: take it off the queue and move on; put it back if the server says no.
    const prevQueue = getCached<Order[] | Page<Order>>('/api/distributor/queue');
    const optimistic: Order = { ...o, status: d.action === 'approve' ? 'approved' : d.action === 'reject' ? 'rejected' : 'modified', reason: d.action === 'reject' ? d.reason : o.reason };
    upsertOrder(optimistic);
    onDone(o.id);
    toast(msg);
    try {
      const next = await api.post<Order>(`/api/distributor/orders/${encodeURIComponent(o.id)}/decision`, d);
      upsertOrder(next); // 'approved' now and 'confirmed' moments later over SSE is normal
    } catch (e) {
      if (prevQueue) setCached('/api/distributor/queue', prevQueue);
      const er = e instanceof ApiError ? e : new ApiError('UNKNOWN', 'Could not send your decision.', 0);
      const fresh = (er.body as { order?: Order } | undefined)?.order;
      upsertOrder(fresh ?? o); // ALREADY_DECIDED carries the order as it is now
      toast(`${o.number}: decision not sent. ${er.message}`, { ms: 6000 });
      setErr(er);
    } finally { setSending(false); }
  }

  return (
    <div className="card dpanel">
      <div>
        <div className="eyebrow">Order <span className="mono">{o.number}</span></div>
        <h2 style={{ fontSize: 22, marginTop: 4 }}>{o.store}, {o.city}</h2>
        <div className="sub muted small">{num(o.totalQty)} pcs · {inr(o.totalValue)} · placed {dstr(o.placedAt)}</div>
      </div>
      {err && <div className="note bad" role="alert"><Icon name="alert" size={18} /><div className="grow"><b>Your decision was not sent</b>{err.message}</div></div>}
      {decided && <div className="note info"><Icon name="check" size={18} /><span>Decided: {o.status === 'approved' ? 'approved, CITRUS is creating the sales order' : o.status}.</span></div>}

      {mode === 'view' && (
        <>
          <div className="wa">
            <div className="eyebrow" style={{ color: 'var(--wa)' }}><Icon name="wa" size={14} /> WhatsApp you received</div>
            <div className="bub">New order <b>{o.number}</b> from {o.store}, {o.city}. {num(o.totalQty)} pcs · {inr(o.totalValue)}.{o.note ? ` Note: “${o.note}”` : ''}</div>
            <div className="acts"><span>Approve</span><span>Modify</span><span>Reject</span></div>
          </div>
          <div><GroupedLines lines={o.lines} /></div>
          {credit ? (
            <>
              <div className="credit">
                <div><span>Credit limit</span><b className="num">{credit.limit !== undefined ? inr(credit.limit) : '-'}</b></div>
                {credit.outstanding !== undefined && <div><span>Outstanding</span><b className="num">{inr(credit.outstanding)}</b></div>}
                <div><span>Overdue{credit.overdueDays ? ` · ${credit.overdueDays}d` : ''}</span><b className={`num${(credit.overdue ?? 0) > 0 ? ' bad-ink' : ''}`}>{inr(credit.overdue ?? 0)}</b></div>
              </div>
              <span className="muted xs" style={{ marginTop: -8 }}>{o.store}'s account with you, from {credit.source ?? 'Ginesys'}{credit.asOf ? ` as of ${dstr(credit.asOf)}` : ''}{credit.limit !== undefined && credit.outstanding !== undefined && credit.outstanding + o.totalValue > credit.limit ? '. This order takes them over the limit.' : ''}</span>
            </>
          ) : creditErr || profile ? <span className="muted xs">Credit details from Ginesys are not available right now.</span> : <div className="skel" style={{ height: 58 }} />}
          {profile?.stats && (
            <span className="muted xs">Last 90 days: {num(profile.stats.orders90d ?? 0)} orders{profile.stats.avgOrderValue ? ` · avg ${inr(profile.stats.avgOrderValue)}` : ''}{profile.stats.rejected90d ? ` · ${profile.stats.rejected90d} rejected` : ''}</span>
          )}
          {profile?.phone && <a className="btn sec sm" style={{ alignSelf: 'flex-start' }} href={`tel:+91${profile.phone.replace(/\D/g, '').slice(-10)}`}><Icon name="phone" size={14} />Call {o.store} · {maskPhone(profile.phone)}</a>}
          <div className="note ok" style={{ fontSize: 12.5 }}><Icon name="check" size={16} /><span>Stock for this order is held in Ginesys while you decide.</span></div>
          {!decided && (
            <>
              <div className="dbtns">
                <button type="button" className="btn ok" disabled={sending} onClick={() => send({ action: 'approve' }, `${o.number} approved. Sending to CITRUS`)}><Icon name="check" size={18} />{t('approve')}</button>
                <button type="button" className="btn sec" onClick={() => { setMode('modify'); setReason(null); }}><Icon name="edit" size={18} />{t('modify')}</button>
                <button type="button" className="btn bad" onClick={() => { setMode('reject'); setReason(null); }}><Icon name="x" size={18} />{t('reject')}</button>
              </div>
              <span className="muted xs">Approving sends the order to CITRUS, where the sales order is created in Ginesys.</span>
            </>
          )}
        </>
      )}

      {mode === 'modify' && (
        <>
          <div className="eyebrow">Reduce quantities · you can only lower them</div>
          <div data-dscope>
            {o.lines.map((l, i) => (
              <div key={`${l.styleId}|${l.color}|${l.size}`} className="dqrow">
                <span style={{ minWidth: 0 }}><b>{l.name}</b><span className="muted"> · {l.color} · {l.size}</span>{qty[i] !== l.qty && <span className="was" style={{ display: 'block' }}>was {l.qty}</span>}</span>
                <div className="step">
                  <button type="button" tabIndex={-1} aria-label={`One less ${l.size}`} disabled={qty[i] <= 0} onClick={() => setQty(q => q.map((x, j) => (j === i ? Math.max(0, x - 1) : x)))}>−</button>
                  <input className="dqin" inputMode="numeric" pattern="[0-9]*" enterKeyHint="next" value={qty[i]} aria-label={`${l.name}, ${l.color}, size ${l.size}, ordered ${l.qty}`}
                    onFocus={e => { const el = e.currentTarget; setTimeout(() => el.select(), 0); }}
                    onChange={e => { const v = Math.min(l.qty, parseInt(e.target.value.replace(/\D/g, ''), 10) || 0); if ((parseInt(e.target.value, 10) || 0) > l.qty) toast(`Can only reduce. Ordered ${l.qty}`); setQty(q => q.map((x, j) => (j === i ? v : x))); }}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); const all = [...document.querySelectorAll<HTMLInputElement>('[data-dscope] .dqin')]; all[all.indexOf(e.currentTarget) + 1]?.focus(); } }} />
                  <button type="button" tabIndex={-1} aria-label={`One more ${l.size}`} disabled={qty[i] >= l.qty} onClick={() => setQty(q => q.map((x, j) => (j === i ? Math.min(l.qty, x + 1) : x)))}>+</button>
                </div>
              </div>
            ))}
          </div>
          <ReasonChips label="Reason for the change (required)" options={POLICY.modifyReasons} value={reason} onChange={setReason} />
          <div className="row">
            <button type="button" className="btn" disabled={!reason || !changes.length || sending}
              onClick={() => send({ action: 'modify', reason: reason!, lines: o.lines.map((l, i) => ({ styleId: l.styleId, color: l.color, size: l.size, qty: qty[i] })) }, `Changes sent to ${o.store}`)}>
              Send changes to retailer{changes.length ? ` (${changes.length})` : ''}
            </button>
            <button type="button" className="btn sec" onClick={() => { setMode('view'); setQty(o.lines.map(l => l.qty)); }}>Cancel</button>
          </div>
          <span className="muted xs">The retailer sees each change and confirms before the order goes to CITRUS.</span>
        </>
      )}

      {mode === 'reject' && (
        <>
          <ReasonChips label="Reason for rejecting (required)" options={POLICY.rejectReasons} value={reason} onChange={setReason} />
          <div className="row">
            <button type="button" className="btn bad" disabled={!reason || sending} onClick={() => send({ action: 'reject', reason: reason! }, `${o.number} rejected. ${o.store} is told on WhatsApp`)}>Reject order</button>
            <button type="button" className="btn sec" onClick={() => setMode('view')}>Back</button>
          </div>
          <span className="muted xs">The held stock is released and the retailer is told the reason.</span>
        </>
      )}
    </div>
  );
}
