const UK = 'Europe/London'

export const ukTime = (iso) =>
  new Date(iso).toLocaleTimeString('en-GB', { timeZone: UK, hour: '2-digit', minute: '2-digit' })

export const ukDateTime = (iso) =>
  new Date(iso).toLocaleString('en-GB', {
    timeZone: UK, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })

export const ukDay = (isoDate) =>
  new Date(`${isoDate}T12:00:00Z`).toLocaleDateString('en-GB', {
    timeZone: UK, weekday: 'short', day: 'numeric', month: 'short',
  })

export const shortDay = (isoDate) =>
  new Date(`${isoDate}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: UK, day: 'numeric', month: 'short' })

export const gw = (mw, digits = 1) => (mw == null ? '–' : `${(mw / 1000).toFixed(digits)} GW`)
export const gwh = (mwh) => (mwh == null ? '–' : `${Math.round(mwh / 1000).toLocaleString('en-GB')} GWh`)
export const signedGw = (mw) => (mw == null ? '–' : `${mw > 0 ? '+' : mw < 0 ? '−' : ''}${(Math.abs(mw) / 1000).toFixed(2)} GW`)
export const pct = (v) => (v == null ? '–' : `${v.toFixed(1)}%`)

export function shiftDay(isoDate, delta) {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}
