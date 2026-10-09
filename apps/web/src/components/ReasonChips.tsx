export function ReasonChips({ label, options, value, onChange }: { label: string; options: string[]; value: string | null; onChange: (v: string) => void }) {
  return (
    <div className="fgroup" role="radiogroup" aria-label={label}>
      <div className="eyebrow">{label}</div>
      <div className="chips">{options.map(r => <button type="button" key={r} role="radio" aria-checked={value === r} className="chip" aria-pressed={value === r} onClick={() => onChange(r)}>{r}</button>)}</div>
    </div>
  );
}
