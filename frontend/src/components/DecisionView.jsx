import { useEffect, useMemo, useState } from 'react'
import {
  Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { fetchDecision } from '../api'
import { gw, gwh, shiftDay, signedGw, ukDateTime, ukDay, ukTime } from '../format'
import { COLORS, Card, ErrorBox, Kpi, Loading, TooltipBox } from './ui'

/** Merge hourly forecast points, half-hourly actuals and older runs onto one time axis. */
export function buildChartRows(view) {
  const rows = new Map()
  const row = (iso) => {
    const t = Date.parse(iso)
    if (!rows.has(t)) rows.set(t, { t })
    return rows.get(t)
  }
  view.points.forEach((p) => {
    Object.assign(row(p.time), { forecast: p.forecast, band: p.p10 != null ? [p.p10, p.p90] : null })
  })
  view.actuals.forEach((a) => { row(a.time).actual = a.actual })
  view.previous_runs.forEach((run, i) => {
    run.points.forEach((p) => { row(p.time)[`prev${i}`] = p.forecast })
  })
  return [...rows.values()].sort((a, b) => a.t - b.t)
}

function ChartTooltip({ active, payload, label, view }) {
  if (!active || !payload?.length) return null
  const r = payload[0].payload
  const rows = []
  if (r.forecast != null) rows.push({ label: 'Forecast', value: gw(r.forecast, 2), color: COLORS.forecast })
  if (r.band) rows.push({ label: '80% range', value: `${gw(r.band[0])} – ${gw(r.band[1])}`, color: COLORS.band })
  if (r.actual != null) rows.push({ label: 'Actual', value: gw(r.actual, 2), color: COLORS.actual })
  view.previous_runs.forEach((run, i) => {
    if (r[`prev${i}`] != null) rows.push({ label: `Run ${ukTime(run.publish_time)}`, value: gw(r[`prev${i}`], 2), color: COLORS.previous })
  })
  return <TooltipBox title={ukTime(new Date(label).toISOString())} rows={rows} />
}

export default function DecisionView({ meta, cutoff }) {
  const [day, setDay] = useState('2026-01-15')
  const [view, setView] = useState(null)
  const [error, setError] = useState(null)
  const [showActual, setShowActual] = useState(true)
  const [showPrevious, setShowPrevious] = useState(false)

  useEffect(() => {
    let cancelled = false
    setError(null)
    fetchDecision(day, cutoff)
      .then((v) => !cancelled && setView(v))
      .catch((e) => !cancelled && setError(e.message))
    return () => { cancelled = true }
  }, [day, cutoff])

  const rows = useMemo(() => (view ? buildChartRows(view) : []), [view])
  const xTicks = useMemo(() => rows.filter((r) => r.forecast != null).map((r) => r.t).filter((_, i) => i % 3 === 0), [rows])
  const first = meta.first_delivery_day
  const last = meta.last_delivery_day
  const s = view?.summary

  return (
    <div className="stack">
      <div className="toolbar">
        <div className="day-nav">
          <button onClick={() => setDay(shiftDay(day, -1))} disabled={day <= first} aria-label="Previous day">‹</button>
          <input type="date" value={day} min={first} max={last} onChange={(e) => e.target.value && setDay(e.target.value)} aria-label="Delivery day" />
          <button onClick={() => setDay(shiftDay(day, 1))} disabled={day >= last} aria-label="Next day">›</button>
        </div>
        <div className="toggles">
          <label><input type="checkbox" checked={showActual} onChange={(e) => setShowActual(e.target.checked)} /> Show actual outcome</label>
          <label><input type="checkbox" checked={showPrevious} onChange={(e) => setShowPrevious(e.target.checked)} /> Show earlier forecast runs</label>
        </div>
      </div>

      {error && <ErrorBox message={error} />}
      {!view && !error && <Loading />}

      {view && (
        <>
          <div className="info-strip">
            <div>
              <strong>Delivery {ukDay(view.delivery_day)}</strong> · decision at {ukDateTime(view.cutoff_utc)}
            </div>
            <div>
              Latest forecast available: <strong>published {ukDateTime(view.publish_time)}</strong>
              {' '}({view.forecast_age_minutes} min before cutoff, {view.lead_time_hours} h before delivery starts)
            </div>
          </div>

          <div className="kpis">
            <Kpi label="Forecast wind energy" value={gwh(s.forecast_energy_mwh)} hint={`avg ${gw(s.forecast_mean_mw)} · range ${gw(s.forecast_min_mw)}–${gw(s.forecast_max_mw)}`} />
            <Kpi
              label="Cautious case (P10)"
              value={gwh(s.p10_energy_mwh)}
              hint={view.band.available ? 'every hour at its low (P10) end · plan to cover the gap' : 'not enough history'}
              tone="accent"
            />
            <Kpi label="Optimistic case (P90)" value={gwh(s.p90_energy_mwh)} hint="every hour at its high (P90) end" />
            {showActual && (
              <Kpi
                label="Actual (in hindsight)"
                value={gwh(s.actual_energy_mwh)}
                hint={s.day_mae_mw != null ? `day MAE ${gw(s.day_mae_mw, 2)} · bias ${signedGw(s.day_bias_mw)}` : 'not settled yet'}
              />
            )}
          </div>

          <Card
            title="Wind generation forecast for the delivery day"
            subtitle={view.band.available
              ? `Shaded range = forecast adjusted by the 10th–90th percentile of day-ahead errors over the previous ${view.band.history_days} fully-settled days (known at decision time).`
              : 'Not enough history yet to estimate an error range.'}
          >
            <div className="chart" style={{ height: 380 }}>
              <ResponsiveContainer>
                <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={COLORS.grid} vertical={false} />
                  <XAxis
                    dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} ticks={xTicks}
                    tickFormatter={(t) => ukTime(new Date(t).toISOString())}
                    stroke={COLORS.axis} tickLine={false} fontSize={12}
                  />
                  <YAxis domain={[0, (max) => Math.ceil(max / 4000) * 4000]} tickCount={6} allowDecimals={false} tickFormatter={(v) => `${v / 1000}`} stroke={COLORS.axis} tickLine={false} axisLine={false} fontSize={12}
                    label={{ value: 'GW', angle: 0, position: 'insideTopLeft', offset: 0, dy: -4, fill: 'var(--text-muted)', fontSize: 12 }} />
                  <Tooltip content={<ChartTooltip view={view} />} />
                  <Legend verticalAlign="top" height={32} iconType="plainline" />
                  {view.band.available && (
                    <Area dataKey="band" name="80% range (P10–P90)" fill={COLORS.band} stroke="none" fillOpacity={1} connectNulls isAnimationActive={false} />
                  )}
                  {showPrevious && view.previous_runs.map((run, i) => (
                    <Line key={run.publish_time} dataKey={`prev${i}`} name={i === 0 ? 'Earlier runs' : undefined} legendType={i === 0 ? 'plainline' : 'none'}
                      stroke={COLORS.previous} strokeDasharray="4 4" strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
                  ))}
                  <Line dataKey="forecast" name="Forecast" stroke={COLORS.forecast} strokeWidth={2.5} dot={false} connectNulls isAnimationActive={false} />
                  {showActual && (
                    <Line dataKey="actual" name="Actual" stroke={COLORS.actual} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
