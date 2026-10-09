import { Navigate } from 'react-router';
import { useSession } from '../../state/session';
import { ROLE_HOME } from '../../routes';
import { AuthLayout, OtpFlow } from './OtpFlow';

export default function Login() {
  const s = useSession();
  if (s.status === 'authed') return <Navigate to={ROLE_HOME[s.me.role]} replace />;
  return (
    <AuthLayout>
      <div>
        <h1 style={{ fontSize: 30 }}>Sign in</h1>
        <p className="muted" style={{ marginTop: 6 }}>Retailers, distributors and the CITRUS team sign in with their registered mobile number.</p>
      </div>
      {s.status === 'anon' && s.offline && <div className="note warn" role="status"><div className="grow"><b>You are offline</b>Connect to the internet to sign in.</div></div>}
      <OtpFlow />
      <p className="muted xs">First time? Open the link or QR code your CITRUS rep sent you.</p>
    </AuthLayout>
  );
}
