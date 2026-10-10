// Retailer directory: find a store, see if it is active and ordering, re-bind its mobile when the shop number changes.
import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { api, ApiError } from '../../lib/api';
import type { AdminOverview } from '@citrus/shared';
import { getCached, usePaged } from '../../lib/query';
import { dmy, num } from '../../lib/format';
import { toast } from '../../state/toast';
import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/Sheet';
import { ErrorNote } from '../../components/Bits';
import { PageHeader } from './shared';

interface RetailerRow { id: string; code: string; store: string; city: string; state: string; distributor: string; activated: boolean; activatedAt?: string; points: number; invite?: string; orders: number; lastOrderAt?: string }
const STATES = ['Kerala', 'Karnataka', 'Tamil Nadu', 'Andhra Pradesh', 'Telangana', 'Odisha', 'Maharashtra', 'Puducherry', 'Goa'];

export default function Retailers() {
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState(sp.get('q') ?? '');
  const state = sp.get('state') ?? '', status = sp.get('status') ?? '';
  useEffect(() => {
    const id = setTimeout(() => setSp(p => { const n = new URLSearchParams(p); if (q.trim()) n.set('q', q.trim()); else n.delete('q'); return n; }, { replace: true }), 250);
    return () => clearTimeout(id);
  }, [q, setSp]);
  const setParam = (k: string, v: string) => setSp(p => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n; }, { replace: true });
  const qs = new URLSearchParams({ ...(sp.get('q') ? { q: sp.get('q')! } : {}), ...(state ? { state } : {}), ...(status ? { status } : {}) }).toString();
  const { items, next, more, busy, error, refresh } = usePaged<RetailerRow>(`/api/admin/retailers${qs ? `?${qs}` : ''}`, 30_000);
  const [edit, setEdit] = useState<RetailerRow | null>(null);
  // States come from the overview's sell-in regions when loaded, so new territories appear without a code change.
  const regions = getCached<AdminOverview>('/api/admin/overview')?.regions.map(r => r.name).sort();

  return (
    <>
      <PageHeader title="Retailers" sub="Find a store, see whether it has activated and is ordering, and change its mobile when the shop number changes." />
      <section className="ap-card">
        <div className="ap-tabs" role="group" aria-label="Status">
          {[['', 'All stores'], ['active', 'Active'], ['invited', 'Not activated']].map(([v, l]) => (
            <button type="button" key={v} className="ap-tab" aria-pressed={status === v} onClick={() => setParam('status', v)}>{l}{status === v && items && <span className="ap-count num">{num(items.length)}{next ? '+' : ''}</span>}</button>
          ))}
        </div>
        <div className="ap-toolbar">
          <label className="ap-search"><Icon name="search" size={16} /><span className="sr">Search retailers</span>
            <input type="search" placeholder="Search store, city or code" value={q} onChange={e => setQ(e.target.value)} /></label>
          <label className="ap-sel"><span className="sr">State</span>
            <select value={state} onChange={e => setParam('state', e.target.value)}><option value="">All states</option>{(regions?.length ? regions : STATES).map(s => <option key={s}>{s}</option>)}</select></label>
        </div>
        {error && !items ? <div className="ap-card-b"><ErrorNote error={error} onRetry={refresh} /></div> : !items ? <div className="ap-skel-rows" aria-busy="true">{Array.from({ length: 8 }, (_, i) => <i key={i} />)}</div> : !items.length ? <div className="ap-empty"><Icon name="search" size={18} /><span>No stores match.</span></div> : (
          <div className="ap-tw">
            <table className="ap-t ap-t-ret">
              <thead><tr><th className="c-store">Store</th><th className="c-code">Code</th><th className="c-dist">Distributor</th><th className="c-st">Status</th><th className="c-ord r">Orders</th><th className="c-last">Last order</th><th className="c-pts r">Points</th><th className="c-act"><span className="sr">Actions</span></th></tr></thead>
              <tbody>{items.map(r => (
                <tr key={r.id} className="noclick">
                  <td className="c-store"><span className="ap-store"><b>{r.store}</b><span>{r.city}{r.state ? `, ${r.state}` : ''}</span></span></td>
                  <td className="c-code"><span className="ap-id">{r.code}</span></td>
                  <td className="c-dist"><span className="ap-ell" title={r.distributor}>{r.distributor}</span></td>
                  <td className="c-st">{r.activated ? <span className="ap-pill t-ok">Active</span> : <span className="ap-pill">Invited</span>}</td>
                  <td className="c-ord r num">{num(r.orders)}</td>
                  <td className="c-last num">{r.lastOrderAt ? dmy(r.lastOrderAt) : <span className="muted">—</span>}</td>
                  <td className="c-pts r num">{num(r.points)}</td>
                  <td className="c-act r"><button type="button" className="ap-btn sm ghost" onClick={() => setEdit(r)}><Icon name="phone" size={14} />Change mobile</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        {items && items.length > 0 && (
          <div className="ap-foot">
            <span className="num">{num(items.length)} store{items.length === 1 ? '' : 's'}{next ? ' shown' : ''}</span>
            {next && <button type="button" className="ap-btn" onClick={more} disabled={busy}>{busy ? 'Loading…' : 'Load more'}</button>}
          </div>
        )}
      </section>
      <PhoneSheet r={edit} onClose={() => setEdit(null)} />
    </>
  );
}

function PhoneSheet({ r, onClose }: { r: RetailerRow | null; onClose: () => void }) {
  const [phone, setPhone] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setPhone(''); setErr(''); }, [r?.id]);
  const digits = phone.replace(/\D/g, '').slice(-10);
  const valid = /^[6-9]\d{9}$/.test(digits);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!r) return;
    if (!valid) { setErr('Enter a 10-digit Indian mobile number.'); return; }
    setBusy(true); setErr('');
    try {
      await api.put(`/api/admin/retailers/${encodeURIComponent(r.id)}/phone`, { phone: digits });
      toast(`${r.store}: mobile changed. Old sessions are signed out`);
      onClose();
    } catch (e2) { setErr(e2 instanceof ApiError ? e2.message : 'Could not change the number.'); }
    finally { setBusy(false); }
  }
  return (
    <Sheet open={!!r} onClose={() => !busy && onClose()} label="Change mobile" eyebrow={r ? `${r.store} · ${r.code}` : ''} title="Change the store's mobile" initialFocus="#newmob">
      <form onSubmit={submit} className="stack" noValidate>
        <p className="muted small" style={{ marginTop: -6 }}>Use this when the shop's number changes. The store signs in with the new number; sessions on the old one are signed out. This is recorded in the audit log.</p>
        <div className="field"><label htmlFor="newmob">New mobile number</label>
          <div className="tel"><span className="muted">+91</span>
            <input id="newmob" inputMode="numeric" autoComplete="off" maxLength={11} value={phone} placeholder="98470 00000"
              onChange={e => { setErr(''); const d = e.target.value.replace(/\D/g, '').slice(0, 10); setPhone(d.length > 5 ? `${d.slice(0, 5)} ${d.slice(5)}` : d); }}
              aria-invalid={!!err} aria-describedby={err ? 'moberr' : undefined} /></div></div>
        {err && <span id="moberr" className="bad-ink small" role="alert">{err}</span>}
        <div className="row">
          <button type="submit" className="btn" disabled={busy || !valid}>{busy ? 'Saving…' : 'Change number'}</button>
          <button type="button" className="btn sec" onClick={onClose} disabled={busy}>Cancel</button>
        </div>
      </form>
    </Sheet>
  );
}
