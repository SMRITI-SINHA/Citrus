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
      <h1 className="title">Retailers</h1>
      <div className="card panel">
        <label className="search" style={{ minHeight: 44 }}><Icon name="search" /><span className="sr">Search retailers</span>
          <input type="search" placeholder="Store, city or code" value={q} onChange={e => setQ(e.target.value)} /></label>
        <div className="row">
          <label className="fsel"><span className="sr">State</span>
            <select value={state} onChange={e => setParam('state', e.target.value)}><option value="">All states</option>{(regions?.length ? regions : STATES).map(s => <option key={s}>{s}</option>)}</select></label>
          <div className="chips" role="group" aria-label="Status">
            {[['', 'All'], ['active', 'Active'], ['invited', 'Not activated']].map(([v, l]) => <button type="button" key={v} className="chip" aria-pressed={status === v} onClick={() => setParam('status', v)}>{l}</button>)}
          </div>
        </div>
        {error && !items ? <ErrorNote error={error} onRetry={refresh} /> : !items ? <div className="skel" style={{ height: 300 }} aria-busy="true" /> : !items.length ? <div className="empty">No stores match.</div> : (
          <div className="cq">
            <table className="tbl">
              <thead><tr><th>Store</th><th className="p3">Distributor</th><th className="p0">Status</th><th className="r p2">Orders</th><th className="p1">Last order</th><th className="r p3">Points</th><th><span className="sr">Actions</span></th></tr></thead>
              <tbody>{items.map(r => (
                <tr key={r.id}>
                  <td><b>{r.store}</b><div className="muted xs">{r.city} · <span className="mono">{r.code}</span></div><div className="np0 xs">{r.activated ? 'Active' : 'Not activated'}</div></td>
                  <td className="muted p3">{r.distributor}</td>
                  <td className="p0">{r.activated ? <span className="status s-ok">Active</span> : <span className="status s-info">Not activated</span>}</td>
                  <td className="r num p2">{num(r.orders)}</td>
                  <td className="nw muted p1">{r.lastOrderAt ? dmy(r.lastOrderAt) : '-'}</td>
                  <td className="r num p3">{num(r.points)}</td>
                  <td className="r"><button type="button" className="linkbtn" onClick={() => setEdit(r)}>Change mobile</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        {next && <div className="row" style={{ justifyContent: 'center' }}><button type="button" className="btn sec" onClick={more} disabled={busy}>{busy ? 'Loading…' : 'Show more'}</button></div>}
      </div>
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
