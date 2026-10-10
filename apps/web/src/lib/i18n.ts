// English + Hindi for the main labels. Numerals stay English in both (trade convention).
import { useSyncExternalStore } from 'react';

const EN = {
  home: 'Home', catalogue: 'Catalogue', cart: 'Cart', orders: 'Orders', rewards: 'Rewards',
  approvals: 'Approvals', history: 'History', overview: 'Overview', exceptions: 'Exceptions', lowStock: 'Low stock', distributors: 'Distributors', retailers: 'Retailers',
  search: 'Search styles, colours or codes', voice: 'Voice search',
  buyAgain: 'Buy again', buyAgainSub: 'Your recent orders, one tap to reorder',
  yourUsual: 'Your usual', reorder: 'Reorder', reorderLast: 'Reorder last order', browse: 'Browse',
  recommended: 'Recommended for your store', recSub: 'Picked for your store this week',
  newp: 'New styles, more points', newSub: 'Priority products from CITRUS',
  look: 'Complete the look', lookSub: 'Want the trouser that goes with it?',
  progress: 'Your reward progress', away: '{n} points away from {r}', seeAll: 'See all', seeRewards: 'See rewards',
  add: 'Add to cart', avail: 'available', only: 'Only {n} left', out: 'Out of stock',
  place: 'Place order', hello: 'Namaste', track: 'Track order', pts: 'points',
  total: 'Total pieces', split: 'Split by my ratio', sameAsLast: 'Same as last time', clear: 'Clear',
  lastOrder: 'Last order {n}', pcs: 'pcs', viewCart: 'View cart', proceedCart: 'Proceed to cart', savedAuto: 'saved automatically',
  callRep: 'Call {n}', callRepShort: 'Call rep', whatsapp: 'WhatsApp us', yourRep: 'your CITRUS rep',
  filters: 'Filters', sort: 'Sort', availableNow: 'Available now', comingSoon: 'Coming soon',
  signIn: 'Sign in', signOut: 'Sign out', mobile: 'Mobile number', sendCode: 'Send code', verify: 'Verify and continue',
  resend: 'Resend code', codeOnCall: 'Get the code on a call', language: 'हिंदी',
  orderSummary: 'Order summary', note: 'Note for {n} (optional)', po: 'Your PO number (optional)',
  shareCart: 'Share cart on WhatsApp', emptyCart: 'Your cart is empty.',
  accept: 'Accept changes', cancelOrder: 'Cancel order', whatNext: 'What happens next',
  approve: 'Approve', modify: 'Modify', reject: 'Reject', waiting: 'Waiting {n}',
  account: 'Account', appearance: 'Appearance', theme: 'Theme',
  signInSub: 'Retailers, distributors and the CITRUS team sign in with their registered mobile number.', firstTime: 'First time? Open the link or QR code your CITRUS rep sent you.', smsHint: "We'll send a one-time code by SMS. No password needed.",
  heroA: 'Pause. Breathe.', heroB: 'Restock.', restockLast: 'Restock from last order', winEvery: 'Win with every order', shelfT: 'Shop by shelf', shelfS: 'Tap a shelf to see every style in stock', bestT: 'Restock your best-sellers', bestS: 'Styles you order most, with your usual sizes', restockLastShort: 'Restock last order', pairT: 'Goes with what you stock', pairS: 'New to your store, picked to pair with styles you order often', howMany: 'How many pieces?', howManySub: 'Tap a box and type the number for each size.', howManyTotal: 'How many pieces in total?', emptyCartSub: 'Reorder your usual from Home, or browse the catalogue.', cartHint: 'Type any quantity right here. 0 removes a size. Changes save automatically.', cartHint2: 'Type any quantity in any size. Tap × on a size, or type 0, to delete it.', orderAgain: 'Order again', onWay: 'On the way', onWaySub: 'Not delivered yet', rwT: 'Rewards this month', rwS: 'Order CITRUS styles, collect points, claim the prize', earnT: 'Earn faster', earnS: 'Styles with the most points per piece, in stock now',
};
type Key = keyof typeof EN;

