// Formatting: English numerals with Indian (lakh) grouping, always, in both languages.
export const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
export const num = (n: number) => Math.round(n).toLocaleString('en-IN');

export function lakh(n: number): string {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2).replace(/\.?0+$/, '')} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1).replace(/\.0$/, '')} L`;
  return inr(n);
}

export const hhmm = (d: Date | string) => new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
export const dmy = (d: Date | string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
export const dstr = (d: Date | string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ', ' + hhmm(d);

/** "34m", "3h 10m", "2d 4h" */
export function age(from: Date | string, now = Date.now()): string {
  const m = Math.max(0, Math.round((now - new Date(from).getTime()) / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
export const minutesSince = (d: Date | string) => (Date.now() - new Date(d).getTime()) / 60000;

export const plural = (n: number, one: string, many = one + 's') => `${num(n)} ${n === 1 ? one : many}`;

export const initials = (s: string) => s.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('');

/** 9847041736 -> "98470 41736" */
export function fmtPhone(p: string) {
  const d = p.replace(/\D/g, '').slice(-10);
  return d.length === 10 ? `${d.slice(0, 5)} ${d.slice(5)}` : p;
}

/** Masked for display everywhere except the user's own profile: "98XXX XX736". */
export function maskPhone(p: string) {
  const d = p.replace(/\D/g, '').slice(-10);
  if (d.length !== 10) return p.replace(/\d(?=\d{3})/g, 'X');
  return `${d.slice(0, 2)}XXX XX${d.slice(7)}`;
}
