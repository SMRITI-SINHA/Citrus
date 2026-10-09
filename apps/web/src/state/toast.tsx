// Toasts confirm things. Destructive actions offer Undo. Errors that need action are shown inline, not here.
import { useEffect, useSyncExternalStore } from 'react';

interface Toast { id: number; msg: string; undo?: () => void; ms: number }
let cur: Toast | null = null;
let seq = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const subs = new Set<() => void>();
const emit = () => subs.forEach(f => f());

export function toast(msg: string, opts: { undo?: () => void; ms?: number } = {}) {
  clearTimeout(timer);
  cur = { id: ++seq, msg, undo: opts.undo, ms: opts.ms ?? (opts.undo ? 6000 : 2800) };
  emit();
  timer = setTimeout(() => { cur = null; emit(); }, cur.ms);
}
export function dismissToast() { clearTimeout(timer); cur = null; emit(); }

export function Toaster() {
  const tst = useSyncExternalStore(f => { subs.add(f); return () => { subs.delete(f); }; }, () => cur);
  useEffect(() => {
    if (!tst) return;
    const onKey = (e: KeyboardEvent) => {
      if (tst.undo && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !(e.target instanceof HTMLInputElement)) { e.preventDefault(); tst.undo(); dismissToast(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tst]);
  return (
    <div className="toast-host" aria-live="polite" aria-atomic="true">
      {tst && (
        <div className="toast" key={tst.id} role="status">
          <span>{tst.msg}</span>
          {tst.undo && <button type="button" onClick={() => { tst.undo!(); dismissToast(); }}>Undo</button>}
        </div>
      )}
    </div>
  );
}
