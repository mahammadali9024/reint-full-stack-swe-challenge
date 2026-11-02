const CUSTOM = 'custom'

export default function CutoffPicker({ presets, value, onChange }) {
  const isPreset = presets.some((p) => p.time === value)

  return (
    <div className="cutoff">
      <label htmlFor="cutoff-select">Decision cutoff (day before delivery)</label>
      <div className="cutoff-row">
        <select
          id="cutoff-select"
          value={isPreset ? value : CUSTOM}
          onChange={(e) => e.target.value !== CUSTOM && onChange(e.target.value)}
        >
          {presets.map((p) => (
            <option key={p.time} value={p.time}>{p.label}</option>
          ))}
          <option value={CUSTOM}>Custom time…</option>
        </select>
        <input
          type="time"
          aria-label="Custom cutoff time"
          value={value}
          onChange={(e) => e.target.value && onChange(e.target.value)}
        />
      </div>
    </div>
  )
}
