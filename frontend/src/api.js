const BASE = import.meta.env.VITE_API_URL || ''

async function get(path, params = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null)).toString()
  const res = await fetch(`${BASE}/api${path}${qs ? `?${qs}` : ''}`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail || `Request failed (${res.status})`)
  }
  return res.json()
}

export const fetchMeta = () => get('/meta')
export const fetchDecision = (day, cutoff) => get(`/decision/${day}`, { cutoff })
export const fetchAccuracy = (cutoff) => get('/accuracy', { cutoff })
