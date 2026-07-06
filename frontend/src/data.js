const BASE = __DATA_BASE__

export async function fetchIndex() {
  const res = await fetch(`${BASE}/reports/index.json`)
  if (!res.ok) throw new Error(`index.json ${res.status}`)
  return res.json()
}

export async function fetchReport(date) {
  const res = await fetch(`${BASE}/reports/${date}.json`)
  if (!res.ok) throw new Error(`${date}.json ${res.status}`)
  return res.json()
}

export async function fetchCloud() {
  const res = await fetch(`${BASE}/trend-cloud.json`)
  if (!res.ok) throw new Error(`trend-cloud.json ${res.status}`)
  return res.json()
}
