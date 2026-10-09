import type { ReactNode } from 'react';
import type { OrderStatus } from '@citrus/shared';
import { retailerLabel } from '@citrus/shared';
import type { ApiError } from '../lib/api';
import { statusTone } from '../state/orders';
import { ContactButtons } from './Contact';
import { Icon, type IconName } from './Icon';

export function StatusBadge({ status, label }: { status: OrderStatus; label?: string }) {
  return <span className={`status ${statusTone(status)}`}>{label ?? retailerLabel(status)}</span>;
}

export function Note({ tone = 'info', icon, title, children, role }: { tone?: 'info' | 'warn' | 'bad' | 'ok'; icon?: IconName; title?: ReactNode; children?: ReactNode; role?: 'alert' | 'status' }) {
  return (
    <div className={`note ${tone}`} role={role}>
      {icon && <Icon name={icon} size={18} />}
      <div className="grow">{title && <b>{title}</b>}{children}</div>
    </div>
  );
}

/** Inline error that needs action: what happened, a retry, and a person to call. */
export function ErrorNote({ error, onRetry, context }: { error: ApiError | Error; onRetry?: () => void; context?: string }) {
  const net = 'isNetwork' in error && error.isNetwork;
  return (
    <div className="note bad" role="alert">
      <Icon name={net ? 'wifiOff' : 'alert'} size={18} />
      <div className="grow">
        <b>{net ? 'You are offline' : 'That did not load'}</b>
        <span>{error.message}</span>
        <div className="row" style={{ marginTop: 10 }}>
          {onRetry && <button type="button" className="btn sm" onClick={onRetry}><Icon name="refresh" size={16} />Try again</button>}
        </div>
        <div style={{ marginTop: 8 }}><ContactButtons compact context={context} /></div>
      </div>
    </div>
  );
}

export function TileSkeletons({ n = 4, scroll }: { n?: number; scroll?: boolean }) {
  return (
    <div className={scroll ? 'hscroll' : 'grid'} aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="stack" style={{ gap: 9 }}><div className="skel tile" /><div className="skel line" style={{ width: '80%' }} /><div className="skel line" style={{ width: '50%' }} /></div>
      ))}
    </div>
  );
}
export function CardSkeletons({ n = 3, h = 120 }: { n?: number; h?: number }) {
  return <div className="stack" aria-hidden="true">{Array.from({ length: n }, (_, i) => <div key={i} className="skel card" style={{ height: h }} />)}</div>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="card empty"><h3>{title}</h3>{children}</div>;
}

export function SecHead({ title, sub, action, as: H = 'h2' }: { title: ReactNode; sub?: ReactNode; action?: ReactNode; as?: 'h1' | 'h2' | 'h3' }) {
  return <div className="sec-h"><div style={{ minWidth: 0 }}><H className={H === 'h1' ? 'title' : undefined}>{title}</H>{sub && <div className="sub">{sub}</div>}</div>{action}</div>;
}

export function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const mx = Math.max(...values), mn = Math.min(...values);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * 100, 28 - ((v - mn) / ((mx - mn) || 1)) * 24] as const);
  return (
    <svg className="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
      <path d={'M' + pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' L')} fill="none" stroke="currentColor" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
      <circle cx="100" cy={pts[pts.length - 1][1]} r="2.6" fill="var(--citrus)" />
    </svg>
  );
}
