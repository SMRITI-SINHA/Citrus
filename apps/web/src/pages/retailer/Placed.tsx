import { useParams } from 'react-router';
import type { Order } from '@citrus/shared';
import { useQuery } from '../../lib/query';
import { hhmm, inr, num } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { Icon } from '../../components/Icon';
import { PLink } from '../../components/PLink';
import { ErrorNote } from '../../components/Bits';
import { ContactButtons } from '../../components/Contact';

export default function Placed() {
  const { id = '' } = useParams();
  const { t } = useT();
  const { data: o, error, refresh } = useQuery<Order>(`/api/orders/${encodeURIComponent(id)}`, { staleMs: 10_000 });
  if (error && !o) return <ErrorNote error={error} onRetry={refresh} />;
  if (!o) return <div className="skel card" style={{ height: 420, maxWidth: 680 }} aria-busy="true" />;
  const dist = o.distributorName;
  const reserving = o.status === 'placed';
  return (
    <div className="card placed">
      <div className="tick" aria-hidden="true"><Icon name="check" size={30} /></div>
      <div>
        <div className="eyebrow">Order placed</div>
        <h1 className="title" style={{ marginTop: 4 }}>Order <span className="mono" style={{ fontSize: '.85em' }}>{o.number}</span> is with {dist}</h1>
        <p className="muted" style={{ marginTop: 6 }}>{num(o.totalQty)} pcs · {inr(o.totalValue)} · {dist} will check it today. You'll get a WhatsApp message when they decide.</p>
      </div>
      <div className="note ok" style={{ width: '100%' }} role="status">
        <Icon name="check" size={18} />
        <span>{reserving ? `Stock checked at ${hhmm(o.placedAt)}. We are now holding your ${num(o.totalQty)} pieces for you.` : `All ${num(o.totalQty)} pieces are held for you while ${dist} reviews the order.`}</span>
      </div>
      {o.po && <div className="muted" style={{ fontSize: 13 }}>Your PO: <span className="mono">{o.po}</span></div>}
      {o.note && <div className="muted" style={{ fontSize: 13 }}>Your note to {dist}: “{o.note}”</div>}
      <div className="row no-print">
        <PLink to={`/orders/${o.id}`} className="btn">{t('track')}</PLink>
        <button type="button" className="btn sec" onClick={() => window.print()}><Icon name="file" size={16} />Download PDF</button>
        <PLink to="/home" className="btn sec">Back to home</PLink>
      </div>
      <div className="eyebrow" style={{ marginTop: 4 }}>{t('whatNext')}</div>
      <ol className="next">
        <li><b>{dist} reviews it</b>You'll get WhatsApp when they approve. If they suggest a change, nothing goes ahead without your OK.</li>
        <li><b>CITRUS confirms the order</b>You get a CITRUS order number on WhatsApp and here.</li>
        <li><b>Dispatch and delivery</b>Courier tracking on WhatsApp. Reward points show in your account once credited.</li>
      </ol>
      <div className="no-print" style={{ width: '100%' }}><ContactButtons context={`About my order ${o.number}`} /></div>
    </div>
  );
}
