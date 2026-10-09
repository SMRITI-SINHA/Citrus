import { useT } from '../../lib/i18n';
import { useQuery } from '../../lib/query';
import { num } from '../../lib/format';
import { CardSkeletons, ErrorNote } from '../../components/Bits';
import { ExceptionRow, exceptionsOf, PendingConfirmation, type Overview } from './shared';

export default function Exceptions() {
  const { t } = useT();
  const { data, error, refresh } = useQuery<Overview>('/api/admin/overview', { staleMs: 10_000 });
  const ex = data ? exceptionsOf(data) : undefined;
  const act = ex?.filter(x => x.severity !== 'info') ?? [];
  const info = ex?.filter(x => x.severity === 'info') ?? [];
  // Information items are grouped by title so a burst of one kind does not bury what needs action.
  const groups = [...info.reduce((m, x) => m.set(x.title, [...(m.get(x.title) ?? []), x]), new Map<string, typeof info>())];
  return (
    <>
      <h1 className="title">{t('exceptions')}</h1>
      {error && !data && <ErrorNote error={error} onRetry={refresh} />}
      {!data && !error && <CardSkeletons n={4} h={70} />}
      {ex && (
        <div className="card panel">
          <h3>Needs action{act.length ? ` · ${num(act.length)}` : ''}</h3>
          {act.length ? act.map(x => <ExceptionRow key={x.id} x={x} />) : <div className="empty" style={{ padding: 16 }}><h3>Nothing needs action</h3>No sync failures, overdue approvals or activations to verify.</div>}
        </div>
      )}
      {groups.map(([title, xs]) => (
        <details key={title} className="card panel">
          <summary className="row" style={{ justifyContent: 'space-between', cursor: 'pointer', minHeight: 44 }}><b>{title}</b><span className="status s-info">{num(xs.length)} for information</span></summary>
          {xs.map(x => <ExceptionRow key={x.id} x={x} />)}
        </details>
      ))}
      <PendingConfirmation />
    </>
  );
}
