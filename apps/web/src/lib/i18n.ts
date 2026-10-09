// English + Hindi for the main labels. Numerals stay English in both (trade convention).
import { useSyncExternalStore } from 'react';

const EN = {
  home: 'Home', catalogue: 'Catalogue', cart: 'Cart', orders: 'Orders', rewards: 'Rewards',
  approvals: 'Approvals', history: 'History', overview: 'Overview', exceptions: 'Exceptions', lowStock: 'Low stock', distributors: 'Distributors', retailers: 'Retailers',
  search: 'Search styles, colours or codes', voice: 'Voice search',
  buyAgain: 'Buy again', buyAgainSub: 'Your last orders, checked against live stock',
  yourUsual: 'Your usual', reorder: 'Reorder', reorderLast: 'Reorder last order', browse: 'Browse',
  recommended: 'Recommended for your store', recSub: 'Based on what you buy and what sells near you',
  newp: 'New styles, more points', newSub: 'Priority products from CITRUS',
  look: 'Complete the look', lookSub: 'Want the trouser that goes with it?',
  progress: 'Your reward progress', away: '{n} points away from {r}', seeAll: 'See all', seeRewards: 'See rewards',
  add: 'Add to cart', avail: 'available', only: 'Only {n} left', out: 'Out of stock',
  place: 'Place order', hello: 'Namaste', track: 'Track order', pts: 'points',
  total: 'Total pieces', split: 'Split by my ratio', sameAsLast: 'Same as last time', clear: 'Clear',
  lastOrder: 'Last order {n}', pcs: 'pcs', viewCart: 'View cart', savedAuto: 'saved automatically',
  callRep: 'Call {n}', callRepShort: 'Call rep', whatsapp: 'WhatsApp us', yourRep: 'your CITRUS rep',
  filters: 'Filters', sort: 'Sort', availableNow: 'Available now', comingSoon: 'Coming soon',
  signIn: 'Sign in', signOut: 'Sign out', mobile: 'Mobile number', sendCode: 'Send code', verify: 'Verify and continue',
  resend: 'Resend code', codeOnCall: 'Get the code on a call', language: 'हिंदी',
  orderSummary: 'Order summary', note: 'Note for {n} (optional)', po: 'Your PO number (optional)',
  shareCart: 'Share cart on WhatsApp', emptyCart: 'Your cart is empty.',
  accept: 'Accept changes', cancelOrder: 'Cancel order', whatNext: 'What happens next',
  approve: 'Approve', modify: 'Modify', reject: 'Reject', waiting: 'Waiting {n}',
  account: 'Account', appearance: 'Appearance', theme: 'Theme',
};
type Key = keyof typeof EN;

const HI: Partial<Record<Key, string>> = {
  home: 'होम', catalogue: 'कैटलॉग', cart: 'कार्ट', orders: 'ऑर्डर', rewards: 'रिवॉर्ड्स',
  approvals: 'मंज़ूरी', history: 'इतिहास', overview: 'सारांश', exceptions: 'समस्याएँ', lowStock: 'कम स्टॉक', distributors: 'डिस्ट्रीब्यूटर', retailers: 'रिटेलर',
  search: 'स्टाइल, रंग या कोड खोजें', voice: 'बोलकर खोजें',
  buyAgain: 'फिर से ऑर्डर करें', buyAgainSub: 'आपके पिछले ऑर्डर, आज के स्टॉक के साथ',
  yourUsual: 'आपका रोज़ का ऑर्डर', reorder: 'दोबारा ऑर्डर करें', reorderLast: 'पिछला ऑर्डर दोहराएँ', browse: 'देखें',
  recommended: 'आपके स्टोर के लिए', recSub: 'आपकी खरीद और आपके इलाके की बिक्री के आधार पर',
  newp: 'नए स्टाइल, ज़्यादा पॉइंट्स', newSub: 'CITRUS के खास प्रोडक्ट',
  look: 'पूरा लुक', lookSub: 'इसके साथ जाने वाली ट्राउज़र चाहिए?',
  progress: 'आपकी रिवॉर्ड प्रगति', away: '{r} से {n} पॉइंट्स दूर', seeAll: 'सभी देखें', seeRewards: 'रिवॉर्ड्स देखें',
  add: 'कार्ट में डालें', avail: 'उपलब्ध', only: 'सिर्फ़ {n} बचे', out: 'स्टॉक नहीं',
  place: 'ऑर्डर करें', hello: 'नमस्ते', track: 'ऑर्डर ट्रैक करें', pts: 'पॉइंट्स',
  total: 'कुल पीस', split: 'मेरे अनुपात में बाँटें', sameAsLast: 'पिछली बार जैसा', clear: 'साफ़ करें',
  lastOrder: 'पिछला ऑर्डर {n}', pcs: 'पीस', viewCart: 'कार्ट देखें', savedAuto: 'अपने-आप सेव',
  callRep: '{n} को कॉल करें', callRepShort: 'रेप को कॉल', whatsapp: 'WhatsApp करें', yourRep: 'आपके CITRUS रेप',
  filters: 'फ़िल्टर', sort: 'क्रम', availableNow: 'अभी उपलब्ध', comingSoon: 'जल्द आ रहा है',
  signIn: 'साइन इन', signOut: 'साइन आउट', mobile: 'मोबाइल नंबर', sendCode: 'कोड भेजें', verify: 'पुष्टि करें और आगे बढ़ें',
  resend: 'कोड दोबारा भेजें', codeOnCall: 'कॉल पर कोड पाएँ', language: 'English',
  orderSummary: 'ऑर्डर सारांश', note: '{n} के लिए नोट (वैकल्पिक)', po: 'आपका PO नंबर (वैकल्पिक)',
  shareCart: 'WhatsApp पर कार्ट भेजें', emptyCart: 'आपका कार्ट खाली है।',
  accept: 'बदलाव मंज़ूर करें', cancelOrder: 'ऑर्डर रद्द करें', whatNext: 'आगे क्या होगा',
  approve: 'मंज़ूर', modify: 'बदलें', reject: 'अस्वीकार', waiting: '{n} से इंतज़ार',
  account: 'खाता', appearance: 'दिखावट', theme: 'थीम',
};

export type Lang = 'en' | 'hi';
let lang: Lang = (() => { try { return localStorage.getItem('ct.lang') === 'hi' ? 'hi' : 'en'; } catch { return 'en'; } })();
const subs = new Set<() => void>();
function apply() { document.documentElement.lang = lang === 'hi' ? 'hi' : 'en'; }
apply();

export function setLang(l: Lang) {
  lang = l; apply();
  try { localStorage.setItem('ct.lang', l); } catch { /* private mode */ }
  subs.forEach(f => f());
}
export const getLang = () => lang;

export function t(key: Key, vars: Record<string, string | number> = {}): string {
  const s = (lang === 'hi' ? HI[key] : undefined) ?? EN[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}

/** Re-render on language change; returns t and current lang. */
export function useT() {
  const l = useSyncExternalStore(f => { subs.add(f); return () => { subs.delete(f); }; }, () => lang);
  return { t, lang: l, toggle: () => setLang(l === 'en' ? 'hi' : 'en') };
}
