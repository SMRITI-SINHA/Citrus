import type { Order } from '@citrus/shared';
import { retailerLabel } from '@citrus/shared';
import { useQuery } from '../../lib/query';
import { lakh, num } from '../../lib/format';
import { useT } from '../../lib/i18n';
import type { LowStockRow, Page } from '../../lib/types';
import { itemsOf } from '../../lib/types';
import { Icon } from '../../components/Icon';
import { PLink } from '../../components/PLink';
import { ErrorNote, Sparkline } from '../../components/Bits';
import { ExceptionRow, exceptionsOf, OrdersTable, PendingConfirmation, type Overview as OV } from './shared';

const PIPE = ['placed', 'review', 'modified', 'approved'] as const;

export default function Overview() {
  const { t } = useT();
  const { data, error, refresh } = useQuery<OV>('/api/admin/overview', { staleMs: 15_000 });
  const { data: low } = useQuery<LowStockRow[] | Page<LowStockRow>>('/api/admin/low-stock', { staleMs: 60_000 });
  const { data: attention } = useQuery<Page<Order>>('/api/admin/orders?status=attention', { staleMs: 10_000 });
  const { data: recent } = useQuery<Page<Order>>('/api/admin/orders', { staleMs: 10_000 });
  const lowN = itemsOf(low)?.length;

  if (error && !data) return <><h1 className="title">{t('overview')}</h1><ErrorNote error={error} onRetry={refresh} /></>;
  if (!data) return (
    <><h1 className="title">{t('overview')}</h1>
      <div className="kpis" aria-busy="true">{Array.from({ length: 6 }, (_, i) => <div key={i} className="skel card" style={{ height: 120 }} />)}</div>
      <div className="agrid"><div className="skel card" style={{ height: 420 }} /><div className="skel card" style={{ height: 420 }} /></div></>
  );

  const ex = exceptionsOf(data);
  const count = (sev: string) => ex.filter(e => e.severity === sev).length;
  const topMax = Math.max(1, ...data.topStyles.map(s => s.qty));
  const regMax = Math.max(1, ...data.regions.map(r => r.value));
  const integ = data.live?.integration;
  const pipe = data.live?.pipeline ?? {};
  const snap = integ?.stockSnapshotAgeSeconds;
  return (
    <>
      <div className="sec-h">
        <h1 className="title">{t('overview')}</h1>
        {integ && <span className={`status ${integ.ginesys === 'ok' ? 's-ok' : integ.ginesys === 'degraded' ? 's-warn' : 's-bad'}`}>Ginesys link {integ.ginesys === 'ok' ? 'healthy' : integ.ginesys}{snap != null ? ` · stock ${snap < 120 ? `${snap}s` : `${Math.round(snap / 60)}m`} old` : ''}</span>}
      </div>
      <div className="alerts" role="list" aria-label="Alerts">
        {count('bad') > 0 && <PLink to="/admin/exceptions" role="listitem" className="al bad"><Icon name="alert" size={16} /><b>{count('bad')}</b> need action now</PLink>}
        {count('warn') > 0 && <PLink to="/admin/exceptions" role="listitem" className="al warn"><Icon name="alert" size={16} /><b>{count('warn')}</b> to check</PLink>}
        {count('info') > 0 && <PLink to="/admin/exceptions" role="listitem" className="al"><Icon name="users" size={16} /><b>{count('info')}</b> for information</PLink>}
        {(pipe.review ?? 0) > 0 && <PLink to="/admin/orders?status=review" role="listitem" className="al"><Icon name="inbox" size={16} /><b>{num(pipe.review ?? 0)}</b> with distributors</PLink>}
        {(pipe.modified ?? 0) > 0 && <PLink to="/admin/orders?status=modified" role="listitem" className="al"><Icon name="edit" size={16} /><b>{num(pipe.modified ?? 0)}</b> awaiting retailers</PLink>}
        {lowN !== undefined && <PLink to="/admin/low-stock" role="listitem" className="al"><Icon name="box" size={16} /><b>{num(lowN)}</b> NOS sizes low</PLink>}
        {!ex.length && <span className="al"><Icon name="check" size={16} />No exceptions</span>}
      </div>
      <div className="kpis">
        {data.kpis.map(k => (
          <div key={k.label} className="card kpi">
            <span className="eyebrow">{k.label}</span><span className="v">{k.value}</span><span className="d">{k.sub}</span>
            {k.series ? <Sparkline values={k.series} /> : k.pct !== undefined ? <span className="meter"><i style={{ width: `${Math.min(100, k.pct)}%` }} /></span> : null}
          </div>
        ))}
      </div>
      <div className="agrid">
        <div className="stack-lg" style={{ gap: 20, minWidth: 0 }}>
          {(attention?.items.length ?? 0) > 0 && (
            <div className="card panel">
              <div className="sec-h"><h3>Orders needing attention</h3><PLink to="/admin/orders?status=attention" className="linkbtn">See all</PLink></div>
              <OrdersTable orders={attention?.items.slice(0, 6)} />
            </div>
          )}
          <div className="card panel">
            <div className="sec-h"><h3>Latest orders</h3><PLink to="/admin/orders" className="linkbtn">All orders</PLink></div>
            <OrdersTable orders={recent?.items.slice(0, 10)} />
          </div>
        </div>
        <div className="stack-lg" style={{ gap: 20 }}>
          <div className="card panel"><h3>Needs attention</h3>
            {ex.filter(x => x.severity !== 'info').slice(0, 3).map(x => <ExceptionRow key={x.id} x={x} />)}
            {!ex.some(x => x.severity !== 'info') && <span className="muted">Nothing needs action{ex.length ? `. ${ex.length} for information on the Exceptions page` : ''}.</span>}
            <PLink to="/admin/exceptions" className="linkbtn" style={{ alignSelf: 'flex-start' }}>All exceptions</PLink>
          </div>
          <div className="card panel"><h3>Top NOS styles, 30 days</h3>
            <div className="bars">{data.topStyles.map(s => <div key={s.styleId ?? s.name} className="b"><span className="t">{s.name}</span><span className="num r">{num(s.qty)}</span><span className="track"><i style={{ width: `${(s.qty / topMax) * 100}%` }} /></span></div>)}</div>
            <span className="muted xs">Pieces ordered through CITRUS Trade</span>
          </div>
          <div className="card panel"><h3>Sell-in by state, 30 days</h3>
            <div className="bars">{data.regions.map(r => <div key={r.name} className="b"><span className="t">{r.name}{r.orders ? <span className="muted"> · {num(r.orders)} orders</span> : null}</span><span className="num r nw">{lakh(r.value)}</span><span className="track"><i style={{ width: `${(r.value / regMax) * 100}%` }} /></span></div>)}</div>
          </div>
          {data.funnel && (
            <div className="card panel"><h3>Where orders are, 30 days</h3>
              <div className="bars">{Object.entries(data.funnel).sort((a, b) => b[1] - a[1]).map(([k, n]) => (
                <div key={k} className="b"><span className="t">{retailerLabel(k as Order['status'])}{(PIPE as readonly string[]).includes(k) ? <span className="muted"> · open</span> : null}</span><span className="num r">{num(n)}</span><span className="track"><i style={{ width: `${(n / Math.max(1, ...Object.values(data.funnel!))) * 100}%` }} /></span></div>
              ))}</div>
            </div>
          )}
        </div>
      </div>
      <PendingConfirmation compact />
    </>
  );
}
