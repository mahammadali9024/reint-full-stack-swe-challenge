import { useEffect, useState } from 'react'
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { fetchAccuracy } from '../api'
import { gw, pct, shortDay, signedGw, ukDateTime } from '../format'
import { COLORS, Card, ErrorBox, Kpi, Loading, TooltipBox } from './ui'

const axisProps = { stroke: COLORS.axis, tickLine: false, fontSize: 12 }
const gwTick = (v) => `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}`

/** Plain-language findings for the trading desk, derived from the numbers. */
export function insights(report) {
  const o = report.overall
  const out = []
  if (Math.abs(o.bias) > 0.25 * o.mae) {
    out.push(o.bias < 0
      ? `Forecasts over-estimated wind by ${gw(-o.bias, 2)} on average. Buying against the raw forecast would systematically leave you short — the cautious (P10) case is the safer planning basis.`
      : `Forecasts under-estimated wind by ${gw(o.bias, 2)} on average, so buying against the raw forecast tends to over-procure.`)
  }
  out.push(`Typical hourly error is ${gw(o.mae, 2)} (${pct(o.nmae_pct)} of average output); 1 hour in 10 misses by more than ${gw(o.p90_abs_error, 1)}.`)
  if (report.band_coverage_pct != null) {
    out.push(`The 80% error range shown on the forecast view contained ${pct(report.band_coverage_pct)} of actual outcomes — ${Math.abs(report.band_coverage_pct - report.band_target_pct) <= 5 ? 'well calibrated, so it can be trusted for risk sizing' : 'treat it with caution'}.`)
  }
  const h = report.horizon
  if (h.length > 1) {
    out.push(`Errors grow with lead time: ${gw(h[0].mae, 2)} MAE for the next few hours vs ${gw(h[h.length - 1].mae, 2)} two days out.`)
  }
  return out
}

function SimpleTooltip({ active, payload, title, rows }) {
  if (!active || !payload?.length) return null
  const r = payload[0].payload
  return <TooltipBox title={title(r)} rows={rows(r)} />
}

