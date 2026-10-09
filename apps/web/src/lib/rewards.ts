import { REWARD_TIERS } from '@citrus/shared';

export function nextTier(points: number) {
  const next = REWARD_TIERS.find(r => r.at > points) ?? REWARD_TIERS[REWARD_TIERS.length - 1];
  const prev = [...REWARD_TIERS].reverse().find(r => r.at <= points);
  return { next, prev, pct: Math.min(100, Math.round((points / next.at) * 100)), away: Math.max(0, next.at - points) };
}
