// Admin home, Stripe-style: header, one KPI strip, then what needs a person (orders + action list),
// then where the business is (states, styles, pipeline), then latest orders and open rules.
import type { Order, OrderStatus } from '@citrus/shared';
import { retailerLabel } from '@citrus/shared';
import { useQuery } from '../../lib/query';
import { lakh, num } from '../../lib/format';
import type { LowStockRow, Page } from '../../lib/types';
import { itemsOf } from '../../lib/types';
import { Icon } from '../../components/Icon';
import { PLink } from '../../components/PLink';
import { ErrorNote } from '../../components/Bits';
import { ExceptionRow, exceptionsOf, OrdersTable, PageHeader, Panel, PendingConfirmation, Tip, type Overview as OV } from './shared';

type Kpi = OV['kpis'][number];
/** What each KPI means, shown under the label and in its tooltip. `down`: lower is better. */
const DEF: { test: RegExp; def: string; sub?: string; down?: boolean; unit?: string }[] = [
  { test: /retailers activated/i, def: 'Stores that have signed in at least once, out of every store invited to CITRUS Trade.' },
  { test: /orders today/i, def: 'Orders placed since midnight across all distributors. Trend: last 7 days.', unit: '' },
  { test: /order value/i, def: 'Trade value of orders placed since midnight, before tax. Trend: last 7 days.' },
  { test: /approval time/i, def: 'Median time from an order being placed to the distributor deciding on it, last 7 days. Lower is better.', down: true },
  { test: /failed erp/i, def: 'Orders that Ginesys did not accept after automatic retries, today. Lower is better.', down: true },
  { test: /fill rate/i, def: 'Fill rate = confirmed pieces ÷ ordered pieces, last 30 days.', sub: 'Confirmed ÷ ordered pcs · 30d' },
];
const defOf = (k: Kpi) => DEF.find(d => d.test.test(k.label));

function delta(k: Kpi) {
  const s = k.series;
  if (!s || s.length < 2) return null;
  const a = s[0], b = s[s.length - 1];
  if (!a) return null;
  const pct = ((b - a) / Math.abs(a)) * 100;
  const good = defOf(k)?.down ? pct < 0 : pct > 0;
  return { pct, good, flat: Math.abs(pct) < 0.5 };
}

