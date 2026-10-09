// Voice search in English or Hindi (Web Speech API where available), plus Hinglish normalisation for typed search.
import { useState } from 'react';
import { getLang, useT } from '../../lib/i18n';
import { toast } from '../../state/toast';
import { Icon } from '../../components/Icon';

const HINGLISH: Record<string, string> = {
  kameez: 'shirt', kamiz: 'shirt', kamij: 'shirt', sirt: 'shirt', shart: 'shirt', shirtt: 'shirt', kurti: 'shirt',
  pent: 'trouser', pant: 'trouser', pants: 'trouser', patloon: 'trouser', patlun: 'trouser', paint: 'trouser', trouzer: 'trouser', trowser: 'trouser',
  jeens: 'denim', jeans: 'denim', jins: 'denim', tshirt: 't-shirt', 'tee-shirt': 't-shirt', banyan: 't-shirt', baniyan: 't-shirt', polo: 'polo',
  safed: 'white', safeed: 'white', kala: 'black', kaala: 'black', neela: 'blue', nila: 'blue', aasmani: 'sky blue', asmani: 'sky blue',
  laal: 'maroon', lal: 'maroon', hara: 'olive', khaki: 'khaki', bhura: 'khaki', gulabi: 'pink', dhaari: 'stripe', dhari: 'stripe', check: 'check', chex: 'check',
  // Devanagari
  'शर्ट': 'shirt', 'कमीज़': 'shirt', 'कमीज': 'shirt', 'पैंट': 'trouser', 'पतलून': 'trouser', 'जींस': 'denim', 'टीशर्ट': 't-shirt', 'टी-शर्ट': 't-shirt',
  'सफ़ेद': 'white', 'सफेद': 'white', 'काला': 'black', 'नीला': 'blue', 'लाल': 'maroon', 'हरा': 'olive', 'गुलाबी': 'pink',
};

export function normaliseQuery(q: string) {
  return q.trim().toLowerCase().split(/\s+/).filter(Boolean).map(w => HINGLISH[w] ?? w).join(' ');
}

type Rec = { lang: string; interimResults: boolean; maxAlternatives: number; start(): void; abort(): void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null };

export function VoiceButton({ onResult }: { onResult: (q: string) => void }) {
  const { t } = useT();
  const [on, setOn] = useState(false);
  function start() {
    const W = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
    const C = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!C) { toast('Voice search is not available in this browser. Type the style, e.g. "white shirt L"'); return; }
    const r = new C();
    r.lang = getLang() === 'hi' ? 'hi-IN' : 'en-IN';
    r.interimResults = false; r.maxAlternatives = 1;
    r.onresult = e => { const txt = e.results[0]?.[0]?.transcript ?? ''; if (txt) onResult(normaliseQuery(txt)); };
    r.onerror = e => { if (e.error !== 'aborted' && e.error !== 'no-speech') toast('Could not hear that. Try again or type it'); };
    r.onend = () => setOn(false);
    setOn(true);
    toast('Listening… say a style in Hindi or English, e.g. "white shirt L"');
    try { r.start(); } catch { setOn(false); }
  }
  return (
    <button type="button" className="iconbtn mic" onClick={start} aria-label={t('voice')} aria-pressed={on} style={on ? { borderColor: 'var(--citrus)', background: 'var(--citrus-soft)' } : undefined}>
      <Icon name="mic" size={20} />
    </button>
  );
}
