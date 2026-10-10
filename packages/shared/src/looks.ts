// "Complete the look": picks the other half of an outfit that a menswear buyer would actually put together.
// Rules, in order: the occasion must match (formal shirt with formal trouser or chino, polo with chino or denim...),
// the colours must be a known good pairing (classic menswear colour wheel), two loud patterns never go together,
// and it must be in stock. Among good pairs, the store's own buying history wins: styles and trouser types it
// already sells rank first. A learned model can replace `score` later; the inputs stay the same.

export interface LookStyle { id: string; name: string; category: string; kind: string; pattern: string; fabric: string; colors: string[] }
export interface LookCtx {
  stockOf: (styleId: string, color: string) => number;
  /** style ids this store has ordered before, with how many orders each */
  bought: Map<string, number>;
  /** kind (chino, formal, denim, polo...) to how many pieces this store has ordered */
  boughtKinds: Map<string, number>;
}
export interface LookPick { style: LookStyle; color: string; score: number; reason: string }

/** Top colour to the bottom colours that suit it, best first. */
export const GOES_WITH: Record<string, string[]> = {
  White: ['Navy', 'Charcoal', 'Khaki', 'Indigo', 'Olive', 'Black', 'Grey'],
  'Sky Blue': ['Khaki', 'Navy', 'Charcoal', 'Stone', 'Grey', 'Indigo'],
  'Light Pink': ['Navy', 'Charcoal', 'Grey', 'White', 'Stone', 'Khaki'],
  Navy: ['Khaki', 'Stone', 'Grey', 'White', 'Charcoal', 'Olive'],
  Black: ['Grey', 'Charcoal', 'Stone', 'Khaki', 'Indigo'],
  Olive: ['Khaki', 'Stone', 'Indigo', 'Navy', 'White'],
  Stone: ['Navy', 'Olive', 'Indigo', 'Charcoal', 'Black'],
  Maroon: ['Khaki', 'Stone', 'Navy', 'Grey', 'Indigo', 'Charcoal'],
  Khaki: ['Navy', 'Olive', 'Indigo', 'White'],
  Charcoal: ['Khaki', 'Stone', 'Grey', 'Black'],
  Grey: ['Navy', 'Black', 'Charcoal', 'Indigo', 'White'],
  Indigo: ['Khaki', 'Stone', 'Grey', 'White'],
  Rust: ['Stone', 'Navy', 'Indigo', 'Khaki', 'Olive'],
  Bottle: ['Khaki', 'Stone', 'Navy', 'Indigo'],
};

type Occ = 'formal' | 'smart' | 'casual';
const LOUD = new Set(['Check', 'Print', 'Stripe']);
const KIND_NOUN: Record<string, string> = { formal: 'formal trousers', trouser: 'chinos', denim: 'jeans', cargo: 'cargos', shorts: 'shorts', shirt: 'shirts', mandarin: 'mandarin shirts', polo: 'polos', tee: 'tees' };

const isTop = (s: LookStyle) => s.category !== 'Trousers';
function occ(s: LookStyle): Occ {
  if (!isTop(s)) return s.kind === 'formal' ? 'formal' : s.kind === 'trouser' ? 'smart' : 'casual';
  if (s.kind === 'tee') return 'casual';
  if (s.kind === 'polo') return 'smart';
  if (['Print', 'Check', 'Chambray'].includes(s.pattern) || /linen/i.test(s.fabric)) return 'casual';
  if (/poplin|satin|giza/i.test(s.fabric) || s.pattern === 'Dobby' || /formal/i.test(s.name)) return 'formal';
  return 'smart';
}
const OCC_FIT: Record<Occ, Partial<Record<Occ, number>>> = {
  formal: { formal: 1, smart: 0.75 },
  smart: { smart: 1, formal: 0.7, casual: 0.75 },
  casual: { casual: 1, smart: 0.9 },
};

/** How well a top and a bottom go together, 0 when they don't. */
export function pairScore(top: LookStyle, tc: string, bot: LookStyle, bc: string): number {
  const list = GOES_WITH[tc] ?? [];
  const ci = list.indexOf(bc);
  if (ci < 0) return 0;
  const o = OCC_FIT[occ(top)][occ(bot)] ?? 0;
  if (!o) return 0;
  const pat = LOUD.has(top.pattern) && LOUD.has(bot.pattern) ? 0 : LOUD.has(bot.pattern) ? 0.8 : 1;
  return o * pat * (1 - ci * 0.08);
}

function reasonFor(anchor: LookStyle, ac: string, other: LookStyle, oc: string, ctx: LookCtx): string {
  const n = ctx.bought.get(other.id);
  const [top, tc, bc] = isTop(anchor) ? [anchor, ac, oc] : [other, oc, ac];
  if (n) return `${tc} with ${bc}. Your store has ordered this ${isTop(other) ? 'shirt' : 'trouser'} ${n > 1 ? `${n} times` : 'before'}.`;
  const kinds = ctx.boughtKinds.get(other.kind);
  const why = occ(top) === 'formal' ? 'office look' : occ(top) === 'casual' ? 'weekend look' : 'smart-casual look';
  return kinds ? `${tc} with ${bc}, a classic ${why}. Your store sells ${KIND_NOUN[other.kind] ?? other.kind}.` : `${tc} with ${bc}, a classic ${why}.`;
}

/** The best partners for one piece, from the other half of the wardrobe, one colour each, in stock only. */
export function partnersFor(anchor: LookStyle, color: string, pool: LookStyle[], ctx: LookCtx, limit = 4): LookPick[] {
  const wantBottom = isTop(anchor);
  const out: LookPick[] = [];
  for (const s of pool) {
    if (isTop(s) === wantBottom || s.id === anchor.id) continue;
    let best: LookPick | null = null;
    for (const c of s.colors) {
      if (ctx.stockOf(s.id, c) <= 0) continue;
      let sc = wantBottom ? pairScore(anchor, color, s, c) : pairScore(s, c, anchor, color);
      if (!sc) continue;
      sc += (ctx.bought.get(s.id) ? 0.35 : 0) + Math.min(0.2, (ctx.boughtKinds.get(s.kind) ?? 0) / 400);
      if (!best || sc > best.score) best = { style: s, color: c, score: sc, reason: '' };
    }
    if (best) out.push(best);
  }
  out.sort((a, b) => b.score - a.score || a.style.id.localeCompare(b.style.id));
  // Keep some variety: no more than two of the same trouser or shirt type.
  const seen = new Map<string, number>(); const picked: LookPick[] = [];
  for (const p of out) {
    const k = p.style.kind; if ((seen.get(k) ?? 0) >= 2) continue;
    seen.set(k, (seen.get(k) ?? 0) + 1); picked.push({ ...p, reason: reasonFor(anchor, color, p.style, p.color, ctx) });
    if (picked.length >= limit) break;
  }
  return picked;
}
