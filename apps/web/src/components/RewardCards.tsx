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

export function RewardPic({ at, name }: { at: number; name: string }) {
  const a = rewardArt(at);
  const [bad, setBad] = useState(false);
  return (
    <span className="rpic" style={{ background: a.tint }}>
      {!bad && <img src={BASE + a.file} alt={name} loading="lazy" decoding="async" onError={() => setBad(true)} />}
      {bad && <Icon name="gift" size={34} />}
    </span>
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
