// "A person is always one tap away": call the CITRUS rep, or WhatsApp CITRUS.
import type { Me } from '@citrus/shared';
import { useSession } from '../state/session';
import { initials } from '../lib/format';
import { useT } from '../lib/i18n';
import { Icon } from './Icon';

const FALLBACK = (import.meta.env.VITE_SUPPORT_PHONE as string | undefined) ?? '';

export function contactOf(me?: Me) {
  const phone = (me?.supportPhone || FALLBACK).replace(/[^\d+]/g, '');
  const digits = phone.replace(/\D/g, '');
  const intl = digits.length === 10 ? '91' + digits : digits;
  return {
    name: me?.repName || '',
    tel: phone ? `tel:${digits.length === 10 ? '+91' + digits : '+' + intl}` : '',
    wa: (text = '') => (intl ? `https://wa.me/${intl}${text ? `?text=${encodeURIComponent(text)}` : ''}` : ''),
  };
}

function useContact() {
  const s = useSession();
  return contactOf(s.status === 'authed' ? s.me : undefined);
}

/** Two buttons: Call <rep> · WhatsApp us. Renders nothing if no number is configured. */
export function ContactButtons({ context = '', compact }: { context?: string; compact?: boolean }) {
  const c = useContact();
  const { t } = useT();
  if (!c.tel) return null;
  const callLabel = c.name ? t('callRep', { n: c.name.split(' ')[0] }) : t('callRepShort');
  return (
    <div className="contact">
      <a className={`btn sec${compact ? ' sm' : ''}`} href={c.tel}><Icon name="phone" size={16} />{callLabel}</a>
      <a className={`btn wa${compact ? ' sm' : ''}`} href={c.wa(context)} target="_blank" rel="noopener noreferrer"><Icon name="wa" size={16} />{t('whatsapp')}</a>
    </div>
  );
}

export function HelpCard({ context, line }: { context?: string; line?: string }) {
  const c = useContact();
  const { t } = useT();
  if (!c.tel) return null;
  return (
    <div className="card helpcard">
      <span className="av" aria-hidden="true">{c.name ? initials(c.name) : 'C'}</span>
      <div className="who"><b>{c.name ? `${c.name}, ${t('yourRep')}` : 'CITRUS'}</b><span className="muted">{line ?? 'Prefer to talk it through? Call or WhatsApp.'}</span></div>
      <ContactButtons context={context} compact />
    </div>
  );
}
