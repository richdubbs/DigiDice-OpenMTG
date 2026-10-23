/** The deck's format dropdown (formats.ts); a format id this version does not know stays selectable instead of being lost. */
import { FORMAT_OPTIONS, formatOption } from './formats';

export function FormatSelect({ value, onChange }: { value: string; onChange: (format: string) => void }) {
  return (
    <label className="deck-format">
      <span className="sr-only">Format</span>
      <select aria-label="Format" title={formatOption(value).name} value={value} onChange={(e) => onChange(e.target.value)}>
        {FORMAT_OPTIONS.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
        {!FORMAT_OPTIONS.some((f) => f.id === value) && <option value={value}>{value}</option>}
      </select>
    </label>
  );
}
