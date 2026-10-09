// Data-use notice shown once after first activation (India DPDP Act).
// Primary action accepts the required uses; WhatsApp marketing is a separate, unticked, optional choice.
import { useState } from 'react';
import type { Me } from '@citrus/shared';
import { api, ApiError } from '../../lib/api';
import { session } from '../../state/session';
import { toast } from '../../state/toast';
import { Icon } from '../../components/Icon';
import { ContactButtons } from '../../components/Contact';
import { useT } from '../../lib/i18n';

export function Consent({ me }: { me: Me }) {
  const [marketing, setMarketing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const { t, toggle } = useT();

  async function agree() {
    setBusy(true); setErr(null);
    try {
      await api.post('/api/me/consent', { waMarketing: marketing });
      session.updateMe({ consentRequired: false });
      toast(`Account activated. Welcome, ${me.retailer?.store ?? me.name}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e : new ApiError('UNKNOWN', 'Could not save. Please try again.', 0));
    } finally { setBusy(false); }
  }

  return (
    <div className="act">
      <aside className="side" aria-hidden="true">
        <div className="brand" style={{ fontSize: 17 }}><span className="dot">.</span>CITRUS<small>Trade</small></div>
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div className="eyebrow" style={{ color: 'var(--citrus)', marginBottom: 14 }}>Your data, plainly</div>
          <h2>One last <em>step.</em></h2>
        </div>
        <span />
      </aside>
      <div className="pane"><div className="box consent">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="brand hide-lg" style={{ fontSize: 17 }}><span className="dot">.</span>CITRUS<small>Trade</small></div>
          <button type="button" className="langbtn" onClick={toggle}>{t('language')}</button>
        </div>
        <div>
          <h1 style={{ fontSize: 28 }}>Before you start</h1>
          <p className="muted" style={{ marginTop: 6 }}>Welcome{me.retailer ? `, ${me.retailer.store}` : ''}. Here is how CITRUS uses your details.</p>
        </div>
        <div className="card box">
          <b>We use your number and store details to:</b>
          <ul>
            <li>take your orders and send them to {me.retailer?.distributor.name ?? 'your distributor'}</li>
            <li>send order updates on WhatsApp and SMS</li>
            <li>run CITRUS rewards on your purchases</li>
          </ul>
          <span className="muted xs">You can ask your CITRUS rep to see, correct or delete your data at any time.</span>
        </div>
        <label className="check">
          <input type="checkbox" checked={marketing} onChange={e => setMarketing(e.target.checked)} />
          <span><b style={{ fontWeight: 600 }}>Also send me new arrivals and offers on WhatsApp</b><span className="muted xs" style={{ display: 'block' }}>Optional. You can stop these any time.</span></span>
        </label>
        {err && <div className="note bad" role="alert"><Icon name="alert" size={18} /><div className="grow"><b>Not saved</b>{err.message}</div></div>}
        <button type="button" className="btn block" onClick={agree} disabled={busy} aria-busy={busy}>Agree and continue</button>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <button type="button" className="linkbtn" onClick={() => session.signOut()}>Not now, sign out</button>
        </div>
        <ContactButtons compact context="Question about CITRUS Trade data use" />
      </div></div>
    </div>
  );
}
