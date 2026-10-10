// Distributor orders: an index list with status tabs (Waiting for you / Waiting for store / Approved / All)
// and an order page with the lines as a size-by-colour matrix, the activity history, and a sidebar with the
// decision (Approve / Modify: lower only, reason required / Reject: reason required), the store and its credit.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import type { DistributorDecision, Order } from '@citrus/shared';
import { POLICY } from '@citrus/shared';
import { api, ApiError } from '../../lib/api';
import { getCached, setCached, useQuery } from '../../lib/query';
import { age, dstr, inr, maskPhone, minutesSince, num } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { itemsOf, type Page, type RetailerProfile } from '../../lib/types';
import { upsertOrder, useQueue } from '../../state/orders';
import { toast } from '../../state/toast';
import { Icon } from '../../components/Icon';
import { PLink } from '../../components/PLink';
import { ErrorNote } from '../../components/Bits';
import { Activity, buildMatrix, OrderRow, overSla, Pill, statusInfo, StatusPill, TABS, tabOf, WHO_LABEL, type TabKey } from './ui';
import '../../panel-dist.css';

function useMinuteTick() {
  const [, set] = useState(0);
  useEffect(() => { const id = setInterval(() => set(x => x + 1), 30_000); return () => clearInterval(id); }, []);
}

/** Queue (open orders) and history (decided ones), merged by id; the newer copy wins. */
function useAllOrders() {
  const q = useQueue();
  const h = useQuery<Order[] | Page<Order>>('/api/distributor/history', { staleMs: 30_000 });
  const hist = itemsOf(h.data);
  const all = useMemo(() => {
    if (!q.data) return undefined;
    const m = new Map<string, Order>();
    for (const o of [...(hist ?? []), ...q.data]) { const p = m.get(o.id); if (!p || p.updatedAt <= o.updatedAt) m.set(o.id, o); }
    return [...m.values()];
  }, [q.data, hist]);
  return { all, error: q.error, refresh: q.refresh };
}

