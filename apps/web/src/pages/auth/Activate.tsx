// QR / invite link landing: shows the store card, then mobile → OTP.
import { useParams } from 'react-router';
import type { InviteInfo } from '@citrus/shared';
import { useQuery } from '../../lib/query';
import { initials } from '../../lib/format';
import { AuthLayout, OtpFlow } from './OtpFlow';
import { PLink } from '../../components/PLink';

export default function Activate() {
  const { token = '' } = useParams();
  const { data: inv, error, loading } = useQuery<InviteInfo>(`/api/auth/invite/${encodeURIComponent(token)}`, { staleMs: 600_000 });
  return (
    <AuthLayout>
      <div>
        <h1 style={{ fontSize: 30 }}>Welcome to CITRUS Trade</h1>
        <p className="muted" style={{ marginTop: 6 }}>Verify your mobile number to activate your retailer account.</p>
      </div>
      {loading && <div className="skel card" style={{ height: 96 }} aria-busy="true" />}
      {inv && (
        <div className="card storecard">
          <div className="av" aria-hidden="true">{initials(inv.store)}</div>
          <div style={{ minWidth: 0 }}>
            <div className="eyebrow">Account from your QR link</div>
            <b style={{ display: 'block' }}>{inv.store}</b>
            <span className="muted" style={{ fontSize: 13 }}>{inv.city} · Customer <span className="mono">{inv.code}</span></span>
            <span className="muted xs" style={{ display: 'block' }}>Distributor {inv.distributor}</span>
          </div>
        </div>
      )}
      {error && (
        <div className="note warn" role="alert">
          <div className="grow"><b>{error.status === 404 || error.status === 410 ? 'This link has expired or was already used' : 'Could not open this link'}</b>
            {error.status === 404 || error.status === 410 ? 'If your store is already active, sign in with your mobile number.' : error.message}
            <div style={{ marginTop: 10 }}><PLink to="/login" className="btn sm">Sign in with mobile</PLink></div></div>
        </div>
      )}
      {!error && <OtpFlow invite={token} hint={inv ? `Use the number CITRUS has for this store (${inv.maskedPhone}). We'll send a one-time code by SMS.` : undefined} />}
      <p className="muted xs">Not your store? Talk to your CITRUS rep. We never create a new account from an unknown number; it goes to manual verification.</p>
    </AuthLayout>
  );
}
