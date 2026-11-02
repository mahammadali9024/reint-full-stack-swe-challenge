import { useEffect, useState } from 'react'
import { fetchMeta } from './api'
import CutoffPicker from './components/CutoffPicker'
import DecisionView from './components/DecisionView'
import AccuracyView from './components/AccuracyView'

const TABS = [
  { id: 'decision', label: 'Day-ahead forecast' },
  { id: 'accuracy', label: 'Forecast accuracy' },
]

export default function App() {
  const [meta, setMeta] = useState(null)
  const [error, setError] = useState(null)
  const [tab, setTabState] = useState(() => (window.location.hash === '#accuracy' ? 'accuracy' : 'decision'))
  const setTab = (id) => {
    setTabState(id)
    window.history.replaceState(null, '', `#${id}`)
  }
  const [cutoff, setCutoff] = useState(null)

  useEffect(() => {
    fetchMeta()
      .then((m) => {
        setMeta(m)
        setCutoff(m.default_cutoff)
      })
      .catch((e) => setError(e.message))
  }, [])

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <span className="logo" aria-hidden>◢</span>
          <div>
            <h1>Wind Forecast Desk</h1>
            <p className="subtitle">GB national wind generation · day-ahead purchasing · January 2026 pilot</p>
          </div>
        </div>
        {meta && <CutoffPicker presets={meta.cutoff_presets} value={cutoff} onChange={setCutoff} />}
      </header>

      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? 'tab active' : 'tab'}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main>
        {error && <div className="error">Could not reach the API: {error}</div>}
        {meta && cutoff && tab === 'decision' && <DecisionView meta={meta} cutoff={cutoff} />}
        {meta && cutoff && tab === 'accuracy' && <AccuracyView cutoff={cutoff} />}
      </main>

      <footer className="footer">
        Data: Elexon BMRS — FUELHH (actual wind, half-hourly) and WINDFOR (wind forecast, hourly). Times shown in UK local time.
      </footer>
    </div>
  )
}
