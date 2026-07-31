import React, { useEffect, useState } from 'react'

export const PROJECT_ACCESS_STORAGE_KEY = 'jefferson-project-access'

export default function OwnerAccessGate({ children }) {
  const [code, setCode] = useState(() => (
    sessionStorage.getItem(PROJECT_ACCESS_STORAGE_KEY)
    || sessionStorage.getItem('jefferson-plan-access')
    || ''
  ))
  const [input, setInput] = useState(code)
  const [status, setStatus] = useState(code ? 'checking' : 'locked')
  const [error, setError] = useState('')

  useEffect(() => {
    if (code) verify(code)
  }, [])

  async function verify(value = input) {
    const clean = value.trim()
    if (!clean) return
    setStatus('checking')
    setError('')
    try {
      const response = await fetch('/api/project-access', {
        headers: { 'x-project-access-code': clean, accept: 'application/json' },
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Access could not be verified')
      sessionStorage.setItem(PROJECT_ACCESS_STORAGE_KEY, clean)
      sessionStorage.setItem('jefferson-plan-access', clean)
      setCode(clean)
      setInput(clean)
      setStatus('unlocked')
    } catch (reason) {
      sessionStorage.removeItem(PROJECT_ACCESS_STORAGE_KEY)
      sessionStorage.removeItem('jefferson-plan-access')
      setCode('')
      setStatus('locked')
      setError(reason.message)
    }
  }

  if (status === 'unlocked') return children

  if (status === 'checking') {
    return <div className="min-h-screen flex items-center justify-center text-lbl3 text-sm" style={{ background: '#000' }}>Opening private workspace…</div>
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-5" style={{ background: '#000' }}>
      <main className="w-full max-w-md">
        <div className="apple-card p-7">
          <div className="text-xs font-semibold uppercase tracking-widest text-lbl3">Owner workspace</div>
          <h1 className="text-white font-bold text-2xl mt-2">3120 Jefferson Street</h1>
          <p className="text-lbl2 text-sm mt-2 mb-6">Enter the private project access code. Shared subcontractor links open a separate read-only portal.</p>
          <form onSubmit={event => { event.preventDefault(); verify() }}>
            <label className="block text-xs text-lbl3 mb-2" htmlFor="project-access-code">Project access code</label>
            <input
              id="project-access-code"
              type="password"
              value={input}
              onChange={event => setInput(event.target.value)}
              className="apple-input w-full"
              autoComplete="current-password"
              autoFocus
            />
            {error && <p className="text-xs mt-2" style={{ color: '#ff453a' }}>{error}</p>}
            <button type="submit" className="btn-primary w-full py-2.5 mt-4 text-sm">Open owner workspace</button>
          </form>
        </div>
        <p className="text-lbl3 text-xs text-center mt-4">Schedule, selection, and plan share links never unlock this workspace.</p>
      </main>
    </div>
  )
}