export default function Queue() {
  useMinuteTick();
  const { id } = useParams();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const { all, error, refresh } = useAllOrders();
  const found = all?.find(o => o.id === id);
  const shownById = found ?? (id ? getCached<Order>(`/api/orders/${id}`) : undefined);
  const tab = (sp.get('tab') as TabKey | null) ?? (shownById ? tabOf(shownById) : 'you');
  const def = TABS.find(t => t.key === tab) ?? TABS[0];
  const list = useMemo(() => {
    const l = (all ?? []).filter(def.match);
    return def.key === 'you' ? l.sort((a, b) => a.placedAt.localeCompare(b.placedAt)) : l.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [all, def]);
  const waiting = (all ?? []).filter(o => o.status === 'review').sort((a, b) => a.placedAt.localeCompare(b.placedAt));
  const shown = shownById ?? (id ? undefined : list[0]);
  const q = (k: TabKey) => (k === 'you' ? '' : `?tab=${k}`);
  const href = (o: Order) => `/queue/${o.id}${q(tab)}`;
  const oldest = waiting[0];
  const late = waiting.filter(overSla).length;
  // phone: a pushed detail screen opens at its top, the list at its top
  useEffect(() => { if (window.innerWidth < 1000) window.scrollTo(0, 0); }, [id]);

  function after(o: Order, action: DistributorDecision['action']) {
    if (action === 'modify') return; // stay on the order: it now shows "Waiting for store" with the proposed diff
    const rest = waiting.filter(x => x.id !== o.id);
    if (rest.length && window.innerWidth >= 1000) nav(`/queue/${rest[0].id}${q(tab)}`, { replace: true });
    else nav(`/queue${q(tab)}`, { replace: true });
  }

  return (
    <div className={`dp${id ? ' dp-has-detail' : ''}`}>
      <header className={`dp-ph${id ? ' dp-hide-narrow' : ''}`}>
        <div>
          <h1>Orders</h1>
          <p className="dp-sub">
            {all ? (waiting.length ? <>{num(waiting.length)} waiting for you{oldest && <> · oldest {age(oldest.placedAt)}</>}{late > 0 && <> · <span className="bad">{late} over {POLICY.approvalSlaHours}h</span></>}</> : 'Nothing waiting for you') : 'Loading orders'}
          </p>
        </div>
        <PLink to="/history" className="dp-btn ghost sm dp-hide-narrow-only"><Icon name="box" size={15} />History</PLink>
      </header>

      <nav className={`dp-tabs${id ? ' dp-hide-narrow' : ''}`} aria-label="Filter orders">
        {TABS.map(t => {
          const n = all?.filter(t.match).length;
          return (
            <button type="button" key={t.key} role="tab" aria-selected={t.key === tab} className={t.key === tab ? 'on' : ''}
              onClick={() => { if (id) nav(`/queue${q(t.key)}`, { replace: true }); else { const next = new URLSearchParams(sp); if (t.key === 'you') next.delete('tab'); else next.set('tab', t.key); setSp(next, { replace: true }); } }}>
              <span className="dp-tl-long">{t.label}</span><span className="dp-tl-short">{t.short}</span>{n !== undefined && <span className="n">{n}</span>}
            </button>
          );
        })}
      </nav>
      {error && !all && <ErrorNote error={error} onRetry={refresh} />}

      <div className="dp-split">
        <section className={`dp-listpane${id ? ' dp-hide-narrow' : ''}`} aria-label="Orders">
          <div className="dp-card dp-list">
            {!all && !error && <div className="dp-rows">{[0, 1, 2, 3].map(i => <div key={i} className="dp-row skel-row"><span className="dp-skel" style={{ width: '55%' }} /><span className="dp-skel" style={{ width: '80%' }} /></div>)}</div>}
            {all && (list.length ? (
              <div className="dp-rows">{list.map(o => <OrderRow key={o.id} o={o} to={href(o)} current={shown?.id === o.id} showStatus={tab !== 'you'} />)}</div>
            ) : (
              <div className="dp-empty">
                <span className="dp-empty-ic"><Icon name={tab === 'you' ? 'check' : 'inbox'} size={20} /></span>
                <b>{tab === 'you' ? 'All caught up' : tab === 'store' ? 'Nothing waiting for a store' : 'No orders here yet'}</b>
                <p>{tab === 'you' ? 'New store orders appear here and on WhatsApp.' : tab === 'store' ? 'Orders you change wait here until the store answers.' : 'Approved orders appear here.'}</p>
              </div>
            ))}
          </div>
          <p className="dp-foot"><Icon name="alert" size={14} />Orders waiting more than {POLICY.approvalSlaHours} hours are flagged to CITRUS.</p>
        </section>

        <section className={`dp-detailpane${id ? '' : ' dp-hide-narrow'}`} aria-label="Order">
          {id && <PLink to={`/queue${q(tab)}`} className="dp-back"><Icon name="back" size={18} />Orders</PLink>}
          {shown ? <OrderPanel key={shown.id} o={shown} onDone={after} />
            : id && all ? <div className="dp-card dp-empty"><b>Order not found</b><p>It may have moved. See History.</p></div>
            : all && !list.length ? null
            : <div className="dp-card dp-skelpanel"><span className="dp-skel" style={{ width: '30%' }} /><span className="dp-skel" style={{ width: '60%', height: 22 }} /><span className="dp-skel" style={{ height: 180 }} /></div>}
        </section>
      </div>
    </div>
  );
}

function OrderPanel({ o, onDone }: { o: Order; onDone: (o: Order, action: DistributorDecision['action']) => void }) {
  const { t } = useT();
  const [mode, setMode] = useState<'view' | 'modify' | 'reject'>('view');
  const [reason, setReason] = useState<string | null>(null);
  const [qty, setQty] = useState<number[]>(() => o.lines.map(l => l.qty));
  const [err, setErr] = useState<ApiError | null>(null);
  const [sending, setSending] = useState(false);
  const top = useRef<HTMLDivElement>(null);
  const rid = encodeURIComponent(o.retailerId);
  const { data: profile, error: creditErr } = useQuery<RetailerProfile>(`/api/distributor/retailers/${rid}`, { staleMs: 120_000 });
  const credit = profile?.credit;
  const canDecide = o.status === 'review';
  const info = statusInfo(o);
  const { sizes, rows } = buildMatrix(o);
  const changed = o.lines.map((l, i) => ({ l, to: qty[i] })).filter(x => x.to !== x.l.qty);
  const editQty = changed.reduce((a, x) => a + x.to - x.l.qty, 0);
  const editVal = changed.reduce((a, x) => a + (x.to - x.l.qty) * x.l.rate, 0);
  const late = overSla(o);
  const accepted = o.events.some(e => e.type === 'accepted');
  const lastChange = [...o.events].reverse().find(e => e.type === 'modified');

  useEffect(() => { if (mode !== 'view') top.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [mode]);

  async function send(d: DistributorDecision, msg: string) {
    if (sending) return;
    setErr(null); setSending(true);
    // Optimistic: show the outcome at once; put the order back if the server says no.
    const prevQueue = getCached<Order[] | Page<Order>>('/api/distributor/queue');
    const changes = d.action === 'modify' ? o.lines.map((l, i) => ({ styleId: l.styleId, color: l.color, size: l.size, from: l.qty, to: qty[i] })).filter(c => c.from !== c.to) : o.changes;
    const optimistic: Order = { ...o, status: d.action === 'approve' ? 'approved' : d.action === 'reject' ? 'rejected' : 'modified', reason: d.action === 'reject' ? d.reason : o.reason, changes, changeReason: d.action === 'modify' ? d.reason : o.changeReason, updatedAt: new Date().toISOString() };
    upsertOrder(optimistic);
    setMode('view');
    onDone(o, d.action);
    toast(msg);
    try {
      const next = await api.post<Order>(`/api/distributor/orders/${encodeURIComponent(o.id)}/decision`, d);
      upsertOrder(next); // 'approved' now and 'confirmed' moments later over live updates is normal
    } catch (e) {
      if (prevQueue) setCached('/api/distributor/queue', prevQueue);
      const er = e instanceof ApiError ? e : new ApiError('UNKNOWN', 'Could not send your decision.', 0);
      const fresh = (er.body as { order?: Order } | undefined)?.order;
      upsertOrder(fresh ?? o); // ALREADY_DECIDED carries the order as it is now
      toast(`${o.number}: decision not sent. ${er.message}`, { ms: 6000 });
      setErr(er);
    } finally { setSending(false); }
  }

  const approve = () => send({ action: 'approve' }, `${o.number} approved. Sending to CITRUS`);
  const startModify = () => { setMode('modify'); setReason(null); setQty(o.lines.map(l => l.qty)); };
  const startReject = () => { setMode('reject'); setReason(null); };
  const sendModify = () => send({ action: 'modify', reason: reason!, lines: o.lines.map((l, i) => ({ styleId: l.styleId, color: l.color, size: l.size, qty: qty[i] })) }, `Changes sent to ${o.store}`);
  const sendReject = () => send({ action: 'reject', reason: reason! }, `${o.number} rejected. ${o.store} is told on WhatsApp`);
  const cancel = () => { setMode('view'); setReason(null); setQty(o.lines.map(l => l.qty)); };

  const setCell = (i: number, raw: string, max: number) => {
    const n = parseInt(raw.replace(/\D/g, ''), 10) || 0;
    if (n > max) toast(`Can only reduce. Ordered ${max}`);
    setQty(q => q.map((x, j) => (j === i ? Math.min(max, n) : x)));
  };

  const overLimit = credit?.limit !== undefined && credit.outstanding !== undefined && credit.outstanding + o.totalValue > credit.limit;

  return (
    <article className={`dp-order mode-${mode}`} ref={top}>
      {/* page header: id, status, who acts next */}
      <header className="dp-oh">
        <div className="dp-oh-l">
          <div className="dp-oh-meta">
            <span className="dp-id">{o.number}</span>
            <StatusPill o={o} />
            {late && <Pill status="sla" dot={false}><Icon name="alert" size={12} />Over {POLICY.approvalSlaHours}h · flagged to CITRUS</Pill>}
          </div>
          <h2>{o.store}</h2>
          <p className="dp-oh-sub">{o.city} · placed {dstr(o.placedAt)}{o.status === 'review' && <> · {minutesSince(o.placedAt) < 1 ? 'just in' : <>waiting {age(o.placedAt)}</>}</>}</p>
        </div>
        <dl className="dp-oh-kpis">
          <div><dt>Pieces</dt><dd>{num(o.totalQty)}</dd></div>
          <div><dt>Value</dt><dd>{inr(o.totalValue)}</dd></div>
        </dl>
      </header>

      {err && <div className="dp-banner bad" role="alert"><Icon name="alert" size={16} /><div><b>Your decision was not sent</b><span>{err.message}</span></div></div>}

      <div className="dp-body">
        <div className="dp-main">
          {mode === 'reject' && (
            <section className="dp-card dp-pad dp-reject o-1">
              <div className="dp-card-h"><h3>Reject this order</h3></div>
              <Reasons label="Reason (required)" options={POLICY.rejectReasons} value={reason} onChange={setReason} />
              <p className="dp-hint">The held stock is released and {o.store} is told the reason on WhatsApp.</p>
              <div className="dp-actrow dp-wide-only">
                <button type="button" className="dp-btn ghost" onClick={cancel}>Back</button>
                <button type="button" className="dp-btn danger" disabled={!reason || sending} onClick={sendReject}>Reject order</button>
              </div>
            </section>
          )}

          {/* items: size x colour matrix, inline editable in modify mode */}
          <section className={`dp-card dp-items o-2${mode === 'modify' ? ' editing' : ''}`}>
            <div className="dp-card-h dp-pad-x">
              <h3>{mode === 'modify' ? 'Lower quantities' : 'Items'}</h3>
              <span className="dp-card-meta">{mode === 'modify' ? 'You can only reduce. Type a new number in any size.' : `${rows.length} ${rows.length === 1 ? 'style' : 'styles'} · ${num(o.totalQty)} pcs`}</span>
            </div>
            {o.status === 'modified' && o.changes?.length ? <div className="dp-legend dp-pad-x"><span className="dp-lgi"><span className="lg-prop">4</span> proposed by you, waiting for {o.store}</span></div>
              : accepted && o.changes?.length ? <div className="dp-legend dp-pad-x"><span className="dp-lgi"><span className="lg-agreed">4</span> agreed with {o.store}</span><span className="dp-lgi"><span className="lg-was">6</span> as first ordered</span></div> : null}
            <div className="dp-mx" role="table" aria-label="Quantities by size" style={{ ['--n' as string]: sizes.length }}>
              <div className="dp-mx-r dp-mx-head" role="row">
                <span role="columnheader">Style</span>
                {sizes.map(z => <span role="columnheader" key={z} className="c">{z}</span>)}
                <span role="columnheader" className="r">Pcs</span>
                <span role="columnheader" className="r">Value</span>
              </div>
              {rows.map(r => {
                const rq = mode === 'modify' ? r.cells.reduce((a, c) => a + (c && c.idx >= 0 ? qty[c.idx] : 0), 0) : r.qty;
                return (
                  <div className="dp-mx-r" role="row" key={r.key}>
                    <span className="dp-mx-style" role="rowheader"><b>{r.name}</b><span>{r.color} · <span className="dp-id">{r.styleId}</span></span></span>
                    {r.cells.map((c, j) => (
                      <span role="cell" key={j} className={`dp-mx-c${!c ? ' none' : ''}${c?.proposed !== undefined ? ' prop' : ''}${c?.was !== undefined ? ' agreed' : ''}${mode === 'modify' && c && c.idx >= 0 && qty[c.idx] !== c.qty ? ' dirty' : ''}`}>
                        <small className="dp-mx-z">{sizes[j]}</small>
                        {!c ? <span className="dash">–</span>
                          : mode === 'modify' && c.idx >= 0 ? (
                            <input className="dp-qin" inputMode="numeric" pattern="[0-9]*" enterKeyHint="next" value={qty[c.idx]}
                              aria-label={`${r.name}, ${r.color}, size ${c.size}, ordered ${c.qty}`}
                              onFocus={e => { const el = e.currentTarget; setTimeout(() => el.select(), 0); }}
                              onChange={e => setCell(c.idx, e.target.value, c.qty)}
                              onKeyDown={e => {
                                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setQty(q => q.map((x, k) => (k === c.idx ? Math.max(0, Math.min(c.qty, x + (e.key === 'ArrowUp' ? 1 : -1))) : x))); }
                                if (e.key === 'Enter') { e.preventDefault(); const els = [...document.querySelectorAll<HTMLInputElement>('.dp-qin')]; els[els.indexOf(e.currentTarget) + 1]?.focus(); }
                              }} />
                          ) : c.proposed !== undefined ? <span className="v"><s>{c.qty}</s><b>{c.proposed}</b></span>
                          : c.was !== undefined ? <span className="v"><b>{c.qty}</b><s>{c.was}</s></span>
                          : <span className="v">{c.qty}</span>}
                        {mode === 'modify' && c && c.idx >= 0 && qty[c.idx] !== c.qty && <small className="dp-mx-was">of {c.qty}</small>}
                      </span>
                    ))}
                    <span className="dp-mx-t r num">{num(rq)}<small className="dp-mx-z"> pcs</small></span>
                    <span className="dp-mx-v r num">{inr(mode === 'modify' ? r.cells.reduce((a, c) => a + (c && c.idx >= 0 ? qty[c.idx] * r.rate : 0), 0) : r.value)}<small className="dp-rate">{inr(r.rate)} / pc</small></span>
                  </div>
                );
              })}
              <div className="dp-mx-r dp-mx-foot" role="row">
                <span role="rowheader">Total</span>
                {sizes.map(z => <span key={z} className="c num"><small className="dp-mx-z">{z}</small>{num(mode === 'modify' ? o.lines.reduce((a, l, i) => a + (l.size === z ? qty[i] : 0), 0) : o.lines.reduce((a, l) => a + (l.size === z ? l.qty : 0), 0))}</span>)}
                <span className="r num">{num(o.totalQty + (mode === 'modify' ? editQty : 0))}<small className="dp-mx-z"> pcs</small></span>
                <span className="r num">{inr(o.totalValue + (mode === 'modify' ? editVal : 0))}</span>
              </div>
            </div>
            {mode === 'modify' && (
              <div className="dp-edit-foot dp-pad">
                <div className="dp-edit-sum">{changed.length ? <><b>{changed.length} {changed.length === 1 ? 'size' : 'sizes'} changed</b> · −{num(-editQty)} pcs · −{inr(-editVal)}</> : <span className="muted">No changes yet</span>}</div>
                <Reasons label="Reason for the change (required)" options={POLICY.modifyReasons} value={reason} onChange={setReason} />
                <p className="dp-hint">{o.store} sees each change and accepts or declines before the order goes to CITRUS.</p>
                <div className="dp-actrow dp-wide-only">
                  <button type="button" className="dp-btn ghost" onClick={cancel}>Cancel</button>
                  <button type="button" className="dp-btn primary" disabled={!reason || !changed.length || sending} onClick={sendModify}>Send changes to {o.store}</button>
                </div>
              </div>
            )}
          </section>

          {o.changes?.length && mode === 'view' && (o.status === 'modified' || accepted || o.status === 'cancelled') ? (
            <section className="dp-card dp-pad dp-changes o-3">
              <div className="dp-card-h">
                <h3>Your changes</h3>
                {o.status === 'modified' ? <Pill status="modified">Waiting for store</Pill> : accepted ? <Pill status="approved">Accepted by store</Pill> : <Pill status="cancelled">Declined by store</Pill>}
              </div>
              {o.changeReason && <p className="dp-reason"><span>Reason</span>{o.changeReason}</p>}
              <ul className="dp-diff">
                {o.changes.map(c => {
                  const name = rows.find(r => r.styleId === c.styleId)?.name ?? c.styleId;
                  return <li key={`${c.styleId}|${c.color}|${c.size}`}><span className="nm">{name}<span className="muted"> · {c.color} · {c.size}</span></span><span className="ft num"><s>{c.from}</s><span className="ar">→</span><b>{c.to}</b></span></li>;
                })}
              </ul>
              {lastChange && <p className="dp-hint">Sent {dstr(lastChange.at)}{o.status === 'modified' ? ` · ${minutesSince(lastChange.at) < 1 ? 'just now' : `${age(lastChange.at)} ago`}` : ''}</p>}
            </section>
          ) : null}

          <section className="dp-card dp-pad o-7">
            <div className="dp-card-h"><h3>Activity</h3><span className="dp-card-meta">Newest first</span></div>
            <Activity o={o} />
          </section>
        </div>

        <aside className="dp-side">
          {/* decision / next step */}
          <section className={`dp-card dp-pad dp-next who-${info.who} o-1`}>
            <div className="dp-next-who"><span>Next</span><b>{WHO_LABEL[info.who]}</b></div>
            <p>{info.next}</p>
            {o.status === 'confirmed' && o.erp.soNumber && <p className="dp-so"><span>Sales order</span><span className="dp-id">{o.erp.soNumber}</span></p>}
            {canDecide && mode === 'view' && (
              <div className="dp-decide dp-wide-only">
                <button type="button" className="dp-btn approve lg" disabled={sending} onClick={approve}><Icon name="check" size={16} />{t('approve')}</button>
                <div className="dp-decide-2">
                  <button type="button" className="dp-btn ghost" onClick={startModify}><Icon name="edit" size={15} />{t('modify')}</button>
                  <button type="button" className="dp-btn ghost danger-ink" onClick={startReject}><Icon name="x" size={15} />{t('reject')}</button>
                </div>
                <p className="dp-hint">Approving sends the order to CITRUS, where the sales order is created in Ginesys.</p>
              </div>
            )}
          </section>

          {(o.note || o.po) && (
            <section className="dp-card dp-pad o-4">
              <div className="dp-card-h"><h3>Note from the store</h3></div>
              {o.note && <p className="dp-quote">“{o.note}”</p>}
              {o.po && <p className="dp-kv"><span>PO</span><span className="dp-id">{o.po}</span></p>}
            </section>
          )}

          <section className="dp-card dp-pad o-5">
            <div className="dp-card-h"><h3>Credit</h3>{credit && <span className="dp-card-meta">{credit.asOf ? `as of ${dstr(credit.asOf)}` : ''}</span>}</div>
            {credit ? (
              <>
                <dl className="dp-kvs">
                  <div><dt>Credit limit</dt><dd>{credit.limit !== undefined ? inr(credit.limit) : '–'}</dd></div>
                  {credit.outstanding !== undefined && <div><dt>Outstanding</dt><dd>{inr(credit.outstanding)}</dd></div>}
                  <div><dt>Overdue{credit.overdueDays ? ` · ${credit.overdueDays}d` : ''}</dt><dd className={(credit.overdue ?? 0) > 0 ? 'bad' : ''}>{inr(credit.overdue ?? 0)}</dd></div>
                  <div><dt>This order</dt><dd>{inr(o.totalValue)}</dd></div>
                </dl>
                {credit.limit && credit.outstanding !== undefined ? (
                  <div className={`dp-meter${overLimit ? ' over' : ''}`} role="img" aria-label={`Outstanding plus this order is ${Math.round(((credit.outstanding + o.totalValue) / credit.limit) * 100)}% of the limit`}>
                    <span className="a" style={{ width: `${Math.min(100, (credit.outstanding / credit.limit) * 100)}%` }} />
                    <span className="b" style={{ width: `${Math.max(0, Math.min(100 - (credit.outstanding / credit.limit) * 100, (o.totalValue / credit.limit) * 100))}%` }} />
                  </div>
                ) : null}
                {credit.limit && credit.outstanding !== undefined ? <p className="dp-meter-l"><span><i className="a" />Outstanding</span><span><i className="b" />This order</span><span className="r">{overLimit ? <b className="bad">Over the limit</b> : `${inr(credit.limit - credit.outstanding - o.totalValue)} left after`}</span></p> : null}
                <p className="dp-src">{o.store}'s account with you. Source: {credit.source ?? 'Ginesys'}</p>
              </>
            ) : creditErr || profile ? <p className="dp-hint">Credit details from Ginesys are not available right now.</p> : <span className="dp-skel" style={{ height: 70 }} />}
          </section>

          <section className="dp-card dp-pad o-6">
            <div className="dp-card-h"><h3>Store</h3></div>
            <div className="dp-store">
              <span className="dp-avatar" aria-hidden>{o.store.split(/\s+/).slice(0, 2).map(w => w[0]).join('')}</span>
              <div><b>{o.store}</b><span>{o.city}{o.retailerCode ? <> · <span className="dp-id">{o.retailerCode}</span></> : null}</span></div>
            </div>
            {profile?.stats && (
              <dl className="dp-kvs">
                <div><dt>Orders, last 90 days</dt><dd>{num(profile.stats.orders90d ?? 0)}</dd></div>
                {profile.stats.avgOrderValue ? <div><dt>Average order</dt><dd>{inr(profile.stats.avgOrderValue)}</dd></div> : null}
                <div><dt>Rejected, last 90 days</dt><dd>{num(profile.stats.rejected90d ?? 0)}</dd></div>
              </dl>
            )}
            {profile?.phone && <a className="dp-btn ghost block" href={`tel:+91${profile.phone.replace(/\D/g, '').slice(-10)}`}><Icon name="phone" size={15} />Call {maskPhone(profile.phone)}</a>}
          </section>
        </aside>
      </div>

      {/* phone: sticky action bar */}
      {(canDecide || mode !== 'view') && (
        <div className="dp-bar" role="toolbar" aria-label="Decide this order">
          {mode === 'view' && canDecide && <>
            <button type="button" className="dp-btn ghost" onClick={startReject} aria-label="Reject"><Icon name="x" size={16} />{t('reject')}</button>
            <button type="button" className="dp-btn ghost" onClick={startModify}><Icon name="edit" size={16} />{t('modify')}</button>
            <button type="button" className="dp-btn approve grow" disabled={sending} onClick={approve}><Icon name="check" size={16} />{t('approve')}</button>
          </>}
          {mode === 'modify' && <>
            <button type="button" className="dp-btn ghost" onClick={cancel}>Cancel</button>
            <button type="button" className="dp-btn primary grow" disabled={!reason || !changed.length || sending} onClick={sendModify}>{!changed.length ? 'Lower a size first' : !reason ? 'Pick a reason' : `Send ${changed.length} ${changed.length === 1 ? 'change' : 'changes'}`}</button>
          </>}
          {mode === 'reject' && <>
            <button type="button" className="dp-btn ghost" onClick={cancel}>Back</button>
            <button type="button" className="dp-btn danger grow" disabled={!reason || sending} onClick={sendReject}>{reason ? 'Reject order' : 'Pick a reason'}</button>
          </>}
        </div>
      )}
    </article>
  );
}

function Reasons({ label, options, value, onChange }: { label: string; options: string[]; value: string | null; onChange: (v: string) => void }) {
  return (
    <div className="dp-reasons" role="radiogroup" aria-label={label}>
      <div className="dp-label">{label}</div>
      <div className="dp-chips">{options.map(r => <button type="button" key={r} role="radio" aria-checked={value === r} className={value === r ? 'on' : ''} onClick={() => onChange(r)}>{value === r && <Icon name="check" size={13} />}{r}</button>)}</div>
    </div>
  );
}
