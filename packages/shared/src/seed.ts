// Sample master data used by the API seed (as if from the WFX/Ginesys item master) and the stand-in Ginesys.
// Replace with the real CITRUS item and customer masters during discovery.
import type { Category } from './index.js';

export const COLORS: Record<string, string> = {
  White: '#F4F4F1', 'Sky Blue': '#9DBCE3', Navy: '#22305A', Black: '#1C1C1F', Olive: '#6A6D3B', Stone: '#D6CDBB',
  'Light Pink': '#E8C1C5', Maroon: '#6C2432', Khaki: '#C4AA7C', Charcoal: '#3B3E46', Grey: '#8C919A', Indigo: '#2F416B',
  Rust: '#9A4A2B', Bottle: '#244233',
};

export interface SeedStyle {
  id: string; name: string; category: Category; kind: string; fit: string; pattern: string; fabric: string;
  colors: string[]; rate: number; mrp: number; points: number; isNew?: boolean;
}

export const CURATED: SeedStyle[] = [
  { id: 'CS-1101', name: 'Oxford Button-Down', category: 'Shirts', kind: 'shirt', fit: 'Regular', pattern: 'Oxford', fabric: 'Cotton Oxford', colors: ['Sky Blue', 'White', 'Navy'], rate: 640, mrp: 1599, points: 20 },
  { id: 'CS-1102', name: 'Classic Poplin Formal', category: 'Shirts', kind: 'shirt', fit: 'Slim', pattern: 'Solid', fabric: 'Cotton poplin', colors: ['White', 'Black', 'Light Pink'], rate: 610, mrp: 1499, points: 20 },
  { id: 'CS-1103', name: 'Linen-Blend Casual', category: 'Shirts', kind: 'shirt', fit: 'Regular', pattern: 'Solid', fabric: 'Linen-cotton', colors: ['Olive', 'Stone', 'Sky Blue'], rate: 780, mrp: 1899, points: 30 },
  { id: 'CS-1104', name: 'Bengal Stripe Formal', category: 'Shirts', kind: 'shirt', fit: 'Slim', pattern: 'Stripe', fabric: 'Cotton', colors: ['Sky Blue', 'Navy'], rate: 660, mrp: 1699, points: 25 },
  { id: 'CS-1105', name: 'Gingham Check Casual', category: 'Shirts', kind: 'shirt', fit: 'Regular', pattern: 'Check', fabric: 'Yarn-dyed cotton', colors: ['Navy', 'Maroon'], rate: 650, mrp: 1649, points: 25 },
  { id: 'CS-1106', name: 'Mandarin Collar Shirt', category: 'Shirts', kind: 'mandarin', fit: 'Slim', pattern: 'Solid', fabric: 'Cotton satin', colors: ['Black', 'Olive'], rate: 720, mrp: 1799, points: 40, isNew: true },
  { id: 'CT-2101', name: 'Stretch Cotton Chino', category: 'Trousers', kind: 'trouser', fit: 'Slim', pattern: 'Solid', fabric: 'Cotton-elastane twill', colors: ['Khaki', 'Navy', 'Olive'], rate: 820, mrp: 1999, points: 25 },
  { id: 'CT-2102', name: 'Flat-Front Formal Trouser', category: 'Trousers', kind: 'formal', fit: 'Regular', pattern: 'Solid', fabric: 'Poly-viscose', colors: ['Charcoal', 'Black', 'Grey'], rate: 760, mrp: 1899, points: 25 },
  { id: 'CT-2103', name: 'Travel Trouser', category: 'Trousers', kind: 'formal', fit: 'Slim', pattern: 'Solid', fabric: '4-way stretch, wrinkle-free', colors: ['Charcoal', 'Navy'], rate: 880, mrp: 2199, points: 40, isNew: true },
  { id: 'CT-2104', name: 'Straight Indigo Denim', category: 'Trousers', kind: 'denim', fit: 'Straight', pattern: 'Solid', fabric: '12 oz denim', colors: ['Indigo', 'Black'], rate: 840, mrp: 2099, points: 20 },
  { id: 'CK-3101', name: 'Piqué Polo', category: 'T-shirts', kind: 'polo', fit: 'Regular', pattern: 'Solid', fabric: 'Cotton piqué', colors: ['Navy', 'White', 'Maroon'], rate: 420, mrp: 999, points: 15 },
  { id: 'CK-3102', name: 'Crew Neck Tee', category: 'T-shirts', kind: 'tee', fit: 'Regular', pattern: 'Solid', fabric: '180 GSM combed cotton', colors: ['Black', 'White', 'Grey'], rate: 260, mrp: 649, points: 10 },
];

