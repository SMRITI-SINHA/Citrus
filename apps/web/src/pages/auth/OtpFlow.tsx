// Mobile → one-time code. Auto-reads the SMS where the browser supports it (WebOTP / one-time-code autofill),
// offers "Resend code" and "Get the code on a call". Unknown numbers never create accounts.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import type { OtpRequestResult, Session } from '@citrus/shared';
import { api, ApiError } from '../../lib/api';
import { fmtPhone } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { session } from '../../state/session';
import { toast } from '../../state/toast';
import { ROLE_HOME } from '../../routes';
import { Icon } from '../../components/Icon';
import { BrandArt } from '../../components/Garment';

const SUPPORT = (import.meta.env.VITE_SUPPORT_PHONE as string | undefined) ?? '';

export function AuthLayout({ children }: { children: ReactNode }) {
  const { t, toggle } = useT();
  return (
    <div className="act">
      <aside className="side">
        <div className="brand" style={{ fontSize: 17 }}><span className="dot">.</span>CITRUS<small>Trade</small></div>
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div className="eyebrow" style={{ color: 'var(--citrus)', marginBottom: 14 }}>Defining Modern Menswear with Classic Elegance</div>
          <h2>Pause. Breathe. <em>Order.</em></h2>
          <p style={{ marginTop: 14 }}>Live stock, your usual size ratios and rewards on every piece. Ordering CITRUS essentials now takes minutes, not phone calls.</p>
        </div>
        <div className="art" aria-hidden="true">
          <BrandArt brand={['store-front']} />
        </div>
      </aside>
      <div className="pane"><div className="box">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="brand hide-lg" style={{ fontSize: 17 }}><span className="dot">.</span>CITRUS<small>Trade</small></div>
          <span className="spacer" />
          <button type="button" className="langbtn" onClick={toggle}>{t('language')}</button>
        </div>
        {children}
      </div></div>
    </div>
  );
}

type Stage = 'phone' | 'code';

