import { useState } from 'react';
import { POLICY } from '@citrus/shared';
import { api, ApiError } from '../../lib/api';
import { useQuery } from '../../lib/query';
import { num } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { itemsOf, type LowStockRow, type Page } from '../../lib/types';
import { toast } from '../../state/toast';
import { Icon } from '../../components/Icon';
import { ErrorNote } from '../../components/Bits';
import { PageHeader, Panel } from './shared';

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
  const out = rows?.filter(r => !r.available).length ?? 0;
  return (
    <>
      <PageHeader title={t('lowStock')} sub={`NOS sizes at ${POLICY.lowStockThreshold} pieces or fewer, live from the availability layer.`}
        meta={rows ? <span className="ap-ph-pills">{out > 0 && <span className="ap-pill t-bad">{num(out)} sold out</span>}<span className="ap-pill t-warn">{num(rows.length - out)} low</span></span> : undefined}
        actions={<button type="button" className="ap-btn" onClick={sync} disabled={syncing}><Icon name="refresh" size={14} />{syncing ? 'Starting…' : 'Sync stock from Ginesys'}</button>} />
      {error && !rows && <ErrorNote error={error} onRetry={refresh} />}
      {!rows && !error && <div className="ap-card ap-skel" style={{ height: 360 }} />}
      {rows && (rows.length ? (
        <Panel title="Sizes running low" count={rows.length} flush>
          <div className="ap-tw">
            <table className="ap-t ap-t-low">
              <thead><tr><th className="c-sty">Style</th><th className="c-code">Code</th><th className="c-var">Colour</th><th className="c-sz">Size</th><th className="c-av r">Sellable</th><th className="c-sold r">Sold, 30d</th></tr></thead>
              <tbody>{rows.map((r, i) => (
                <tr key={`${r.styleId}|${r.color}|${r.size}|${i}`}>
                  <td className="c-sty"><b className="ap-ell">{r.name ?? r.styleId}</b></td>
                  <td className="c-code"><span className="ap-id">{r.styleId}</span></td>
                  <td className="c-var">{r.color}</td>
                  <td className="c-sz"><span className="ap-size">{r.size}</span></td>
                  <td className="c-av r"><span className={`ap-stock ${r.available ? 'low' : 'out'}`}><span className="num">{num(r.available)}</span><span className="ap-gauge"><i style={{ width: `${(r.available / POLICY.lowStockThreshold) * 100}%` }} /></span></span></td>
                  <td className="c-sold r num">{r.sold30d == null ? '—' : num(r.sold30d)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Panel>
      ) : <div className="ap-card ap-empty"><Icon name="check" size={18} /><span><b>No low sizes.</b> Every NOS size has more than {POLICY.lowStockThreshold} pieces.</span></div>)}
    </>
  );
}
