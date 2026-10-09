// Product imagery. Real CITRUS photography only: no drawn garments.
// Order of preference for a style + colour:
//   1. a product photo listed in /photos/manifest.json ("STYLE|Colour" or "STYLE" -> URL), filled from WFX/Ginesys item images or a CITRUS shoot;
//   2. the closest garment shot from the CITRUS photo library (lib/photos.ts): same garment type, nearest colour, varied per style.
// When the library shot is a different colour from the one being ordered, a swatch of the ordered colour sits on it.
import { useState, useSyncExternalStore } from 'react';
import { BRAND, LOOKS, SHOTS, type GarmentType, type PhotoShot } from '../lib/photos';

export interface GarmentSpec { kind: string; pattern: string; fit: string; hex: string; name?: string; color?: string; fabric?: string; styleId?: string }

const HEX = /^#[0-9a-f]{6}$/i;
const safeHex = (h: string | undefined) => {
  if (!h) return '#8C919A';
  if (/^#[0-9a-f]{3}$/i.test(h)) return '#' + h.slice(1).split('').map(c => c + c).join('');
  return HEX.test(h) ? h : '#8C919A';
};
function lum(hex: string) { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; }

export const isBottom = (kind: string) => kind === 'trouser' || kind === 'formal' || kind === 'denim' || kind === 'chino' || kind === 'cargo' || kind === 'shorts';
export const isDark = (hex: string) => lum(safeHex(hex)) < 0.35;

// ---------- CITRUS collections ----------
// Self-hosted copies of the ten collection photos on citrusclothing.in/all-collections.html (public/photos/look).
const BASE = ((import.meta.env.VITE_PHOTO_BASE as string | undefined) ?? '/photos/').replace(/\/?$/, '/');
export const LINES = {
  casual: { label: 'Casual Shirts', file: 'look/casual-shirt.webp' },
  formalShirt: { label: 'Formal Shirts', file: 'look/formal-shirts.webp' },
  knit: { label: 'Knitwear', file: 'look/knitwear.webp' },
  cotton: { label: 'Cotton Trousers', file: 'look/cotton-trousers.webp' },
  lycra: { label: 'Four-way Lycra Trousers', file: 'look/four-way-lycra-trousers.webp' },
  travel: { label: 'Travel Pants', file: 'look/travel-pants.webp' },
  denim: { label: 'Denim', file: 'look/denim.webp' },
  cargo: { label: 'Cargo', file: 'look/cargo.webp' },
  shorts: { label: 'Shorts', file: 'look/shorts.webp' },
  formalPant: { label: 'Formal Pants', file: 'look/formal-pants.webp' },
} as const;
export type Line = keyof typeof LINES;
export { LOOKS };
export const brandPhoto = (id: keyof typeof BRAND | string) => BASE + (BRAND[id]?.src ?? 'brand/store-front.webp');

/** Which CITRUS collection a style belongs to, from the item fields we have (kind, name, fabric, pattern). */
export function lineOf(s: Pick<GarmentSpec, 'kind' | 'name' | 'fabric' | 'pattern'>): Line {
  const k = (s.kind || 'shirt').toLowerCase(), t = `${s.name ?? ''} ${s.fabric ?? ''}`.toLowerCase();
  if (k === 'polo' || k === 'tee') return 'knit';
  if (k === 'denim') return 'denim';
  if (k === 'cargo') return 'cargo';
  if (k === 'shorts') return 'shorts';
  if (isBottom(k)) {
    if (t.includes('travel')) return 'travel';
    if (/4-way|four-way|lycra|stretch|elastane/.test(t)) return k === 'formal' ? 'lycra' : 'cotton';
    return k === 'formal' ? 'formalPant' : 'cotton';
  }
  if (/formal|poplin|twill|satin/.test(t) || /stripe/i.test(s.pattern ?? '')) return 'formalShirt';
  return 'casual';
}
export const linePhoto = (l: Line) => BASE + LINES[l].file;

// ---------- library shot for a style + colour ----------
function rgb(hex: string) { const n = parseInt(safeHex(hex).slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
function lab(hex: string) {
  const f = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = rgb(hex).map(f);
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047, y = r * 0.2126 + g * 0.7152 + b * 0.0722, z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const t = (v: number) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  return [116 * t(y) - 16, 500 * (t(x) - t(y)), 200 * (t(y) - t(z))];
}
const dist = (a: string, b: string) => { const p = lab(a), q = lab(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
function hash(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }

/** Garment types that can stand in for an item, best first. */
function typesFor(kind: string, pattern: string): GarmentType[] {
  const k = (kind || 'shirt').toLowerCase(), p = (pattern || '').toLowerCase();
  if (k === 'polo') return ['polo', 'tee'];
  if (k === 'tee') return ['tee', 'polo'];
  if (k === 'denim') return ['denim', 'trouser'];
  if (k === 'shorts') return ['shorts'];
  if (k === 'formal') return ['formal', 'trouser'];
  if (isBottom(k)) return ['trouser', 'formal'];
  if (p.includes('print')) return ['print', 'shirt'];
  if (p.includes('check')) return ['check', 'shirt', 'print'];
  return ['shirt', 'print', 'check'];
}
const picked = new Map<string, { shot: PhotoShot; close: boolean }>();
/** Nearest-colour CITRUS shot of the same garment type. Styles with the same colour get different shots where the library allows. */
export function shotFor(spec: Pick<GarmentSpec, 'kind' | 'pattern' | 'hex' | 'styleId' | 'name' | 'color'>) {
  const key = `${spec.kind}|${spec.pattern}|${spec.hex}|${spec.styleId ?? spec.name ?? ''}`;
  const hit = picked.get(key); if (hit) return hit;
  const types = typesFor(spec.kind, spec.pattern);
  const scored = SHOTS.filter(s => types.includes(s.garment))
    .map(s => ({ s, d: dist(spec.hex, s.hex) + types.indexOf(s.garment) * 22 }))
    .sort((a, b) => a.d - b.d);
  const best = scored[0];
  const near = scored.filter(x => x.d <= best.d + 10);
  const choice = near[hash(spec.styleId ?? spec.name ?? '') % near.length];
  const out = { shot: choice.s, close: dist(spec.hex, choice.s.hex) < 16 };
  picked.set(key, out);
  return out;
}

// ---------- optional per-product photos ----------
let manifest: Record<string, string> = {};
let ver = 0;
const subs = new Set<() => void>();
if (typeof window !== 'undefined') {
  fetch('/photos/manifest.json', { cache: 'no-cache' })
    .then(r => (r.ok && (r.headers.get('content-type') ?? '').includes('json') ? r.json() : {}))
    .then((m: Record<string, string>) => { if (m && typeof m === 'object' && Object.keys(m).length) { manifest = m; ver++; subs.forEach(f => f()); } })
    .catch(() => { /* no product photos yet: collection photos only */ });
}
const useManifest = () => useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f); }, () => ver);

export function photoFor(spec: GarmentSpec): { src: string; exact: boolean; line: Line } {
  const line = lineOf(spec);
  const own = spec.styleId && (manifest[`${spec.styleId}|${spec.color ?? ''}`] ?? manifest[spec.styleId]);
  if (own) return { src: own, exact: !!manifest[`${spec.styleId}|${spec.color ?? ''}`], line };
  const { shot, close } = shotFor({ ...spec, hex: safeHex(spec.hex) });
  return { src: BASE + shot.src, exact: close, line };
}

function Img({ src, alt, line, pos }: { src: string; alt: string; line: Line; pos?: string }) {
  const [bad, setBad] = useState<string | null>(null);
  if (bad === src) return <span className="ph-fb"><span className="ph-brand">CITRUS</span><span className="ph-line">{LINES[line].label}</span></span>;
  return <img src={src} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" draggable={false} style={pos ? { objectPosition: pos } : undefined} onError={() => setBad(src)} />;
}

/** One product photo, filling its frame. Shows a swatch of the selected colour unless the photo is of that exact colour. */
export function Garment({ spec, label, swatch = true }: { spec: GarmentSpec; label?: string; swatch?: boolean }) {
  useManifest();
  const p = photoFor(spec);
  const alt = label ?? [spec.name, spec.color].filter(Boolean).join(', ');
  return (
    <span className="ph" data-line={p.line}>
      <Img src={p.src} alt={alt || LINES[p.line].label} line={p.line} />
      {swatch && spec.color && !p.exact && (
        <span className="ph-sw" title={`Photo shows a similar CITRUS piece; you are ordering ${spec.color}`}>
          <i style={{ background: safeHex(spec.hex) }} /><span>{spec.color}</span>
        </span>
      )}
    </span>
  );
}

/** A look: the shirt and the trouser side by side. */
export function Outfit({ top, bottom, label }: { top: GarmentSpec; bottom: GarmentSpec; label?: string }) {
  useManifest();
  const a = photoFor(top), b = photoFor(bottom);
  return (
    <span className="ph outfit" role="img" aria-label={label ?? `${top.name ?? 'Shirt'}${top.color ? `, ${top.color}` : ''} with ${bottom.name ?? 'trouser'}${bottom.color ? `, ${bottom.color}` : ''}`}>
      <span className="half"><Img src={a.src} alt="" line={a.line} />{top.color && !a.exact && <span className="ph-sw dot"><i style={{ background: safeHex(top.hex) }} /></span>}</span>
      <span className="half"><Img src={b.src} alt="" line={b.line} />{bottom.color && !b.exact && <span className="ph-sw dot"><i style={{ background: safeHex(bottom.hex) }} /></span>}</span>
    </span>
  );
}

/** Large brand imagery for hero panels: CITRUS store and campaign photos, or collection photos. */
export function BrandArt({ lines = ['casual', 'cotton'] as Line[], brand }: { lines?: Line[]; brand?: string[] }) {
  const srcs = brand ? brand.map(brandPhoto) : lines.map(linePhoto);
  return (
    <span className="ph-art">
      {srcs.map((src, i) => <span key={src} className="frame"><Img src={src} alt="" line={lines[i] ?? 'casual'} /></span>)}
    </span>
  );
}