export function OtpFlow({ invite, hint }: { invite?: string; hint?: string }) {
  const { t } = useT();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [stage, setStage] = useState<Stage>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [req, setReq] = useState<OtpRequestResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<{ code: string; message: string } | null>(null);
  const [left, setLeft] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const digits = phone.replace(/\D/g, '').slice(-10);

  useEffect(() => { if (stage === 'phone') phoneRef.current?.focus(); else codeRef.current?.focus(); }, [stage]);
  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => setLeft(l => l - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);

  // WebOTP: read the code from the SMS automatically (Android Chrome).
  useEffect(() => {
    if (stage !== 'code' || !('OTPCredential' in window)) return;
    const ac = new AbortController();
    (navigator.credentials.get({ otp: { transport: ['sms'] }, signal: ac.signal } as CredentialRequestOptions) as Promise<(Credential & { code?: string }) | null>)
      .then(c => { if (c?.code) setCode(c.code.replace(/\D/g, '').slice(0, 6)); }).catch(() => {});
    return () => ac.abort();
  }, [stage, req?.requestId]);

  async function send(channel?: 'voice') {
    if (digits.length !== 10) { setErr({ code: 'PHONE', message: 'Enter your 10-digit mobile number.' }); phoneRef.current?.focus(); return; }
    setErr(null); setBusy(channel ? 'Calling you…' : 'Sending code…');
    try {
      const r = await api.post<OtpRequestResult>('/api/auth/otp', { phone: digits, ...(invite ? { invite } : {}), ...(channel ? { channel } : {}) }, { auth: false });
      setReq(r); setLeft(r.resendIn || 30); setStage('code'); setCode('');
      if (r.devCode) setCode(r.devCode); // dev only: stands in for SMS auto-read
      if (channel) toast('You will get a call with the code in a few seconds');
      else if (stage === 'code') toast('New code sent by SMS');
    } catch (e) {
      setErr(e instanceof ApiError ? { code: e.code, message: e.message } : { code: 'UNKNOWN', message: 'Could not send the code.' });
      // Rate limits come with retryIn: count down instead of letting people tap into another refusal.
      const wait = e instanceof ApiError ? Number((e.body as { retryIn?: number } | undefined)?.retryIn) : NaN;
      if (wait > 0) setLeft(Math.ceil(wait));
    } finally { setBusy(null); }
  }

  async function verify(c = code) {
    if (!req || c.length !== 6 || busy) return;
    setErr(null); setBusy('Verifying…');
    try {
      const s = await api.post<Session>('/api/auth/verify', { requestId: req.requestId, code: c }, { auth: false });
      session.signedIn(s);
      const next = sp.get('next');
      nav(next && next.startsWith('/') && !next.startsWith('//') ? next : ROLE_HOME[s.me.role], { replace: true });
      if (invite && !s.me.consentRequired) toast(`Account activated. Welcome, ${s.me.retailer?.store ?? s.me.name}`);
    } catch (e) {
      setErr(e instanceof ApiError ? { code: e.code, message: e.message } : { code: 'UNKNOWN', message: 'Could not verify.' });
      setCode(''); codeRef.current?.focus();
    } finally { setBusy(null); }
  }
  // Verify as soon as the sixth digit arrives (typed, pasted or auto-read).
  useEffect(() => { if (code.length === 6 && stage === 'code') verify(code); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [code]);

  const unknown = err?.code === 'UNKNOWN_NUMBER';
  return (
    <>
      {stage === 'phone' ? (
        <form className="stack" onSubmit={e => { e.preventDefault(); send(); }} noValidate>
          <div className="field">
            <label htmlFor="mob">{t('mobile')}</label>
            <div className="tel"><span className="muted">+91</span>
              <input id="mob" ref={phoneRef} inputMode="numeric" autoComplete="tel-national" maxLength={11} placeholder="98470 41736" value={phone}
                aria-invalid={!!err} aria-describedby="mob-help"
                onChange={e => { setErr(null); const d = e.target.value.replace(/\D/g, '').slice(0, 10); setPhone(d.length > 5 ? `${d.slice(0, 5)} ${d.slice(5)}` : d); }} />
            </div>
            <span id="mob-help" className="muted small">{hint ?? "We'll send a one-time code by SMS. No password needed."}</span>
          </div>
          {err && !unknown && <span className="err" role="alert" style={{ color: 'var(--bad)', fontSize: 13 }}>{err.message}</span>}
          {unknown && <UnknownNumber message={err.message} />}
          <button type="submit" className="btn block" disabled={!!busy || left > 0}>{busy ?? (left > 0 ? `Try again in ${left}s` : t('sendCode'))}</button>
        </form>
      ) : (
        <form className="stack" onSubmit={e => { e.preventDefault(); verify(); }} noValidate>
          <div className="field">
            <label htmlFor="otp">Enter the 6-digit code sent to +91 {fmtPhone(digits)}</label>
            <div className="otpwrap">
              <div className="otp" aria-hidden="true">
                {Array.from({ length: 6 }, (_, i) => <span key={i} className={`${code[i] ? 'f' : ''}${i === Math.min(code.length, 5) ? ' cur' : ''}${err ? ' err' : ''}`}>{code[i] ?? ''}</span>)}
              </div>
              <input id="otp" ref={codeRef} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} value={code}
                aria-invalid={!!err} onChange={e => { setErr(null); setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); }} />
            </div>
            <span className="muted small" aria-live="polite">{busy ?? (code.length < 6 ? 'Waiting for the SMS. The code fills in by itself on most phones.' : '')}</span>
            {req?.devCode && <span className="devhint">Dev: code {req.devCode} filled from API echo</span>}
            {err && <span className="err" role="alert">{err.message}</span>}
            <span className="small row" style={{ gap: 6 }}>
              {left > 0 ? <span className="muted">Resend in {left}s</span> : <button type="button" className="linkbtn" onClick={() => send()}>{t('resend')}</button>}
              <span className="muted">·</span>
              <button type="button" className="linkbtn" disabled={left > 0} onClick={() => send('voice')}>{t('codeOnCall')}</button>
              <span className="muted">·</span>
              <button type="button" className="linkbtn" onClick={() => { setStage('phone'); setErr(null); setLeft(0); }}>Change number</button>
            </span>
          </div>
          <button type="submit" className="btn block" disabled={code.length < 6 || !!busy}>{busy ?? t('verify')}</button>
        </form>
      )}
    </>
  );
}

function UnknownNumber({ message }: { message: string }) {
  return (
    <div className="note warn" role="alert">
      <Icon name="alert" size={18} />
      <div className="grow">
        <b>This number is not on a CITRUS account</b>
        <span>{message || 'We have told the CITRUS team. Your rep will call you to verify the store.'} We never create a new account from an unknown number.</span>
        {SUPPORT && <div className="contact"><a className="btn sec sm" href={`tel:+91${SUPPORT.replace(/\D/g, '').slice(-10)}`}><Icon name="phone" size={16} />Call CITRUS</a></div>}
      </div>
    </div>
  );
}
