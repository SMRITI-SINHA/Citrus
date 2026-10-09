// Product imagery. Real CITRUS photography only: no drawn garments.
// Order of preference for a style + colour:
//   1. a product photo listed in /photos/manifest.json ("STYLE|Colour" or "STYLE" -> URL), filled from WFX/Ginesys item images or a CITRUS shoot;
//   2. the CITRUS collection photo for the style's line (the same ten collections as citrusclothing.in/all-collections.html).
// VITE_PHOTO_BASE points the collection photos at a self-hosted copy; by default they load from citrusclothing.in.
// A collection photo may show a different colour from the one selected, so a swatch of the selected colour sits on it.
import { useState, useSyncExternalStore } from 'react';

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
const BASE = ((import.meta.env.VITE_PHOTO_BASE as string | undefined) ?? 'https://citrusclothing.in/img/categories/').replace(/\/?$/, '/');
export const LINES = {
  casual: { label: 'Casual Shirts', file: 'CASUAL SHIRT.webp' },
  formalShirt: { label: 'Formal Shirts', file: 'FORMAL SHIRTS.webp' },
  knit: { label: 'Knitwear', file: 'KNITWEAR.webp' },
  cotton: { label: 'Cotton Trousers', file: 'COTTON TROUSERS.webp' },
  lycra: { label: 'Four-way Lycra Trousers', file: 'FOUR-WAY LYCRA TROUSERS.webp' },
  travel: { label: 'Travel Pants', file: 'TRAVEL PANTS.webp' },
  denim: { label: 'Denim', file: 'DENIM.webp' },
  cargo: { label: 'Cargo', file: 'CARGO.webp' },
  shorts: { label: 'Shorts', file: 'SHORTS.webp' },
  formalPant: { label: 'Formal Pants', file: 'FORMAL PANTS.webp' },
} as const;
export type Line = keyof typeof LINES;

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
export const linePhoto = (l: Line) => BASE + encodeURIComponent(LINES[l].file);

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
  return own ? { src: own, exact: !!manifest[`${spec.styleId}|${spec.color ?? ''}`], line } : { src: linePhoto(line), exact: false, line };
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
        <span className="ph-sw" title={`Shown in a CITRUS ${LINES[p.line].label.toLowerCase()} photo; you are ordering ${spec.color}`}>
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

/** Large brand imagery for hero panels: two CITRUS collection photos. */
export function BrandArt({ lines = ['casual', 'cotton'] as Line[] }: { lines?: Line[] }) {
  return (
    <span className="ph-art">
      {lines.map(l => <span key={l} className="frame"><Img src={linePhoto(l)} alt="" line={l} /></span>)}
    </span>
  );
}
