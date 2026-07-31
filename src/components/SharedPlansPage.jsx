import React, { useEffect, useState } from 'react'

function formatSize(bytes) {
  if (!bytes) return ''
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function SharedPlansPage({ token }) {
  const [plans, setPlans] = useState([])
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    fetch(`/api/shared-plans?token=${encodeURIComponent(token)}`, { headers: { accept: 'application/json' } })
      .then(response => response.ok ? response.json() : response.json().then(data => Promise.reject(new Error(data.error || 'Link unavailable'))))
      .then(data => {
        if (!active) return
        setPlans(data.plans || [])
        setSelected((data.plans || []).find(plan => plan.name.startsWith('Architectural')) || data.plans?.[0] || null)
      })
      .catch(reason => { if (active) setError(reason.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [token])

  return (
    <div className="min-h-screen" style={{ background: '#000' }}>
      <header className="glass sticky top-0 z-50" style={{ borderBottom: '1px solid rgba(84,84,88,0.4)' }}>
        <div className="max-w-7xl mx-auto px-5 py-4 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-white font-bold tracking-tight">3120 Jefferson Street</h1>
            <p className="text-lbl2 text-xs mt-0.5">Shared construction plans · View only</p>
          </div>
          <span className="text-xs rounded-full px-3 py-1.5" style={{ color: '#30d158', background: 'rgba(48,209,88,0.12)' }}>Secure link</span>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-5 py-6">
        {loading && <div className="text-center py-24 text-lbl3 text-sm">Opening shared plans…</div>}
        {error && <div className="apple-card max-w-lg mx-auto p-7 text-center"><div className="text-xl mb-3">🔒</div><h2 className="text-white font-semibold">This shared link is unavailable</h2><p className="text-lbl2 text-sm mt-2">{error}</p></div>}
        {!loading && !error && (
          <div className="grid lg:grid-cols-[300px_minmax(0,1fr)] gap-4 items-start">
            <aside className="apple-card overflow-hidden">
              <div className="px-4 py-3 text-xs font-semibold uppercase tracking-widest text-lbl3" style={{ borderBottom: '1px solid rgba(84,84,88,0.35)' }}>{plans.length} documents</div>
              {plans.map(plan => (
                <button key={plan.id} type="button" onClick={() => setSelected(plan)}
                  className="w-full text-left px-4 py-3 transition-colors"
                  style={{ borderBottom: '1px solid rgba(84,84,88,0.22)', background: selected?.id === plan.id ? 'rgba(10,132,255,0.14)' : 'transparent' }}>
                  <div className="text-lbl text-sm font-medium">{plan.name}</div>
                  <div className="text-lbl3 text-xs mt-1">{formatSize(plan.file_size)}</div>
                </button>
              ))}
            </aside>

            <section>
              {selected && (
                <>
                  <div className="flex items-center justify-between gap-4 mb-3">
                    <h2 className="text-white font-semibold text-lg">{selected.name}</h2>
                    <a className="text-acc text-sm font-medium" href={selected.url} target="_blank" rel="noreferrer">Open or download ↗</a>
                  </div>
                  <div className="apple-card overflow-hidden">
                    <iframe src={selected.url} title={selected.name} style={{ width: '100%', height: '78vh', border: 'none', display: 'block' }} />
                  </div>
                </>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  )
}
