import { useState } from 'react';
import { POLICY } from '@citrus/shared';
import { api, ApiError } from '../../lib/api';
import { useQuery } from '../../lib/query';
import { num } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { itemsOf, type LowStockRow, type Page } from '../../lib/types';
import { toast } from '../../state/toast';
import { Icon } from '../../components/Icon';
import { CardSkeletons, ErrorNote } from '../../components/Bits';

export default function LowStock() {
  const { t } = useT();
  const { data, error, refresh } = useQuery<LowStockRow[] | Page<LowStockRow>>('/api/admin/low-stock', { staleMs: 30_000 });
  const rows = itemsOf(data)?.slice().sort((a, b) => a.available - b.available);
  const [syncing, setSyncing] = useState(false);
  async function sync() {
    setSyncing(true);
    try { await api.post('/api/admin/sync/stock'); toast('Stock refresh from Ginesys started'); setTimeout(refresh, 2500); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not start the refresh'); }
    finally { setSyncing(false); }
  }
  return (
    <>
      <div className="sec-h">
        <div><h1 className="title">{t('lowStock')}</h1><div className="sub">NOS sizes at {POLICY.lowStockThreshold} pieces or fewer, live from the availability layer</div></div>
        <button type="button" className="btn sec sm" onClick={sync} disabled={syncing}><Icon name="refresh" size={14} />{syncing ? 'Starting…' : 'Refresh from Ginesys'}</button>
      </div>
      {error && !rows && <ErrorNote error={error} onRetry={refresh} />}
      {!rows && !error && <CardSkeletons n={1} h={360} />}
      {rows && (rows.length ? (
        <div className="card cq">
          <table className="tbl">
            <thead><tr><th>Style</th><th className="p2">Code</th><th>Colour · size</th><th className="r">Sellable</th><th className="r p1">Sold, 30 days</th></tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={`${r.styleId}|${r.color}|${r.size}|${i}`}>
                <td>{r.name ?? r.styleId}<div className="np1 muted xs">{num(r.sold30d)} sold in 30 days</div></td>
                <td className="mono nw p2">{r.styleId}</td><td className="nw">{r.color} · {r.size}</td>
                <td className="r num"><span className={`status ${r.available ? 's-warn' : 's-bad'}`}>{num(r.available)}</span></td>
                <td className="r num p1">{num(r.sold30d)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <div className="card empty"><h3>No low sizes</h3>Every NOS size has more than {POLICY.lowStockThreshold} pieces.</div>)}
    </>
  );
}