/**
 * Dataset scale. 'full' approximates a ₹100 cr menswear brand: ~3,000 NOS styles (~70k SKUs), 2,800 retailers,
 * ~45 distributors. 'demo' keeps only the curated styles and named stores. Set SEED_SCALE before seeding AND before
 * starting the stand-in Ginesys so both sides agree on the item master.
 */
export const SCALE: 'demo' | 'full' = ((globalThis as any).process?.env?.SEED_SCALE ?? 'full') === 'demo' ? 'demo' : 'full';

const SERIES = ['Heritage', 'Metro', 'Coastline', 'Signature', 'Weekend', 'Boardroom', 'Monsoon', 'Festive', 'Essentials', 'Travel', 'Malabar', 'Urban', 'Classic', 'Riviera', 'Cotton Club'];
const SHIRT = { patterns: ['Solid', 'Stripe', 'Check', 'Oxford', 'Print', 'Dobby', 'Chambray'], fabrics: ['Cotton poplin', 'Cotton twill', 'Linen-cotton', 'Cotton satin', 'Cotton Oxford', 'Dobby cotton', 'Giza cotton', 'Bamboo-cotton'], fits: ['Slim', 'Regular', 'Tailored'] };
const TROUSER = { patterns: ['Solid', 'Solid', 'Solid', 'Check', 'Stripe'], fabrics: ['Cotton-elastane twill', 'Poly-viscose', '4-way stretch', '12 oz denim', 'Cotton drill', 'Wool-blend'], fits: ['Slim', 'Regular', 'Straight', 'Tapered'] };
const TEE = { patterns: ['Solid', 'Solid', 'Stripe', 'Print'], fabrics: ['Cotton piqué', '180 GSM combed cotton', 'Supima cotton', 'Cotton-lycra jersey'], fits: ['Regular', 'Slim'] };
const PALETTE = Object.keys({ White: 1, 'Sky Blue': 1, Navy: 1, Black: 1, Olive: 1, Stone: 1, 'Light Pink': 1, Maroon: 1, Khaki: 1, Charcoal: 1, Grey: 1, Indigo: 1, Rust: 1, Bottle: 1 });

function generated(): SeedStyle[] {
  const out: SeedStyle[] = [];
  const r = rng(20261008);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const plan: [Category, string, number, number][] = [['Shirts', 'CS', 10001, 1640], ['Trousers', 'CT', 20001, 900], ['T-shirts', 'CK', 30001, 448]];
  for (const [category, prefix, start, n] of plan) {
    for (let i = 0; i < n; i++) {
      const spec = category === 'Shirts' ? SHIRT : category === 'Trousers' ? TROUSER : TEE;
      const fabric = pick(spec.fabrics), pattern = pick(spec.patterns), fit = pick(spec.fits);
      const kind = category === 'Shirts' ? (r() < 0.12 ? 'mandarin' : 'shirt') : category === 'T-shirts' ? (r() < 0.55 ? 'polo' : 'tee') : fabric.includes('denim') ? 'denim' : fabric.includes('Poly') || fabric.includes('Wool') ? 'formal' : 'trouser';
      const noun = { shirt: 'Shirt', mandarin: 'Mandarin Shirt', polo: 'Polo', tee: 'Tee', denim: 'Jeans', formal: 'Formal Trouser', trouser: 'Chino' }[kind as 'shirt'];
      const base = category === 'Shirts' ? 450 + Math.floor(r() * 650) : category === 'Trousers' ? 650 + Math.floor(r() * 650) : 220 + Math.floor(r() * 380);
      const rate = Math.round(base / 10) * 10;
      const mrp = Math.ceil((rate * 2.45) / 100) * 100 - 1;
      const cols = new Set<string>(); const nc = 3 + Math.floor(r() * 4);
      while (cols.size < nc) cols.add(pick(PALETTE));
      const isNew = r() < 0.06;
      out.push({ id: `${prefix}-${start + i}`, name: `${pick(SERIES)} ${pattern === 'Solid' ? '' : pattern + ' '}${noun}`, category, kind, fit, pattern, fabric, colors: [...cols], rate, mrp, points: isNew ? 40 : 10 + Math.floor(r() * 4) * 5, isNew });
    }
  }
  return out;
}

