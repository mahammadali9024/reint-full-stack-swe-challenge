import { describe, expect, it } from 'vitest'
import { buildChartRows } from './DecisionView'
import { insights } from './AccuracyView'

describe('buildChartRows', () => {
  it('merges hourly forecast, half-hourly actuals and earlier runs by time', () => {
    const rows = buildChartRows({
      points: [{ time: '2026-01-15T00:00:00Z', forecast: 100, p10: 80, p90: 120, actual: 90 }],
      actuals: [
        { time: '2026-01-15T00:00:00Z', actual: 90 },
        { time: '2026-01-15T00:30:00Z', actual: 95 },
      ],
      previous_runs: [{ publish_time: 'x', points: [{ time: '2026-01-15T00:00:00Z', forecast: 110 }] }],
    })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ forecast: 100, band: [80, 120], actual: 90, prev0: 110 })
    expect(rows[1]).toMatchObject({ actual: 95 })
    expect(rows[1].forecast).toBeUndefined()
  })
})

describe('insights', () => {
  const base = {
    overall: { mae: 2000, bias: -1700, nmae_pct: 18, p90_abs_error: 4100 },
    band_coverage_pct: 81.6,
    band_target_pct: 80,
    horizon: [{ mae: 1600 }, { mae: 2300 }],
  }
  it('warns about systematic over-forecasting', () => {
    expect(insights(base)[0]).toMatch(/over-estimated wind by 1.70 GW/)
  })
  it('calls a band calibrated when coverage is near target', () => {
    expect(insights(base).join(' ')).toMatch(/well calibrated/)
  })
  it('skips the bias finding when bias is small', () => {
    const r = { ...base, overall: { ...base.overall, bias: 100 } }
    expect(insights(r).join(' ')).not.toMatch(/estimated wind/)
  })
})