const HI: Partial<Record<Key, string>> = {
  home: 'होम', catalogue: 'कैटलॉग', cart: 'कार्ट', orders: 'ऑर्डर', rewards: 'रिवॉर्ड्स',
  approvals: 'मंज़ूरी', history: 'इतिहास', overview: 'सारांश', exceptions: 'समस्याएँ', lowStock: 'कम स्टॉक', distributors: 'डिस्ट्रीब्यूटर', retailers: 'रिटेलर',
  search: 'स्टाइल, रंग या कोड खोजें', voice: 'बोलकर खोजें',
  buyAgain: 'फिर से ऑर्डर करें', buyAgainSub: 'आपके हाल के ऑर्डर, एक टैप में दोबारा',
  yourUsual: 'आपका रोज़ का ऑर्डर', reorder: 'दोबारा ऑर्डर करें', reorderLast: 'पिछला ऑर्डर दोहराएँ', browse: 'देखें',
  recommended: 'आपके स्टोर के लिए', recSub: 'इस हफ़्ते आपके स्टोर के लिए चुने गए',
  newp: 'नए स्टाइल, ज़्यादा पॉइंट्स', newSub: 'CITRUS के खास प्रोडक्ट',
  look: 'पूरा लुक', lookSub: 'इसके साथ जाने वाली ट्राउज़र चाहिए?',
  progress: 'आपकी रिवॉर्ड प्रगति', away: '{r} से {n} पॉइंट्स दूर', seeAll: 'सभी देखें', seeRewards: 'रिवॉर्ड्स देखें',
  add: 'कार्ट में डालें', avail: 'उपलब्ध', only: 'सिर्फ़ {n} बचे', out: 'स्टॉक नहीं',
  place: 'ऑर्डर करें', hello: 'नमस्ते', track: 'ऑर्डर ट्रैक करें', pts: 'पॉइंट्स',
  total: 'कुल पीस', split: 'मेरे अनुपात में बाँटें', sameAsLast: 'पिछली बार जैसा', clear: 'साफ़ करें',
  lastOrder: 'पिछला ऑर्डर {n}', pcs: 'पीस', viewCart: 'कार्ट देखें', proceedCart: 'कार्ट पर जाएँ', savedAuto: 'अपने-आप सेव',
  callRep: '{n} को कॉल करें', callRepShort: 'रेप को कॉल', whatsapp: 'WhatsApp करें', yourRep: 'आपके CITRUS रेप',
  filters: 'फ़िल्टर', sort: 'क्रम', availableNow: 'अभी उपलब्ध', comingSoon: 'जल्द आ रहा है',
  signIn: 'साइन इन', signOut: 'साइन आउट', mobile: 'मोबाइल नंबर', sendCode: 'कोड भेजें', verify: 'पुष्टि करें और आगे बढ़ें',
  resend: 'कोड दोबारा भेजें', codeOnCall: 'कॉल पर कोड पाएँ', language: 'English',
  orderSummary: 'ऑर्डर सारांश', note: '{n} के लिए नोट (वैकल्पिक)', po: 'आपका PO नंबर (वैकल्पिक)',
  shareCart: 'WhatsApp पर कार्ट भेजें', emptyCart: 'आपका कार्ट खाली है।',
  accept: 'बदलाव मंज़ूर करें', cancelOrder: 'ऑर्डर रद्द करें', whatNext: 'आगे क्या होगा',
  approve: 'मंज़ूर', modify: 'बदलें', reject: 'अस्वीकार', waiting: '{n} से इंतज़ार',
  account: 'खाता', appearance: 'दिखावट', theme: 'थीम',
  signInSub: 'रिटेलर, डिस्ट्रीब्यूटर और CITRUS टीम अपने रजिस्टर्ड मोबाइल नंबर से साइन इन करें।', firstTime: 'पहली बार? CITRUS रेप का भेजा लिंक या QR कोड खोलें।', smsHint: 'हम SMS पर एक बार का कोड भेजेंगे। पासवर्ड की ज़रूरत नहीं।',
  heroA: 'रुकिए। साँस लीजिए।', heroB: 'फिर से स्टॉक करें।', restockLast: 'पिछले ऑर्डर से स्टॉक भरें', winEvery: 'हर ऑर्डर पर इनाम', shelfT: 'शेल्फ़ से चुनें', shelfS: 'शेल्फ़ पर टैप करें, स्टॉक के सारे स्टाइल देखें', bestT: 'आपके सबसे ज़्यादा बिकने वाले स्टाइल', bestS: 'जो स्टाइल आप सबसे ज़्यादा मँगाते हैं, आपके रोज़ के साइज़ के साथ', restockLastShort: 'पिछला ऑर्डर दोहराएँ', pairT: 'आपके स्टॉक के साथ जँचेगा', pairS: 'आपके स्टोर के लिए नया, आपके रोज़ के स्टाइल से मेल खाता', howMany: 'कितने पीस चाहिए?', howManySub: 'डिब्बे पर टैप करें और हर साइज़ की गिनती लिखें।', howManyTotal: 'कुल कितने पीस?', emptyCartSub: 'होम से अपना रोज़ का ऑर्डर दोहराएँ, या कैटलॉग देखें।', cartHint: 'यहीं कोई भी गिनती लिखें। 0 लिखने से साइज़ हट जाएगा। बदलाव अपने-आप सेव होते हैं।', cartHint2: 'किसी भी साइज़ में गिनती लिखें। हटाने के लिए × दबाएँ या 0 लिखें।', orderAgain: 'फिर से ऑर्डर करें', onWay: 'रास्ते में', onWaySub: 'अभी डिलीवर नहीं हुआ', rwT: 'इस महीने के रिवॉर्ड्स', rwS: 'CITRUS स्टाइल मँगाएँ, पॉइंट्स जमा करें, इनाम पाएँ', earnT: 'जल्दी कमाएँ', earnS: 'हर पीस पर सबसे ज़्यादा पॉइंट्स वाले स्टाइल, अभी स्टॉक में',
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