export default function AccuracyView({ cutoff }) {
  const [report, setReport] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setReport(null)
    setError(null)
    fetchAccuracy(cutoff)
      .then((r) => !cancelled && setReport(r))
      .catch((e) => !cancelled && setError(e.message))
    return () => { cancelled = true }
  }, [cutoff])

  if (error) return <ErrorBox message={error} />
  if (!report) return <Loading />
  const o = report.overall

  return (
    <div className="stack">
      <p className="lead">
        How good was the forecast available at the <strong>{report.cutoff}</strong> cutoff, across all {report.daily.length} delivery
        days ({shortDay(report.first_delivery_day)} – {shortDay(report.last_delivery_day)})? Error = actual − forecast.
      </p>

      <div className="kpis">
        <Kpi label="Mean absolute error" value={gw(o.mae, 2)} hint={`${pct(o.nmae_pct)} of average output`} />
        <Kpi label="Bias (actual − forecast)" value={signedGw(o.bias)} hint={o.bias < 0 ? 'forecast too high → shortfall risk' : 'forecast too low'} tone={o.bias < 0 ? 'warn' : ''} />
        <Kpi label="RMSE" value={gw(o.rmse, 2)} hint="penalises large misses" />
        <Kpi label="P90 absolute error" value={gw(o.p90_abs_error, 2)} hint="9 hours in 10 are within this" />
        <Kpi label="Worst hourly shortfall" value={gw(o.max_shortfall, 2)} hint="largest wind below forecast" />
        <Kpi label="80% range coverage" value={pct(report.band_coverage_pct)} hint={`target ${report.band_target_pct}%`} />
      </div>

      <Card title="Key findings" className="insights">
        <ul>{insights(report).map((t) => <li key={t}>{t}</li>)}</ul>
      </Card>

      <div className="grid-2">
        <Card title="Daily average wind: forecast vs actual" subtitle="Forecast = run used for that day's decision">
          <div className="chart" style={{ height: 280 }}>
            <ResponsiveContainer>
              <LineChart data={report.daily} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={COLORS.grid} vertical={false} />
                <XAxis dataKey="day" tickFormatter={shortDay} {...axisProps} minTickGap={24} />
                <YAxis tickFormatter={gwTick} {...axisProps} axisLine={false} unit=" GW" width={56} />
                <Tooltip content={<SimpleTooltip title={(r) => `Delivery ${shortDay(r.day)}`} rows={(r) => [
                  { label: 'Forecast', value: gw(r.mean_forecast, 2), color: COLORS.forecast },
                  { label: 'Actual', value: gw(r.mean_actual, 2), color: COLORS.actual },
                  { label: 'Run used', value: ukDateTime(r.publish_time) },
                ]} />} />
                <Legend verticalAlign="top" height={28} iconType="plainline" />
                <Line isAnimationActive={false} dataKey="mean_forecast" name="Forecast" stroke={COLORS.forecast} strokeWidth={2} dot={false} />
                <Line isAnimationActive={false} dataKey="mean_actual" name="Actual" stroke={COLORS.actual} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Daily bias" subtitle="Below zero = wind came in under forecast (you would be short)">
          <div className="chart" style={{ height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={report.daily} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={COLORS.grid} vertical={false} />
                <XAxis dataKey="day" tickFormatter={shortDay} {...axisProps} minTickGap={24} />
                <YAxis tickFormatter={gwTick} {...axisProps} axisLine={false} unit=" GW" width={56} />
                <ReferenceLine y={0} stroke="var(--text-muted)" />
                <Tooltip cursor={{ fill: 'var(--hover)' }} content={<SimpleTooltip title={(r) => `Delivery ${shortDay(r.day)}`} rows={(r) => [
                  { label: 'Bias', value: signedGw(r.bias) },
                  { label: 'MAE', value: gw(r.mae, 2) },
                ]} />} />
                <Bar isAnimationActive={false} dataKey="bias" radius={[3, 3, 3, 3]}>
                  {report.daily.map((d) => <Cell key={d.day} fill={d.bias < 0 ? 'var(--neg)' : 'var(--pos)'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Error vs forecast lead time" subtitle="All forecast runs for these days — how much does waiting for a newer forecast help?">
          <div className="chart" style={{ height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={report.horizon} margin={{ top: 8, right: 16, bottom: 16, left: 0 }}>
                <CartesianGrid stroke={COLORS.grid} vertical={false} />
                <XAxis dataKey="horizon_from_h" tickFormatter={(h) => `${h}h`} {...axisProps}
                  label={{ value: 'hours ahead', position: 'insideBottom', offset: -10, fill: 'var(--text-muted)', fontSize: 12 }} />
                <YAxis tickFormatter={gwTick} {...axisProps} axisLine={false} unit=" GW" width={56} />
                <Tooltip cursor={{ fill: 'var(--hover)' }} content={<SimpleTooltip title={(r) => `${r.horizon_from_h}–${r.horizon_to_h} h ahead`} rows={(r) => [
                  { label: 'MAE', value: gw(r.mae, 2) },
                  { label: 'Samples', value: r.count.toLocaleString('en-GB') },
                ]} />} />
                <Bar isAnimationActive={false} dataKey="mae" fill={COLORS.forecast} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Error by hour of day" subtitle="Mean absolute error, UK local hour of delivery">
          <div className="chart" style={{ height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={report.by_hour} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={COLORS.grid} vertical={false} />
                <XAxis dataKey="hour" tickFormatter={(h) => `${String(h).padStart(2, '0')}:00`} {...axisProps} minTickGap={16} />
                <YAxis tickFormatter={gwTick} {...axisProps} axisLine={false} unit=" GW" width={56} />
                <Tooltip cursor={{ fill: 'var(--hover)' }} content={<SimpleTooltip title={(r) => `${String(r.hour).padStart(2, '0')}:00`} rows={(r) => [
                  { label: 'MAE', value: gw(r.mae, 2) },
                  { label: 'Bias', value: signedGw(r.bias) },
                ]} />} />
                <Bar isAnimationActive={false} dataKey="mae" fill={COLORS.forecast} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Distribution of hourly errors" subtitle="Actual − forecast, 0.5 GW bins">
          <div className="chart" style={{ height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={report.histogram} margin={{ top: 8, right: 16, bottom: 0, left: 0 }} barCategoryGap={2}>
                <CartesianGrid stroke={COLORS.grid} vertical={false} />
                <XAxis dataKey="from_mw" tickFormatter={gwTick} {...axisProps} unit=" GW" />
                <YAxis {...axisProps} axisLine={false} width={40} />
                <Tooltip cursor={{ fill: 'var(--hover)' }} content={<SimpleTooltip title={(r) => `${gwTick(r.from_mw)} to ${gwTick(r.to_mw)} GW`} rows={(r) => [
                  { label: 'Hours', value: r.count },
                ]} />} />
                <Bar isAnimationActive={false} dataKey="count" radius={[3, 3, 0, 0]}>
                  {report.histogram.map((b) => <Cell key={b.from_mw} fill={b.to_mw <= 0 ? 'var(--neg)' : 'var(--pos)'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Does a later decision help?" subtitle="Same delivery days, forecast available at each auction's cutoff">
          <table className="table">
            <thead>
              <tr><th>Cutoff</th><th>MAE</th><th>Bias</th><th>P90 |error|</th></tr>
            </thead>
            <tbody>
              {report.cutoff_comparison.map((c) => (
                <tr key={c.time} className={c.time === report.cutoff ? 'current' : ''}>
                  <td>{c.label}</td>
                  <td>{gw(c.mae, 2)}</td>
                  <td>{signedGw(c.bias)}</td>
                  <td>{gw(c.p90_abs_error, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  )
}