function Spark({ values, tone }: { values: number[]; tone: string }) {
  const mx = Math.max(...values), mn = Math.min(...values);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * 100, 30 - ((v - mn) / ((mx - mn) || 1)) * 26] as const);
  const line = 'M' + pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' L');
  return (
    <svg className={`ap-spark ${tone}`} viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
      <path className="a" d={`${line} L100,32 L0,32 Z`} />
      <path className="l" d={line} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function KpiCell({ k }: { k: Kpi }) {
  const d = defOf(k), dl = delta(k);
  return (
    <div className="ap-kpi">
      <div className="ap-kpi-l"><span>{k.label}</span>{d && <Tip text={d.def} />}</div>
      <div className="ap-kpi-v">
        <span className="num">{k.value}</span>
        {dl && !dl.flat && <span className={`ap-delta ${dl.good ? 'up' : 'down'}`} title="Change over the last 7 days">{dl.pct > 0 ? '+' : '−'}{Math.abs(dl.pct) >= 10 ? Math.round(Math.abs(dl.pct)) : Math.abs(dl.pct).toFixed(1)}%</span>}
      </div>
      <div className="ap-kpi-s">{d?.sub ?? k.sub}</div>
      {k.series ? <Spark values={k.series} tone={dl ? (dl.flat ? '' : dl.good ? 'up' : 'down') : ''} />
        : k.pct !== undefined ? <div className="ap-meter" role="img" aria-label={`${k.pct}%`}><i style={{ width: `${Math.min(100, k.pct)}%` }} /></div> : null}
    </div>
  );
}

const pctLabel = (f: number) => (f > 0 && f < 0.005 ? '<1%' : `${Math.round(f * 100)}%`);
const FLOW: OrderStatus[] = ['placed', 'review', 'modified', 'approved', 'confirmed', 'processing', 'dispatched', 'delivered', 'rejected', 'cancelled'];
const OPEN = new Set<string>(['placed', 'review', 'modified', 'approved']);

export default function Overview() {
  const { data, error, refresh } = useQuery<OV>('/api/admin/overview', { staleMs: 15_000 });
  const { data: low } = useQuery<LowStockRow[] | Page<LowStockRow>>('/api/admin/low-stock', { staleMs: 60_000 });
  const { data: attention } = useQuery<Page<Order>>('/api/admin/orders?status=attention', { staleMs: 10_000 });
  const { data: recent } = useQuery<Page<Order>>('/api/admin/orders', { staleMs: 10_000 });
  const lowN = itemsOf(low)?.length;
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  const sample = <span className="ap-sample" tabIndex={0} title="The KPI figures on this page are sample values until Ginesys and live order data are connected.">Sample data</span>;
  const head = <PageHeader title="Overview" meta={sample} sub={`All regions · ${today}`} />;

  if (error && !data) return <>{head}<ErrorNote error={error} onRetry={refresh} /></>;
  if (!data) return (
    <>{head}
      <div className="ap-kpis" aria-busy="true">{Array.from({ length: 6 }, (_, i) => <div key={i} className="ap-kpi"><i className="ap-sk" style={{ width: '60%' }} /><i className="ap-sk" style={{ height: 26, width: '45%' }} /><i className="ap-sk" style={{ height: 30 }} /></div>)}</div>
      <div className="ap-split"><div className="ap-card ap-skel" style={{ height: 380 }} /><div className="ap-card ap-skel" style={{ height: 380 }} /></div></>
  );

  const ex = exceptionsOf(data);
  const act = ex.filter(x => x.severity !== 'info');
  const integ = data.live?.integration;
  const pipe = data.live?.pipeline ?? {};
  const snap = integ?.stockSnapshotAgeSeconds;
  const topMax = Math.max(1, ...data.topStyles.map(s => s.qty));
  const regTotal = data.regions.reduce((a, r) => a + r.value, 0) || 1;
  const funnel = data.funnel ?? {};
  const fTotal = Object.values(funnel).reduce((a, n) => a + (n ?? 0), 0) || 1;
  const openN = FLOW.filter(s => OPEN.has(s)).reduce((a, s) => a + (funnel[s] ?? 0), 0);
  const attn = attention?.items ?? [];

  return (
    <>
      <PageHeader title="Overview" meta={sample} sub={`All regions · ${today}`}
        actions={<>
          <PLink to="/admin/low-stock" className="ap-btn">{lowN !== undefined && <span className="ap-btn-n num">{num(lowN)}</span>}Low stock</PLink>
          <PLink to="/admin/orders" className="ap-btn pri">View orders<Icon name="fwd" size={14} /></PLink>
        </>} />

      <div className="ap-kpis">{data.kpis.map(k => <KpiCell key={k.label} k={k} />)}</div>

      <div className="ap-split">
        <div className="ap-col">
        <Panel title="Orders needing attention" count={attn.length} flush
          sub="Sync failures and orders waiting on a distributor decision"
          action={<PLink to="/admin/orders?status=attention" className="ap-link">View all<Icon name="fwd" size={13} /></PLink>}>
          <OrdersTable orders={attention ? attn.slice(0, 7) : undefined} empty="Nothing is waiting. Every open order is moving." dense />
        </Panel>
          {integ && (
            <Panel title="System health">
              <dl className="ap-health ap-health-row">
                <div><dt>Ginesys ERP link</dt><dd><span className={`ap-erp t-${integ.ginesys === 'ok' ? 'ok' : integ.ginesys === 'degraded' ? 'warn' : 'bad'}`}><i />{integ.ginesys === 'ok' ? 'Operational' : integ.ginesys === 'degraded' ? 'Degraded' : 'Down'}</span></dd></div>
                <div><dt>Sync queue</dt><dd className="num">{num(integ.queue?.pending ?? 0)} pending · <span className={integ.queue?.failed ? 'bad-ink' : ''}>{num(integ.queue?.failed ?? 0)} failed</span></dd></div>
                <div><dt>Stock snapshot</dt><dd className="num">{snap == null ? '—' : snap < 120 ? `${snap}s old` : `${Math.round(snap / 60)} min old`}</dd></div>
                <div><dt>Open orders</dt><dd className="num">{num(pipe.review ?? 0)} with distributors · {num(pipe.modified ?? 0)} with retailers</dd></div>
              </dl>
            </Panel>
          )}
        </div>

        <div className="ap-col">
          <Panel title="Action list" count={act.length} flush
            action={<PLink to="/admin/exceptions" className="ap-link">All exceptions<Icon name="fwd" size={13} /></PLink>}>
            {act.length ? act.slice(0, 4).map(x => <ExceptionRow key={x.id} x={x} />)
              : <div className="ap-empty"><Icon name="check" size={18} /><span>Nothing needs action{ex.length ? `. ${ex.length} for information.` : '.'}</span></div>}
          </Panel>
        </div>
      </div>

      <div className="ap-tri">
        <Panel title="Sell-in by state" sub="Order value, last 30 days">
          <ul className="ap-bars">{data.regions.map(r => (
            <li key={r.name}><span className="t">{r.name}</span><span className="v num">{lakh(r.value)}</span><span className="p num">{Math.round((r.value / regTotal) * 100)}%</span>
              <span className="track"><i style={{ width: `${(r.value / regTotal) * 100 / Math.max(...data.regions.map(x => x.value / regTotal))}%` }} /></span></li>
          ))}</ul>
        </Panel>
        <Panel title="Top NOS styles" sub="Pieces ordered, last 30 days">
          <ul className="ap-bars">{data.topStyles.map((s, i) => (
            <li key={s.styleId ?? s.name}><span className="t"><span className="rk num">{i + 1}</span>{s.name}</span><span className="v num">{num(s.qty)}</span>
              <span className="track"><i style={{ width: `${(s.qty / topMax) * 100}%` }} /></span></li>
          ))}</ul>
        </Panel>
        <Panel title="Order pipeline" sub={`Last 30 days · ${num(openN)} open`}>
          <div className="ap-stack" role="img" aria-label="Orders by stage">
            {FLOW.filter(s => funnel[s]).map(s => <i key={s} className={OPEN.has(s) ? 'open' : s === 'rejected' || s === 'cancelled' ? 'lost' : 'done'} style={{ flexGrow: funnel[s] }} title={`${retailerLabel(s)}: ${funnel[s]}`} />)}
          </div>
          <ul className="ap-pipe">{FLOW.filter(s => funnel[s]).map(s => (
            <li key={s}>
              <PLink to={`/admin/orders?status=${s}`}><span className={`sw ${OPEN.has(s) ? 'open' : s === 'rejected' || s === 'cancelled' ? 'lost' : 'done'}`} />{retailerLabel(s)}</PLink>
              <span className="v num">{num(funnel[s] ?? 0)}</span><span className="p num">{pctLabel((funnel[s] ?? 0) / fTotal)}</span>
            </li>
          ))}</ul>
        </Panel>
      </div>

      <Panel title="Latest orders" flush action={<PLink to="/admin/orders" className="ap-link">All orders<Icon name="fwd" size={13} /></PLink>}>
        <OrdersTable orders={recent?.items.slice(0, 8)} />
      </Panel>

      <PendingConfirmation compact />
    </>
  );
}
