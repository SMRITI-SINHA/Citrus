// Hosted demo only: switch between the three panels without typing numbers and codes.
import { useState } from 'react';
import type { Session } from '@citrus/shared';
import { api } from '../lib/api';
import { session, useSession } from '../state/session';
import { router } from '../App';

const ROLES = [['retailer', 'Retailer', '9847041736'], ['distributor', 'Distributor', '9847012345'], ['admin', 'CITRUS admin', '9845000001']] as const;

export async function signInAs(phone: string) {
  const { requestId } = await api.post<{ requestId: string }>('/api/auth/otp', { phone }, { auth: false });
  const s = await api.post<Session>('/api/auth/verify', { requestId, code: '482916' }, { auth: false });
  session.signedIn(s);
  router.navigate('/');
}

export function DemoBar() {
  const st = useSession();
  const [busy, setBusy] = useState('');
  const role = st.status === 'authed' ? st.me.role : '';
  async function go(phone: string, r: string) { setBusy(r); try { await signInAs(phone); } finally { setBusy(''); } }
  return (
    <div className="demobar" role="toolbar" aria-label="Demo controls">
      <span className="demotag">Demo · sample data</span>
      <span className="demoroles">
        {ROLES.map(([r, label, phone]) => <button type="button" key={r} aria-pressed={role === r} disabled={!!busy} onClick={() => go(phone, r)}>{busy === r ? '…' : label}</button>)}
      </span>
      <button type="button" className="demolink" onClick={() => session.signOut().then(() => router.navigate('/login'))}>Sign-in screen</button>
    </div>
  );
}