export const STYLES: SeedStyle[] = SCALE === 'full' ? [...CURATED, ...generated()] : CURATED;

export const COMING_SOON = [
  { name: 'Corduroy Overshirt', kind: 'shirt', pattern: 'Solid', color: 'Rust', when: 'Autumn/Winter 26 · Forward stock' },
  { name: 'Festive Jacquard Shirt', kind: 'mandarin', pattern: 'Check', color: 'Bottle', when: 'Festive drop · Forward stock' },
  { name: 'Wool-Blend Trouser', kind: 'formal', pattern: 'Solid', color: 'Grey', when: 'Autumn/Winter 26 · Ready stock' },
  { name: 'Heavy Flannel Check', kind: 'shirt', pattern: 'Check', color: 'Maroon', when: 'Autumn/Winter 26 · Forward stock' },
];

const SIZES: Record<Category, string[]> = {
  Shirts: ['S', 'M', 'L', 'XL', 'XXL'], 'T-shirts': ['S', 'M', 'L', 'XL', 'XXL'], Trousers: ['30', '32', '34', '36', '38'],
};

function rng(seed: number) { let a = seed; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function hash(s: string) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

/** Deterministic sellable stock per SKU, the same numbers the approved demo shows. */
export function seedStock(): Record<string, number> {
  const st: Record<string, number> = {};
  for (const s of STYLES) for (const c of s.colors) for (const z of SIZES[s.category]) {
    const r = rng(hash(s.id + c + z))(), r2 = rng(hash(z + c + s.id))();
    st[`${s.id}|${c}|${z}`] = r < 0.08 ? 0 : r < 0.2 ? 1 + Math.floor(r2 * 4) : 6 + Math.floor(r2 * 34);
  }
  Object.assign(st, {
    'CS-1101|Sky Blue|S': 14, 'CS-1101|Sky Blue|M': 46, 'CS-1101|Sky Blue|L': 13, 'CS-1101|Sky Blue|XL': 4, 'CS-1101|Sky Blue|XXL': 0,
    'CS-1103|Stone|XL': 0, 'CS-1103|Stone|XXL': 0, 'CT-2101|Khaki|32': 22, 'CT-2101|Khaki|34': 18, 'CT-2102|Charcoal|34': 26,
  });
  return st;
}
export const sizesFor = (c: Category) => SIZES[c];

const NAMED_DISTRIBUTORS = [
  { id: 'D-KL-01', code: 'MTL', name: 'Malabar Trade Links', city: 'Kozhikode', state: 'Kerala', phone: '9847012345', contact: 'Anwar' },
  { id: 'D-KA-01', code: 'SDB', name: 'Shivaji Distributors', city: 'Bengaluru', state: 'Karnataka', phone: '9845023456', contact: 'Prakash' },
  { id: 'D-TN-01', code: 'KTA', name: 'Kaveri Textile Agencies', city: 'Coimbatore', state: 'Tamil Nadu', phone: '9842034567', contact: 'Senthil' },
  { id: 'D-OD-01', code: 'KLT', name: 'Kalinga Traders', city: 'Bhubaneswar', state: 'Odisha', phone: '9437045678', contact: 'Sasmita' },
];

/** The demo retailer plus a spread of sample stores. Real customer master comes from Ginesys. */
const NAMED_RETAILERS = [
  { code: 'RT-KL-0417', store: 'Sree Balaji Menswear', owner: 'Rajesh', city: 'Kochi', state: 'Kerala', gstin: '32AAXPB4417K1Z3', phone: '9847041736', distributor: 'D-KL-01', invite: 'sbm-kochi-7f3k' },
  { code: 'RT-KL-0388', store: 'Om Sai Collection', owner: 'Suresh', city: 'Thrissur', state: 'Kerala', gstin: '32AAKPS3881L1Z9', phone: '9847038812', distributor: 'D-KL-01', invite: 'osc-thrissur-2m9q' },
  { code: 'RT-KL-0352', store: 'Rajhans Garments', owner: 'Faisal', city: 'Kannur', state: 'Kerala', gstin: '32ABRPF3524M1Z2', phone: '9847035240', distributor: 'D-KL-01', invite: 'rhg-kannur-5t1w' },
  { code: 'RT-KL-0291', store: 'Style Point', owner: 'Nikhil', city: 'Kottayam', state: 'Kerala', gstin: '32AACPN2911K1Z7', phone: '9847029110', distributor: 'D-KL-01', invite: 'stp-kottayam-8h2c' },
  { code: 'RT-KA-0510', store: 'New Look Men’s Wear', owner: 'Manjunath', city: 'Mysuru', state: 'Karnataka', gstin: '29AAJPM5102N1Z4', phone: '9845051020', distributor: 'D-KA-01', invite: 'nlm-mysuru-4p8d' },
  { code: 'RT-TN-0233', store: 'Kumar Fashions', owner: 'Kumar', city: 'Erode', state: 'Tamil Nadu', gstin: '33AAEPK2331P1Z8', phone: '9842023310', distributor: 'D-TN-01', invite: 'kfs-erode-6r3n' },
  { code: 'RT-OD-0141', store: 'Venkatesh Textiles', owner: 'Venkatesh', city: 'Cuttack', state: 'Odisha', gstin: '21AAFPV1412Q1Z1', phone: '9437014120', distributor: 'D-OD-01', invite: 'vkt-cuttack-9x5b' },
];

const GST: Record<string, string> = { KL: '32', KA: '29', TN: '33', OD: '21', AP: '37', TS: '36', MH: '27', GA: '30', PY: '34' };
const GEO: [string, string, number, string[]][] = [
  ['Kerala', 'KL', 30, ['Kochi', 'Thrissur', 'Kozhikode', 'Kannur', 'Kottayam', 'Kollam', 'Palakkad', 'Malappuram', 'Alappuzha', 'Thiruvananthapuram']],
  ['Karnataka', 'KA', 18, ['Bengaluru', 'Mysuru', 'Mangaluru', 'Hubballi', 'Belagavi', 'Davanagere', 'Shivamogga', 'Udupi']],
  ['Tamil Nadu', 'TN', 17, ['Coimbatore', 'Chennai', 'Madurai', 'Erode', 'Tiruppur', 'Salem', 'Tiruchirappalli', 'Tirunelveli']],
  ['Odisha', 'OD', 10, ['Bhubaneswar', 'Cuttack', 'Berhampur', 'Sambalpur', 'Rourkela', 'Balasore']],
  ['Andhra Pradesh', 'AP', 8, ['Visakhapatnam', 'Vijayawada', 'Guntur', 'Nellore', 'Tirupati']],
  ['Telangana', 'TS', 8, ['Hyderabad', 'Warangal', 'Karimnagar', 'Nizamabad']],
  ['Maharashtra', 'MH', 5, ['Pune', 'Kolhapur', 'Solapur', 'Nashik']],
  ['Goa', 'GA', 2, ['Panaji', 'Margao']],
  ['Puducherry', 'PY', 2, ['Puducherry']],
];
const STORE_A = ['Sree', 'New', 'Royal', 'Classic', 'Modern', 'Prince', 'Kings', 'Lakshmi', 'Ganesh', 'Balaji', 'Om Sai', 'Style', 'Trendz', 'Raja', 'Galaxy', 'Metro', 'City', 'Jyothi', 'Anand', 'Vijaya', 'Sai Ram', 'Popular', 'Bharath', 'Elite'];
const STORE_B = ['Menswear', 'Collection', 'Garments', 'Fashions', 'Textiles', 'Men’s Wear', 'Dresses', 'Readymades', 'Gents Corner', 'Clothing Co'];
const OWNERS = ['Rajesh', 'Suresh', 'Faisal', 'Nikhil', 'Manjunath', 'Kumar', 'Venkatesh', 'Anwar', 'Joseph', 'Thomas', 'Ravi', 'Prakash', 'Shibu', 'Biju', 'Ashraf', 'Ramesh', 'Srinivas', 'Ganesh', 'Arun', 'Mahesh', 'Sanjay', 'Deepak', 'Saji', 'Vinod'];

function generatedPartners() {
  const r = rng(7781);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const dists = [...NAMED_DISTRIBUTORS];
  const rets = [...NAMED_RETAILERS];
  let dn = 0;
  const total = 2800 - NAMED_RETAILERS.length;
  for (const [state, code, pct, cities] of GEO) {
    const n = Math.round((total * pct) / 100);
    const nd = Math.max(1, Math.round(n / 65));
    const mine = dists.filter(d => d.state === state).map(d => d.id);
    for (let i = mine.length; i < nd; i++) {
      const id = `D-${code}-${String(i + 1).padStart(2, '0')}`;
      const city = cities[i % cities.length];
      dists.push({ id, code: `${code}D${i + 1}`, name: `${pick(['Sri', 'Vel', 'Coastal', 'Southern', 'United', 'Prime', 'Global', 'Lotus'])} ${pick(['Agencies', 'Distributors', 'Trade Links', 'Marketing', 'Enterprises'])} ${city}`, city, state, phone: `8${String(100000000 + ++dn * 7919).slice(-9)}`, contact: pick(OWNERS) });
      mine.push(id);
    }
    for (let i = 0; i < n && rets.length < 2800; i++) {
      const idx = rets.length;
      const city = pick(cities);
      rets.push({
        code: `RT-${code}-${String(1000 + idx).padStart(4, '0')}`, store: `${pick(STORE_A)} ${pick(STORE_B)}`, owner: pick(OWNERS), city, state,
        gstin: `${GST[code]}AA${String.fromCharCode(65 + (idx % 26))}PX${String(idx).padStart(4, '0')}K1Z${idx % 10}`,
        phone: `7${String(200000000 + idx).slice(-9)}`, distributor: mine[idx % mine.length], invite: `inv-${code.toLowerCase()}-${(idx * 2654435761 >>> 0).toString(36)}`,
      });
    }
  }
  return { dists, rets };
}
const PARTNERS = SCALE === 'full' ? generatedPartners() : { dists: NAMED_DISTRIBUTORS, rets: NAMED_RETAILERS };
export const DISTRIBUTORS = PARTNERS.dists;
export const RETAILERS = PARTNERS.rets;

export const ADMINS = [{ phone: '9845000001', name: 'Hitesh Jain' }, { phone: '9845000002', name: 'CITRUS Ops' }];

/** Past orders for the demo retailer (styleId, colour, multiplier of the 1:3:3:2:1 ratio ×2), oldest last. */
export const PAST_ORDERS = [
  { number: 'CT-10441', daysAgo: 20, lines: [['CS-1101', 'Sky Blue', 2], ['CT-2101', 'Khaki', 2], ['CT-2102', 'Charcoal', 1], ['CS-1103', 'Stone', 1]] as [string, string, number][] },
  { number: 'CT-10398', daysAgo: 41, lines: [['CS-1102', 'White', 2], ['CK-3101', 'Navy', 1], ['CT-2104', 'Indigo', 1]] as [string, string, number][] },
  { number: 'CT-10352', daysAgo: 64, lines: [['CS-1104', 'Sky Blue', 1], ['CT-2102', 'Black', 1], ['CK-3102', 'Black', 2]] as [string, string, number][] },
];

export const RECOMMENDATIONS = [
  { styleId: 'CS-1104', color: 'Sky Blue', reason: 'Stores that reorder your Oxford Sky Blue also stock this' },
  { styleId: 'CT-2102', color: 'Black', reason: 'You buy formal shirts every 5 weeks; no black formals in 60 days' },
  { styleId: 'CK-3101', color: 'Navy', reason: 'Your best-selling T-shirt colour, 3 orders in a row' },
  { styleId: 'CT-2103', color: 'Charcoal', reason: 'New. Sells with Oxford shirts in Kerala stores' },
  { styleId: 'CS-1105', color: 'Navy', reason: 'Casual checks are up 18% in your region this month' },
];

export function pairsFor(styleId: string, color: string): [string, string][] {
  const s = STYLES.find(x => x.id === styleId)!;
  const bottom = ['trouser', 'formal', 'denim'].includes(s.kind);
  if (bottom) return ([['CS-1101', 'Sky Blue'], ['CS-1104', 'Navy'], ['CS-1103', 'Stone'], ['CK-3101', 'White']] as [string, string][]).filter(p => p[0] !== styleId);
  const dark = ['Navy', 'Black', 'Charcoal', 'Maroon', 'Olive', 'Indigo'].includes(color);
  return [['CT-2101', dark ? 'Khaki' : 'Navy'], ['CT-2102', color === 'Black' ? 'Grey' : 'Charcoal'], ['CT-2103', dark ? 'Charcoal' : 'Navy'], ['CT-2104', 'Indigo']];
}
