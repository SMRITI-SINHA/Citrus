import type { OrderLine } from '@citrus/shared';
import { num } from '../lib/format';

export function groupOrderLines(lines: OrderLine[]) {
  const m = new Map<string, { styleId: string; name: string; color: string; ls: OrderLine[] }>();
  for (const l of lines) {
    const k = l.styleId + '|' + l.color;
    if (!m.has(k)) m.set(k, { styleId: l.styleId, name: l.name, color: l.color, ls: [] });
    m.get(k)!.ls.push(l);
  }
  return [...m.values()];
}

export function GroupedLines({ lines }: { lines: OrderLine[] }) {
  return (
    <>
      {groupOrderLines(lines).map(g => (
        <div key={g.styleId + g.color} className="dgrp">
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}><b>{g.name}, {g.color}</b><b className="num">{num(g.ls.reduce((a, l) => a + l.qty, 0))} pcs</b></div>
          <div className="cline" style={{ padding: 0, display: 'block' }}><div className="szs" style={{ marginTop: 0 }}>{g.ls.map(l => <span key={l.size}>{l.size} × {l.qty}</span>)}</div></div>
        </div>
      ))}
    </>
  );
}

