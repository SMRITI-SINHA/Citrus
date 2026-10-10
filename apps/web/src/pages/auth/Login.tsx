import { useT, t as tx } from '../../lib/i18n';
import { Navigate } from 'react-router';
import { useSession } from '../../state/session';
import { ROLE_HOME } from '../../routes';
import { AuthLayout, OtpFlow } from './OtpFlow';

export default function Login() {
  useT(); // re-render on language change
  const s = useSession();
  if (s.status === 'authed') return <Navigate to={ROLE_HOME[s.me.role]} replace />;
  return (
    <AuthLayout>
      <div>
        <h1 style={{ fontSize: 30 }}>{tx('signIn')}</h1>
        <p className="muted" style={{ marginTop: 6 }}>{tx('signInSub')}</p>
      </div>
      {s.status === 'anon' && s.offline && <div className="note warn" role="status"><div className="grow"><b>You are offline</b>Connect to the internet to sign in.</div></div>}
      <OtpFlow />
      <p className="muted xs">{tx('firstTime')}</p>
    </AuthLayout>
  );
}
