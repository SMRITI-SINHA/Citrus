// Shelves a store restocks by: the way a menswear owner thinks about the wall, not the ERP category tree.
// Formal vs casual shirts is inferred from fabric, pattern and name until CITRUS tags it in the item master.
export interface ShelfStyle { name: string; category: string; kind: string; pattern: string; fabric: string }
export interface Shelf { key: string; label: string; category: 'Shirts' | 'Trousers' | 'T-shirts'; test: (s: ShelfStyle) => boolean }

const formalShirt = (s: ShelfStyle) => /formal/i.test(s.name) || /poplin|satin|giza|twill|dobby/i.test(s.fabric) || ['Stripe', 'Dobby'].includes(s.pattern);
const shirt = (s: ShelfStyle) => s.kind === 'shirt' || s.kind === 'mandarin';

export const SHELVES: Shelf[] = [
  { key: 'formal-shirts', label: 'Formal shirts', category: 'Shirts', test: s => shirt(s) && formalShirt(s) },
  { key: 'casual-shirts', label: 'Casual shirts', category: 'Shirts', test: s => shirt(s) && !formalShirt(s) },
  { key: 'chinos', label: 'Chinos', category: 'Trousers', test: s => s.kind === 'trouser' },
  { key: 'formal-trousers', label: 'Formal trousers', category: 'Trousers', test: s => s.kind === 'formal' },
  { key: 'polos', label: 'Polos', category: 'T-shirts', test: s => s.kind === 'polo' },
  { key: 'tees', label: 'Tees', category: 'T-shirts', test: s => s.kind === 'tee' },
];
export const shelfOf = (key: string | null | undefined) => SHELVES.find(x => x.key === key);
