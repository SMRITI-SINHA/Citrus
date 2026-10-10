// Rewards shown as the prize itself (Havells Sampark trip slabs, Pidilite "balance to go"): a picture, the points, and how far the store is.
import { useState } from 'react';
import { REWARD_TIERS } from '@citrus/shared';
import { num } from '../lib/format';
import { nextTier } from '../lib/rewards';
import { Icon } from './Icon';

const BASE = ((import.meta.env.VITE_PHOTO_BASE as string | undefined) ?? '/photos/').replace(/\/?$/, '/');
const ART: Record<number, { file: string; tint: string; tag: string }> = {
  1000: { file: 'rewards/air-fryer.webp', tint: 'linear-gradient(135deg,#FFE7C2,#FFC98A)', tag: 'Quick win' },
  4000: { file: 'rewards/credit-note.webp', tint: 'linear-gradient(135deg,#D9F5E8,#9EE0C3)', tag: 'Money off' },
  5000: { file: 'rewards/bangkok.webp', tint: 'linear-gradient(135deg,#FFD6E0,#F5A3B8)', tag: 'Trip for two' },
  10000: { file: 'rewards/iphone.webp', tint: 'linear-gradient(135deg,#DCE3FF,#AEBBF5)', tag: 'Top prize' },
};
export const rewardArt = (at: number) => ART[at] ?? ART[1000];

/** Photo credits the CC licences require; shown under the reward cards. */
export const REWARD_CREDITS = 'Photos: KOSIN SUKHUM (CC BY-SA 4.0), Padgriffin (CC BY 4.0), Ashley Pomeroy (CC BY 4.0), via Wikimedia Commons. iPhone 18 Pro: Apple. Prize models may differ.';

export function RewardPic({ at, name }: { at: number; name: string }) {
  const a = rewardArt(at);
  const [bad, setBad] = useState(false);
  if (at === 4000) return (
    <span className="rpic cnote" style={{ background: a.tint }} role="img" aria-label={name}><VoucherArt /></span>
  );
  return (
    <span className="rpic" style={{ background: a.tint }}>
      {!bad && <img src={BASE + a.file} alt={name} loading="lazy" decoding="async" onError={() => setBad(true)} />}
      {bad && <Icon name="gift" size={34} />}
    </span>
  );
}

/** The ₹4,000 credit note drawn as the real thing: a gift voucher with a ribbon, cash fanned behind it. */
function VoucherArt() {
  return (
    <svg className="voucher" viewBox="0 0 160 120" aria-hidden="true">
      <defs>
        <linearGradient id="vc-card" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#1B2A55" /><stop offset="1" stopColor="#3B4FA8" /></linearGradient>
        <linearGradient id="vc-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#FFE08A" /><stop offset=".5" stopColor="#F5B82E" /><stop offset="1" stopColor="#D98E04" /></linearGradient>
        <linearGradient id="vc-note" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#7FD8A8" /><stop offset="1" stopColor="#2E9E6B" /></linearGradient>
        <mask id="vc-cut"><rect width="160" height="120" fill="#fff" /><circle cx="22" cy="68" r="7" fill="#000" /><circle cx="138" cy="68" r="7" fill="#000" /></mask>
      </defs>
      <g transform="rotate(-14 80 60)"><rect x="34" y="18" width="96" height="50" rx="6" fill="url(#vc-note)" /><rect x="40" y="24" width="84" height="38" rx="4" fill="none" stroke="#E8FFF2" strokeOpacity=".7" /><circle cx="82" cy="43" r="10" fill="#E8FFF2" fillOpacity=".55" /></g>
      <g transform="rotate(8 80 60)"><rect x="40" y="20" width="96" height="50" rx="6" fill="url(#vc-note)" opacity=".9" /><rect x="46" y="26" width="84" height="38" rx="4" fill="none" stroke="#E8FFF2" strokeOpacity=".6" /></g>
      <g mask="url(#vc-cut)" filter="drop-shadow(0 6px 8px rgba(10,20,50,.35))">
        <rect x="15" y="40" width="130" height="58" rx="9" fill="url(#vc-card)" />
        <rect x="104" y="40" width="12" height="58" fill="url(#vc-gold)" />
      </g>
      <path d="M110 40c-10-14-26-12-24-4 2 7 16 6 24 4zm0 0c10-14 26-12 24-4-2 7-16 6-24 4z" fill="url(#vc-gold)" />
      <circle cx="110" cy="40" r="4.5" fill="#D98E04" />
      <text x="28" y="66" fill="#FFE08A" fontSize="9" fontWeight="700" letterSpacing="1.2" fontFamily="Inter,system-ui,sans-serif">CREDIT NOTE</text>
      <text x="28" y="87" fill="#fff" fontSize="21" fontWeight="800" fontFamily="Inter,system-ui,sans-serif">₹4,000</text>
    </svg>
  );
}

/** One card per reward: picture, name, points, and a bar or "Unlocked". */
export function RewardCards({ points, compact }: { points: number; compact?: boolean }) {
  const { next } = nextTier(points);
  return (
    <div className={`rcards${compact ? ' compact' : ''}`}>
      {REWARD_TIERS.map(r => {
        const got = points >= r.at, pct = Math.min(100, Math.round((points / r.at) * 100));
        return (
          <div key={r.at} className={`rcard${got ? ' got' : ''}${r.at === next.at && !got ? ' next' : ''}`}>
            <RewardPic at={r.at} name={r.name} />
            <span className="rtag">{got ? 'Unlocked' : r.at === next.at ? 'Next for you' : rewardArt(r.at).tag}</span>
            <b className="rname">{r.name}</b>
            <span className="rpts num">{num(r.at)} pts</span>
            {got ? <span className="rgot"><Icon name="check" size={14} /> Ready to claim</span>
              : <><span className="rbar"><i style={{ width: `${pct}%` }} /></span><span className="rleft num">{num(r.at - points)} pts to go</span></>}
          </div>
        );
      })}
    </div>
  );
}

/** Compact "this order gets you closer" nudge for the cart (Shikhar / Udaan slab nudges). */
export function RewardNudge({ points, adding }: { points: number; adding: number }) {
  const after = points + adding;
  const t = nextTier(after);
  const unlocks = REWARD_TIERS.filter(r => r.at > points && r.at <= after);
  return (
    <div className="rnudge">
      <RewardPic at={unlocks[0]?.at ?? t.next.at} name={unlocks[0]?.name ?? t.next.name} />
      <div className="grow">
        {unlocks.length
          ? <><b>This order unlocks the {unlocks.map(u => u.name).join(' and ')}!</b><span className="muted">You'll have {num(after)} points after delivery.</span></>
          : <><b>{num(t.away)} pts more to the {t.next.name}</b><span className="muted">This order adds {num(adding)} pts. New styles earn more.</span></>}
        <span className="rbar"><i style={{ width: `${t.pct}%` }} /></span>
      </div>
    </div>
  );
}
