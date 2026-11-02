export function Kpi({ label, value, hint, tone }) {
  return (
    <div className={`kpi ${tone || ''}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {hint && <div className="kpi-hint">{hint}</div>}
    </div>
  )
}

export function Card({ title, subtitle, children, className = '' }) {
  return (
    <section className={`card ${className}`}>
      {title && <h2>{title}</h2>}
      {subtitle && <p className="card-subtitle">{subtitle}</p>}
      {children}
    </section>
  )
}

export function Loading() {
  return <div className="loading" role="status">Loading…</div>
}

export function ErrorBox({ message }) {
  return <div className="error">{message}</div>
}

/** Recharts tooltip in the app's style. rows: [{label, value, color}] */
export function TooltipBox({ title, rows }) {
  return (
    <div className="tooltip">
      <div className="tooltip-title">{title}</div>
      {rows.map((r) => (
        <div className="tooltip-row" key={r.label}>
          {r.color && <span className="swatch" style={{ background: r.color }} />}
          <span className="tooltip-label">{r.label}</span>
          <span className="tooltip-value">{r.value}</span>
        </div>
      ))}
    </div>
  )
}

export const COLORS = {
  forecast: 'var(--series-forecast)',
  actual: 'var(--series-actual)',
  band: 'var(--series-band)',
  previous: 'var(--series-previous)',
  grid: 'var(--grid)',
  axis: 'var(--text-muted)',
}
