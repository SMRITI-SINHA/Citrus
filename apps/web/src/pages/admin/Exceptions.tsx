import { useQuery } from '../../lib/query';
import { num } from '../../lib/format';
import { Icon } from '../../components/Icon';
import { ErrorNote } from '../../components/Bits';
import { ExceptionRow, exceptionsOf, PageHeader, Panel, PendingConfirmation, type Overview } from './shared';

export default function Exceptions() {
  const { data, error, refresh } = useQuery<Overview>('/api/admin/overview', { staleMs: 10_000 });
  const ex = data ? exceptionsOf(data) : undefined;
  const act = ex?.filter(x => x.severity !== 'info') ?? [];
  const info = ex?.filter(x => x.severity === 'info') ?? [];
  // Information items are grouped by title so a burst of one kind does not bury what needs action.
  const groups = [...info.reduce((m, x) => m.set(x.title, [...(m.get(x.title) ?? []), x]), new Map<string, typeof info>())];
  const bad = act.filter(x => x.severity === 'bad').length;
  return (
    <>
      <PageHeader title="Exceptions" sub="Sync failures, overdue approvals and activations that need a person. Most urgent first."
        meta={ex ? <span className="ap-ph-pills">{bad > 0 && <span className="ap-pill t-bad">{num(bad)} urgent</span>}{act.length - bad > 0 && <span className="ap-pill t-warn">{num(act.length - bad)} to check</span>}</span> : undefined} />
      {error && !data && <ErrorNote error={error} onRetry={refresh} />}
      {!data && !error && <div className="ap-card ap-skel" style={{ height: 280 }} />}
      {ex && (
        <Panel title="Needs action" count={act.length} flush>
          {act.length ? act.map(x => <ExceptionRow key={x.id} x={x} />)
            : <div className="ap-empty"><Icon name="check" size={18} /><span><b>Nothing needs action.</b> No sync failures, overdue approvals or activations to verify.</span></div>}
        </Panel>
      )}
      {groups.map(([title, xs]) => (
        <details key={title} className="ap-card ap-disc">
          <summary><Icon name="fwd" size={14} /><b>{title}</b><span className="ap-pill">{num(xs.length)} for information</span></summary>
          <div>{xs.map(x => <ExceptionRow key={x.id} x={x} />)}</div>
        </details>
      ))}
      <PendingConfirmation />
    </>
  );
}
